package com.pavavak.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pavavak.app.data.AdminChat
import com.pavavak.app.data.AdminSummary
import com.pavavak.app.data.AdminUser
import com.pavavak.app.data.ChatRepository
import com.pavavak.app.data.Message
import com.pavavak.app.data.MessageContent
import com.pavavak.app.data.previewText
import com.pavavak.app.ui.theme.PavaColors
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

@Composable
fun AdminScreen(repository: ChatRepository, onBack: () -> Unit, onMonitor: (AdminChat) -> Unit) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var addUser by remember { mutableStateOf(false) }
    var reloadUsers by remember { mutableIntStateOf(0) }
    Scaffold(
        containerColor = PavaColors.Background,
        topBar = { SimpleTopBar("Admin", onBack) },
        floatingActionButton = {
            if (tab == 1) FloatingActionButton(onClick = { addUser = true }, containerColor = PavaColors.Accent, contentColor = PavaColors.OnAccent) {
                Icon(Icons.Filled.Add, "Add user")
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            TabRow(selectedTabIndex = tab, containerColor = PavaColors.Background) {
                listOf("Overview", "Users", "Monitor").forEachIndexed { i, label -> Tab(selected = tab == i, onClick = { tab = i }, text = { Text(label) }) }
            }
            when (tab) {
                0 -> AdminOverview(repository)
                1 -> AdminUsers(repository, reloadUsers)
                else -> AdminChats(repository, onMonitor)
            }
        }
    }
    if (addUser) AddUserDialog(repository, onDone = { reloadUsers++ }) { addUser = false }
}

@Composable
private fun AdminOverview(repository: ChatRepository) {
    var summary by remember { mutableStateOf<AdminSummary?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmBroadcast by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    LaunchedEffect(Unit) { runCatching { repository.api.adminSummary() }.onSuccess { summary = it }.onFailure { error = it.message } }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (error != null) Text(error!!, color = PavaColors.Danger)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Stat("Users", summary?.users, Modifier.weight(1f))
            Stat("Chats", summary?.conversations, Modifier.weight(1f))
            Stat("Messages", summary?.messages, Modifier.weight(1f))
        }
        Surface(color = PavaColors.Surface, shape = RoundedCornerShape(14.dp)) {
            Column(Modifier.fillMaxWidth().padding(16.dp)) {
                Text("Tell everyone about an update", fontWeight = FontWeight.SemiBold, color = PavaColors.TextPrimary)
                Text("Sends a system message to every user asking them to refresh or update the app.", color = PavaColors.TextMuted, fontSize = 13.sp)
                Spacer(Modifier.height(10.dp))
                Button(onClick = { confirmBroadcast = true }) {
                    Icon(Icons.Filled.Campaign, null); Spacer(Modifier.size(8.dp)); Text("Send update notice")
                }
            }
        }
        Text("Monitoring is read-only. Members never see that a chat was viewed.", color = PavaColors.TextMuted, fontSize = 12.sp)
    }
    if (confirmBroadcast) ConfirmDialog("Send update notice?", "Every user will get a system message.", "Send", onConfirm = {
        scope.launch {
            runCatching { repository.api.adminBroadcastUpdate() }.onSuccess { context.toast("Sent to $it chats") }
                .onFailure { context.toast(it.message ?: "Couldn't send") }
        }
    }, onDismiss = { confirmBroadcast = false })
}

@Composable
private fun Stat(label: String, value: Int?, modifier: Modifier) {
    Surface(color = PavaColors.Surface, shape = RoundedCornerShape(14.dp), modifier = modifier) {
        Column(Modifier.padding(14.dp)) {
            Text(value?.toString() ?: "–", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = PavaColors.Accent)
            Text(label, color = PavaColors.TextMuted, fontSize = 13.sp)
        }
    }
}

@Composable
private fun AdminUsers(repository: ChatRepository, reloadKey: Int) {
    var users by remember { mutableStateOf<List<AdminUser>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var menuFor by remember { mutableStateOf<Long?>(null) }
    var tempPassword by remember { mutableStateOf<Pair<String, String>?>(null) }
    var confirmReset by remember { mutableStateOf<AdminUser?>(null) }
    var filter by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    suspend fun load() { runCatching { repository.api.adminUsers() }.onSuccess { users = it; error = null }.onFailure { error = it.message } }
    LaunchedEffect(reloadKey) { load() }

    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(filter, { filter = it }, placeholder = { Text("Filter users") }, singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp))
        when {
            error != null -> Text(error!!, color = PavaColors.Danger, modifier = Modifier.padding(16.dp))
            users == null -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 88.dp)) {
                val shown = users!!.filter { filter.isBlank() || it.username.contains(filter, true) || it.displayName.contains(filter, true) }
                items(shown, key = { it.userId }) { u ->
                    ListItem(
                        headlineContent = { Text(u.displayName, color = if (u.disabled) PavaColors.TextMuted else PavaColors.TextPrimary) },
                        supportingContent = {
                            Text("@${u.username}" + (if (u.isAdmin) " · Admin" else "") + (if (u.disabled) " · Disabled" else ""),
                                color = if (u.disabled) PavaColors.Danger else PavaColors.TextMuted)
                        },
                        leadingContent = { Avatar(u.displayName, size = 40.dp) },
                        trailingContent = {
                            Box {
                                IconButton(onClick = { menuFor = u.userId }) { Icon(Icons.Filled.MoreVert, "Actions for ${u.displayName}") }
                                DropdownMenu(expanded = menuFor == u.userId, onDismissRequest = { menuFor = null }) {
                                    DropdownMenuItem(text = { Text("Reset password") }, onClick = { menuFor = null; confirmReset = u })
                                    if (!u.isAdmin) DropdownMenuItem(text = { Text(if (u.disabled) "Enable account" else "Disable account") }, onClick = {
                                        menuFor = null
                                        scope.launch {
                                            runCatching { repository.api.adminSetDisabled(u.userId, !u.disabled) }.onSuccess { load() }
                                                .onFailure { context.toast(it.message ?: "Couldn't update") }
                                        }
                                    })
                                }
                            }
                        },
                        colors = ListItemDefaults.colors(containerColor = PavaColors.Background),
                    )
                }
            }
        }
    }
    confirmReset?.let { u ->
        ConfirmDialog("Reset password for ${u.displayName}?", "They'll be signed out everywhere and need the temporary password to sign in.", "Reset",
            destructive = true, onConfirm = {
                scope.launch {
                    runCatching { repository.api.adminResetPassword(u.userId) }.onSuccess { tempPassword = u.displayName to it }
                        .onFailure { context.toast(it.message ?: "Couldn't reset") }
                }
            }, onDismiss = { confirmReset = null })
    }
    tempPassword?.let { (name, pw) ->
        AlertDialog(
            onDismissRequest = { tempPassword = null },
            title = { Text("Temporary password") },
            text = {
                Column {
                    Text("Give this to $name privately. It's shown only once.", color = PavaColors.TextMuted)
                    Spacer(Modifier.height(12.dp))
                    Text(pw, fontFamily = FontFamily.Monospace, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = PavaColors.TextPrimary)
                }
            },
            confirmButton = { TextButton(onClick = { context.copyText(pw); context.toast("Copied") }) { Text("Copy") } },
            dismissButton = { TextButton(onClick = { tempPassword = null }) { Text("Done") } },
        )
    }
}

@Composable
private fun AddUserDialog(repository: ChatRepository, onDone: () -> Unit, onDismiss: () -> Unit) {
    var username by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Add user") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(username, { username = it.trim().lowercase() }, label = { Text("Username") }, singleLine = true)
                OutlinedTextField(displayName, { displayName = it }, label = { Text("Display name") }, singleLine = true)
                OutlinedTextField(password, { password = it }, label = { Text("Password") }, singleLine = true,
                    supportingText = { Text("At least 8 characters") })
                if (error != null) Text(error!!, color = PavaColors.Danger, fontSize = 13.sp)
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && username.length >= 3 && password.length >= 8, onClick = {
                busy = true
                scope.launch {
                    runCatching { repository.api.adminCreateUser(username, displayName.ifBlank { username }, password) }
                        .onSuccess { context.toast("User added"); onDone(); onDismiss() }
                        .onFailure { error = it.message ?: "Couldn't add user" }
                    busy = false
                }
            }) { Text("Add") }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("Cancel") } },
    )
}

@Composable
private fun AdminChats(repository: ChatRepository, onMonitor: (AdminChat) -> Unit) {
    var chats by remember { mutableStateOf<List<AdminChat>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var filter by remember { mutableStateOf("") }
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(reload) { runCatching { repository.api.adminChats() }.onSuccess { chats = it; error = null }.onFailure { error = it.message } }
    Column(Modifier.fillMaxSize()) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
            OutlinedTextField(filter, { filter = it }, placeholder = { Text("Filter by name") }, singleLine = true, modifier = Modifier.weight(1f))
            IconButton(onClick = { reload++ }) { Icon(Icons.Filled.Refresh, "Refresh") }
        }
        when {
            error != null -> Text(error!!, color = PavaColors.Danger, modifier = Modifier.padding(16.dp))
            chats == null -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            else -> LazyColumn(Modifier.fillMaxSize()) {
                val shown = chats!!.filter { filter.isBlank() || it.label.contains(filter, true) }
                items(shown, key = { it.chatId }) { c ->
                    ListItem(
                        headlineContent = { Text(c.label, color = PavaColors.TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        supportingContent = {
                            Text(previewText(c.lastMessage?.text).ifBlank { "No messages" }, color = PavaColors.TextMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        },
                        leadingContent = { Avatar(c.label, size = 40.dp) },
                        trailingContent = { Text(formatListTimestamp(c.lastSentAt ?: c.lastMessage?.sentAt), fontSize = 12.sp, color = PavaColors.TextMuted) },
                        colors = ListItemDefaults.colors(containerColor = PavaColors.Background),
                        modifier = Modifier.clickable { onMonitor(c) },
                    )
                }
            }
        }
    }
}

/** Read-only view of any chat, including messages members deleted or cleared. */
@Composable
fun MonitorChatScreen(repository: ChatRepository, chatId: String, title: String, onBack: () -> Unit, onGallery: () -> Unit) {
    var messages by remember { mutableStateOf<List<Message>>(emptyList()) }  // newest first
    var cursor by remember { mutableStateOf<String?>(null) }
    var hasMore by remember { mutableStateOf(true) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var images by remember { mutableStateOf<Pair<List<String>, Int>?>(null) }
    var video by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    fun loadMore() {
        if (loading || !hasMore) return
        loading = true
        scope.launch {
            runCatching { repository.api.adminThread(chatId, cursor) }
                .onSuccess { page ->
                    // Pages arrive oldest-first; the list shows newest at the bottom (reversed layout)
                    val known = messages.mapTo(HashSet()) { it.messageId }
                    messages = messages + page.items.filter { it.messageId !in known }.asReversed()
                    cursor = page.nextCursor; hasMore = page.hasMore && page.nextCursor != null; error = null
                }
                .onFailure { error = it.message }
            loading = false
        }
    }
    LaunchedEffect(chatId) { loadMore() }
    LaunchedEffect(listState) {
        snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }.distinctUntilChanged()
            .collect { if (messages.isNotEmpty() && it >= messages.size - 5) loadMore() }
    }
    val imageIds = messages.asReversed().mapNotNull { (it.content as? MessageContent.Image)?.fileId }
    val callbacks = BubbleCallbacks(
        onOpenImage = { id -> images = imageIds to imageIds.indexOf(id).coerceAtLeast(0) },
        onOpenVideo = { video = it },
        onOpenViewOnce = { m ->
            when (val c = m.content) {
                is MessageContent.Image -> images = listOf(c.fileId) to 0
                is MessageContent.Video -> video = c.fileId
                else -> Unit
            }
        },
    )

    Scaffold(
        containerColor = PavaColors.Background,
        topBar = {
            SimpleTopBar(title, onBack) {
                IconButton(onClick = onGallery) { Icon(Icons.Filled.PhotoLibrary, "Media in this chat") }
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            Row(
                Modifier.fillMaxWidth().background(PavaColors.Accent.copy(alpha = 0.12f)).padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Visibility, null, tint = PavaColors.Accent, modifier = Modifier.size(18.dp))
                Spacer(Modifier.size(8.dp))
                Text("Monitoring · read-only", color = PavaColors.Accent, fontSize = 13.sp)
            }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when {
                    error != null && messages.isEmpty() -> Text(error!!, color = PavaColors.Danger, modifier = Modifier.padding(16.dp))
                    loading && messages.isEmpty() -> SplashScreen()
                    messages.isEmpty() -> Text("No messages", color = PavaColors.TextMuted, modifier = Modifier.align(Alignment.Center))
                    else -> LazyColumn(state = listState, reverseLayout = true, modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 8.dp)) {
                        items(messages, key = { it.messageId }) { m ->
                            MessageBubble(m, repository, emptyList(), callbacks, monitor = true)
                        }
                        if (loading) item { Box(Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                        } }
                    }
                }
            }
        }
    }
    images?.let { (ids, start) -> ImageViewer(repository.media, ids, start) { images = null } }
    video?.let { VideoViewer(repository.media, it) { video = null } }
}
