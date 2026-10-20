package com.pavavak.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pavavak.app.data.ChatRepository
import com.pavavak.app.data.Message
import com.pavavak.app.data.MessageContent
import com.pavavak.app.data.ThreadState
import com.pavavak.app.ui.theme.PavaColors
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

@Composable
fun ChatScreen(repository: ChatRepository, chatId: String, onBack: () -> Unit) {
    val threads by repository.threads.collectAsStateWithLifecycle()
    val chatList by repository.chatList.collectAsStateWithLifecycle()
    val typing by repository.typing.collectAsStateWithLifecycle()
    val thread = threads[chatId] ?: ThreadState(loading = true)
    val chat = chatList.chats.firstOrNull { it.chatId == chatId }
    val title = chat?.displayTitle ?: "Chat"

    DisposableEffect(chatId) {
        repository.openChat(chatId)
        onDispose { repository.closeChat(chatId) }
    }

    val items = remember(thread.messages) { buildItems(thread.messages) }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()

    FollowNewestMessage(listState, thread.messages)

    // Older pages load when the user scrolls near the top (the end of a reversed list)
    val itemCount by rememberUpdatedState(items.size)
    LaunchedEffect(listState, chatId) {
        snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
            .distinctUntilChanged()
            .collect { lastVisible -> if (itemCount > 0 && lastVisible >= itemCount - 6) repository.loadOlder(chatId) }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(PavaColors.Background)
            .statusBarsPadding()
            .windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars)),
    ) {
        ChatTopBar(title = title, subtitle = typing[chatId]?.let { "typing…" }, onBack = onBack)

        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                thread.loading && thread.messages.isEmpty() -> SplashScreen()
                thread.error != null && thread.messages.isEmpty() -> Column(
                    Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("Couldn't load messages", fontWeight = FontWeight.SemiBold)
                    Text("Tap to retry", color = PavaColors.Accent, modifier = Modifier.clickable { repository.openChat(chatId) }.padding(8.dp))
                }
                thread.messages.isEmpty() -> Text(
                    "No messages yet. Say hi 👋", color = PavaColors.TextMuted,
                    modifier = Modifier.align(Alignment.Center),
                )
                else -> LazyColumn(
                    state = listState,
                    reverseLayout = true,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp, vertical = 8.dp),
                ) {
                    items(items, key = { it.key }, contentType = { it::class }) { item ->
                        when (item) {
                            is ThreadItem.Bubble -> MessageBubble(item.message, onRetry = { repository.retry(chatId, item.message) })
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

            JumpToLatestButton(listState, Modifier.align(Alignment.BottomEnd).padding(12.dp)) {
                scope.launch { listState.animateScrollToItem(0) }
            }
        }

        Composer(
            onSend = { repository.send(chatId, it) },
            onTyping = { repository.setTyping(chatId, it) },
        )
    }
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
    LaunchedEffect(listState) {
        snapshotFlow { listState.firstVisibleItemIndex <= 1 }.collect { wasAtBottom = it }
    }
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
        SmallFloatingActionButton(onClick = onClick, containerColor = PavaColors.SurfaceHigh, shape = CircleShape) {
            Icon(Icons.Filled.KeyboardArrowDown, "Jump to latest message", tint = PavaColors.TextPrimary)
        }
    }
}

@Composable
private fun ChatTopBar(title: String, subtitle: String?, onBack: () -> Unit) {
    Surface(color = PavaColors.Surface, contentColor = PavaColors.TextPrimary) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Avatar(title, size = 38.dp)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (subtitle != null) Text(subtitle, fontSize = 13.sp, color = PavaColors.Accent)
            }
        }
    }
}

@Composable
private fun DayHeader(date: LocalDate) {
    Box(Modifier.fillMaxWidth().padding(vertical = 10.dp), contentAlignment = Alignment.Center) {
        Surface(color = PavaColors.SurfaceHigh, shape = RoundedCornerShape(10.dp)) {
            Text(dayLabel(date), fontSize = 12.sp, color = PavaColors.TextMuted, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
        }
    }
}

@Composable
private fun MessageBubble(message: Message, onRetry: () -> Unit) {
    val outgoing = message.isOutgoing
    Row(
        Modifier.fillMaxWidth().padding(vertical = 2.dp),
        horizontalArrangement = if (outgoing) Arrangement.End else Arrangement.Start,
    ) {
        Surface(
            color = if (outgoing) PavaColors.OutgoingBubble else PavaColors.IncomingBubble,
            shape = RoundedCornerShape(
                topStart = 16.dp, topEnd = 16.dp,
                bottomStart = if (outgoing) 16.dp else 4.dp, bottomEnd = if (outgoing) 4.dp else 16.dp,
            ),
            modifier = Modifier.widthIn(max = 300.dp).then(if (message.status == "failed") Modifier.clickable(onClick = onRetry) else Modifier),
        ) {
            Column(Modifier.padding(start = 12.dp, end = 10.dp, top = 7.dp, bottom = 5.dp)) {
                BubbleBody(message)
                Row(Modifier.align(Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                    if (message.edited) Text("edited  ", fontSize = 11.sp, color = PavaColors.TextMuted)
                    Text(formatTime(message.sentAt), fontSize = 11.sp, color = Color.White.copy(alpha = 0.6f))
                    if (outgoing) {
                        Spacer(Modifier.width(4.dp))
                        StatusTick(message.status)
                    }
                }
                if (message.status == "failed") Text("Not sent. Tap to retry.", fontSize = 12.sp, color = PavaColors.Danger)
            }
        }
    }
}

@Composable
private fun BubbleBody(message: Message) {
    if (message.deleted) {
        Text("This message was deleted", fontStyle = FontStyle.Italic, color = PavaColors.TextMuted, fontSize = 15.sp)
        return
    }
    if (message.viewOnce) {
        Text(if (message.viewOnceOpened || message.isOutgoing) "👁 View-once message" else "👁 View-once message — open in the web app for now", color = PavaColors.TextMuted, fontSize = 15.sp)
        return
    }
    when (val content = MessageContent.parse(message.text)) {
        is MessageContent.Text -> Text(content.text, fontSize = 16.sp, color = PavaColors.TextPrimary, lineHeight = 21.sp)
        is MessageContent.Image -> Text("📷 Photo", fontSize = 15.sp)
        is MessageContent.Video -> Text("🎥 Video", fontSize = 15.sp)
        is MessageContent.Audio -> Text("🎤 Voice note", fontSize = 15.sp)
        is MessageContent.Document -> Text("📄 ${content.fileName}", fontSize = 15.sp)
        MessageContent.Poll -> Text("📊 Poll", fontSize = 15.sp)
        MessageContent.SystemUpdate -> Text("🔄 App update", fontSize = 15.sp)
    }
}

@Composable
private fun StatusTick(status: String) {
    val (icon, tint) = when (status) {
        "sending" -> Icons.Filled.Schedule to Color.White.copy(alpha = 0.6f)
        "failed" -> Icons.Filled.ErrorOutline to PavaColors.Danger
        "read" -> Icons.Filled.DoneAll to PavaColors.ReadTick
        "delivered" -> Icons.Filled.DoneAll to Color.White.copy(alpha = 0.6f)
        else -> Icons.Filled.Done to Color.White.copy(alpha = 0.6f)
    }
    Icon(icon, contentDescription = status, tint = tint, modifier = Modifier.size(15.dp))
}

@Composable
private fun Composer(onSend: (String) -> Unit, onTyping: (Boolean) -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    var lastTypingSent by remember { mutableLongStateOf(0L) }
    var typingTicks by remember { mutableIntStateOf(0) }

    LaunchedEffect(typingTicks) {
        if (typingTicks == 0) return@LaunchedEffect
        kotlinx.coroutines.delay(4000)
        onTyping(false)
        lastTypingSent = 0L
    }

    Row(
        Modifier.fillMaxWidth().background(PavaColors.Background).padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        TextField(
            value = text,
            onValueChange = {
                text = it
                val now = System.currentTimeMillis()
                // The server auto-stops "typing" after 3s, so refresh it a little sooner
                if (it.isNotBlank() && now - lastTypingSent > 2500) { onTyping(true); lastTypingSent = now }
                typingTicks++
            },
            placeholder = { Text("Message") },
            maxLines = 5,
            shape = RoundedCornerShape(24.dp),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = PavaColors.SurfaceHigh,
                unfocusedContainerColor = PavaColors.SurfaceHigh,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
            ),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.width(8.dp))
        FilledIconButton(
            onClick = {
                if (text.isNotBlank()) {
                    onSend(text)
                    text = ""
                    onTyping(false)
                    lastTypingSent = 0L
                }
            },
            enabled = text.isNotBlank(),
            colors = IconButtonDefaults.filledIconButtonColors(containerColor = PavaColors.Accent),
            modifier = Modifier.size(52.dp),
        ) {
            Icon(Icons.AutoMirrored.Filled.Send, "Send", tint = PavaColors.Background)
        }
    }
}
