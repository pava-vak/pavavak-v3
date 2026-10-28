package com.pavavak.app.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
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

data class IncomingEvent(val chatId: String, val message: Message, val chatOpen: Boolean)

@Serializable
private data class QueuedText(
    val localId: String,
    val chatId: String,
    val body: String,
    val viewOnce: Boolean = false,
    val deleteAfter: String = "never",
    val silent: Boolean = false,
    val burn: String = "off",
    val sentAt: String,
)

class ChatRepository(
    val api: ApiClient,
    private val store: SecureStore,
    private val realtime: RealtimeClient,
    val media: MediaRepository,
    private val lock: AppLock,
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

    /** chatId -> messageId -> reactions */
    private val _reactions = MutableStateFlow<Map<String, Map<String, List<Reaction>>>>(emptyMap())
    val reactions: StateFlow<Map<String, Map<String, List<Reaction>>>> = _reactions

    private val _pinned = MutableStateFlow<Map<String, PinnedMessage?>>(emptyMap())
    val pinned: StateFlow<Map<String, PinnedMessage?>> = _pinned

    private val _online = MutableStateFlow<Set<Long>>(emptySet())
    val online: StateFlow<Set<Long>> = _online

    private val _lastSeen = MutableStateFlow<Map<Long, String?>>(emptyMap())
    val lastSeen: StateFlow<Map<Long, String?>> = _lastSeen

    private val _incoming = MutableSharedFlow<IncomingEvent>(extraBufferCapacity = 32)
    val incoming: SharedFlow<IncomingEvent> = _incoming

    private val linkPreviews = HashMap<String, LinkPreview?>()

    // Offline outbox: text waits here (persisted) and media retries wait here (this session only),
    // both auto-sent when the network returns.
    private val outbox = java.util.Collections.synchronizedList(loadOutbox())
    private val mediaRetries = ConcurrentHashMap<String, suspend () -> Unit>()
    @Volatile private var flushing = false

    private var activeChatId: String? = null
    private var inForeground = true
    private val pendingReadJobs = HashMap<String, Job>()

    val currentUser: User? get() = (_session.value as? SessionState.SignedIn)?.user

    /**
     * Synchronous "is this device signed in" from encrypted storage — true even before the session
     * object is restored. Used by the push receiver on a cold start (process woken by a notification)
     * so a real notification isn't dropped just because the in-memory session isn't ready yet.
     */
    fun hasStoredSession(): Boolean = store.accessToken != null && store.user != null

    /** Runs before sign-out while the session is still valid (the app unregisters its push token here). */
    var beforeLogout: (suspend () -> Unit)? = null

    data class CachedChat(val title: String, val muted: Boolean)

    /** Title and mute state from the live list, or from the encrypted cache when the app was closed. */
    fun cachedChat(chatId: String): CachedChat? {
        chat(chatId)?.let { return CachedChat(it.displayTitle, it.muted) }
        val raw = store.chatCache ?: return null
        return runCatching {
            val obj = api.json.parseToJsonElement(raw).jsonObject[chatId]?.jsonObject ?: return null
            CachedChat(obj.str("t") ?: "Chat", obj.str("m") == "true")
        }.getOrNull()
    }

    private fun saveChatCache(chats: List<ChatSummary>) {
        store.chatCache = kotlinx.serialization.json.buildJsonObject {
            for (c in chats) put(c.chatId, kotlinx.serialization.json.buildJsonObject {
                put("t", kotlinx.serialization.json.JsonPrimitive(c.displayTitle))
                put("m", kotlinx.serialization.json.JsonPrimitive(c.muted))
            })
        }.toString()
    }

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
        if (_session.value is SessionState.SignedIn) { realtime.connect(); flushOutbox() } // "connect" event reloads chats + open thread
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
        scope.launch { runCatching { api.me() }.onSuccess { _session.value = SessionState.SignedIn(it) } }
    }

    fun logout() {
        scope.launch {
            runCatching { beforeLogout?.invoke() }
            realtime.disconnect()
            api.logout()
            onSignedOut()
        }
    }

    fun updateDisplayName(name: String, onDone: (String?) -> Unit) = scope.launch {
        runCatching { api.updateDisplayName(name); api.me() }
            .onSuccess { _session.value = SessionState.SignedIn(it); onDone(null) }
            .onFailure { onDone(it.message) }
    }

    private fun onSignedOut() {
        realtime.disconnect()
        activeChatId = null
        pendingReadJobs.values.forEach { it.cancel() }
        pendingReadJobs.clear()
        _typing.value = emptyMap()
        _chatList.value = ChatListState()
        _threads.value = emptyMap()
        _reactions.value = emptyMap()
        _pinned.value = emptyMap()
        _online.value = emptySet()
        media.clear()
        lock.reset()
        _session.value = SessionState.SignedOut
    }

    // ── Chat list ───────────────────────────────────────────────────────────

    fun refreshChats() {
        _chatList.update { it.copy(loading = true, error = null) }
        scope.launch {
            runCatching { api.chats() }
                .onSuccess { chats -> _chatList.value = ChatListState(sortChats(chats)); saveChatCache(chats) }
                .onFailure { e -> _chatList.update { it.copy(loading = false, error = e.message) } }
        }
    }

    suspend fun startChatWith(userId: Long): ChatSummary {
        val chat = api.startDirectChat(userId)
        _chatList.update { s -> s.copy(chats = sortChats(listOf(chat) + s.chats.filter { it.chatId != chat.chatId })) }
        return chat
    }

    suspend fun searchUsers(query: String) = api.searchUsers(query)

    // ── Groups ────────────────────────────────────────────────────────────────

    private val _groupDetails = MutableStateFlow<Map<String, GroupDetail>>(emptyMap())
    val groupDetails: StateFlow<Map<String, GroupDetail>> = _groupDetails

    suspend fun createGroup(title: String, memberIds: List<Long>): ChatSummary {
        val chat = api.createGroup(title, memberIds)
        _chatList.update { s -> s.copy(chats = sortChats(listOf(chat) + s.chats.filter { it.chatId != chat.chatId })) }
        return chat
    }

    fun refreshGroupDetail(chatId: String) = scope.launch {
        runCatching { api.groupDetail(chatId) }.onSuccess { d -> _groupDetails.update { it + (chatId to d) } }
    }

    suspend fun addGroupMembers(chatId: String, memberIds: List<Long>) { api.addGroupMembers(chatId, memberIds); refreshGroupDetail(chatId) }
    suspend fun removeGroupMember(chatId: String, userId: Long) { api.removeGroupMember(chatId, userId); refreshGroupDetail(chatId) }
    suspend fun renameGroup(chatId: String, title: String) { api.renameGroup(chatId, title); refreshGroupDetail(chatId) }
    suspend fun setGroupRole(chatId: String, userId: Long, role: String) { api.setGroupRole(chatId, userId, role); refreshGroupDetail(chatId) }
    suspend fun leaveGroup(chatId: String) {
        api.leaveGroup(chatId)
        _chatList.update { s -> s.copy(chats = s.chats.filter { it.chatId != chatId }) }
        _threads.update { it - chatId }
        _groupDetails.update { it - chatId }
    }

    fun groupDetail(chatId: String): GroupDetail? = _groupDetails.value[chatId]

    suspend fun startSelfChat(): ChatSummary {
        val chat = api.startSelfChat()
        _chatList.update { s -> if (s.chats.any { it.chatId == chat.chatId }) s else s.copy(chats = sortChats(listOf(chat) + s.chats)) }
        return chat
    }

    /** Removes a single message from my view only (the other person and admin keep it). */
    suspend fun deleteForMe(chatId: String, messageId: String) {
        api.deleteForMe(messageId)
        updateThread(chatId) { st -> st.copy(messages = st.messages.filter { it.messageId != messageId }) }
    }

    fun chat(chatId: String): ChatSummary? = _chatList.value.chats.firstOrNull { it.chatId == chatId }

    private fun sortChats(chats: List<ChatSummary>) = chats.sortedByDescending { it.lastMessage?.sentAt.orEmpty() }

    private fun patchChat(chatId: String, transform: (ChatSummary) -> ChatSummary): Boolean {
        var found = false
        _chatList.update { s ->
            s.copy(chats = sortChats(s.chats.map { if (it.chatId == chatId) { found = true; transform(it) } else it }))
        }
        return found
    }

    fun setArchived(chatId: String, archived: Boolean) = optimistic(chatId, { it.copy(archived = archived) }) { api.setArchived(chatId, archived) }
    fun setMuted(chatId: String, muted: Boolean) = optimistic(chatId, { it.copy(muted = muted) }) { api.setMuted(chatId, muted) }
    fun setBackground(chatId: String, background: String?) =
        optimistic(chatId, { it.copy(background = background) }) { api.setBackground(chatId, background) }

    private fun optimistic(chatId: String, change: (ChatSummary) -> ChatSummary, call: suspend () -> Unit) {
        val before = chat(chatId)
        patchChat(chatId, change)
        scope.launch { runCatching { call() }.onFailure { if (before != null) patchChat(chatId) { before } } }
    }

    suspend fun clearChat(chatId: String) {
        api.clearChat(chatId)
        updateThread(chatId) { ThreadState() }
        patchChat(chatId) { it.copy(lastMessage = it.lastMessage?.copy(text = ""), unreadCount = 0) }
    }

    suspend fun deleteChat(chatId: String) {
        api.deleteChat(chatId)
        _chatList.update { s -> s.copy(chats = s.chats.filter { it.chatId != chatId }) }
        _threads.update { it - chatId }
    }

    // ── Thread ──────────────────────────────────────────────────────────────

    fun openChat(chatId: String) {
        activeChatId = chatId
        realtime.join(chatId)
        patchChat(chatId) { it.copy(unreadCount = 0) }
        val existing = _threads.value[chatId]
        updateThread(chatId) { (existing ?: ThreadState()).copy(loading = existing == null, error = null) }
        injectQueued(chatId) // show any waiting-to-send messages immediately, even offline
        scope.launch {
            runCatching { api.thread(chatId) }
                .onSuccess { page ->
                    updateThread(chatId) {
                        // If the newest page doesn't reach what we already had, the cache has a gap: start over
                        val known = it.messages.mapTo(HashSet()) { m -> m.messageId }
                        val overlaps = page.items.any { m -> m.messageId in known }
                        val fresh = it.messages.isEmpty() || (!overlaps && page.page.hasMore)
                        it.copy(
                            messages = if (fresh) page.items + it.messages.filter { m -> m.isLocal } else mergeLatest(it.messages, page.items),
                            hasMore = if (fresh) page.page.hasMore else it.hasMore,
                            nextCursor = if (fresh) page.page.nextCursor else it.nextCursor,
                            loading = false,
                        )
                    }
                    injectQueued(chatId)
                    if (inForeground && activeChatId == chatId) markReadSoon(chatId)
                }
                .onFailure { e -> updateThread(chatId) { it.copy(loading = false, error = e.message) }; injectQueued(chatId) }
        }
        scope.launch { runCatching { api.reactions(chatId) }.onSuccess { r -> _reactions.update { it + (chatId to r) } } }
        scope.launch { runCatching { api.pinned(chatId) }.onSuccess { p -> _pinned.update { it + (chatId to p) } } }
        chat(chatId)?.peerUserId?.let { refreshPresence(it) }
        if (chat(chatId)?.isGroup == true) refreshGroupDetail(chatId)
    }

    fun refreshPresence(userId: Long) = scope.launch {
        runCatching { api.presence(userId) }.onSuccess { p ->
            _online.update { if (p.online) it + userId else it - userId }
            _lastSeen.update { it + (userId to p.lastSeenAt) }
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
                            hasMore = page.page.hasMore, nextCursor = page.page.nextCursor, loadingMore = false,
                        )
                    }
                }
                .onFailure { updateThread(chatId) { it.copy(loadingMore = false) } }
        }
    }

    /** Sends text (optionally a reply, view-once, or auto-deleting) with an optimistic bubble. */
    fun send(chatId: String, text: String, viewOnce: Boolean = false, deleteAfter: String = "never", replyTo: Message? = null,
             silent: Boolean = false, burn: String = "off") {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return
        val body = if (replyTo != null) replyBody(replyTo, trimmed) else trimmed
        sendBody(chatId, body, viewOnce, deleteAfter, silent, burn)
    }

    fun sendBody(chatId: String, body: String, viewOnce: Boolean = false, deleteAfter: String = "never",
                 silent: Boolean = false, burn: String = "off") {
        val localId = "local-${UUID.randomUUID()}"
        val now = Instant.now().toString()
        val pending = Message(messageId = localId, direction = "outgoing", text = body, sentAt = now,
            status = "sending", viewOnce = viewOnce, silent = silent)
        updateThread(chatId) { it.copy(messages = it.messages + pending) }
        scope.launch {
            runCatching { api.send(chatId, body, viewOnce, deleteAfter, silent, burn) }
                .onSuccess { sent -> replaceLocal(chatId, localId, sent) }
                .onFailure { e ->
                    if (isRetryable(e)) {
                        // No network / server busy: queue it and show "waiting", auto-send on reconnect
                        enqueue(QueuedText(localId, chatId, body, viewOnce, deleteAfter, silent, burn, now))
                        setStatus(chatId, localId, "queued")
                    } else {
                        markFailed(chatId, localId)
                    }
                }
        }
    }

    /** IOErrors, timeouts, 5xx and rate limits are worth retrying; a 4xx rejection is not. */
    private fun isRetryable(e: Throwable): Boolean = when (e) {
        is ApiException -> e.status >= 500 || e.status == 408 || e.status == 429
        is IOException -> true
        else -> false
    }

    /** Uploads first (bubble shows "Sending photo…"), then sends the media marker body. */
    fun sendMedia(chatId: String, label: String, viewOnce: Boolean, deleteAfter: String, silent: Boolean = false, burn: String = "off",
                  upload: suspend () -> String) {
        val localId = "local-${UUID.randomUUID()}"
        var attemptRef: (suspend () -> Unit)? = null
        val pending = Message(messageId = localId, direction = "outgoing", text = "$UPLOADING$label",
            sentAt = Instant.now().toString(), status = "sending")
        updateThread(chatId) { it.copy(messages = it.messages + pending) }
        val attempt: suspend () -> Unit = {
            runCatching { val body = upload(); api.send(chatId, body, viewOnce, deleteAfter, silent, burn) }
                .onSuccess { sent -> mediaRetries.remove(localId); replaceLocal(chatId, localId, sent) }
                .onFailure { e ->
                    if (isRetryable(e)) {
                        // Keep the upload closure and retry when back online (not persisted across restart)
                        mediaRetries[localId] = { if (mediaRetries.containsKey(localId)) attemptRef!!() }
                        setStatus(chatId, localId, "queued")
                    } else {
                        mediaRetries.remove(localId)
                        updateThread(chatId) { s ->
                            s.copy(messages = s.messages.map { m ->
                                if (m.messageId == localId) m.copy(status = "failed", text = "$UPLOADING$label — ${e.message ?: "failed"}") else m
                            })
                        }
                    }
                }
        }
        attemptRef = attempt
        scope.launch { attempt() }
    }

    private fun replaceLocal(chatId: String, localId: String, sent: Message) {
        updateThread(chatId) { s ->
            val withoutLocal = s.messages.filter { it.messageId != localId }
            if (withoutLocal.any { it.messageId == sent.messageId }) s.copy(messages = withoutLocal)
            else s.copy(messages = s.messages.map { if (it.messageId == localId) sent else it })
        }
        patchChat(chatId) { it.copy(lastMessage = LastMessage(sent.messageId, sent.text, sent.sentAt, "outgoing", sent.status)) }
    }

    private fun markFailed(chatId: String, localId: String) = setStatus(chatId, localId, "failed")

    private fun setStatus(chatId: String, localId: String, status: String) = updateThread(chatId) { s ->
        s.copy(messages = s.messages.map { m -> if (m.messageId == localId) m.copy(status = status) else m })
    }

    // ── Offline outbox ────────────────────────────────────────────────────────

    private fun loadOutbox(): MutableList<QueuedText> =
        store.outbox?.let { runCatching { api.json.decodeFromString<List<QueuedText>>(it).toMutableList() }.getOrNull() } ?: mutableListOf()

    private fun persistOutbox() { store.outbox = synchronized(outbox) { api.json.encodeToString(outbox.toList()) } }

    private fun enqueue(item: QueuedText) {
        synchronized(outbox) { if (outbox.none { it.localId == item.localId }) outbox.add(item) }
        persistOutbox()
    }

    private fun dropFromOutbox(localId: String) {
        synchronized(outbox) { outbox.removeAll { it.localId == localId } }
        persistOutbox()
    }

    /** Sends everything waiting (text, then in-session media), oldest first, stopping on the first network failure. */
    fun flushOutbox() {
        if (flushing) return
        flushing = true
        scope.launch {
            try {
                val pending = synchronized(outbox) { outbox.toList() }
                for (q in pending) {
                    setStatus(q.chatId, q.localId, "sending")
                    val ok = runCatching { api.send(q.chatId, q.body, q.viewOnce, q.deleteAfter, q.silent, q.burn) }
                        .onSuccess { sent -> dropFromOutbox(q.localId); replaceLocal(q.chatId, q.localId, sent) }
                        .onFailure { e -> if (isRetryable(e)) { setStatus(q.chatId, q.localId, "queued"); return@launch } else { dropFromOutbox(q.localId); markFailed(q.chatId, q.localId) } }
                        .isSuccess
                    if (!ok) return@launch
                }
                // In-session media uploads that failed offline
                for ((_, retry) in mediaRetries.toList()) runCatching { retry() }
            } finally {
                flushing = false
            }
        }
    }

    /** Re-shows queued messages for a chat (e.g. after its thread loads), so they aren't lost from view. */
    private fun injectQueued(chatId: String) {
        val mine = synchronized(outbox) { outbox.filter { it.chatId == chatId } }
        if (mine.isEmpty()) return
        updateThread(chatId) { s ->
            val have = s.messages.mapTo(HashSet()) { it.messageId }
            val add = mine.filter { it.localId !in have }
                .map { Message(messageId = it.localId, direction = "outgoing", text = it.body, sentAt = it.sentAt, status = "queued", viewOnce = it.viewOnce, silent = it.silent) }
            if (add.isEmpty()) s else s.copy(messages = (s.messages + add).sortedBy { it.sentAt })
        }
    }

    fun retry(chatId: String, message: Message) {
        dropFromOutbox(message.messageId)
        mediaRetries.remove(message.messageId)
        if (message.text.startsWith(UPLOADING)) {
            updateThread(chatId) { s -> s.copy(messages = s.messages.filter { it.messageId != message.messageId }) }
            return
        }
        updateThread(chatId) { s -> s.copy(messages = s.messages.filter { it.messageId != message.messageId }) }
        sendBody(chatId, message.text, message.viewOnce)
    }

    fun discardFailed(chatId: String, message: Message) {
        dropFromOutbox(message.messageId)
        mediaRetries.remove(message.messageId)
        updateThread(chatId) { s -> s.copy(messages = s.messages.filter { it.messageId != message.messageId }) }
    }

    fun setTyping(chatId: String, typing: Boolean) = realtime.typing(chatId, typing)

    // ── Message actions ─────────────────────────────────────────────────────

    suspend fun edit(chatId: String, message: Message, newText: String) {
        val content = message.content as? MessageContent.Text
        // Keep the reply quote when editing a reply
        val body = if (content?.quote != null) "> ${content.quote}\n${newText.trim()}" else newText.trim()
        api.editMessage(message.messageId, body)
        updateThread(chatId) { s -> s.copy(messages = s.messages.map { if (it.messageId == message.messageId) it.copy(text = body, edited = true) else it }) }
    }

    suspend fun delete(chatId: String, messageId: String) {
        api.deleteMessage(messageId)
        markDeleted(chatId, messageId)
    }

    fun react(chatId: String, messageId: String, emoji: String) = scope.launch {
        val me = currentUser ?: return@launch
        val mine = _reactions.value[chatId]?.get(messageId)?.firstOrNull { it.userId == me.userId }
        applyReaction(chatId, messageId, me.userId, me.displayName, if (mine?.emoji == emoji) null else emoji)
        runCatching { api.react(messageId, emoji) }.onFailure {
            applyReaction(chatId, messageId, me.userId, me.displayName, mine?.emoji)
        }
    }

    private fun applyReaction(chatId: String, messageId: String, userId: Long, name: String, emoji: String?) {
        _reactions.update { all ->
            val chatMap = all[chatId].orEmpty()
            val list = chatMap[messageId].orEmpty().filter { it.userId != userId } +
                listOfNotNull(emoji?.let { Reaction(userId, name, it) })
            all + (chatId to (chatMap + (messageId to list)))
        }
    }

    suspend fun forward(messageId: String, toChatId: String) {
        api.forward(messageId, toChatId)
    }

    suspend fun star(messageId: String) = api.star(messageId)
    suspend fun unstar(messageId: String) = api.unstar(messageId)

    suspend fun pin(chatId: String, message: Message?) {
        api.pin(chatId, message?.messageId)
        _pinned.update { it + (chatId to message?.let { m -> PinnedMessage(m.messageId, m.text, m.senderDisplayName) }) }
    }

    suspend fun openViewOnce(chatId: String, messageId: String) {
        runCatching { api.openViewOnce(messageId) }
    }

    /** After a view-once message has been shown, the local copy is burned too. */
    fun burnViewOnce(chatId: String, messageId: String) = updateThread(chatId) { s ->
        s.copy(messages = s.messages.map { if (it.messageId == messageId) it.copy(viewOnceOpened = true, text = "") else it })
    }

    fun vote(chatId: String, messageId: String, option: Int) = scope.launch {
        runCatching { api.vote(messageId, option) }.onSuccess { votes -> applyPoll(chatId, messageId, votes, option) }
    }

    private fun applyPoll(chatId: String, messageId: String, votes: Map<String, Int>, myVote: Int?) = updateThread(chatId) { s ->
        s.copy(messages = s.messages.map { m ->
            if (m.messageId == messageId && m.poll != null) m.copy(poll = m.poll.copy(votes = votes, myVote = myVote ?: m.poll.myVote)) else m
        })
    }

    suspend fun createPoll(chatId: String, question: String, options: List<String>) {
        api.createPoll(chatId, question, options)
        openChat(chatId)
    }

    suspend fun schedule(chatId: String, text: String, at: Instant) = api.schedule(chatId, text, at.toString())

    suspend fun linkPreview(url: String): LinkPreview? {
        if (linkPreviews.containsKey(url)) return linkPreviews[url]
        return api.linkPreview(url).also { linkPreviews[url] = it }
    }

    private fun markDeleted(chatId: String, messageId: String) = updateThread(chatId) { s ->
        s.copy(messages = s.messages.map { if (it.messageId == messageId) it.copy(deleted = true, text = "") else it })
    }

    private fun updateThread(chatId: String, transform: (ThreadState) -> ThreadState) {
        _threads.update { map -> map + (chatId to transform(map[chatId] ?: ThreadState())) }
    }

    /** Replaces the newest page while keeping older messages already loaded and unsent local ones. */
    private fun mergeLatest(current: List<Message>, latest: List<Message>): List<Message> {
        if (current.isEmpty()) return latest
        val latestIds = latest.mapTo(HashSet()) { it.messageId }
        val oldestLatest = latest.firstOrNull()?.sentAt.orEmpty()
        val older = current.filter { it.messageId !in latestIds && !it.isLocal && it.sentAt < oldestLatest }
        val pending = current.filter { it.isLocal }
        return older + latest + pending
    }

    // ── Realtime ────────────────────────────────────────────────────────────

    private fun handleEvent(event: RealtimeEvent) {
        val obj = runCatching { api.json.parseToJsonElement(event.payload).jsonObject }.getOrNull() ?: return
        val chatId = obj.str("chatId")
        when (event.name) {
            "connect" -> {
                // Drop stale presence; the server snapshots who's really online right after connecting
                _online.value = emptySet()
                refreshChats()
                activeChatId?.let { openChat(it) }
                flushOutbox()
            }
            "disconnect" -> { _typing.value = emptyMap(); _online.value = emptySet() }
            "message:new" -> {
                if (chatId == null) return
                val message = runCatching { api.json.decodeFromJsonElement<Message>(obj["message"]!!) }.getOrNull() ?: return
                onIncomingMessage(chatId, message)
            }
            "chat:updated" -> {
                if (chatId == null) return
                if (obj.str("reload") == "true") { refreshChats(); return }
                val last = obj["lastMessage"]?.let { runCatching { api.json.decodeFromJsonElement<LastMessage>(it) }.getOrNull() }
                val unread = obj.int("unreadCount")
                val found = patchChat(chatId) { c ->
                    c.copy(lastMessage = last ?: c.lastMessage, unreadCount = if (chatId == activeChatId) 0 else unread ?: c.unreadCount)
                }
                if (!found) refreshChats()
            }
            "message:read", "message:delivered" -> {
                val messageId = obj.str("messageId") ?: return
                val status = obj.str("status") ?: if (event.name == "message:read") "read" else "delivered"
                if (chatId != null) updateThread(chatId) { s ->
                    s.copy(messages = s.messages.map { if (it.messageId == messageId && rank(status) > rank(it.status)) it.copy(status = status) else it })
                }
                if (chatId != null) patchChat(chatId) { c ->
                    if (c.lastMessage?.messageId == messageId) c.copy(lastMessage = c.lastMessage.copy(status = status)) else c
                }
            }
            "message:expiry" -> {
                // Burn after reading started: both sides count down, the server deletes it when time is up
                val messageId = obj.str("messageId") ?: return
                val expiresAt = obj.str("expiresAt") ?: return
                if (chatId != null) updateThread(chatId) { s ->
                    s.copy(messages = s.messages.map { if (it.messageId == messageId) it.copy(expiresAt = expiresAt) else it })
                }
            }
            "message:deleted" -> {
                val messageId = obj.str("messageId") ?: return
                if (chatId != null) markDeleted(chatId, messageId)
            }
            "message:edited" -> {
                val messageId = obj.str("messageId") ?: return
                val text = obj.str("text") ?: return
                if (chatId != null) updateThread(chatId) { s ->
                    s.copy(messages = s.messages.map { if (it.messageId == messageId) it.copy(text = text, edited = true) else it })
                }
            }
            "message:reaction" -> {
                val messageId = obj.str("messageId") ?: return
                val userId = obj["userId"].asLong() ?: return
                if (chatId != null) applyReaction(chatId, messageId, userId, obj.str("displayName").orEmpty(), obj.str("emoji"))
            }
            "chat:pinned" -> if (chatId != null) {
                val messageId = obj.str("messageId")
                val msg = messageId?.let { id -> _threads.value[chatId]?.messages?.firstOrNull { it.messageId == id } }
                _pinned.update { it + (chatId to messageId?.let { PinnedMessage(it, msg?.text, msg?.senderDisplayName) }) }
                if (messageId != null && msg == null) scope.launch { runCatching { api.pinned(chatId) }.onSuccess { p -> _pinned.update { it + (chatId to p) } } }
            }
            "poll:voted" -> {
                val messageId = obj.str("messageId") ?: return
                val votes = (obj["votes"] as? JsonObject)?.mapValues { (it.value as? JsonPrimitive)?.content?.toIntOrNull() ?: 0 } ?: return
                if (chatId != null) applyPoll(chatId, messageId, votes, null)
            }
            "group:updated" -> if (chatId != null) refreshGroupDetail(chatId)
            "chat:new" -> refreshChats()
            "chat:removed" -> if (chatId != null) _chatList.update { s -> s.copy(chats = s.chats.filter { it.chatId != chatId }) }
            "typing:start" -> if (chatId != null) _typing.update { it + (chatId to (obj.str("displayName") ?: "typing")) }
            "typing:stop" -> if (chatId != null) _typing.update { it - chatId }
            "presence:online" -> obj["userId"].asLong()?.let { id -> _online.update { it + id } }
            "presence:offline" -> obj["userId"].asLong()?.let { id ->
                _online.update { it - id }
                _lastSeen.update { it + (id to obj.str("lastSeenAt")) }
            }
        }
    }

    private fun rank(status: String) = when (status) { "read" -> 3; "delivered" -> 2; "sent" -> 1; else -> 0 }

    private fun onIncomingMessage(chatId: String, message: Message) {
        _typing.update { it - chatId }
        if (_threads.value.containsKey(chatId)) {
            updateThread(chatId) { s ->
                if (s.messages.any { it.messageId == message.messageId }) s
                else {
                    // Our own message echoed back before the HTTP response: drop the matching pending copy
                    val pendingTwin = if (message.isOutgoing) s.messages.firstOrNull { it.isLocal && it.text == message.text } else null
                    s.copy(messages = s.messages.filter { it !== pendingTwin } + message)
                }
            }
        }
        val isActive = chatId == activeChatId && inForeground
        val found = patchChat(chatId) { c ->
            c.copy(
                lastMessage = LastMessage(message.messageId, if (message.viewOnce) "" else message.text, message.sentAt, message.direction, message.status),
                unreadCount = if (isActive || message.isOutgoing) 0 else c.unreadCount + 1,
            )
        }
        if (!found) refreshChats()
        if (!message.isOutgoing) {
            if (isActive) markReadSoon(chatId) else scope.launch { api.markDelivered(chatId, message.messageId) }
            _incoming.tryEmit(IncomingEvent(chatId, message, isActive))
        }
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

    companion object {
        /** Local-only body prefix for a media message that is still uploading. */
        const val UPLOADING = "__UPLOADING__:"
    }
}
