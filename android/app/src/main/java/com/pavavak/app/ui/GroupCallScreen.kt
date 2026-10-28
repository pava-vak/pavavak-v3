package com.pavavak.app.ui

import android.view.ViewGroup
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Cameraswitch
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pavavak.app.call.GroupCallManager
import com.pavavak.app.call.GroupCallMedia
import com.pavavak.app.call.GroupCallState
import kotlinx.coroutines.delay
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

/**
 * Full-screen group-call overlay. [nameFor] resolves a participant userId to a display name
 * (the caller passes a resolver backed by the group's member list). [maskIcon] non-null means
 * the phone is disguised AND locked, so the ring reads as the decoy app.
 */
@Composable
fun GroupCallOverlay(
    calls: GroupCallManager,
    nameFor: (Long) -> String,
    maskIcon: String? = null,
    onRequestPermsThenAccept: (() -> Unit) -> Unit,
) {
    val state by calls.state.collectAsStateWithLifecycle()
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var minimized by remember { mutableStateOf(false) }
    LaunchedEffect(state) {
        if (state !is GroupCallState.Idle) com.pavavak.app.push.Notifier.cancelCall(ctx)
        if (state is GroupCallState.Idle || state is GroupCallState.Incoming) minimized = false
    }
    AnimatedVisibility(visible = state !is GroupCallState.Idle) {
        when (val s = state) {
            is GroupCallState.Incoming -> {
                val mask = maskIcon?.let { com.pavavak.app.data.AppIcons.callNotice(it, s.media == GroupCallMedia.VIDEO) }
                IncomingGroupCall(
                    title = mask?.first ?: s.fromName,
                    subtitle = mask?.second ?: "Incoming group ${if (s.media == GroupCallMedia.VIDEO) "video " else ""}call",
                    onAccept = { onRequestPermsThenAccept { calls.accept() } },
                    onDecline = { calls.decline() },
                )
            }
            is GroupCallState.Active ->
                if (minimized) MinimizedGroupBar(s, calls, onExpand = { minimized = false })
                else ActiveGroupCall(s, calls, nameFor, onMinimize = { minimized = true })
            else -> {}
        }
    }
}

@Composable
private fun IncomingGroupCall(title: String, subtitle: String, onAccept: () -> Unit, onDecline: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color(0xFF0E1726))) {
        Column(Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(Modifier.height(96.dp))
            Box(Modifier.size(104.dp).clip(CircleShape).background(Color(0xFF26A269)), contentAlignment = Alignment.Center) {
                Text(title.take(1).uppercase().ifBlank { "?" }, color = Color.White, fontSize = 44.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(18.dp))
            Text(title.ifBlank { "Group call" }, color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            Text(subtitle, color = Color(0xFF9FB2C8), fontSize = 17.sp)
            Spacer(Modifier.weight(1f))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                GRoundBtn(Icons.Filled.CallEnd, "Decline", bg = Color(0xFFE5484D), tint = Color.White, big = true, onClick = onDecline)
                GRoundBtn(Icons.Filled.Call, "Accept", bg = Color(0xFF26A269), tint = Color.White, big = true, onClick = onAccept)
            }
            Spacer(Modifier.height(36.dp))
        }
    }
}

@Composable
private fun ActiveGroupCall(s: GroupCallState.Active, calls: GroupCallManager, nameFor: (Long) -> String, onMinimize: () -> Unit) {
    val muted by calls.muted.collectAsStateWithLifecycle()
    val speaker by calls.speaker.collectAsStateWithLifecycle()
    val cameraOn by calls.cameraOn.collectAsStateWithLifecycle()
    val participants by calls.participants.collectAsStateWithLifecycle()
    val remoteVideos by calls.remoteVideos.collectAsStateWithLifecycle()
    val localVideo by calls.localVideo.collectAsStateWithLifecycle()
    val isVideo = s.media == GroupCallMedia.VIDEO

    // Tiles: self first, then every remote participant.
    val remoteIds = participants.toList().sorted()
    val columns = if (remoteIds.size <= 1) 1 else 2

    Box(Modifier.fillMaxSize().background(Color(0xFF0E1726))) {
        Column(Modifier.fillMaxSize().safeDrawingPadding().padding(8.dp)) {
            Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(38.dp).clip(CircleShape).background(Color(0x332A3647)).clickable(onClick = onMinimize),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Filled.KeyboardArrowDown, "Minimize", tint = Color.White, modifier = Modifier.size(24.dp)) }
                Spacer(Modifier.size(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(s.title.ifBlank { "Group call" }, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
                    LaunchedEffect(Unit) { while (true) { now = System.currentTimeMillis(); delay(1000) } }
                    val secs = ((now - s.startedAt) / 1000).coerceAtLeast(0)
                    Text("${participants.size + 1} in call · %d:%02d".format(secs / 60, secs % 60), color = Color(0xFF9FB2C8), fontSize = 13.sp)
                }
            }

            LazyVerticalGrid(columns = GridCells.Fixed(columns), modifier = Modifier.weight(1f).fillMaxWidth()) {
                item(key = "self") {
                    CallTile("You", if (isVideo && cameraOn) localVideo else null, calls, mirror = true, modifier = Modifier.padding(4.dp))
                }
                items(remoteIds, key = { it }) { id ->
                    CallTile(nameFor(id), remoteVideos[id], calls, mirror = false, modifier = Modifier.padding(4.dp))
                }
            }

            Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                GRoundBtn(if (muted) Icons.Filled.MicOff else Icons.Filled.Mic, if (muted) "Unmute" else "Mute",
                    bg = if (muted) Color.White else Color(0xFF2A3647), tint = if (muted) Color.Black else Color.White) { calls.toggleMute() }
                GRoundBtn(Icons.Filled.VolumeUp, "Speaker",
                    bg = if (speaker) Color.White else Color(0xFF2A3647), tint = if (speaker) Color.Black else Color.White) { calls.toggleSpeaker() }
                if (isVideo) {
                    GRoundBtn(if (cameraOn) Icons.Filled.Videocam else Icons.Filled.VideocamOff, "Camera",
                        bg = if (cameraOn) Color(0xFF2A3647) else Color.White, tint = if (cameraOn) Color.White else Color.Black) { calls.toggleVideo() }
                    GRoundBtn(Icons.Filled.Cameraswitch, "Flip", bg = Color(0xFF2A3647), tint = Color.White) { calls.switchCamera() }
                }
                GRoundBtn(Icons.Filled.CallEnd, "Leave", bg = Color(0xFFE5484D), tint = Color.White) { calls.hangUp() }
            }
        }
    }
}

@Composable
private fun CallTile(name: String, track: VideoTrack?, calls: GroupCallManager, mirror: Boolean, modifier: Modifier = Modifier) {
    Box(modifier.aspectRatio(0.75f).clip(RoundedCornerShape(12.dp)).background(Color(0xFF1A2639))) {
        if (track != null) {
            GroupVideoRenderer(track, calls, Modifier.fillMaxSize(), mirror = mirror)
        } else {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Box(Modifier.size(64.dp).clip(CircleShape).background(Color(0xFF26A269)), contentAlignment = Alignment.Center) {
                    Text(name.take(1).uppercase().ifBlank { "?" }, color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
        Text(
            name, color = Color.White, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.align(Alignment.BottomStart).padding(6.dp)
                .clip(RoundedCornerShape(6.dp)).background(Color(0x99000000)).padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}

@Composable
private fun MinimizedGroupBar(s: GroupCallState.Active, calls: GroupCallManager, onExpand: () -> Unit) {
    val participants by calls.participants.collectAsStateWithLifecycle()
    Box(Modifier.fillMaxWidth().safeDrawingPadding().padding(horizontal = 12.dp, vertical = 6.dp)) {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Color(0xFF1B6E3C))
                .clickable(onClick = onExpand).padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Call, null, tint = Color.White, modifier = Modifier.size(20.dp))
            Spacer(Modifier.size(10.dp))
            Column(Modifier.weight(1f)) {
                Text(s.title.ifBlank { "Group call" }, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${participants.size + 1} in call · tap to return", color = Color(0xFFBFE3CC), fontSize = 12.sp)
            }
            Box(Modifier.size(40.dp).clip(CircleShape).background(Color(0xFFE5484D)).clickable { calls.hangUp() }, contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.CallEnd, "Leave", tint = Color.White, modifier = Modifier.size(20.dp))
            }
        }
    }
}

@Composable
private fun GroupVideoRenderer(track: VideoTrack?, calls: GroupCallManager, modifier: Modifier = Modifier, mirror: Boolean = false) {
    if (track == null) return
    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            SurfaceViewRenderer(ctx).apply {
                layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                init(calls.eglContext, null)
                setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                setMirror(mirror)
                setEnableHardwareScaler(true)
            }
        },
        update = { view -> runCatching { track.addSink(view) } },
        onRelease = { view -> runCatching { track.removeSink(view) }; runCatching { view.release() } },
    )
}

@Composable
private fun GRoundBtn(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, bg: Color, tint: Color, big: Boolean = false, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(if (big) 68.dp else 58.dp).clip(CircleShape).background(bg).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
            Icon(icon, label, tint = tint, modifier = Modifier.size(if (big) 30.dp else 24.dp))
        }
        Spacer(Modifier.height(5.dp))
        Text(label, color = Color(0xFF9FB2C8), fontSize = 11.sp)
    }
}
