package com.pavavak.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pavavak.app.data.ChatRepository
import com.pavavak.app.data.GroupMember
import com.pavavak.app.data.UserSearchResult
import com.pavavak.app.ui.theme.PavaColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupInfoScreen(repository: ChatRepository, chatId: String, onBack: () -> Unit, onChatGone: () -> Unit) {
    val details by repository.groupDetails.collectAsStateWithLifecycle()
    val detail = details[chatId]
    val me = repository.currentUser?.userId
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()

    var renaming by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    var confirmLeave by remember { mutableStateOf(false) }
    var memberMenu by remember { mutableStateOf<GroupMember?>(null) }
    var confirmRemove by remember { mutableStateOf<GroupMember?>(null) }

    LaunchedEffect(chatId) { repository.refreshGroupDetail(chatId) }

    val amAdmin = detail?.isAdmin == true

    Scaffold(
        containerColor = PavaColors.Background,
        topBar = { SimpleTopBar("Group info", onBack) },
    ) { padding ->
        if (detail == null) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                LinearProgressIndicator(Modifier.width(120.dp))
            }
            return@Scaffold
        }
        Column(Modifier.fillMaxSize().padding(padding)) {
            // Header: avatar + name (+ rename for admins) + member count
            Column(Modifier.fillMaxWidth().padding(vertical = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Avatar(detail.title ?: "Group", size = 84.dp)
                Spacer(Modifier.height(12.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(detail.title ?: "Group", fontWeight = FontWeight.Bold, fontSize = 22.sp, color = PavaColors.TextPrimary)
                    if (amAdmin) IconButton(onClick = { renaming = true }) { Icon(Icons.Filled.Edit, "Rename group", tint = PavaColors.TextMuted) }
                }
                Text("${detail.memberCount} members", color = PavaColors.TextMuted, fontSize = 14.sp)
            }

            if (amAdmin) Row(
                Modifier.fillMaxWidth().clickable { adding = true }.padding(horizontal = 20.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.PersonAdd, null, tint = PavaColors.Accent)
                Spacer(Modifier.width(16.dp))
                Text("Add members", color = PavaColors.Accent, fontWeight = FontWeight.SemiBold)
            }

            LazyColumn(Modifier.weight(1f)) {
                items(detail.members, key = { it.userId }) { m ->
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Avatar(m.displayName.ifBlank { "?" })
                        Spacer(Modifier.width(14.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                if (m.userId == me) "${m.displayName} (You)" else m.displayName,
                                fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = PavaColors.TextPrimary,
                            )
                            m.username?.let { Text("@$it", color = PavaColors.TextMuted, fontSize = 13.sp) }
                        }
                        if (m.isAdmin) Surface(color = PavaColors.SurfaceHigh, shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp)) {
                            Text("Admin", fontSize = 11.sp, color = PavaColors.Accent, modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp))
                        }
                        // Admins can manage everyone except themselves here (leave is the self action)
                        if (amAdmin && m.userId != me) Box {
                            IconButton(onClick = { memberMenu = m }) { Icon(Icons.Filled.MoreVert, "Manage", tint = PavaColors.TextMuted) }
                            DropdownMenu(expanded = memberMenu?.userId == m.userId, onDismissRequest = { memberMenu = null }) {
                                DropdownMenuItem(
                                    text = { Text(if (m.isAdmin) "Dismiss as admin" else "Make admin") },
                                    onClick = {
                                        memberMenu = null
                                        scope.launch {
                                            runCatching { repository.setGroupRole(chatId, m.userId, if (m.isAdmin) "member" else "admin") }
                                                .onFailure { context.toast(it.message ?: "Couldn't update") }
                                        }
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text("Remove from group", color = PavaColors.Danger) },
                                    onClick = { memberMenu = null; confirmRemove = m },
                                )
                            }
                        }
                    }
                }
            }

            Row(
                Modifier.fillMaxWidth().clickable { confirmLeave = true }.padding(horizontal = 20.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.AutoMirrored.Filled.Logout, null, tint = PavaColors.Danger)
                Spacer(Modifier.width(16.dp))
                Text("Leave group", color = PavaColors.Danger, fontWeight = FontWeight.SemiBold)
            }
        }
    }

    if (renaming && detail != null) RenameGroupDialog(detail.title ?: "", onSave = { newName ->
        scope.launch { runCatching { repository.renameGroup(chatId, newName) }.onFailure { context.toast(it.message ?: "Couldn't rename") } }
    }, onDismiss = { renaming = false })

    if (adding && detail != null) AddMembersDialog(repository, existing = detail.members.map { it.userId }.toSet(), onAdd = { ids ->
        scope.launch { runCatching { repository.addGroupMembers(chatId, ids) }.onFailure { context.toast(it.message ?: "Couldn't add") } }
    }, onDismiss = { adding = false })

    confirmRemove?.let { m ->
        ConfirmDialog("Remove ${m.displayName}?", "They will be removed from this group.", "Remove", destructive = true,
            onConfirm = { scope.launch { runCatching { repository.removeGroupMember(chatId, m.userId) }.onFailure { context.toast(it.message ?: "Couldn't remove") } } },
            onDismiss = { confirmRemove = null })
    }
    if (confirmLeave) ConfirmDialog("Leave group?", "You'll stop receiving messages from this group.", "Leave", destructive = true,
        onConfirm = { scope.launch { runCatching { repository.leaveGroup(chatId); onChatGone() }.onFailure { context.toast(it.message ?: "Couldn't leave") } } },
        onDismiss = { confirmLeave = false })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RenameGroupDialog(current: String, onSave: (String) -> Unit, onDismiss: () -> Unit) {
    var text by remember { mutableStateOf(current) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Group name") },
        text = { OutlinedTextField(text, { text = it }, singleLine = true, modifier = Modifier.fillMaxWidth()) },
        confirmButton = { TextButton(onClick = { if (text.trim().isNotEmpty()) { onSave(text.trim()); onDismiss() } }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddMembersDialog(repository: ChatRepository, existing: Set<Long>, onAdd: (List<Long>) -> Unit, onDismiss: () -> Unit) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<UserSearchResult>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    val selected = remember { androidx.compose.runtime.mutableStateMapOf<Long, String>() }

    LaunchedEffect(query) {
        if (query.trim().length < 3) { results = emptyList(); return@LaunchedEffect }
        delay(300)
        loading = true
        results = try { repository.searchUsers(query.trim()) } catch (e: Exception) { emptyList() } finally { loading = false }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add members") },
        text = {
            Column(Modifier.fillMaxWidth().imePadding()) {
                OutlinedTextField(query, { query = it }, placeholder = { Text("Search people") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                if (loading) LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 8.dp))
                Column(Modifier.height(240.dp).verticalScroll(rememberScrollState())) {
                    results.filter { it.userId !in existing }.forEach { person ->
                        val isSel = selected.containsKey(person.userId)
                        Row(
                            Modifier.fillMaxWidth().clickable {
                                if (isSel) selected.remove(person.userId) else selected[person.userId] = person.displayName
                            }.padding(vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Avatar(person.displayName, size = 34.dp)
                            Spacer(Modifier.width(12.dp))
                            Text(person.displayName, Modifier.weight(1f), fontWeight = FontWeight.Medium)
                            if (isSel) Icon(Icons.Filled.PersonAdd, "Selected", tint = PavaColors.Accent)
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(enabled = selected.isNotEmpty(), onClick = { onAdd(selected.keys.toList()); onDismiss() }) {
                Text(if (selected.isEmpty()) "Add" else "Add ${selected.size}")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
