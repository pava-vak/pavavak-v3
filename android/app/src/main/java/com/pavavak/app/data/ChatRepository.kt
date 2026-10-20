package com.pavavak.app.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant
import java.util.UUID

sealed interface SessionState {
    data object Loading : SessionState
    data object SignedOut : SessionState
    data class SignedIn(val user: User) : SessionState
}

data class ChatListState(
    val chats: List<ChatSummary> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
)

/** Messages are kept oldest-first; the UI renders them reversed from the bottom. */
data class ThreadState(
    val messages: List<Message> = emptyList(),
    val hasMore: Boolean = false,
    val nextCursor: String? = null,
    val loading: Boolean = false,
    val loadingMore: Boolean = false,
    val error: String? = null,
)

class ChatRepository(
    private val api: ApiClient,
    private val store: SecureStore,
    private val realtime: RealtimeClient,
    private val scope: CoroutineScope,
) {
    private val _session = MutableStateFlow<SessionState>(SessionState.Loading)
    val session: StateFlow<SessionState> = _session

    private val _chatList = MutableStateFlow(ChatListState())
    val chatList: StateFlow<ChatListState> = _chatList

    private val _threads = MutableStateFlow<Map<String, ThreadState>>(emptyMap())
    val threads: StateFlow<Map<String, ThreadState>> = _threads

    private val _typing = MutableStateFlow<Map<String, String>>(emptyMap())
    val typing: StateFlow<Map<String, String>> = _typing

    private var activeChatId: String? = null
    private var inForeground = true
    private val pendingReadJobs = HashMap<String, Job>()

    init {
        api.onSessionExpired = { scope.launch { onSignedOut() } }
        scope.launch { realtime.events.collect { handleEvent(it) } }
    }

    // ── App lifecycle ───────────────────────────────────────────────────────

    /** No live connection and no read receipts while the user can't see the app. */
    fun onAppBackground() {
        inForeground = false
        realtime.disconnect()
    }

    fun onAppForeground() {
        inForeground = true
        if (_session.value is SessionState.SignedIn) realtime.connect() // "connect" event reloads chats + open thread
    }

    // ── Session ─────────────────────────────────────────────────────────────

    fun restoreSession() {
        val cached = store.user
        if (store.accessToken == null || cached == null) {
            _session.value = SessionState.SignedOut
            return
        }
        _session.value = SessionState.SignedIn(cached)
        realtime.connect()
        refreshChats()
        scope.launch { runCatching { api.me() }.onSuccess { _session.value = SessionState.SignedIn(it) } }
    }

    suspend fun login(username: String, password: String) {
        val result = api.login(username.trim(), password)
        _session.value = SessionState.SignedIn(result.user)
        realtime.connect()
        refreshChats()
    }

    fun logout() {
        scope.launch {
            realtime.disconnect()
            api.logout()
            onSignedOut()
        }
    }

    private fun onSignedOut() {
        realtime.disconnect()
        activeChatId = null
        pendingReadJobs.values.forEach { it.cancel() }
        pendingReadJobs.clear()
        _typing.value = emptyMap()
        _chatList.value = ChatListState()
        _threads.value = emptyMap()
        _session.value = SessionState.SignedOut
    }

    // ── Chat list ───────────────────────────────────────────────────────────

    fun refreshChats() {
        _chatList.update { it.copy(loading = true, error = null) }
        scope.launch {
            runCatching { api.chats() }
                .onSuccess { chats -> _chatList.value = ChatListState(sortChats(chats)) }
                .onFailure { e -> _chatList.update { it.copy(loading = false, error = e.message) } }
        }
    }

    suspend fun startChatWith(userId: Long): ChatSummary {
        val chat = api.startDirectChat(userId)
        _chatList.update { s -> s.copy(chats = sortChats(listOf(chat) + s.chats.filter { it.chatId != chat.chatId })) }
        return chat
    }

    suspend fun searchUsers(query: String) = api.searchUsers(query)

    private fun sortChats(chats: List<ChatSummary>) =
        chats.sortedByDescending { it.lastMessage?.sentAt.orEmpty() }

    private fun patchChat(chatId: String, transform: (ChatSummary) -> ChatSummary): Boolean {
        var found = false
        _chatList.update { s ->
            s.copy(chats = sortChats(s.chats.map { if (it.chatId == chatId) { found = true; transform(it) } else it }))
        }
        return found
    }

    // ── Thread ──────────────────────────────────────────────────────────────

    fun openChat(chatId: String) {
        activeChatId = chatId
        realtime.join(chatId)
        patchChat(chatId) { it.copy(unreadCount = 0) }
        val existing = _threads.value[chatId]
        updateThread(chatId) { (existing ?: ThreadState()).copy(loading = existing == null, error = null) }
        scope.launch {
            runCatching { api.thread(chatId) }
                .onSuccess { page ->
                    updateThread(chatId) {
                        // If the newest page doesn't reach what we already had, the cache has a gap: start over
                        val known = it.messages.mapTo(HashSet()) { m -> m.messageId }
                        val overlaps = page.items.any { m -> m.messageId in known }
                        val fresh = it.messages.isEmpty() || (!overlaps && page.page.hasMore)
                        it.copy(
                            messages = if (fresh) page.items + it.messages.filter { m -> m.messageId.startsWith("local-") }
                                       else mergeLatest(it.messages, page.items),
                            hasMore = if (fresh) page.page.hasMore else it.hasMore,
                            nextCursor = if (fresh) page.page.nextCursor else it.nextCursor,
                            loading = false,
                        )
                    }
                    if (inForeground && activeChatId == chatId) markReadSoon(chatId)
                }
                .onFailure { e -> updateThread(chatId) { it.copy(loading = false, error = e.message) } }
        }
    }

    fun closeChat(chatId: String) {
        if (activeChatId == chatId) {
            activeChatId = null
            realtime.join(null)
        }
    }

    fun loadOlder(chatId: String) {
        val state = _threads.value[chatId] ?: return
        if (!state.hasMore || state.loadingMore || state.nextCursor == null) return
        updateThread(chatId) { it.copy(loadingMore = true) }
        scope.launch {
            runCatching { api.thread(chatId, state.nextCursor) }
                .onSuccess { page ->
                    updateThread(chatId) { s ->
                        val known = s.messages.mapTo(HashSet()) { it.messageId }
                        s.copy(
                            messages = page.items.filter { it.messageId !in known } + s.messages,
                            hasMore = page.page.hasMore,
                            nextCursor = page.page.nextCursor,
                            loadingMore = false,
                        )
                    }
                }
                .onFailure { updateThread(chatId) { it.copy(loadingMore = false) } }
        }
    }

    fun send(chatId: String, text: String) {
        val body = text.trim()
        if (body.isEmpty()) return
        val localId = "local-${UUID.randomUUID()}"
        val pending = Message(
            messageId = localId, direction = "outgoing", text = body,
            sentAt = Instant.now().toString(), status = "sending",
        )
        updateThread(chatId) { it.copy(messages = it.messages + pending) }
        scope.launch {
            runCatching { api.send(chatId, body) }
                .onSuccess { sent ->
                    updateThread(chatId) { s ->
                        val withoutLocal = s.messages.filter { it.messageId != localId }
                        if (withoutLocal.any { it.messageId == sent.messageId }) s.copy(messages = withoutLocal)
                        else s.copy(messages = s.messages.map { if (it.messageId == localId) sent else it })
                    }
                    patchChat(chatId) { it.copy(lastMessage = LastMessage(sent.messageId, sent.text, sent.sentAt, "outgoing", sent.status)) }
                }
                .onFailure {
                    updateThread(chatId) { s ->
                        s.copy(messages = s.messages.map { m -> if (m.messageId == localId) m.copy(status = "failed") else m })
                    }
                }
        }
    }

    fun retry(chatId: String, message: Message) {
        updateThread(chatId) { s -> s.copy(messages = s.messages.filter { it.messageId != message.messageId }) }
        send(chatId, message.text)
    }

    fun setTyping(chatId: String, typing: Boolean) = realtime.typing(chatId, typing)

    private fun updateThread(chatId: String, transform: (ThreadState) -> ThreadState) {
        _threads.update { map -> map + (chatId to transform(map[chatId] ?: ThreadState())) }
    }

    /** Replaces the newest page while keeping older messages already loaded and unsent local ones. */
    private fun mergeLatest(current: List<Message>, latest: List<Message>): List<Message> {
        if (current.isEmpty()) return latest
        val latestIds = latest.mapTo(HashSet()) { it.messageId }
        val oldestLatest = latest.firstOrNull()?.sentAt.orEmpty()
        val older = current.filter { it.messageId !in latestIds && !it.messageId.startsWith("local-") && it.sentAt < oldestLatest }
        val pending = current.filter { it.messageId.startsWith("local-") }
        return older + latest + pending
    }

    // ── Realtime ────────────────────────────────────────────────────────────

    private fun handleEvent(event: RealtimeEvent) {
        val obj = runCatching { api.json.parseToJsonElement(event.payload).jsonObject }.getOrNull() ?: return
        val chatId = obj.str("chatId")
        when (event.name) {
            "connect" -> {
                refreshChats()
                activeChatId?.let { openChat(it) }
            }
            "disconnect" -> _typing.value = emptyMap()
            "message:new" -> {
                if (chatId == null) return
                val message = runCatching { api.json.decodeFromJsonElement<Message>(obj["message"]!!) }.getOrNull() ?: return
                onIncomingMessage(chatId, message)
            }
            "chat:updated" -> {
                if (chatId == null) return
                if (obj.str("reload") == "true") { refreshChats(); return }
                val last = obj["lastMessage"]?.let { runCatching { api.json.decodeFromJsonElement<LastMessage>(it) }.getOrNull() }
                val unread = (obj["unreadCount"] as? kotlinx.serialization.json.JsonPrimitive)?.intOrNull
                val found = patchChat(chatId) { c ->
                    c.copy(
                        lastMessage = last ?: c.lastMessage,
                        unreadCount = if (chatId == activeChatId) 0 else unread ?: c.unreadCount,
                    )
                }
                if (!found) refreshChats()
            }
            "message:read", "message:delivered" -> {
                val messageId = obj.str("messageId") ?: return
                val status = obj.str("status") ?: if (event.name == "message:read") "read" else "delivered"
                if (chatId != null) updateThread(chatId) { s ->
                    s.copy(messages = s.messages.map { if (it.messageId == messageId) it.copy(status = status) else it })
                }
            }
            "message:deleted" -> {
                val messageId = obj.str("messageId") ?: return
                if (chatId != null) updateThread(chatId) { s ->
                    s.copy(messages = s.messages.map { if (it.messageId == messageId) it.copy(deleted = true, text = "") else it })
                }
            }
            "message:edited" -> {
                val messageId = obj.str("messageId") ?: return
                val text = obj.str("text") ?: return
                if (chatId != null) updateThread(chatId) { s ->
                    s.copy(messages = s.messages.map { if (it.messageId == messageId) it.copy(text = text, edited = true) else it })
                }
            }
            "chat:new" -> refreshChats()
            "chat:removed" -> if (chatId != null) {
                _chatList.update { s -> s.copy(chats = s.chats.filter { it.chatId != chatId }) }
            }
            "typing:start" -> if (chatId != null) {
                _typing.update { it + (chatId to (obj.str("displayName") ?: "typing")) }
            }
            "typing:stop" -> if (chatId != null) _typing.update { it - chatId }
        }
    }

    private fun onIncomingMessage(chatId: String, message: Message) {
        _typing.update { it - chatId }
        if (_threads.value.containsKey(chatId)) {
            updateThread(chatId) { s ->
                if (s.messages.any { it.messageId == message.messageId }) s
                else {
                    // Our own message echoed back before the HTTP response: drop the matching pending copy
                    val pendingTwin = if (message.isOutgoing) s.messages.firstOrNull {
                        it.messageId.startsWith("local-") && it.text == message.text
                    } else null
                    s.copy(messages = s.messages.filter { it !== pendingTwin } + message)
                }
            }
        }
        val isActive = chatId == activeChatId && inForeground
        val found = patchChat(chatId) { c ->
            c.copy(
                lastMessage = LastMessage(message.messageId, message.text, message.sentAt, message.direction, message.status),
                unreadCount = if (isActive || message.isOutgoing) 0 else c.unreadCount + 1,
            )
        }
        if (!found) refreshChats()
        if (isActive && !message.isOutgoing) markReadSoon(chatId)
    }

    /** Coalesces bursts of incoming messages into one read receipt call (the server allows 30/min). */
    private fun markReadSoon(chatId: String) {
        pendingReadJobs[chatId]?.cancel()
        pendingReadJobs[chatId] = scope.launch {
            delay(800)
            if (inForeground && activeChatId == chatId) api.markChatRead(chatId)
            pendingReadJobs.remove(chatId)
        }
    }

    private fun JsonObject.str(key: String): String? = this[key]?.jsonPrimitive?.contentOrNull
}
