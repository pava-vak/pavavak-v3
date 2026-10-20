package com.pavavak.app.ui

import android.media.MediaPlayer
import android.net.Uri
import android.widget.MediaController
import android.widget.VideoView
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Download
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil3.compose.AsyncImage
import com.pavavak.app.data.MediaRepository
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.io.File

private val FullScreen = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)

/** Loads a media file (download on first use) as Compose state: null while loading. */
@Composable
fun rememberMediaFile(media: MediaRepository, fileId: String): Result<File>? =
    produceState<Result<File>?>(initialValue = media.cached(fileId)?.let { Result.success(it) }, fileId) {
        if (value == null) value = runCatching { media.file(fileId) }
    }.value

/** Full-screen photo viewer: pinch/double-tap zoom, pan, swipe between all photos in the chat. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ImageViewer(media: MediaRepository, fileIds: List<String>, startIndex: Int, allowSave: Boolean = true, onClose: () -> Unit) {
    val pager = rememberPagerState(initialPage = startIndex.coerceIn(0, (fileIds.size - 1).coerceAtLeast(0))) { fileIds.size }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    Dialog(onDismissRequest = onClose, properties = FullScreen) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            HorizontalPager(state = pager, modifier = Modifier.fillMaxSize(), beyondViewportPageCount = 1) { page ->
                ZoomableImage(media, fileIds[page])
            }
            ViewerTopBar(
                title = if (fileIds.size > 1) "${pager.currentPage + 1} / ${fileIds.size}" else "",
                onClose = onClose,
                onSave = if (allowSave) ({
                    scope.launch {
                        runCatching { media.saveToDevice(fileIds[pager.currentPage], "image") }
                            .onSuccess { context.toast("Saved to $it") }.onFailure { context.toast(it.message ?: "Couldn't save") }
                    }
                }) else null,
            )
        }
    }
}

@Composable
private fun ZoomableImage(media: MediaRepository, fileId: String) {
    val file = rememberMediaFile(media, fileId)
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    Box(
        Modifier.fillMaxSize()
            .pointerInput(fileId) {
                detectTapGestures(onDoubleTap = { if (scale > 1f) { scale = 1f; offset = Offset.Zero } else scale = 2.5f })
            }
            .pointerInput(fileId) {
                detectTransformGestures { _, pan, zoom, _ ->
                    scale = (scale * zoom).coerceIn(1f, 6f)
                    offset = if (scale == 1f) Offset.Zero else offset + pan
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        when {
            file == null -> CircularProgressIndicator(color = Color.White)
            file.isFailure -> Text(file.exceptionOrNull()?.message ?: "Couldn't load", color = Color.White)
            else -> AsyncImage(
                model = file.getOrNull(), contentDescription = "Photo", contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize().graphicsLayer(scaleX = scale, scaleY = scale, translationX = offset.x, translationY = offset.y),
            )
        }
    }
}

@Composable
fun VideoViewer(media: MediaRepository, fileId: String, allowSave: Boolean = true, maxSeconds: Int? = null, onClose: () -> Unit) {
    val file = rememberMediaFile(media, fileId)
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var remaining by remember { mutableStateOf(maxSeconds) }
    if (maxSeconds != null) LaunchedEffect(file?.isSuccess) {
        if (file?.isSuccess != true) return@LaunchedEffect
        while ((remaining ?: 0) > 0) { delay(1000); remaining = (remaining ?: 1) - 1 }
        onClose()
    }
    Dialog(onDismissRequest = onClose, properties = FullScreen) {
        Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
            when {
                file == null -> CircularProgressIndicator(color = Color.White)
                file.isFailure -> Text(file.exceptionOrNull()?.message ?: "Couldn't load", color = Color.White)
                else -> AndroidView(
                    factory = { ctx ->
                        VideoView(ctx).apply {
                            setMediaController(MediaController(ctx).also { it.setAnchorView(this) })
                            setVideoURI(Uri.fromFile(file.getOrThrow()))
                            setOnPreparedListener { start() }
                            if (maxSeconds != null) setOnCompletionListener { onClose() }
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            ViewerTopBar(
                title = remaining?.let { "Disappears in ${it}s" } ?: "",
                onClose = onClose,
                onSave = if (allowSave) ({
                    scope.launch {
                        runCatching { media.saveToDevice(fileId, "video") }
                            .onSuccess { context.toast("Saved to $it") }.onFailure { context.toast(it.message ?: "Couldn't save") }
                    }
                }) else null,
            )
        }
    }
}

/** View-once photo: shown for 10 seconds, no saving, then burned. */
@Composable
fun ViewOnceImage(media: MediaRepository, fileId: String, onClose: () -> Unit) {
    val file = rememberMediaFile(media, fileId)
    var remaining by remember { mutableStateOf(10) }
    LaunchedEffect(file?.isSuccess) {
        if (file?.isSuccess != true) return@LaunchedEffect
        while (remaining > 0) { delay(1000); remaining-- }
        onClose()
    }
    Dialog(onDismissRequest = onClose, properties = FullScreen) {
        Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
            when {
                file == null -> CircularProgressIndicator(color = Color.White)
                file.isFailure -> Text(file.exceptionOrNull()?.message ?: "Couldn't load", color = Color.White)
                else -> AsyncImage(model = file.getOrNull(), contentDescription = "View-once photo", modifier = Modifier.fillMaxSize())
            }
            ViewerTopBar(title = "👁 Disappears in ${remaining}s", onClose = onClose, onSave = null)
        }
    }
}

/** View-once text: readable for 10 seconds with a countdown bar. */
@Composable
fun ViewOnceText(text: String, onClose: () -> Unit) {
    var remaining by remember { mutableFloatStateOf(10f) }
    LaunchedEffect(Unit) {
        while (remaining > 0f) { delay(100); remaining -= 0.1f }
        onClose()
    }
    Dialog(onDismissRequest = onClose, properties = FullScreen) {
        Column(Modifier.fillMaxSize().background(Color.Black).statusBarsPadding().navigationBarsPadding().padding(24.dp)) {
            LinearProgressIndicator(progress = { remaining / 10f }, modifier = Modifier.fillMaxWidth().height(3.dp), color = Color.White,
                trackColor = Color.White.copy(alpha = 0.2f), gapSize = 0.dp, drawStopIndicator = {})
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Text(text, color = Color.White, fontSize = 20.sp, textAlign = TextAlign.Center, lineHeight = 28.sp)
            }
            Text("Tap ✕ or wait — this message will disappear", color = Color.White.copy(alpha = 0.6f), fontSize = 13.sp,
                modifier = Modifier.align(Alignment.CenterHorizontally))
            IconButton(onClick = onClose, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                Icon(Icons.Filled.Close, "Close", tint = Color.White)
            }
        }
    }
}

@Composable
private fun ViewerTopBar(title: String, onClose: () -> Unit, onSave: (() -> Unit)?) {
    Row(
        Modifier.fillMaxWidth().background(Color(0x66000000)).statusBarsPadding().padding(horizontal = 4.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onClose) { Icon(Icons.Filled.Close, "Close", tint = Color.White) }
        Text(title, color = Color.White, modifier = Modifier.weight(1f))
        if (onSave != null) IconButton(onClick = onSave) { Icon(Icons.Filled.Download, "Save to phone", tint = Color.White) }
    }
}

/** One voice note plays at a time across the whole app. */
object AudioPlayer {
    data class State(val fileId: String? = null, val playing: Boolean = false, val positionMs: Int = 0, val durationMs: Int = 0)

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state
    private var player: MediaPlayer? = null
    private var ticker: kotlinx.coroutines.Job? = null

    fun toggle(scope: kotlinx.coroutines.CoroutineScope, fileId: String, file: File) {
        val s = _state.value
        val p = player
        if (s.fileId == fileId && p != null) {
            if (p.isPlaying) { p.pause(); _state.value = s.copy(playing = false) } else { p.start(); _state.value = s.copy(playing = true); tick(scope) }
            return
        }
        stop()
        val mp = MediaPlayer().apply {
            setDataSource(file.absolutePath)
            setOnCompletionListener { _state.value = _state.value.copy(playing = false, positionMs = 0); ticker?.cancel() }
            prepare()
            start()
        }
        player = mp
        _state.value = State(fileId, true, 0, mp.duration)
        tick(scope)
    }

    fun seek(fraction: Float) {
        val p = player ?: return
        val pos = (fraction * p.duration).toInt()
        p.seekTo(pos)
        _state.value = _state.value.copy(positionMs = pos)
    }

    private fun tick(scope: kotlinx.coroutines.CoroutineScope) {
        ticker?.cancel()
        ticker = scope.launch {
            while (true) {
                val p = player ?: break
                runCatching { _state.value = _state.value.copy(positionMs = p.currentPosition) }
                delay(200)
            }
        }
    }

    fun stop() {
        ticker?.cancel()
        player?.runCatching { stop(); release() }
        player = null
        _state.value = State()
    }
}

@Composable
fun StopAudioOnLeave() {
    DisposableEffect(Unit) { onDispose { AudioPlayer.stop() } }
}
