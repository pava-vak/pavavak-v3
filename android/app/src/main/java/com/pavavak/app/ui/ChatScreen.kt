package com.pavavak.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pavavak.app.data.ChatRepository
import com.pavavak.app.data.Message
import com.pavavak.app.data.MessageContent
import com.pavavak.app.data.ThreadState
import com.pavavak.app.ui.theme.PavaColors
import com.pavavak.app.ui.theme.WALLPAPERS
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import java.time.LocalDate

private sealed interface ThreadItem {
    val key: String
    data class Bubble(val message: Message) : ThreadItem { override val key get() = message.messageId }
    data class Day(val date: LocalDate) : ThreadItem { override val key get() = "day-$date" }
}

/** Newest first, with a day header placed after (i.e. visually above) each day's oldest message. */
private fun buildItems(messages: List<Message>): List<ThreadItem> {
    val out = ArrayList<ThreadItem>(messages.size + 8)
    val newestFirst = messages.asReversed()
    newestFirst.forEachIndexed { i, m ->
        out += ThreadItem.Bubble(m)
        val day = localDateOf(m.sentAt)
        val olderDay = newestFirst.getOrNull(i + 1)?.let { localDateOf(it.sentAt) }
        if (day != null && day != olderDay) out += ThreadItem.Day(day)
    }
    return out
}

/** Drafts survive switching chats but are never written to disk. */
private val drafts = HashMap<String, String>()

@Composable
fun ChatScreen(repository: ChatRepository, chatId: String, onBack: () -> Unit, onOpenInfo: () -> Unit, onOpenGallery: () -> Unit) {
    val threads by repository.threads.collectAsStateWithLifecycle()
    val chatList by repository.chatList.collectAsStateWithLifecycle()
    val typing by repository.typing.collectAsStateWithLifecycle()
    val reactions by repository.reactions.collectAsStateWithLifecycle()
    val pinnedMap by repository.pinned.collectAsStateWithLifecycle()
    val online by repository.online.collectAsStateWithLifecycle()
    val lastSeen by repository.lastSeen.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val thread = threads[chatId] ?: ThreadState(loading = true)
    val chat = chatList.chats.firstOrNull { it.chatId == chatId }
    val title = chat?.displayTitle ?: "Chat"
    val peer = chat?.peerUserId
    val chatReactions = reactions[chatId].orEmpty()
    val pinned = pinnedMap[chatId]

    var replyTo by remember(chatId) { mutableStateOf<Message?>(null) }
    var actionFor by remember { mutableStateOf<Message?>(null) }
    var editing by remember { mutableStateOf<Message?>(null) }
    var forwarding by remember { mutableStateOf<Message?>(null) }
    var confirmDelete by remember { mutableStateOf<Message?>(null) }
    var confirmDeleteForMe by remember { mutableStateOf<Message?>(null) }
    var historyFor by remember { mutableStateOf<Message?>(null) }
    var schedulingText by remember { mutableStateOf<String?>(null) }
    var creatingPoll by remember { mutableStateOf(false) }
    var searchOpen by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }
    var viewer by remember { mutableStateOf<Viewer?>(null) }
    var menuOpen by remember { mutableStateOf(false) }

    DisposableEffect(chatId) {
        com.pavavak.app.push.Notifier.cancel(context, chatId)
        repository.openChat(chatId)
        onDispose { repository.closeChat(chatId); AudioPlayer.stop() }
    }

    // Disappearing and burn-after-reading messages vanish on time, even before the server's delete arrives
    var nowMs by remember { mutableStateOf(System.currentTimeMillis()) }
    val counting = thread.messages.any { it.expiresAt != null }
    LaunchedEffect(counting) { while (counting) { nowMs = System.currentTimeMillis(); kotlinx.coroutines.delay(1000) } }
    val visibleMessages = remember(thread.messages, searchQuery, searchOpen, nowMs) {
        val alive = thread.messages.filter { m -> parseInstant(m.expiresAt)?.let { it.toEpochMilli() > nowMs } ?: true }
        if (searchOpen && searchQuery.length >= 2) alive.filter { it.text.contains(searchQuery, ignoreCase = true) && !it.viewOnce }
        else alive
    }
    val items = remember(visibleMessages) { buildItems(visibleMessages) }
    val listState = rememberLazyListState()
    FollowNewestMessage(listState, thread.messages)

    val itemCount by rememberUpdatedState(items.size)
    LaunchedEffect(listState, chatId) {
        snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
            .distinctUntilChanged()
            .collect { lastVisible -> if (itemCount > 0 && lastVisible >= itemCount - 6) repository.loadOlder(chatId) }
    }

    val imageIds = remember(thread.messages) {
        thread.messages.filter { !it.viewOnce && !it.deleted }.mapNotNull { (it.content as? MessageContent.Image)?.fileId }
    }

    val callbacks = BubbleCallbacks(
        onLongPress = { actionFor = it },
        onSwipeReply = { replyTo = it },
        onOpenImage = { id -> viewer = Viewer.Images(imageIds, imageIds.indexOf(id).coerceAtLeast(0)) },
        onOpenVideo = { id -> viewer = Viewer.Video(id) },
        onOpenViewOnce = { m ->
            scope.launch { repository.openViewOnce(chatId, m.messageId) }
            viewer = Viewer.ViewOnce(m)
        },
        onVote = { m, i -> repository.vote(chatId, m.messageId, i) },
        onRetry = { repository.retry(chatId, it) },
        onDiscard = { repository.discardFailed(chatId, it) },
        onReactionTap = { m, e -> repository.react(chatId, m.messageId, e) },
    )

    val wallpaper = WALLPAPERS.firstOrNull { it.first == chat?.background }?.third

    Column(
        Modifier.fillMaxSize().background(PavaColors.Background).statusBarsPadding()
            .windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars)),
    ) {
        val status = when {
            typing[chatId] != null -> "typing…"
            peer != null && peer in online -> "online"
            peer != null -> formatLastSeen(lastSeen[peer])
            else -> ""
        }
        if (searchOpen) {
            SearchBar(searchQuery, onChange = { searchQuery = it }, count = if (searchQuery.length >= 2) visibleMessages.size else null,
                onClose = { searchOpen = false; searchQuery = "" })
        } else {
            ChatHeader(title, status, online = peer != null && peer in online, onBack = onBack, onInfo = onOpenInfo,
                onSearch = { searchOpen = true }, onGallery = onOpenGallery, menuOpen = menuOpen, onMenu = { menuOpen = it })
        }
        if (pinned != null && !searchOpen) PinnedBanner(
            pinned.text,
            onTap = {
                val index = items.indexOfFirst { it is ThreadItem.Bubble && it.message.messageId == pinned.messageId }
                if (index >= 0) scope.launch { listState.animateScrollToItem(index) } else context.toast("Pinned message is further back in the chat")
            },
            onUnpin = { scope.launch { runCatching { repository.pin(chatId, null) } } },
        )

        Box(
            Modifier.weight(1f).fillMaxWidth().then(
                if (wallpaper != null) Modifier.background(Brush.linearGradient(listOf(wallpaper.first, wallpaper.second))) else Modifier,
            ),
        ) {
            when {
                thread.loading && thread.messages.isEmpty() -> SplashScreen()
                thread.error != null && thread.messages.isEmpty() -> Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Couldn't load messages", fontWeight = FontWeight.SemiBold, color = PavaColors.TextPrimary)
                    Text("Tap to retry", color = PavaColors.Accent, modifier = Modifier.clickable { repository.openChat(chatId) }.padding(8.dp))
                }
                thread.messages.isEmpty() -> Text("No messages yet. Say hi 👋", color = PavaColors.TextMuted, modifier = Modifier.align(Alignment.Center))
                searchOpen && searchQuery.length >= 2 && visibleMessages.isEmpty() ->
                    Text("No messages found for \"$searchQuery\"", color = PavaColors.TextMuted, modifier = Modifier.align(Alignment.Center))
                else -> LazyColumn(
                    state = listState, reverseLayout = true, modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 8.dp),
                ) {
                    items(items, key = { it.key }, contentType = { it::class }) { item ->
                        when (item) {
                            is ThreadItem.Bubble -> MessageBubble(item.message, repository, chatReactions[item.message.messageId].orEmpty(),
                                callbacks, highlight = searchQuery.takeIf { searchOpen && it.length >= 2 })
                            is ThreadItem.Day -> DayHeader(item.date)
                        }
                    }
                    if (thread.loadingMore) item(key = "loading-older") {
                        Box(Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                        }
                    }
                }
            }
            JumpToLatestButton(listState, Modifier.align(Alignment.BottomEnd).padding(12.dp)) { scope.launch { listState.animateScrollToItem(0) } }
        }

        Composer(
            chatId = chatId,
            replyTo = replyTo,
            onCancelReply = { replyTo = null },
            initialDraft = drafts[chatId].orEmpty(),
            onDraftChange = { if (it.isEmpty()) drafts.remove(chatId) else drafts[chatId] = it },
            onSendText = { text, o -> repository.send(chatId, text, o.viewOnce, o.deleteAfter, replyTo, o.silent, o.burn); replyTo = null },
            onSendImage = { uri, o -> repository.sendMedia(chatId, "Sending photo…", o.viewOnce, o.deleteAfter, o.silent, o.burn) { "__IMG__:" + repository.media.uploadImage(uri) } },
            onSendVideo = { uri, o -> repository.sendMedia(chatId, "Sending video…", o.viewOnce, o.deleteAfter, o.silent, o.burn) { "__VID__:" + repository.media.uploadVideo(uri) } },
            onSendDocument = { uri, o -> repository.sendMedia(chatId, "Sending file…", false, o.deleteAfter, o.silent, o.burn) { repository.media.uploadDocument(uri) } },
            onSendVoice = { file, o -> repository.sendMedia(chatId, "Sending voice note…", false, o.deleteAfter, o.silent, o.burn) { "__AUD__:" + repository.media.uploadVoice(file) } },
            onTyping = { repository.setTyping(chatId, it) },
            onSchedule = { schedulingText = it },
            onSendWhenOnline = { text ->
                scope.launch {
                    runCatching { repository.api.sendWhenOnline(chatId, text) }
                        .onSuccess { context.toast("Will send when ${chat?.displayTitle ?: "they"} are online") }
                        .onFailure { context.toast(it.message ?: "Couldn't queue") }
                }
            },
            onPoll = { creatingPoll = true },
        )
    }

    actionFor?.let { m ->
        MessageActionSheet(
            message = m,
            isPinned = pinned?.messageId == m.messageId,
            onReact = { repository.react(chatId, m.messageId, it) },
            onAction = { action ->
                actionFor = null
                when (action) {
                    MessageAction.Reply -> replyTo = m
                    MessageAction.Copy -> context.copyText((m.content as? MessageContent.Text)?.text ?: m.text)
                    MessageAction.Edit -> editing = m
                    MessageAction.Forward -> forwarding = m
                    MessageAction.Pin, MessageAction.Unpin -> scope.launch {
                        runCatching { repository.pin(chatId, if (action == MessageAction.Pin) m else null) }
                            .onFailure { context.toast(it.message ?: "Couldn't pin") }
                    }
                    MessageAction.Star -> scope.launch {
                        runCatching { repository.star(m.messageId) }.onSuccess { context.toast("Starred") }.onFailure { context.toast(it.message ?: "Couldn't star") }
                    }
                    MessageAction.Save -> scope.launch {
                        val c = m.content
                        runCatching {
                            when (c) {
                                is MessageContent.Image -> repository.media.saveToDevice(c.fileId, "image")
                                is MessageContent.Video -> repository.media.saveToDevice(c.fileId, "video")
                                is MessageContent.Document -> repository.media.saveToDevice(c.fileId, "file", c.fileName)
                                else -> null
                            }
                        }.onSuccess { if (it != null) context.toast("Saved to $it") }.onFailure { context.toast(it.message ?: "Couldn't save") }
                    }
                    MessageAction.History -> historyFor = m
                    MessageAction.DeleteForMe -> confirmDeleteForMe = m
                    MessageAction.Delete -> confirmDelete = m
                }
            },
            onDismiss = { actionFor = null },
        )
    }
    editing?.let { m ->
        EditMessageDialog((m.content as? MessageContent.Text)?.text ?: m.text,
            onSave = { t -> scope.launch { runCatching { repository.edit(chatId, m, t) }.onFailure { context.toast(it.message ?: "Couldn't edit") } } },
            onDismiss = { editing = null })
    }
    forwarding?.let { m ->
        ForwardDialog(chatList.chats, chatId,
            onPick = { target -> scope.launch {
                runCatching { repository.forward(m.messageId, target.chatId) }
                    .onSuccess { context.toast("Forwarded to ${target.displayTitle}") }.onFailure { context.toast(it.message ?: "Couldn't forward") }
            } },
            onDismiss = { forwarding = null })
    }
    confirmDelete?.let { m ->
        ConfirmDialog("Delete message?", "Delete this message for everyone?", "Delete", destructive = true,
            onConfirm = { scope.launch { runCatching { repository.delete(chatId, m.messageId) }.onFailure { context.toast(it.message ?: "Couldn't delete") } } },
            onDismiss = { confirmDelete = null })
    }
    confirmDeleteForMe?.let { m ->
        ConfirmDialog("Delete for me?", "This removes the message from your view only. ${chat?.displayTitle ?: "The other person"} will still see it.", "Delete for me", destructive = true,
            onConfirm = { scope.launch { runCatching { repository.deleteForMe(chatId, m.messageId) }.onFailure { context.toast(it.message ?: "Couldn't delete") } } },
            onDismiss = { confirmDeleteForMe = null })
    }
    historyFor?.let { m -> EditHistoryDialog(repository, m) { historyFor = null } }
    schedulingText?.let { text ->
        ScheduleDialog(
            onSchedule = { at -> scope.launch {
                runCatching { repository.schedule(chatId, text, at) }
                    .onSuccess { context.toast("Scheduled for ${formatDateTime(at.toString())}") }
                    .onFailure { context.toast(it.message ?: "Couldn't schedule") }
            } },
            onDismiss = { schedulingText = null },
        )
    }
    if (creatingPoll) PollDialog(
        onCreate = { q, opts -> scope.launch { runCatching { repository.createPoll(chatId, q, opts) }.onFailure { context.toast(it.message ?: "Couldn't create poll") } } },
        onDismiss = { creatingPoll = false },
    )

    when (val v = viewer) {
        is Viewer.Images -> ImageViewer(repository.media, v.ids, v.start) { viewer = null }
        is Viewer.Video -> VideoViewer(repository.media, v.fileId) { viewer = null }
        is Viewer.ViewOnce -> {
            val done = { repository.burnViewOnce(chatId, v.message.messageId); viewer = null }
            when (val c = v.message.content) {
                is MessageContent.Image -> ViewOnceImage(repository.media, c.fileId, onClose = done)
                is MessageContent.Video -> VideoViewer(repository.media, c.fileId, allowSave = false, maxSeconds = 30, onClose = done)
                is MessageContent.Text -> ViewOnceText(c.text, onClose = done)
                else -> done()
            }
        }
        null -> Unit
    }
}

private sealed interface Viewer {
    data class Images(val ids: List<String>, val start: Int) : Viewer
    data class Video(val fileId: String) : Viewer
    data class ViewOnce(val message: Message) : Viewer
}

/**
 * With a reversed list the newest message is item 0. New items keep the user's position by key,
 * so when the user was already at the newest message (or sent it), scroll down to show it.
 */
@Composable
private fun FollowNewestMessage(listState: LazyListState, messages: List<Message>) {
    val newest = messages.lastOrNull()
    var lastNewestId by remember { mutableStateOf<String?>(null) }
    var wasAtBottom by remember { mutableStateOf(true) }
    LaunchedEffect(listState) { snapshotFlow { listState.firstVisibleItemIndex <= 1 }.collect { wasAtBottom = it } }
    LaunchedEffect(newest?.messageId) {
        val id = newest?.messageId ?: return@LaunchedEffect
        val isNew = lastNewestId != null && id != lastNewestId
        lastNewestId = id
        if (isNew && (wasAtBottom || newest.isOutgoing)) listState.animateScrollToItem(0)
    }
}

@Composable
private fun JumpToLatestButton(listState: LazyListState, modifier: Modifier, onClick: () -> Unit) {
    val show by remember { derivedStateOf { listState.firstVisibleItemIndex > 3 } }
    AnimatedVisibility(show, modifier = modifier, enter = fadeIn(), exit = fadeOut()) {
        SmallFloatingActionButton(onClick = onClick, containerColor = PavaColors.Surface, shape = CircleShape) {
            Icon(Icons.Filled.KeyboardArrowDown, "Jump to latest message", tint = PavaColors.TextPrimary)
        }
    }
}

@Composable
private fun ChatHeader(
    title: String, status: String, online: Boolean, onBack: () -> Unit, onInfo: () -> Unit,
    onSearch: () -> Unit, onGallery: () -> Unit, menuOpen: Boolean, onMenu: (Boolean) -> Unit,
) {
    Surface(color = PavaColors.Surface, contentColor = PavaColors.TextPrimary) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Row(Modifier.weight(1f).clickable(onClick = onInfo), verticalAlignment = Alignment.CenterVertically) {
                Avatar(title, size = 38.dp, online = online)
                Spacer(Modifier.width(10.dp))
                Column {
                    Text(title, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (status.isNotEmpty()) Text(status, fontSize = 12.sp, maxLines = 1,
                        color = if (status == "typing…" || status == "online") PavaColors.Accent else PavaColors.TextMuted)
                }
            }
            IconButton(onClick = onSearch) { Icon(Icons.Filled.Search, "Search in chat") }
            IconButton(onClick = onGallery) { Icon(Icons.Filled.PhotoLibrary, "Media, docs and voice notes") }
            Box {
                IconButton(onClick = { onMenu(true) }) { Icon(Icons.Filled.MoreVert, "More") }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { onMenu(false) }) {
                    DropdownMenuItem(text = { Text("Contact info") }, onClick = { onMenu(false); onInfo() })
                    DropdownMenuItem(text = { Text("Media, docs and voice notes") }, onClick = { onMenu(false); onGallery() })
                    DropdownMenuItem(text = { Text("Search") }, onClick = { onMenu(false); onSearch() })
                }
            }
        }
    }
}

@Composable
private fun SearchBar(query: String, onChange: (String) -> Unit, count: Int?, onClose: () -> Unit) {
    Surface(color = PavaColors.Surface) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose) { Icon(Icons.Filled.Close, "Close search", tint = PavaColors.TextPrimary) }
            TextField(
                value = query, onValueChange = onChange, placeholder = { Text("Search this chat") }, singleLine = true,
                colors = TextFieldDefaults.colors(focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent,
                    focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent),
                modifier = Modifier.weight(1f),
            )
            if (count != null) Text("$count found", fontSize = 12.sp, color = PavaColors.TextMuted, modifier = Modifier.padding(end = 12.dp))
        }
    }
}

@Composable
private fun DayHeader(date: LocalDate) {
    Box(Modifier.fillMaxWidth().padding(vertical = 10.dp), contentAlignment = Alignment.Center) {
        Surface(color = PavaColors.Surface, shape = RoundedCornerShape(10.dp)) {
            Text(dayLabel(date), fontSize = 12.sp, color = PavaColors.TextMuted, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
        }
    }
}
