package com.pavavak.app.ui

import android.content.Intent
import android.os.Build
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.pavavak.app.data.ChatRepository
import com.pavavak.app.data.LinkPreview
import com.pavavak.app.data.Message
import com.pavavak.app.data.MessageContent
import com.pavavak.app.data.Reaction
import com.pavavak.app.ui.theme.PavaColors
import kotlinx.coroutines.launch
import java.text.BreakIterator
import kotlin.math.roundToInt

data class BubbleCallbacks(
    val onLongPress: (Message) -> Unit = {},
    val onSwipeReply: (Message) -> Unit = {},
    val onOpenImage: (String) -> Unit = {},
    val onOpenVideo: (String) -> Unit = {},
    val onOpenViewOnce: (Message) -> Unit = {},
    val onVote: (Message, Int) -> Unit = { _, _ -> },
    val onRetry: (Message) -> Unit = {},
    val onDiscard: (Message) -> Unit = {},
    val onReactionTap: (Message, String) -> Unit = { _, _ -> },
    val onReload: () -> Unit = {},
)

private val URL_REGEX = Regex("""https?://[^\s<>"')\]]+""")

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MessageBubble(
    message: Message,
    repository: ChatRepository,
    reactions: List<Reaction>,
    callbacks: BubbleCallbacks,
    monitor: Boolean = false,
    highlight: String? = null,
) {
    val outgoing = message.isOutgoing && !monitor
    val content = message.content
    val jumbo = (content as? MessageContent.Text)?.takeIf { it.quote == null && !message.deleted }?.let { emojiOnlyCount(it.text) } ?: 0
    val haptics = LocalHapticFeedback.current
    var dragX by remember { mutableFloatStateOf(0f) }
    val animatedDrag by animateFloatAsState(dragX, label = "swipe")
    val threshold = with(LocalDensity.current) { 64.dp.toPx() }
    val canReply = !monitor && !message.isLocal && !message.deleted

    Column(
        Modifier.fillMaxWidth().padding(vertical = 2.dp),
        horizontalAlignment = if (outgoing) Alignment.End else Alignment.Start,
    ) {
        Box(contentAlignment = Alignment.CenterStart) {
            if (dragX > 8f) Icon(Icons.AutoMirrored.Filled.Reply, null, tint = PavaColors.TextMuted,
                modifier = Modifier.alpha((dragX / threshold).coerceIn(0f, 1f)).padding(start = 4.dp))
            val bubbleModifier = Modifier
                .offset { IntOffset(animatedDrag.roundToInt(), 0) }
                .widthIn(max = 300.dp)
                .then(if (canReply) Modifier.pointerInput(message.messageId) {
                    detectHorizontalDragGestures(
                        onDragEnd = {
                            if (dragX >= threshold) { haptics.performHapticFeedback(HapticFeedbackType.LongPress); callbacks.onSwipeReply(message) }
                            dragX = 0f
                        },
                        onDragCancel = { dragX = 0f },
                    ) { _, delta -> dragX = (dragX + delta).coerceIn(0f, threshold * 1.4f) }
                } else Modifier)
                .combinedClickable(
                    onClick = { if (message.status == "failed") callbacks.onRetry(message) },
                    onLongClick = { if (!message.isLocal) { haptics.performHapticFeedback(HapticFeedbackType.LongPress); callbacks.onLongPress(message) } },
                )
            if (jumbo in 1..3) {
                Column(bubbleModifier.padding(horizontal = 4.dp), horizontalAlignment = if (outgoing) Alignment.End else Alignment.Start) {
                    Text((content as MessageContent.Text).text, fontSize = 42.sp, lineHeight = 50.sp)
                    BubbleFooter(message, outgoing, monitor, onBubble = false)
                }
            } else {
                Surface(
                    color = when {
                        message.text == "__SYS_UPDATE__" -> PavaColors.SurfaceHigh
                        outgoing -> PavaColors.OutgoingBubble
                        else -> PavaColors.IncomingBubble
                    },
                    contentColor = if (outgoing) PavaColors.OutgoingText else PavaColors.TextPrimary,
                    shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp,
                        bottomStart = if (outgoing) 16.dp else 4.dp, bottomEnd = if (outgoing) 4.dp else 16.dp),
                    shadowElevation = if (PavaColors.IsLight) 1.dp else 0.dp,
                    modifier = bubbleModifier.then(
                        if (highlight != null && message.text.contains(highlight, ignoreCase = true))
                            Modifier.border(2.dp, PavaColors.Accent, RoundedCornerShape(16.dp)) else Modifier,
                    ),
                ) {
                    Column(Modifier.padding(start = 10.dp, end = 10.dp, top = 7.dp, bottom = 5.dp)) {
                        if (monitor) Text(message.senderDisplayName ?: "?", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = PavaColors.Accent)
                        if (message.forwarded) Text("↪ Forwarded", fontSize = 12.sp, fontStyle = FontStyle.Italic,
                            color = LocalContentColorAlpha(0.7f))
                        BubbleBody(message, content, outgoing, monitor, repository, callbacks, jumbo)
                        BubbleFooter(message, outgoing, monitor, onBubble = true)
                        if (message.status == "queued") Text("🕓 Waiting for network…", fontSize = 11.sp, color = LocalContentColorAlpha(0.7f))
                        if (message.status == "failed") Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Not sent.", fontSize = 12.sp, color = PavaColors.Danger)
                            if (content !is MessageContent.Uploading) TextButton(onClick = { callbacks.onRetry(message) }) { Text("Retry", fontSize = 12.sp) }
                            TextButton(onClick = { callbacks.onDiscard(message) }) { Text("Remove", fontSize = 12.sp) }
                        }
                    }
                }
            }
        }
        if (reactions.isNotEmpty()) ReactionChips(reactions, repository.currentUser?.userId) { emoji ->
            if (!monitor) callbacks.onReactionTap(message, emoji)
        }
    }
}

@Composable
private fun LocalContentColorAlpha(alpha: Float): Color = androidx.compose.material3.LocalContentColor.current.copy(alpha = alpha)

@Composable
private fun BubbleBody(
    message: Message, content: MessageContent, outgoing: Boolean, monitor: Boolean,
    repository: ChatRepository, callbacks: BubbleCallbacks, jumbo: Int,
) {
    val muted = LocalContentColorAlpha(0.65f)
    if (message.deleted || message.deletedAt != null) {
        if (monitor && message.text.isNotEmpty()) {
            Text("🚫 deleted", fontSize = 11.sp, color = PavaColors.Danger)
        } else {
            Text("🚫 This message was deleted", fontStyle = FontStyle.Italic, color = muted, fontSize = 15.sp)
            return
        }
    }
    if (message.viewOnce && !monitor) {
        val kind = when (content) { is MessageContent.Image -> "Photo"; is MessageContent.Video -> "Video"; else -> "Message" }
        when {
            outgoing -> Text("👁 View once sent", color = muted, fontSize = 15.sp)
            message.viewOnceOpened || message.text.isEmpty() -> Text("👁 Opened", color = muted, fontSize = 15.sp)
            else -> Row(Modifier.clickable { callbacks.onOpenViewOnce(message) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Visibility, null, tint = PavaColors.Accent, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                Text("$kind · Tap to view once", fontSize = 15.sp, fontWeight = FontWeight.Medium)
            }
        }
        return
    }
    if (monitor && message.viewOnce) Text("👁 view once", fontSize = 11.sp, color = PavaColors.Accent)
    when (content) {
        is MessageContent.Text -> {
            content.quote?.let { QuoteBlock(it) }
            val size = when (jumbo) { in 4..7 -> 28.sp; else -> 16.sp }
            Text(linkified(content.text), fontSize = size, lineHeight = if (jumbo in 4..7) 34.sp else 21.sp)
            URL_REGEX.find(content.text)?.value?.let { url -> LinkPreviewCard(repository, url) }
        }
        is MessageContent.Image -> PhotoPlaceholder(repository, content.fileId) { callbacks.onOpenImage(content.fileId) }
        is MessageContent.Video -> MediaChip("▶", "Video", "Tap to play") { callbacks.onOpenVideo(content.fileId) }
        is MessageContent.Audio -> VoiceNote(repository, content.fileId)
        is MessageContent.Document -> DocumentChip(repository, content)
        is MessageContent.Uploading -> Row(verticalAlignment = Alignment.CenterVertically) {
            if (message.status != "failed" && message.status != "queued") CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
            Spacer(Modifier.width(8.dp))
            Text(content.label, fontSize = 15.sp, maxLines = 2)
        }
        MessageContent.Poll -> PollBlock(message, monitor) { idx -> callbacks.onVote(message, idx) }
        MessageContent.SystemUpdate -> Column {
            Text("🔄 Update available", fontWeight = FontWeight.SemiBold)
            Text("A new version is ready to install.", fontSize = 13.sp, color = muted)
        }
    }
}

@Composable
private fun QuoteBlock(quote: String) {
    Row(Modifier.padding(bottom = 4.dp).clip(RoundedCornerShape(6.dp)).background(Color.Black.copy(alpha = 0.18f))) {
        Box(Modifier.width(3.dp).height(36.dp).background(PavaColors.Accent))
        Text(quote, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, color = LocalContentColorAlpha(0.8f),
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp))
    }
}

@Composable
private fun BubbleFooter(message: Message, outgoing: Boolean, monitor: Boolean, onBubble: Boolean) {
    val muted = if (onBubble) LocalContentColorAlpha(0.6f) else PavaColors.TextMuted
    Row(Modifier.padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        val burning = message.burnSeconds != null
        when {
            message.expiresAt != null -> remainingLabel(message.expiresAt)?.let { Text((if (burning) "🔥 " else "⏱ ") + "$it  ", fontSize = 11.sp, color = muted) }
            burning -> Text("🔥 ${burnLabel(message.burnSeconds!!)} after reading  ", fontSize = 11.sp, color = muted)
        }
        if (message.silent && outgoing) Text("🔕  ", fontSize = 11.sp, color = muted)
        if (message.edited) Text("edited  ", fontSize = 11.sp, color = muted)
        Text(formatTime(message.sentAt), fontSize = 11.sp, color = muted)
        if (outgoing && !monitor) {
            Spacer(Modifier.width(4.dp))
            TickIcon(message.status)
        }
    }
}

@Composable
fun TickIcon(status: String, modifier: Modifier = Modifier) {
    val base = LocalContentColorAlpha(0.6f)
    val (icon, tint) = when (status) {
        "sending" -> Icons.Filled.Schedule to base
        "queued" -> Icons.Filled.Schedule to base
        "failed" -> Icons.Filled.ErrorOutline to PavaColors.Danger
        "read" -> Icons.Filled.DoneAll to PavaColors.ReadTick
        "delivered" -> Icons.Filled.DoneAll to base
        else -> Icons.Filled.Done to base
    }
    Icon(icon, contentDescription = status, tint = tint, modifier = modifier.size(15.dp))
}

@Composable
private fun ReactionChips(reactions: List<Reaction>, myId: Long?, onTap: (String) -> Unit) {
    val grouped = reactions.groupBy { it.emoji }
    Row(Modifier.padding(horizontal = 6.dp).offset(y = (-4).dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        grouped.forEach { (emoji, list) ->
            val mine = list.any { it.userId == myId }
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = if (mine) PavaColors.Accent.copy(alpha = 0.25f) else PavaColors.Surface,
                border = androidx.compose.foundation.BorderStroke(1.dp, PavaColors.Outline),
                modifier = Modifier.clickable { onTap(emoji) },
            ) {
                Text(if (list.size > 1) "$emoji ${list.size}" else emoji, fontSize = 13.sp,
                    modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp))
            }
        }
    }
}

/** Never loads by itself. After the first tap the photo is cached but stays blurred in the chat. */
@Composable
private fun PhotoPlaceholder(repository: ChatRepository, fileId: String, onOpen: () -> Unit) {
    val cached = remember(fileId) { mutableStateOf(repository.media.cached(fileId)) }
    LaunchedEffect(Unit) { cached.value = repository.media.cached(fileId) }
    val file = cached.value
    if (file == null) {
        MediaChip("📷", "Photo", "Tap to view", onOpen)
        return
    }
    Box(Modifier.size(220.dp, 160.dp).clip(RoundedCornerShape(10.dp)).clickable(onClick = onOpen), contentAlignment = Alignment.Center) {
        AsyncImage(
            model = file, contentDescription = "Photo", contentScale = ContentScale.Crop,
            modifier = Modifier.matchParentSize().then(if (Build.VERSION.SDK_INT >= 31) Modifier.blur(16.dp) else Modifier.alpha(0.15f)),
        )
        Surface(shape = RoundedCornerShape(16.dp), color = Color.Black.copy(alpha = 0.45f)) {
            Text("👁 Tap to view", color = Color.White, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
        }
    }
}

@Composable
private fun MediaChip(icon: String, title: String, subtitle: String, onClick: () -> Unit) {
    Row(
        Modifier.widthIn(min = 180.dp).clip(RoundedCornerShape(10.dp)).background(Color.Black.copy(alpha = 0.18f))
            .clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(icon, fontSize = 22.sp)
        Spacer(Modifier.width(10.dp))
        Column {
            Text(title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            Text(subtitle, fontSize = 12.sp, color = LocalContentColorAlpha(0.7f))
        }
    }
}

@Composable
internal fun VoiceNote(repository: ChatRepository, fileId: String) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val audio by AudioPlayer.state.collectAsStateWithLifecycle()
    val isThis = audio.fileId == fileId
    var loading by remember { mutableStateOf(false) }
    Row(Modifier.widthIn(min = 220.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(40.dp).clip(CircleShape).background(PavaColors.Accent).clickable {
            if (loading) return@clickable
            scope.launch {
                loading = true
                runCatching { repository.media.file(fileId) }
                    .onSuccess { f -> runCatching { AudioPlayer.toggle(scope, fileId, f) }.onFailure { context.toast("Can't play this voice note") } }
                    .onFailure { context.toast(it.message ?: "Couldn't load") }
                loading = false
            }
        }, contentAlignment = Alignment.Center) {
            if (loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = PavaColors.OnAccent)
            else Icon(if (isThis && audio.playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, "Play voice note", tint = PavaColors.OnAccent)
        }
        Column(Modifier.weight(1f).padding(start = 6.dp)) {
            Slider(
                value = if (isThis && audio.durationMs > 0) audio.positionMs.toFloat() / audio.durationMs else 0f,
                onValueChange = { if (isThis) AudioPlayer.seek(it) },
                colors = SliderDefaults.colors(thumbColor = PavaColors.Accent, activeTrackColor = PavaColors.Accent),
                modifier = Modifier.height(24.dp),
            )
            Text(
                if (isThis && audio.durationMs > 0) "${mmss(audio.positionMs)} / ${mmss(audio.durationMs)}" else "🎤 Voice note",
                fontSize = 11.sp, color = LocalContentColorAlpha(0.7f),
            )
        }
    }
}

private fun mmss(ms: Int) = "%d:%02d".format(ms / 60000, (ms / 1000) % 60)

@Composable
private fun DocumentChip(repository: ChatRepository, doc: MessageContent.Document) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var loading by remember { mutableStateOf(false) }
    Row(
        Modifier.widthIn(min = 200.dp).clip(RoundedCornerShape(10.dp)).background(Color.Black.copy(alpha = 0.18f))
            .clickable(enabled = !loading) {
                scope.launch {
                    loading = true
                    runCatching {
                        val file = repository.media.file(doc.fileId)
                        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
                        val mime = android.webkit.MimeTypeMap.getSingleton()
                            .getMimeTypeFromExtension(doc.fileId.substringAfterLast('.').lowercase()) ?: "*/*"
                        context.startActivity(Intent.createChooser(
                            Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
                            doc.fileName,
                        ))
                    }.onFailure { context.toast(it.message ?: "Couldn't open the file") }
                    loading = false
                }
            }.padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.Description, null, tint = PavaColors.Accent, modifier = Modifier.size(28.dp))
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(doc.fileName, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(doc.fileId.substringAfterLast('.').uppercase() + " · Tap to open", fontSize = 12.sp, color = LocalContentColorAlpha(0.7f))
        }
        if (loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
    }
}

@Composable
private fun PollBlock(message: Message, monitor: Boolean, onVote: (Int) -> Unit) {
    val poll = message.poll ?: run { Text("📊 Poll"); return }
    val total = poll.totalVotes
    Column(Modifier.widthIn(min = 220.dp)) {
        Text("📊 ${poll.question}", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        Spacer(Modifier.height(6.dp))
        poll.options.forEachIndexed { i, option ->
            val count = poll.votes[i.toString()] ?: 0
            val mine = poll.myVote == i
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable(enabled = !monitor) { onVote(i) }.padding(vertical = 5.dp)) {
                Row {
                    Text((if (mine) "● " else "○ ") + option, fontSize = 14.sp, modifier = Modifier.weight(1f),
                        fontWeight = if (mine) FontWeight.SemiBold else FontWeight.Normal)
                    Text(if (total > 0) "${count * 100 / total}%" else "", fontSize = 12.sp)
                }
                LinearProgressIndicator(progress = { if (total > 0) count.toFloat() / total else 0f },
                    modifier = Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)), color = PavaColors.Accent,
                    trackColor = LocalContentColorAlpha(0.15f), gapSize = 0.dp, drawStopIndicator = {})
            }
        }
        Text("$total vote${if (total == 1) "" else "s"}", fontSize = 12.sp, color = LocalContentColorAlpha(0.7f))
    }
}

@Composable
private fun LinkPreviewCard(repository: ChatRepository, url: String) {
    var preview by remember(url) { mutableStateOf<LinkPreview?>(null) }
    LaunchedEffect(url) { preview = repository.linkPreview(url) }
    val p = preview ?: return
    if (p.title.isNullOrBlank() && p.description.isNullOrBlank()) return
    Column(Modifier.padding(top = 6.dp).widthIn(max = 280.dp).clip(RoundedCornerShape(8.dp)).background(Color.Black.copy(alpha = 0.18f))) {
        p.imageUrl?.let { AsyncImage(model = it, contentDescription = null, contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxWidth().height(120.dp)) }
        Column(Modifier.padding(8.dp)) {
            Text((p.siteName ?: runCatching { java.net.URI(url).host }.getOrNull()).orEmpty(), fontSize = 11.sp, color = LocalContentColorAlpha(0.6f))
            p.title?.let { Text(it.take(80), fontWeight = FontWeight.SemiBold, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis) }
            p.description?.let { Text(it.take(120), fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, color = LocalContentColorAlpha(0.75f)) }
        }
    }
}

@Composable
private fun linkified(text: String): AnnotatedString {
    val linkColor = PavaColors.ReadTick
    return remember(text, linkColor) {
        buildAnnotatedString {
            var last = 0
            for (m in URL_REGEX.findAll(text)) {
                append(text.substring(last, m.range.first))
                withLink(LinkAnnotation.Url(m.value, TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline)))) {
                    append(m.value)
                }
                last = m.range.last + 1
            }
            append(text.substring(last))
        }
    }
}

/** Number of emoji if the text is emoji only (ignoring spaces), else 0. */
fun emojiOnlyCount(text: String): Int {
    val t = text.trim()
    if (t.isEmpty() || t.length > 40) return 0
    val it = BreakIterator.getCharacterInstance()
    it.setText(t)
    var count = 0
    var start = it.first()
    var end = it.next()
    while (end != BreakIterator.DONE) {
        val g = t.substring(start, end)
        if (!g.isBlank()) {
            val cp = g.codePointAt(0)
            val isEmoji = Character.getType(cp) == Character.OTHER_SYMBOL.toInt() || cp >= 0x1F000 ||
                (cp in 0x2600..0x27BF) || g.length > 1 && Character.isSurrogate(g[0])
            if (!isEmoji || Character.isLetterOrDigit(cp)) return 0
            count++
        }
        start = end
        end = it.next()
    }
    return count
}
