package com.pavavak.app.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Unarchive
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pavavak.app.data.ChatRepository
import com.pavavak.app.data.AppLock
import androidx.compose.material.icons.filled.LockOpen
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.VisibilityOff
import com.pavavak.app.data.ChatSummary
import com.pavavak.app.data.User
import com.pavavak.app.data.previewText
import com.pavavak.app.ui.theme.PavaColors
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatListScreen(
    repository: ChatRepository,
    user: User,
    archived: Boolean,
    onOpenChat: (String) -> Unit,
    onNewChat: () -> Unit,
    onOpenArchived: () -> Unit,
    onBack: () -> Unit,
    onSearch: () -> Unit,
    onStarred: () -> Unit,
    onScheduled: () -> Unit,
    onSettings: () -> Unit,
    onAdmin: () -> Unit,
    lock: AppLock,
    hidePreviews: Boolean,
    onHiddenChats: () -> Unit,
) {
    val state by repository.chatList.collectAsStateWithLifecycle()
    val hidden by lock.hiddenChats.collectAsStateWithLifecycle()
    val lockedChats by lock.lockedChats.collectAsStateWithLifecycle()
    val decoy by lock.decoy.collectAsStateWithLifecycle()
    val typing by repository.typing.collectAsStateWithLifecycle()
    val online by repository.online.collectAsStateWithLifecycle()
    var menuOpen by remember { mutableStateOf(false) }
    var sheetFor by remember { mutableStateOf<ChatSummary?>(null) }
    var confirmDelete by remember { mutableStateOf<ChatSummary?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    // Hidden chats never appear here; with the decoy PIN nothing does
    val listed = if (decoy) emptyList() else state.chats.filter { it.chatId !in hidden }
    val visible = listed.filter { it.archived == archived }
    val archivedCount = listed.count { it.archived }

    Scaffold(
        containerColor = PavaColors.Background,
        topBar = {
            TopAppBar(
                // Long-press the title to open hidden chats (after PIN or fingerprint)
                title = {
                    Text(if (archived) "Archived" else "PaVa Vak", fontWeight = FontWeight.Bold,
                        modifier = Modifier.combinedClickable(onClick = {}, onLongClick = { if (!decoy && !archived) onHiddenChats() }))
                },
                navigationIcon = {
                    if (archived) IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = PavaColors.Background),
                actions = {
                    if (!archived) {
                        IconButton(onClick = onSearch) { Icon(Icons.Filled.Search, "Search messages") }
                        IconButton(onClick = { menuOpen = true }) { Icon(Icons.Filled.MoreVert, "Menu") }
                        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                            DropdownMenuItem(text = { Text("Starred messages") }, leadingIcon = { Icon(Icons.Filled.Star, null) },
                                onClick = { menuOpen = false; onStarred() })
                            DropdownMenuItem(text = { Text("Scheduled messages") }, leadingIcon = { Icon(Icons.Filled.Schedule, null) },
                                onClick = { menuOpen = false; onScheduled() })
                            if (user.isAdmin && !decoy) DropdownMenuItem(text = { Text("Admin") }, leadingIcon = { Icon(Icons.Filled.AdminPanelSettings, null) },
                                onClick = { menuOpen = false; onAdmin() })
                            DropdownMenuItem(text = { Text("Settings") }, leadingIcon = { Icon(Icons.Filled.Settings, null) },
                                onClick = { menuOpen = false; onSettings() })
                            DropdownMenuItem(text = { Text("Sign out") }, leadingIcon = { Icon(Icons.AutoMirrored.Filled.Logout, null) },
                                onClick = { menuOpen = false; repository.logout() })
                        }
                    }
                },
            )
        },
        floatingActionButton = {
            if (!archived) FloatingActionButton(onClick = onNewChat, containerColor = PavaColors.Accent, contentColor = PavaColors.OnAccent,
                modifier = Modifier.navigationBarsPadding()) {
                Icon(Icons.Filled.Chat, "New chat")
            }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state.loading && state.chats.isNotEmpty(),
            onRefresh = repository::refreshChats,
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            when {
                state.chats.isEmpty() && state.loading -> SplashScreen()
                visible.isEmpty() && (archived || archivedCount == 0) ->
                    EmptyChats(state.error, archived, onRetry = repository::refreshChats, onNewChat = onNewChat)
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    if (!archived && archivedCount > 0) item(key = "archived") {
                        ListItem(
                            headlineContent = { Text("Archived", fontWeight = FontWeight.SemiBold) },
                            leadingContent = { Icon(Icons.Filled.Archive, null, tint = PavaColors.Accent, modifier = Modifier.padding(horizontal = 11.dp)) },
                            trailingContent = { Text("$archivedCount", color = PavaColors.TextMuted) },
                            colors = ListItemDefaults.colors(containerColor = PavaColors.Background),
                            modifier = Modifier.combinedClickable(onClick = onOpenArchived),
                        )
                    }
                    items(visible, key = { it.chatId }) { chat ->
                        ChatRow(chat, typingName = typing[chat.chatId], online = chat.peerUserId in online,
                            hidePreview = hidePreviews, locked = chat.chatId in lockedChats,
                            onClick = { onOpenChat(chat.chatId) }, onLongClick = { sheetFor = chat })
                        HorizontalDivider(Modifier.padding(start = 76.dp), color = PavaColors.Outline)
                    }
                    item { Text("🔒 Private and secure by default.", color = PavaColors.TextMuted, fontSize = 12.sp,
                        modifier = Modifier.fillMaxWidth().padding(20.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center) }
                }
            }
        }
    }

    sheetFor?.let { chat ->
        ModalBottomSheet(onDismissRequest = { sheetFor = null }, containerColor = PavaColors.Surface) {
            Text(chat.displayTitle, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
            SheetAction(if (chat.archived) Icons.Filled.Unarchive else Icons.Filled.Archive, if (chat.archived) "Unarchive" else "Archive") {
                repository.setArchived(chat.chatId, !chat.archived); sheetFor = null
            }
            SheetAction(if (chat.muted) Icons.Filled.VolumeUp else Icons.Filled.NotificationsOff, if (chat.muted) "Unmute" else "Mute") {
                repository.setMuted(chat.chatId, !chat.muted); sheetFor = null
            }
            SheetAction(Icons.Filled.VisibilityOff, "Hide chat") {
                lock.setHidden(chat.chatId, true); sheetFor = null
                context.toast("Hidden. Long-press \"PaVa Vak\" at the top to see hidden chats.")
            }
            val isLocked = chat.chatId in lockedChats
            SheetAction(if (isLocked) Icons.Filled.LockOpen else Icons.Filled.Lock, if (isLocked) "Remove chat lock" else "Lock chat") {
                sheetFor = null
                if (!isLocked && !lock.isConfigured()) context.toast("Turn on app lock in Settings first")
                else lock.setChatLocked(chat.chatId, !isLocked)
            }
            SheetAction(Icons.Filled.DeleteOutline, "Delete chat", destructive = true) { confirmDelete = chat; sheetFor = null }
            Spacer(Modifier.height(24.dp))
        }
    }

    confirmDelete?.let { chat ->
        ConfirmDialog(
            title = "Delete chat?", text = "Delete this chat from your list? The other person keeps their copy.",
            confirmLabel = "Delete", destructive = true,
            onConfirm = { scope.launch { runCatching { repository.deleteChat(chat.chatId) }.onFailure { context.toast(it.message ?: "Couldn't delete") } } },
            onDismiss = { confirmDelete = null },
        )
    }
}

@Composable
fun SheetAction(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, destructive: Boolean = false, onClick: () -> Unit) {
    ListItem(
        headlineContent = { Text(label, color = if (destructive) PavaColors.Danger else PavaColors.TextPrimary) },
        leadingContent = { Icon(icon, null, tint = if (destructive) PavaColors.Danger else PavaColors.TextMuted) },
        colors = ListItemDefaults.colors(containerColor = PavaColors.Surface),
        modifier = Modifier.combinedClickable(onClick = onClick),
    )
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ChatRow(
    chat: ChatSummary, typingName: String?, online: Boolean, hidePreview: Boolean, locked: Boolean,
    onClick: () -> Unit, onLongClick: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(chat.displayTitle, online = online)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(chat.displayTitle, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = PavaColors.TextPrimary,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text(formatListTimestamp(chat.lastMessage?.sentAt), fontSize = 12.sp,
                    color = if (chat.unreadCount > 0 && !chat.muted) PavaColors.Unread else PavaColors.TextMuted)
            }
            Spacer(Modifier.height(3.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                val last = chat.lastMessage
                if (!locked && typingName == null && last?.direction == "outgoing" && !last.text.isNullOrEmpty()) {
                    TickIcon(last.status.orEmpty(), Modifier.padding(end = 4.dp))
                }
                val preview = when {
                    locked -> "🔒 Locked chat"
                    typingName != null -> "typing…"
                    last == null -> chat.subtitle.orEmpty()
                    hidePreview -> if (chat.unreadCount > 0) "New message" else "Message"
                    last.text.isNullOrEmpty() -> if (last.direction == "incoming") "👁 Message" else ""
                    else -> previewText(last.text)
                }
                Text(preview, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    color = if (typingName != null) PavaColors.Accent else PavaColors.TextMuted, modifier = Modifier.weight(1f))
                if (chat.muted) Icon(Icons.Filled.NotificationsOff, "Muted", tint = PavaColors.TextMuted, modifier = Modifier.size(16.dp).padding(start = 2.dp))
                if (chat.unreadCount > 0) {
                    Spacer(Modifier.width(6.dp))
                    Box(
                        Modifier.widthIn(min = 22.dp).height(22.dp).clip(CircleShape)
                            .background(if (chat.muted) PavaColors.TextMuted else PavaColors.Unread),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(if (chat.unreadCount > 99) "99+" else chat.unreadCount.toString(), fontSize = 12.sp,
                            fontWeight = FontWeight.Bold, color = androidx.compose.ui.graphics.Color.White,
                            modifier = Modifier.padding(horizontal = 6.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun EmptyChats(error: String?, archived: Boolean, onRetry: () -> Unit, onNewChat: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        when {
            error != null -> {
                Text("Couldn't load your chats", fontWeight = FontWeight.SemiBold)
                Text(error, color = PavaColors.TextMuted, fontSize = 14.sp)
                TextButton(onClick = onRetry) { Text("Try again") }
            }
            archived -> Text("No archived chats", color = PavaColors.TextMuted)
            else -> {
                Text("No chats yet", fontWeight = FontWeight.SemiBold)
                Text("Start a private conversation.", color = PavaColors.TextMuted, fontSize = 14.sp)
                TextButton(onClick = onNewChat) { Text("New chat") }
            }
        }
    }
}
