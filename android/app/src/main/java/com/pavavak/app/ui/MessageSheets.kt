package com.pavavak.app.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.automirrored.filled.Forward
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pavavak.app.data.ChatSummary
import com.pavavak.app.data.Message
import com.pavavak.app.data.MessageContent
import com.pavavak.app.ui.theme.PavaColors
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset

enum class MessageAction { Reply, Copy, Edit, Forward, Pin, Unpin, Star, Save, Delete }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MessageActionSheet(
    message: Message,
    isPinned: Boolean,
    onReact: (String) -> Unit,
    onAction: (MessageAction) -> Unit,
    onDismiss: () -> Unit,
) {
    var showAllEmoji by remember { mutableStateOf(false) }
    val content = message.content
    val isText = content is MessageContent.Text
    val restricted = message.viewOnce || message.deleted
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = PavaColors.Surface) {
        if (!message.deleted) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                QUICK_REACTIONS.forEach { e ->
                    Box(Modifier.size(46.dp).clip(CircleShape).clickable { onReact(e); onDismiss() }, contentAlignment = Alignment.Center) {
                        Text(e, fontSize = 26.sp)
                    }
                }
                IconButton(onClick = { showAllEmoji = !showAllEmoji }) { Icon(Icons.Filled.Add, "More reactions") }
            }
            if (showAllEmoji) EmojiPanel { onReact(it); onDismiss() }
        }
        Column(Modifier.padding(bottom = 24.dp)) {
            if (!message.deleted) SheetAction(Icons.AutoMirrored.Filled.Reply, "Reply") { onAction(MessageAction.Reply) }
            if (isText && !restricted) SheetAction(Icons.Filled.ContentCopy, "Copy") { onAction(MessageAction.Copy) }
            if (isText && message.isOutgoing && !restricted) SheetAction(Icons.Filled.Edit, "Edit") { onAction(MessageAction.Edit) }
            if (!restricted) SheetAction(Icons.AutoMirrored.Filled.Forward, "Forward") { onAction(MessageAction.Forward) }
            if (!restricted) SheetAction(Icons.Filled.PushPin, if (isPinned) "Unpin" else "Pin") {
                onAction(if (isPinned) MessageAction.Unpin else MessageAction.Pin)
            }
            if (!restricted) SheetAction(Icons.Filled.Star, "Star") { onAction(MessageAction.Star) }
            if (!restricted && (content is MessageContent.Image || content is MessageContent.Video || content is MessageContent.Document))
                SheetAction(Icons.Filled.Download, "Save to phone") { onAction(MessageAction.Save) }
            if (message.isOutgoing && !message.deleted) SheetAction(Icons.Filled.DeleteOutline, "Delete for everyone", destructive = true) {
                onAction(MessageAction.Delete)
            }
        }
    }
}

fun Context.copyText(text: String) {
    (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("message", text))
    toast("Copied")
}

@Composable
fun EditMessageDialog(initial: String, onSave: (String) -> Unit, onDismiss: () -> Unit) {
    var text by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Edit message") },
        text = { OutlinedTextField(value = text, onValueChange = { text = it }, modifier = Modifier.fillMaxWidth(), maxLines = 8) },
        confirmButton = { TextButton(enabled = text.isNotBlank() && text != initial, onClick = { onSave(text); onDismiss() }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
fun ForwardDialog(chats: List<ChatSummary>, excludeChatId: String, onPick: (ChatSummary) -> Unit, onDismiss: () -> Unit) {
    var query by remember { mutableStateOf("") }
    val visible = chats.filter { it.chatId != excludeChatId && it.displayTitle.contains(query, ignoreCase = true) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Forward to…") },
        text = {
            Column {
                OutlinedTextField(value = query, onValueChange = { query = it }, placeholder = { Text("Search chats") },
                    singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                LazyColumn(Modifier.heightIn(max = 360.dp)) {
                    items(visible, key = { it.chatId }) { chat ->
                        Row(Modifier.fillMaxWidth().clip(androidx.compose.foundation.shape.RoundedCornerShape(8.dp))
                            .clickable { onPick(chat); onDismiss() }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Avatar(chat.displayTitle, size = 36.dp)
                            Spacer(Modifier.width(12.dp))
                            Text(chat.displayTitle, fontWeight = FontWeight.Medium)
                        }
                    }
                    if (visible.isEmpty()) item { Text("No chats", color = PavaColors.TextMuted) }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** Pick a date then a time; must be at least a minute ahead (the server checks too). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScheduleDialog(onSchedule: (Instant) -> Unit, onDismiss: () -> Unit) {
    val zone = ZoneId.systemDefault()
    val inOneHour = java.time.ZonedDateTime.now(zone).plusHours(1)
    val dateState = rememberDatePickerState(initialSelectedDateMillis = inOneHour.toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
    val timeState = rememberTimePickerState(initialHour = inOneHour.hour, initialMinute = inOneHour.minute)
    var step by remember { mutableStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    if (step == 0) {
        DatePickerDialog(
            onDismissRequest = onDismiss,
            confirmButton = { TextButton(onClick = { step = 1 }) { Text("Next") } },
            dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
        ) { DatePicker(state = dateState) }
    } else {
        AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("Send at") },
            text = {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    TimePicker(state = timeState)
                    error?.let { Text(it, color = PavaColors.Danger, fontSize = 13.sp) }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    val date = dateState.selectedDateMillis?.let { Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate() } ?: LocalDate.now(zone)
                    val at = date.atTime(LocalTime.of(timeState.hour, timeState.minute)).atZone(zone).toInstant()
                    if (at.isBefore(Instant.now().plusSeconds(60))) error = "Pick a time at least a minute from now"
                    else { onSchedule(at); onDismiss() }
                }) { Text("Schedule") }
            },
            dismissButton = { TextButton(onClick = { step = 0 }) { Text("Back") } },
        )
    }
}

@Composable
fun PollDialog(onCreate: (String, List<String>) -> Unit, onDismiss: () -> Unit) {
    var question by remember { mutableStateOf("") }
    val options = remember { mutableStateListOf("", "") }
    val valid = question.isNotBlank() && options.count { it.isNotBlank() } >= 2
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Create poll") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                OutlinedTextField(value = question, onValueChange = { question = it.take(200) }, label = { Text("Question") }, modifier = Modifier.fillMaxWidth())
                options.forEachIndexed { i, o ->
                    OutlinedTextField(value = o, onValueChange = { options[i] = it.take(100) }, label = { Text("Option ${i + 1}") },
                        singleLine = true, modifier = Modifier.fillMaxWidth().padding(top = 6.dp))
                }
                if (options.size < 6) TextButton(onClick = { options.add("") }) { Text("+ Add option") }
            }
        },
        confirmButton = {
            TextButton(enabled = valid, onClick = { onCreate(question.trim(), options.map { it.trim() }.filter { it.isNotEmpty() }); onDismiss() }) { Text("Create") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
fun PinnedBanner(text: String?, onTap: () -> Unit, onUnpin: (() -> Unit)?) {
    Surface(color = PavaColors.Surface, modifier = Modifier.fillMaxWidth().clickable(onClick = onTap)) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.PushPin, null, tint = PavaColors.Accent, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(10.dp))
            Text(com.pavavak.app.data.previewText(text).take(60).ifBlank { "Pinned message" }, fontSize = 14.sp,
                maxLines = 1, color = PavaColors.TextPrimary, modifier = Modifier.weight(1f))
            if (onUnpin != null) IconButton(onClick = onUnpin, modifier = Modifier.size(28.dp)) {
                Text("✕", color = PavaColors.TextMuted)
            }
        }
    }
}
