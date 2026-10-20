package com.pavavak.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pavavak.app.data.ChatRepository
import com.pavavak.app.data.ChatSummary
import com.pavavak.app.data.User
import com.pavavak.app.data.previewText
import com.pavavak.app.ui.theme.PavaColors

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatListScreen(
    repository: ChatRepository,
    user: User,
    onOpenChat: (String) -> Unit,
    onNewChat: () -> Unit,
) {
    val state by repository.chatList.collectAsStateWithLifecycle()
    val typing by repository.typing.collectAsStateWithLifecycle()
    var menuOpen by remember { mutableStateOf(false) }

    Scaffold(
        containerColor = PavaColors.Background,
        topBar = {
            TopAppBar(
                title = { Text("PaVa Vak", fontWeight = FontWeight.Bold) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = PavaColors.Background),
                actions = {
                    IconButton(onClick = { menuOpen = true }) { Icon(Icons.Filled.MoreVert, "Menu") }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        DropdownMenuItem(
                            text = { Text("Signed in as @${user.username}", color = PavaColors.TextMuted) },
                            onClick = {}, enabled = false,
                        )
                        DropdownMenuItem(
                            text = { Text("Sign out") },
                            leadingIcon = { Icon(Icons.AutoMirrored.Filled.Logout, null) },
                            onClick = { menuOpen = false; repository.logout() },
                        )
                    }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onNewChat, containerColor = PavaColors.Accent) {
                Icon(Icons.Filled.Edit, "New chat")
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
                state.chats.isEmpty() -> EmptyChats(state.error, onRetry = repository::refreshChats, onNewChat = onNewChat)
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    items(state.chats, key = { it.chatId }) { chat ->
                        ChatRow(chat, typingName = typing[chat.chatId], onClick = { onOpenChat(chat.chatId) })
                        HorizontalDivider(Modifier.padding(start = 76.dp), color = PavaColors.Outline.copy(alpha = 0.5f))
                    }
                }
            }
        }
    }
}

@Composable
private fun ChatRow(chat: ChatSummary, typingName: String?, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(chat.displayTitle)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    chat.displayTitle, fontWeight = FontWeight.SemiBold, fontSize = 16.sp,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                )
                Text(
                    formatListTimestamp(chat.lastMessage?.sentAt), fontSize = 12.sp,
                    color = if (chat.unreadCount > 0) PavaColors.Unread else PavaColors.TextMuted,
                )
            }
            Spacer(Modifier.height(3.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                val preview = when {
                    typingName != null -> "typing…"
                    chat.lastMessage == null -> chat.subtitle.orEmpty()
                    chat.lastMessage.direction == "outgoing" -> "You: " + previewText(chat.lastMessage.text)
                    else -> previewText(chat.lastMessage.text)
                }
                Text(
                    preview, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    color = if (typingName != null) PavaColors.Accent else PavaColors.TextMuted,
                    modifier = Modifier.weight(1f),
                )
                if (chat.unreadCount > 0) {
                    Spacer(Modifier.width(8.dp))
                    Box(
                        Modifier.widthIn(min = 22.dp).height(22.dp).clip(CircleShape).background(PavaColors.Unread),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            if (chat.unreadCount > 99) "99+" else chat.unreadCount.toString(),
                            fontSize = 12.sp, fontWeight = FontWeight.Bold, color = PavaColors.Background,
                            modifier = Modifier.padding(horizontal = 6.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun EmptyChats(error: String?, onRetry: () -> Unit, onNewChat: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (error != null) {
            Text("Couldn't load your chats", fontWeight = FontWeight.SemiBold)
            Text(error, color = PavaColors.TextMuted, fontSize = 14.sp)
            TextButton(onClick = onRetry) { Text("Try again") }
        } else {
            Text("No chats yet", fontWeight = FontWeight.SemiBold)
            Text("Start a private conversation.", color = PavaColors.TextMuted, fontSize = 14.sp)
            TextButton(onClick = onNewChat) { Text("New chat") }
        }
    }
}
