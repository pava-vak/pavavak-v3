package com.pavavak.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.AudioFile
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CleaningServices
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Unarchive
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pavavak.app.data.ChatRepository
import com.pavavak.app.data.FoundMessage
import com.pavavak.app.data.MediaItem
import com.pavavak.app.data.ScheduledItem
import com.pavavak.app.data.previewText
import com.pavavak.app.ui.theme.PavaColors
import com.pavavak.app.ui.theme.WALLPAPERS
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SimpleTopBar(title: String, onBack: () -> Unit, actions: @Composable () -> Unit = {}) {
    TopAppBar(
        title = { Text(title, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        actions = { actions() },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = PavaColors.Background),
    )
}

// ── Contact info ────────────────────────────────────────────────────────────

@Composable
fun ContactInfoScreen(repository: ChatRepository, chatId: String, onBack: () -> Unit, onGallery: () -> Unit, onSearch: () -> Unit, onChatGone: () -> Unit) {
    val chats by repository.chatList.collectAsStateWithLifecycle()
    val online by repository.online.collectAsStateWithLifecycle()
    val lastSeen by repository.lastSeen.collectAsStateWithLifecycle()
    val chat = chats.chats.firstOrNull { it.chatId == chatId }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var confirm by remember { mutableStateOf<String?>(null) }
    val peer = chat?.peerUserId
    var blocked by remember(peer) { mutableStateOf(false) }
    LaunchedEffect(peer) {
        peer?.let {
            repository.refreshPresence(it)
            runCatching { repository.api.blockedUsers() }.onSuccess { list -> blocked = list.contains(it.toString()) }
        }
    }

    Scaffold(containerColor = PavaColors.Background, topBar = { SimpleTopBar("Contact info", onBack) }) { padding ->
        if (chat == null) { SplashScreen(); return@Scaffold }
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).navigationBarsPadding()) {
            Column(Modifier.fillMaxWidth().padding(vertical = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Avatar(chat.displayTitle, size = 104.dp, online = peer != null && peer in online)
                Spacer(Modifier.height(12.dp))
                Text(chat.displayTitle, fontSize = 24.sp, fontWeight = FontWeight.SemiBold, color = PavaColors.TextPrimary)
                chat.subtitle?.takeIf { it.isNotBlank() }?.let { Text(it, color = PavaColors.TextMuted) }
                val status = when {
                    peer != null && peer in online -> "online"
                    peer != null -> formatLastSeen(lastSeen[peer])
                    else -> ""
                }
                if (status.isNotEmpty()) Text(status, color = if (status == "online") PavaColors.Accent else PavaColors.TextMuted, fontSize = 13.sp)
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                QuickAction(Icons.Filled.Search, "Search", Modifier.weight(1f), onSearch)
                QuickAction(Icons.Filled.PhotoLibrary, "Media", Modifier.weight(1f), onGallery)
                QuickAction(if (chat.muted) Icons.Filled.NotificationsOff else Icons.Filled.NotificationsOff,
                    if (chat.muted) "Unmute" else "Mute", Modifier.weight(1f)) { repository.setMuted(chatId, !chat.muted) }
            }

            Section("Chat wallpaper")
            LazyRow(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                item {
                    WallpaperSwatch("Default", null, selected = chat.background == null) { repository.setBackground(chatId, null) }
                }
                items(WALLPAPERS) { (id, label, colors) ->
                    WallpaperSwatch(label, Brush.linearGradient(listOf(colors.first, colors.second)), selected = chat.background == id) {
                        repository.setBackground(chatId, id)
                    }
                }
            }

            Section("Privacy")
            Text(
                "🔒 Photos and videos in this chat only download when you tap them, and are kept in the app's private storage.",
                color = PavaColors.TextMuted, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
            )

            Section("Chat")
            Row_(if (chat.archived) Icons.Filled.Unarchive else Icons.Filled.Archive, if (chat.archived) "Unarchive chat" else "Archive chat", null) {
                repository.setArchived(chatId, !chat.archived)
                context.toast(if (chat.archived) "Chat unarchived" else "Chat archived")
            }
            Row_(Icons.Filled.CleaningServices, "Clear chat", "Remove all messages for you", destructive = true) { confirm = "clear" }
            if (peer != null) Row_(if (blocked) Icons.Filled.Block else Icons.Filled.Block, if (blocked) "Unblock" else "Block", if (blocked) "They can't message you" else "Stop this person messaging you", destructive = !blocked) {
                scope.launch {
                    val next = !blocked
                    runCatching { repository.api.setBlocked(peer, next) }
                        .onSuccess { blocked = next; context.toast(if (next) "Blocked" else "Unblocked") }
                        .onFailure { context.toast(it.message ?: "Couldn't update") }
                }
            }
            Row_(Icons.Filled.DeleteOutline, "Delete chat", null, destructive = true) { confirm = "delete" }
            Spacer(Modifier.height(24.dp))
        }
    }
    when (confirm) {
        "clear" -> ConfirmDialog("Clear this chat?", "Messages will be removed for you. ${chat?.displayTitle ?: "They"} will still see them.", "Clear",
            destructive = true, onConfirm = {
                scope.launch { runCatching { repository.clearChat(chatId) }.onSuccess { context.toast("Chat cleared") }.onFailure { context.toast(it.message ?: "Couldn't clear") } }
            }, onDismiss = { confirm = null })
        "delete" -> ConfirmDialog("Delete this chat?", "The chat will be removed from your list.", "Delete",
            destructive = true, onConfirm = {
                scope.launch { runCatching { repository.deleteChat(chatId) }.onSuccess { onChatGone() }.onFailure { context.toast(it.message ?: "Couldn't delete") } }
            }, onDismiss = { confirm = null })
    }
}

@Composable
private fun QuickAction(icon: ImageVector, label: String, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier.clip(RoundedCornerShape(14.dp)).border(1.dp, PavaColors.Outline, RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, null, tint = PavaColors.Accent)
        Spacer(Modifier.height(4.dp))
        Text(label, color = PavaColors.TextPrimary, fontSize = 13.sp)
    }
}

@Composable
private fun WallpaperSwatch(label: String, brush: Brush?, selected: Boolean, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.clickable(onClick = onClick)) {
        Box(
            Modifier.size(width = 56.dp, height = 84.dp).clip(RoundedCornerShape(10.dp))
                .then(if (brush != null) Modifier.background(brush) else Modifier.background(PavaColors.Background))
                .border(if (selected) 3.dp else 1.dp, if (selected) PavaColors.Accent else PavaColors.Outline, RoundedCornerShape(10.dp)),
            contentAlignment = Alignment.Center,
        ) { if (selected) Icon(Icons.Filled.Check, "Selected", tint = PavaColors.Accent) }
        Text(label, fontSize = 11.sp, color = PavaColors.TextMuted)
    }
}

// ── Media gallery ───────────────────────────────────────────────────────────

/** Tiles are deliberately icons, never thumbnails: nothing downloads until a tile is tapped. */
@Composable
fun GalleryScreen(repository: ChatRepository, chatId: String, title: String, admin: Boolean, onBack: () -> Unit) {
    var tab by remember { mutableIntStateOf(0) }
    var items by remember { mutableStateOf<List<MediaItem>>(emptyList()) }
    var cursor by remember { mutableStateOf<String?>(null) }
    var hasMore by remember { mutableStateOf(true) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var viewer by remember { mutableStateOf<Pair<String, String>?>(null) }
    val scope = rememberCoroutineScope()

    fun loadMore() {
        if (loading || !hasMore) return
        loading = true
        scope.launch {
            runCatching { repository.api.mediaPage(chatId, cursor, admin) }
                .onSuccess { page -> items = items + page.items; cursor = page.nextCursor; hasMore = page.hasMore && page.nextCursor != null; error = null }
                .onFailure { error = it.message; hasMore = false }
            loading = false
        }
    }
    LaunchedEffect(chatId) { loadMore() }

    val tabs = listOf("Media" to setOf("image", "video"), "Docs" to setOf("document"), "Voice" to setOf("audio"))
    val shown = items.filter { it.type in tabs[tab].second }

    Scaffold(containerColor = PavaColors.Background, topBar = { SimpleTopBar(title, onBack) }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            TabRow(selectedTabIndex = tab, containerColor = PavaColors.Background) {
                tabs.forEachIndexed { i, (label, _) -> Tab(selected = tab == i, onClick = { tab = i }, text = { Text(label) }) }
            }
            when {
                error != null && items.isEmpty() -> Text(error!!, color = PavaColors.Danger, modifier = Modifier.padding(16.dp))
                shown.isEmpty() && !loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Nothing here yet", color = PavaColors.TextMuted)
                }
                tab == 0 -> LazyVerticalGrid(GridCells.Adaptive(104.dp), contentPadding = PaddingValues(6.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxSize()) {
                    items(shown, key = { it.messageId }) { item ->
                        LaunchedEffect(item.messageId) { if (item == shown.lastOrNull()) loadMore() }
                        Box(
                            Modifier.aspectRatio(1f).clip(RoundedCornerShape(8.dp)).background(PavaColors.SurfaceHigh)
                                .clickable { viewer = item.type to item.fileId },
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(if (item.type == "video") Icons.Filled.PlayCircle else Icons.Filled.Image, item.type, tint = PavaColors.TextMuted, modifier = Modifier.size(34.dp))
                            Text(formatListTimestamp(item.sentAt), fontSize = 10.sp, color = PavaColors.TextMuted,
                                modifier = Modifier.align(Alignment.BottomEnd).padding(4.dp))
                        }
                    }
                }
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    items(shown, key = { it.messageId }) { item ->
                        LaunchedEffect(item.messageId) { if (item == shown.lastOrNull()) loadMore() }
                        ListItem(
                            headlineContent = { Text(if (item.type == "audio") "Voice note" else "Document", color = PavaColors.TextPrimary) },
                            supportingContent = { Text(listOfNotNull(item.senderName, formatDateTime(item.sentAt)).joinToString(" · "), color = PavaColors.TextMuted) },
                            leadingContent = { Icon(if (item.type == "audio") Icons.Filled.AudioFile else Icons.Filled.Description, null, tint = PavaColors.Accent) },
                            colors = ListItemDefaults.colors(containerColor = PavaColors.Background),
                            modifier = Modifier.clickable { viewer = item.type to item.fileId },
                        )
                    }
                }
            }
            if (loading) Box(Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
            }
        }
    }

    viewer?.let { (type, fileId) ->
        when (type) {
            "image" -> {
                val ids = shown.filter { it.type == "image" }.map { it.fileId }
                ImageViewer(repository.media, ids, ids.indexOf(fileId).coerceAtLeast(0)) { viewer = null }
            }
            "video" -> VideoViewer(repository.media, fileId) { viewer = null }
            "audio" -> AudioSheet(repository, fileId) { viewer = null }
            else -> {
                val context = LocalContext.current
                LaunchedEffect(fileId) {
                    runCatching { openWithApp(context, repository.media.file(fileId), null) }.onFailure { context.toast(it.message ?: "Couldn't open file") }
                    viewer = null
                }
            }
        }
    }
}

@Composable
private fun AudioSheet(repository: ChatRepository, fileId: String, onClose: () -> Unit) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = { AudioPlayer.stop(); onClose() },
        title = { Text("Voice note") },
        text = { VoiceNote(repository, fileId) },
        confirmButton = { TextButton(onClick = { AudioPlayer.stop(); onClose() }) { Text("Close") } },
    )
}

/** Opens a downloaded private file in another app through the FileProvider. */
fun openWithApp(context: android.content.Context, file: java.io.File, mime: String?) {
    val uri = androidx.core.content.FileProvider.getUriForFile(context, context.packageName + ".files", file)
    val type = mime ?: android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase()) ?: "*/*"
    val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).setDataAndType(uri, type)
        .addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
    context.startActivity(android.content.Intent.createChooser(intent, "Open with"))
}

// ── Search, starred, scheduled ──────────────────────────────────────────────

@Composable
fun SearchScreen(repository: ChatRepository, onBack: () -> Unit, onOpenChat: (String) -> Unit) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<FoundMessage>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    LaunchedEffect(query) {
        if (query.trim().length < 2) { results = null; return@LaunchedEffect }
        delay(350)
        runCatching { repository.api.search(query.trim()) }.onSuccess { results = it; error = null }.onFailure { error = it.message }
    }
    Scaffold(containerColor = PavaColors.Background, topBar = { SimpleTopBar("Search messages", onBack) }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            OutlinedTextField(query, { query = it }, placeholder = { Text("Search all chats") }, singleLine = true,
                leadingIcon = { Icon(Icons.Filled.Search, null) },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).focusRequester(focus))
            when {
                error != null -> Text(error!!, color = PavaColors.Danger, modifier = Modifier.padding(16.dp))
                results == null -> Text("Type at least 2 letters", color = PavaColors.TextMuted, modifier = Modifier.padding(16.dp))
                results!!.isEmpty() -> Text("No messages found", color = PavaColors.TextMuted, modifier = Modifier.padding(16.dp))
                else -> FoundList(results!!, highlight = query.trim(), onOpenChat = onOpenChat)
            }
        }
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun FoundList(items: List<FoundMessage>, highlight: String?, onOpenChat: (String) -> Unit, onLongPress: ((FoundMessage) -> Unit)? = null) {
    LazyColumn(Modifier.fillMaxSize()) {
        items(items, key = { it.messageId }) { m ->
            ListItem(
                headlineContent = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(m.chatTitle ?: "Chat", fontWeight = FontWeight.SemiBold, color = PavaColors.TextPrimary, modifier = Modifier.weight(1f), maxLines = 1)
                        Text(formatListTimestamp(m.sentAt), fontSize = 12.sp, color = PavaColors.TextMuted)
                    }
                },
                supportingContent = {
                    Text(listOfNotNull(m.senderName?.let { "$it: " }).joinToString("") + previewText(m.text),
                        color = PavaColors.TextMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                },
                leadingContent = { Avatar(m.chatTitle ?: "?", size = 40.dp) },
                colors = ListItemDefaults.colors(containerColor = PavaColors.Background),
                modifier = Modifier.combinedClickable(onClick = { onOpenChat(m.chatId) }, onLongClick = { onLongPress?.invoke(m) }),
            )
        }
    }
}

@Composable
fun StarredScreen(repository: ChatRepository, onBack: () -> Unit, onOpenChat: (String) -> Unit) {
    var items by remember { mutableStateOf<List<FoundMessage>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var unstar by remember { mutableStateOf<FoundMessage?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    LaunchedEffect(Unit) { runCatching { repository.api.starred() }.onSuccess { items = it }.onFailure { error = it.message } }
    Scaffold(containerColor = PavaColors.Background, topBar = { SimpleTopBar("Starred messages", onBack) }) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when {
                error != null -> Text(error!!, color = PavaColors.Danger, modifier = Modifier.padding(16.dp))
                items == null -> SplashScreen()
                items!!.isEmpty() -> EmptyState(Icons.Filled.Star, "No starred messages", "Long-press a message and tap Star to keep it here.")
                else -> FoundList(items!!, null, onOpenChat, onLongPress = { unstar = it })
            }
        }
    }
    unstar?.let { m ->
        ConfirmDialog("Unstar message?", previewText(m.text).take(120), "Unstar", onConfirm = {
            scope.launch {
                runCatching { repository.unstar(m.messageId) }.onSuccess { items = items?.filter { it.messageId != m.messageId } }
                    .onFailure { context.toast(it.message ?: "Couldn't unstar") }
            }
        }, onDismiss = { unstar = null })
    }
}

@Composable
fun ScheduledScreen(repository: ChatRepository, onBack: () -> Unit) {
    var items by remember { mutableStateOf<List<ScheduledItem>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var cancel by remember { mutableStateOf<ScheduledItem?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    LaunchedEffect(Unit) { runCatching { repository.api.scheduled() }.onSuccess { items = it }.onFailure { error = it.message } }
    Scaffold(containerColor = PavaColors.Background, topBar = { SimpleTopBar("Scheduled messages", onBack) }) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when {
                error != null -> Text(error!!, color = PavaColors.Danger, modifier = Modifier.padding(16.dp))
                items == null -> SplashScreen()
                items!!.isEmpty() -> EmptyState(Icons.Filled.Schedule, "Nothing scheduled", "In a chat, tap 📎 then Schedule to send a message later.")
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    items(items!!, key = { it.key }) { s ->
                        ListItem(
                            headlineContent = { Text(s.chatTitle ?: "Chat", fontWeight = FontWeight.SemiBold, color = PavaColors.TextPrimary) },
                            supportingContent = {
                                Column {
                                    Text(previewText(s.text), color = PavaColors.TextPrimary, maxLines = 3, overflow = TextOverflow.Ellipsis)
                                    Text("Sends ${formatDateTime(s.scheduledAt)}", color = PavaColors.Accent, fontSize = 12.sp)
                                }
                            },
                            leadingContent = { Icon(Icons.Filled.Schedule, null, tint = PavaColors.Accent) },
                            trailingContent = { IconButton(onClick = { cancel = s }) { Icon(Icons.Filled.Block, "Cancel", tint = PavaColors.Danger) } },
                            colors = ListItemDefaults.colors(containerColor = PavaColors.Background),
                        )
                    }
                }
            }
        }
    }
    cancel?.let { s ->
        ConfirmDialog("Cancel scheduled message?", previewText(s.text).take(120), "Cancel message", destructive = true, onConfirm = {
            scope.launch {
                runCatching { repository.api.cancelScheduled(s.key) }.onSuccess { items = items?.filter { it.key != s.key } }
                    .onFailure { context.toast(it.message ?: "Couldn't cancel") }
            }
        }, onDismiss = { cancel = null })
    }
}

@Composable
fun EmptyState(icon: ImageVector, title: String, text: String) {
    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(80.dp).clip(CircleShape).background(PavaColors.Accent.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = PavaColors.Accent, modifier = Modifier.size(38.dp))
        }
        Spacer(Modifier.height(16.dp))
        Text(title, fontWeight = FontWeight.SemiBold, fontSize = 18.sp, color = PavaColors.TextPrimary)
        Spacer(Modifier.height(6.dp))
        Text(text, color = PavaColors.TextMuted, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

