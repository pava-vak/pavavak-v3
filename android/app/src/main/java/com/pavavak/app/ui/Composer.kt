package com.pavavak.app.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.EmojiEmotions
import androidx.compose.material.icons.filled.Keyboard
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.Photo
import androidx.compose.material.icons.filled.Poll
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.pavavak.app.data.Message
import com.pavavak.app.data.previewText
import com.pavavak.app.ui.theme.PavaColors
import kotlinx.coroutines.delay
import java.io.File

val QUICK_REACTIONS = listOf("❤️", "👍", "😂", "😮", "😢", "🙏")

val EMOJI = listOf(
    "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚",
    "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🥸", "🤩", "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "☹️",
    "😣", "😖", "😫", "😩", "🥺", "😢", "😭", "😤", "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓",
    "🤗", "🤔", "🤭", "🤫", "🤥", "😶", "😐", "😑", "😬", "🙄", "😯", "😦", "😧", "😮", "😲", "🥱", "😴", "🤤", "😪", "😵",
    "🤐", "🥴", "🤢", "🤮", "🤧", "😷", "🤒", "🤕", "🤑", "🤠", "😈", "👿", "👻", "💀", "👽", "🤖", "💩", "😺", "😸", "😹",
    "👍", "👎", "👌", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇", "☝️", "👋", "🤚", "🖐️", "✋", "👏", "🙌", "🙏",
    "💪", "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💯",
    "🔥", "✨", "⭐", "🌟", "💫", "🎉", "🎊", "🎁", "🎂", "🍰", "☕", "🍵", "🍕", "🍔", "🍟", "🌹", "🌸", "🌞", "🌙", "⚡",
    "✅", "❌", "⚠️", "❓", "❗", "💤", "💬", "👀", "🙈", "🙉", "🙊", "🤝", "🫶", "🫡", "🫠", "🥹", "😮‍💨", "🤌", "👑", "💎",
)

data class ComposerOptions(val viewOnce: Boolean = false, val deleteAfter: String = "never")

private val DELETE_AFTER = listOf("never" to "Off", "1h" to "1 hour", "24h" to "24 hours", "7d" to "7 days")

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun Composer(
    chatId: String,
    replyTo: Message?,
    onCancelReply: () -> Unit,
    initialDraft: String,
    onDraftChange: (String) -> Unit,
    onSendText: (String, ComposerOptions) -> Unit,
    onSendImage: (Uri, ComposerOptions) -> Unit,
    onSendVideo: (Uri, ComposerOptions) -> Unit,
    onSendDocument: (Uri, ComposerOptions) -> Unit,
    onSendVoice: (File, ComposerOptions) -> Unit,
    onTyping: (Boolean) -> Unit,
    onSchedule: (String) -> Unit,
    onPoll: () -> Unit,
) {
    val context = LocalContext.current
    var text by rememberSaveable(chatId) { mutableStateOf(initialDraft) }
    var options by remember(chatId) { mutableStateOf(ComposerOptions()) }
    var showAttach by remember { mutableStateOf(false) }
    var showEmoji by remember { mutableStateOf(false) }
    var lastTypingSent by remember { mutableLongStateOf(0L) }
    var typingVersion by remember { mutableStateOf(0) }
    val keyboard = LocalSoftwareKeyboardController.current
    val focus = remember { FocusRequester() }

    LaunchedEffect(typingVersion) {
        if (typingVersion == 0) return@LaunchedEffect
        delay(1500)
        onTyping(false)
        lastTypingSent = 0L
    }
    LaunchedEffect(replyTo) { if (replyTo != null) runCatching { focus.requestFocus() } }

    // Media pickers: options are captured when the picker returns
    val pickMedia = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            val type = context.contentResolver.getType(uri).orEmpty()
            if (type.startsWith("video/")) onSendVideo(uri, options) else onSendImage(uri, options)
            options = ComposerOptions()
        }
    }
    var captureUri by remember { mutableStateOf<Uri?>(null) }
    val takePhoto = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        captureUri?.let { if (ok) { onSendImage(it, options); options = ComposerOptions() } }
    }
    val takeVideo = rememberLauncherForActivityResult(ActivityResultContracts.CaptureVideo()) { ok ->
        captureUri?.let { if (ok) { onSendVideo(it, options); options = ComposerOptions() } }
    }
    val pickDocument = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) { onSendDocument(uri, options); options = ComposerOptions() }
    }

    fun send() {
        if (text.isBlank()) return
        onSendText(text, options)
        text = ""
        onDraftChange("")
        options = ComposerOptions()
        onTyping(false)
        lastTypingSent = 0L
    }

    Column(Modifier.fillMaxWidth().background(PavaColors.Background)) {
        replyTo?.let { ReplyBar(it, onCancelReply) }
        if (options.viewOnce || options.deleteAfter != "never") {
            Row(Modifier.padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (options.viewOnce) Chip("👁 View once") { options = options.copy(viewOnce = false) }
                if (options.deleteAfter != "never") Chip("⏱ ${DELETE_AFTER.first { it.first == options.deleteAfter }.second}") {
                    options = options.copy(deleteAfter = "never")
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 6.dp), verticalAlignment = Alignment.Bottom) {
            Surface(shape = RoundedCornerShape(26.dp), color = PavaColors.SurfaceHigh, modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.Bottom) {
                    IconButton(onClick = {
                        showEmoji = !showEmoji
                        if (showEmoji) keyboard?.hide() else runCatching { focus.requestFocus() }
                    }) { Icon(if (showEmoji) Icons.Filled.Keyboard else Icons.Filled.EmojiEmotions, "Emoji", tint = PavaColors.TextMuted) }
                    TextField(
                        value = text,
                        onValueChange = {
                            text = it
                            onDraftChange(it)
                            val now = System.currentTimeMillis()
                            if (it.isNotBlank() && now - lastTypingSent > 2500) { onTyping(true); lastTypingSent = now }
                            typingVersion++
                        },
                        placeholder = { Text(if (options.viewOnce) "👁 View once message" else "Message", color = PavaColors.TextMuted) },
                        maxLines = 6,
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent,
                            focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
                            focusedTextColor = PavaColors.TextPrimary, unfocusedTextColor = PavaColors.TextPrimary,
                        ),
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                        modifier = Modifier.weight(1f).focusRequester(focus),
                    )
                    IconButton(onClick = { showAttach = true }) { Icon(Icons.Filled.AttachFile, "Attach", tint = PavaColors.TextMuted) }
                    if (text.isBlank()) IconButton(onClick = {
                        captureUri = newCaptureUri(context, "jpg"); captureUri?.let { takePhoto.launch(it) }
                    }) { Icon(Icons.Filled.PhotoCamera, "Camera", tint = PavaColors.TextMuted) }
                }
            }
            Spacer(Modifier.width(6.dp))
            if (text.isNotBlank()) {
                FilledIconButton(
                    onClick = ::send,
                    colors = IconButtonDefaults.filledIconButtonColors(containerColor = PavaColors.Accent),
                    modifier = Modifier.size(52.dp),
                ) { Icon(if (options.viewOnce) Icons.Filled.Visibility else Icons.AutoMirrored.Filled.Send, "Send", tint = PavaColors.OnAccent) }
            } else {
                VoiceRecordButton(onRecorded = { onSendVoice(it, options); options = ComposerOptions() })
            }
        }
        if (showEmoji) EmojiPanel { emoji -> text += emoji; onDraftChange(text) }
    }

    if (showAttach) {
        ModalBottomSheet(onDismissRequest = { showAttach = false }, containerColor = PavaColors.Surface) {
            Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 28.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    AttachTile(Icons.Filled.Photo, "Gallery", Color(0xFF8B5CF6)) {
                        showAttach = false
                        pickMedia.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
                    }
                    AttachTile(Icons.Filled.PhotoCamera, "Camera", Color(0xFFEC4899)) {
                        showAttach = false; captureUri = newCaptureUri(context, "jpg"); captureUri?.let { takePhoto.launch(it) }
                    }
                    AttachTile(Icons.Filled.Videocam, "Video", Color(0xFFEF4444)) {
                        showAttach = false; captureUri = newCaptureUri(context, "mp4"); captureUri?.let { takeVideo.launch(it) }
                    }
                    AttachTile(Icons.Filled.AttachFile, "Document", Color(0xFF0EA5E9)) {
                        showAttach = false
                        pickDocument.launch(arrayOf("application/pdf", "application/msword",
                            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                            "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                            "text/plain", "text/csv", "application/zip"))
                    }
                }
                Spacer(Modifier.height(18.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    AttachTile(Icons.Filled.Visibility, if (options.viewOnce) "View once ✓" else "View once", Color(0xFF14B8A6)) {
                        options = options.copy(viewOnce = !options.viewOnce); showAttach = false
                    }
                    AttachTile(Icons.Filled.Timer, "Timer", Color(0xFFF59E0B)) {
                        val idx = DELETE_AFTER.indexOfFirst { it.first == options.deleteAfter }
                        options = options.copy(deleteAfter = DELETE_AFTER[(idx + 1) % DELETE_AFTER.size].first)
                    }
                    AttachTile(Icons.Filled.Schedule, "Schedule", Color(0xFF6366F1)) {
                        showAttach = false
                        if (text.isBlank()) context.toast("Type the message first, then schedule it") else onSchedule(text.also { text = ""; onDraftChange("") })
                    }
                    AttachTile(Icons.Filled.Poll, "Poll", Color(0xFF10B981)) { showAttach = false; onPoll() }
                }
                if (options.deleteAfter != "never") Text(
                    "Auto-delete: ${DELETE_AFTER.first { it.first == options.deleteAfter }.second} (tap again to change)",
                    color = PavaColors.TextMuted, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp).align(Alignment.CenterHorizontally),
                )
            }
        }
    }
}

private fun newCaptureUri(context: Context, ext: String): Uri {
    val dir = File(context.cacheDir, "captures").apply { mkdirs() }
    val file = File(dir, "capture_${System.currentTimeMillis()}.$ext")
    return FileProvider.getUriForFile(context, "${context.packageName}.files", file)
}

@Composable
private fun ReplyBar(message: Message, onCancel: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 4.dp).clip(RoundedCornerShape(10.dp))
            .background(PavaColors.SurfaceHigh).padding(start = 0.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(4.dp).height(48.dp).background(PavaColors.Accent))
        Column(Modifier.weight(1f).padding(horizontal = 10.dp, vertical = 6.dp)) {
            Text(if (message.isOutgoing) "Replying to yourself" else "Replying to ${message.senderDisplayName ?: "message"}",
                fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = PavaColors.Accent)
            Text(previewText(message.text), fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, color = PavaColors.TextMuted)
        }
        IconButton(onClick = onCancel) { Icon(Icons.Filled.Close, "Cancel reply", tint = PavaColors.TextMuted) }
    }
}

@Composable
private fun Chip(label: String, onRemove: () -> Unit) {
    Surface(shape = RoundedCornerShape(14.dp), color = PavaColors.Accent.copy(alpha = 0.18f)) {
        Row(Modifier.padding(start = 10.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(label, fontSize = 13.sp, color = PavaColors.TextPrimary)
            IconButton(onClick = onRemove, modifier = Modifier.size(28.dp)) { Icon(Icons.Filled.Close, "Remove", modifier = Modifier.size(14.dp)) }
        }
    }
}

@Composable
private fun AttachTile(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, color: Color, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(76.dp).clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(6.dp)) {
        Box(Modifier.size(54.dp).clip(CircleShape).background(color), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = Color.White)
        }
        Spacer(Modifier.height(6.dp))
        Text(label, fontSize = 12.sp, color = PavaColors.TextPrimary, maxLines = 1)
    }
}

@Composable
fun EmojiPanel(onPick: (String) -> Unit) {
    LazyVerticalGrid(columns = GridCells.Adaptive(44.dp), modifier = Modifier.fillMaxWidth().height(260.dp).background(PavaColors.Surface)) {
        items(EMOJI) { e ->
            Box(Modifier.size(44.dp).clickable { onPick(e) }, contentAlignment = Alignment.Center) { Text(e, fontSize = 24.sp) }
        }
    }
}

/** Hold to record, release to send, slide left to cancel. AAC in .m4a ("audio/mp4"), which the web app also plays. */
@Composable
private fun VoiceRecordButton(onRecorded: (File) -> Unit) {
    val context = LocalContext.current
    var recording by remember { mutableStateOf(false) }
    var cancelling by remember { mutableStateOf(false) }
    var startedAt by remember { mutableLongStateOf(0L) }
    var elapsed by remember { mutableLongStateOf(0L) }
    val cancelDistance = with(LocalDensity.current) { 120.dp.toPx() }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) context.toast("Microphone permission is needed for voice notes")
        else context.toast("Hold the mic button to record")
    }
    val recorder = remember { mutableStateOf<Pair<MediaRecorder, File>?>(null) }

    LaunchedEffect(recording) {
        while (recording) { elapsed = System.currentTimeMillis() - startedAt; delay(200) }
    }

    if (recording) {
        Text(
            if (cancelling) "Release to cancel" else "● ${elapsed / 1000}s  ← slide to cancel",
            color = if (cancelling) PavaColors.Danger else PavaColors.TextMuted, fontSize = 12.sp,
            modifier = Modifier.padding(end = 6.dp, bottom = 16.dp),
        )
    }
    Box(
        Modifier.size(52.dp).clip(CircleShape).background(if (recording) PavaColors.Danger else PavaColors.Accent)
            .pointerInput(Unit) {
                awaitEachGesture {
                    val down = awaitFirstDown()
                    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                        permission.launch(Manifest.permission.RECORD_AUDIO)
                        return@awaitEachGesture
                    }
                    val started = runCatching { startRecording(context) }.getOrNull()
                    if (started == null) { context.toast("Couldn't start recording"); return@awaitEachGesture }
                    recorder.value = started
                    startedAt = System.currentTimeMillis(); recording = true; cancelling = false
                    var dx = 0f
                    while (true) {
                        val event = awaitPointerEvent()
                        val change = event.changes.firstOrNull { it.id == down.id } ?: break
                        dx += change.positionChange().x
                        cancelling = dx < -cancelDistance
                        if (!change.pressed) break
                    }
                    recording = false
                    val (rec, file) = started
                    val ok = runCatching { rec.stop() }.isSuccess
                    rec.release()
                    recorder.value = null
                    val longEnough = System.currentTimeMillis() - startedAt > 700
                    if (ok && !cancelling && longEnough && file.length() > 500) onRecorded(file) else {
                        file.delete()
                        if (!cancelling && !longEnough) context.toast("Hold to record a voice note")
                    }
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Filled.Mic, "Hold to record a voice note", tint = PavaColors.OnAccent)
    }
}

private fun startRecording(context: Context): Pair<MediaRecorder, File> {
    val file = File(context.cacheDir, "voice_${System.currentTimeMillis()}.m4a")
    @Suppress("DEPRECATION")
    val rec = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else MediaRecorder()
    rec.setAudioSource(MediaRecorder.AudioSource.MIC)
    rec.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
    rec.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
    rec.setAudioEncodingBitRate(64_000)
    rec.setAudioSamplingRate(44_100)
    rec.setOutputFile(file.absolutePath)
    rec.prepare()
    rec.start()
    return rec to file
}
