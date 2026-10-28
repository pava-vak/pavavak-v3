package com.pavavak.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Group
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pavavak.app.data.ChatRepository
import com.pavavak.app.data.UserSearchResult
import com.pavavak.app.ui.theme.PavaColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewChatScreen(repository: ChatRepository, onBack: () -> Unit, onChatStarted: (String) -> Unit, onNewGroup: () -> Unit = {}) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<UserSearchResult>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val focus = remember { FocusRequester() }

    LaunchedEffect(Unit) { focus.requestFocus() }
    LaunchedEffect(query) {
        error = null
        if (query.trim().length < 3) { results = emptyList(); return@LaunchedEffect }
        delay(300)
        loading = true
        results = try {
            repository.searchUsers(query.trim())
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message
            emptyList()
        } finally {
            loading = false
        }
    }

    Scaffold(
        containerColor = PavaColors.Background,
        topBar = {
            TopAppBar(
                title = { Text("New chat") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = PavaColors.Background),
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).imePadding()) {
            Row(
                Modifier.fillMaxWidth().clickable(onClick = onNewGroup).padding(horizontal = 16.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Group, null, tint = PavaColors.Accent)
                Spacer(Modifier.width(14.dp))
                Text("New group", fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = PavaColors.Accent)
            }
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                placeholder = { Text("Search by name or username") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).focusRequester(focus),
            )
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 8.dp))
            val hint = when {
                error != null -> error
                query.trim().length < 3 -> "Type at least 3 letters"
                !loading && results.isEmpty() -> "No one found"
                else -> null
            }
            hint?.let { Text(it!!, color = PavaColors.TextMuted, modifier = Modifier.padding(16.dp)) }
            LazyColumn {
                items(results, key = { it.userId }) { person ->
                    Row(
                        Modifier.fillMaxWidth().clickable {
                            scope.launch {
                                runCatching { repository.startChatWith(person.userId) }
                                    .onSuccess { onChatStarted(it.chatId) }
                                    .onFailure { error = it.message }
                            }
                        }.padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Avatar(person.displayName)
                        Spacer(Modifier.width(14.dp))
                        Column {
                            Text(person.displayName, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                            Text("@${person.username}", color = PavaColors.TextMuted, fontSize = 13.sp)
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewGroupScreen(repository: ChatRepository, onBack: () -> Unit, onGroupCreated: (String) -> Unit) {
    var name by remember { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<UserSearchResult>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // userId -> display name, so selected people survive searching for the next one
    val selected = remember { androidx.compose.runtime.mutableStateMapOf<Long, String>() }
    val scope = rememberCoroutineScope()

    LaunchedEffect(query) {
        error = null
        if (query.trim().length < 3) { results = emptyList(); return@LaunchedEffect }
        delay(300)
        loading = true
        results = try { repository.searchUsers(query.trim()) }
        catch (e: kotlinx.coroutines.CancellationException) { throw e }
        catch (e: Exception) { error = e.message; emptyList() }
        finally { loading = false }
    }

    val canCreate = name.trim().isNotEmpty() && selected.isNotEmpty() && !creating

    Scaffold(
        containerColor = PavaColors.Background,
        topBar = {
            TopAppBar(
                title = { Text(if (selected.isEmpty()) "New group" else "New group · ${selected.size}") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = PavaColors.Background),
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).imePadding()) {
            OutlinedTextField(
                value = name, onValueChange = { name = it },
                placeholder = { Text("Group name") }, singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
            )
            if (selected.isNotEmpty()) Text(
                selected.values.joinToString(", "),
                color = PavaColors.TextMuted, fontSize = 13.sp,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
            Button(
                onClick = {
                    creating = true
                    scope.launch {
                        runCatching { repository.createGroup(name.trim(), selected.keys.toList()) }
                            .onSuccess { onGroupCreated(it.chatId) }
                            .onFailure { error = it.message; creating = false }
                    }
                },
                enabled = canCreate,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
            ) { Text(if (creating) "Creating…" else "Create group") }
            OutlinedTextField(
                value = query, onValueChange = { query = it },
                placeholder = { Text("Add people by name or username") }, singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
            )
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 8.dp))
            error?.let { Text(it, color = PavaColors.Danger, modifier = Modifier.padding(16.dp)) }
            LazyColumn {
                items(results, key = { it.userId }) { person ->
                    val isSel = selected.containsKey(person.userId)
                    Row(
                        Modifier.fillMaxWidth().clickable {
                            if (isSel) selected.remove(person.userId) else selected[person.userId] = person.displayName
                        }.padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Avatar(person.displayName)
                        Spacer(Modifier.width(14.dp))
                        Column(Modifier.weight(1f)) {
                            Text(person.displayName, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                            Text("@${person.username}", color = PavaColors.TextMuted, fontSize = 13.sp)
                        }
                        if (isSel) Icon(Icons.Filled.Check, "Selected", tint = PavaColors.Accent)
                    }
                }
            }
        }
    }
}
