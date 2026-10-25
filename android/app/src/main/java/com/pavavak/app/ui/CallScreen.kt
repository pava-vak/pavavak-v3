package com.pavavak.app.ui

import android.view.ViewGroup
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Cameraswitch
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
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pavavak.app.call.CallManager
import com.pavavak.app.call.CallMedia
import com.pavavak.app.call.CallState
import kotlinx.coroutines.delay
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

/**
 * Full-screen call overlay shown above everything while a call is ringing or active.
 * [maskIcon] non-null (a disguise id) means the phone is disguised AND locked: the ringing screen
 * must read as that decoy app and never show the caller — the real name appears only after answering.
 */
@Composable
fun CallOverlay(calls: CallManager, maskIcon: String? = null, onRequestMicThenStart: (() -> Unit) -> Unit) {
    val state by calls.state.collectAsStateWithLifecycle()
    val ctx = androidx.compose.ui.platform.LocalContext.current
    LaunchedEffect(state) { if (state !is CallState.Idle) com.pavavak.app.push.Notifier.cancelCall(ctx) }
    AnimatedVisibility(visible = state !is CallState.Idle) {
        when (val s = state) {
            is CallState.Outgoing -> CallUi(s.peerName, when (s.phase) {
                com.pavavak.app.call.OutgoingPhase.RINGING -> "Ringing…"
                com.pavavak.app.call.OutgoingPhase.OFFLINE -> "${s.peerName.ifBlank { "They" }} is offline — they'll be notified"
                else -> "Calling…"
            }, calls, s.media, active = false, incoming = false)
            is CallState.Connecting -> CallUi(s.peerName, "Connecting…", calls, s.media, active = false, incoming = false)
            is CallState.Incoming -> {
                // Masked: show the decoy app's own wording instead of the caller's name/"call".
                val mask = maskIcon?.let { com.pavavak.app.data.AppIcons.callNotice(it, s.media == CallMedia.VIDEO) }
                CallUi(
                    mask?.first ?: s.peerName,
                    mask?.second ?: "Incoming ${if (s.media == CallMedia.VIDEO) "video " else ""}call",
                    calls, s.media, active = false, incoming = true,
                    onAccept = { onRequestMicThenStart { calls.accept() } },
                )
            }
            is CallState.Active -> CallUi(s.peerName, null, calls, s.media, active = true, incoming = false, startedAt = s.startedAt)
            is CallState.Failed -> CallUi("", s.reason, calls, CallMedia.AUDIO, active = false, incoming = false)
            else -> {}
        }
    }
}

@Composable
private fun CallUi(
    name: String,
    status: String?,
    calls: CallManager,
    media: CallMedia,
    active: Boolean,
    incoming: Boolean,
    startedAt: Long = 0L,
    onAccept: (() -> Unit)? = null,
) {
    val muted by calls.muted.collectAsStateWithLifecycle()
    val speaker by calls.speaker.collectAsStateWithLifecycle()
    val cameraOn by calls.cameraOn.collectAsStateWithLifecycle()
    val remoteVideo by calls.remoteVideo.collectAsStateWithLifecycle()
    val localVideo by calls.localVideo.collectAsStateWithLifecycle()
    val isVideo = media == CallMedia.VIDEO

    Box(Modifier.fillMaxSize().background(Color(0xFF0E1726))) {
        // Remote video fills the screen once it arrives (video calls only).
        if (isVideo && remoteVideo != null) {
            VideoRenderer(remoteVideo, calls, Modifier.fillMaxSize())
        }
        // Local camera preview: picture-in-picture while active, otherwise a hint during ringing.
        if (isVideo && localVideo != null && cameraOn) {
            Box(
                Modifier.safeDrawingPadding().padding(16.dp).size(108.dp, 150.dp)
                    .align(Alignment.TopEnd).clip(RoundedCornerShape(12.dp)).background(Color.Black),
            ) { VideoRenderer(localVideo, calls, Modifier.fillMaxSize(), mirror = true, overlay = true) }
        }

        Column(
            Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // On a connected video call the frames carry the screen; keep only the name/timer up top.
            val showAvatar = !(isVideo && active && remoteVideo != null)
            Spacer(Modifier.height(if (showAvatar) 72.dp else 24.dp))
            if (showAvatar) {
                Box(
                    Modifier.size(104.dp).clip(CircleShape).background(Color(0xFF26A269)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(name.take(1).uppercase().ifBlank { "?" }, color = Color.White, fontSize = 44.sp, fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.height(18.dp))
            }
            Text(name.ifBlank { "Call" }, color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            if (active) {
                var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
                LaunchedEffect(Unit) { while (true) { now = System.currentTimeMillis(); delay(1000) } }
                val secs = ((now - startedAt) / 1000).coerceAtLeast(0)
                Text("%d:%02d".format(secs / 60, secs % 60), color = Color(0xFF9FB2C8), fontSize = 17.sp)
            } else {
                Text(status ?: "", color = Color(0xFF9FB2C8), fontSize = 17.sp)
            }

            Spacer(Modifier.weight(1f))

            if (active) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    RoundBtn(if (muted) Icons.Filled.MicOff else Icons.Filled.Mic, if (muted) "Unmute" else "Mute",
                        bg = if (muted) Color.White else Color(0xFF2A3647),
                        tint = if (muted) Color.Black else Color.White) { calls.toggleMute() }
                    RoundBtn(Icons.Filled.VolumeUp, "Speaker",
                        bg = if (speaker) Color.White else Color(0xFF2A3647),
                        tint = if (speaker) Color.Black else Color.White) { calls.toggleSpeaker() }
                    if (isVideo) {
                        RoundBtn(if (cameraOn) Icons.Filled.Videocam else Icons.Filled.VideocamOff, if (cameraOn) "Camera" else "Camera off",
                            bg = if (cameraOn) Color(0xFF2A3647) else Color.White,
                            tint = if (cameraOn) Color.White else Color.Black) { calls.toggleVideo() }
                        RoundBtn(Icons.Filled.Cameraswitch, "Flip",
                            bg = Color(0xFF2A3647), tint = Color.White) { calls.switchCamera() }
                    }
                }
                Spacer(Modifier.height(28.dp))
                RoundBtn(Icons.Filled.CallEnd, "End", bg = Color(0xFFE5484D), tint = Color.White, big = true) { calls.hangUp() }
            } else if (incoming) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    RoundBtn(Icons.Filled.CallEnd, "Decline", bg = Color(0xFFE5484D), tint = Color.White, big = true) { calls.decline() }
                    RoundBtn(Icons.Filled.Call, "Accept", bg = Color(0xFF26A269), tint = Color.White, big = true) { onAccept?.invoke() }
                }
            } else {
                RoundBtn(Icons.Filled.CallEnd, "End", bg = Color(0xFFE5484D), tint = Color.White, big = true) { calls.hangUp() }
            }
            Spacer(Modifier.height(36.dp))
        }
    }
}

/** A WebRTC SurfaceViewRenderer bound to [track], initialized with the call's shared GL context. */
@Composable
private fun VideoRenderer(
    track: VideoTrack?,
    calls: CallManager,
    modifier: Modifier = Modifier,
    mirror: Boolean = false,
    overlay: Boolean = false,
) {
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
                setZOrderMediaOverlay(overlay)
            }
        },
        update = { view -> runCatching { track.addSink(view) } },
        onRelease = { view -> runCatching { track.removeSink(view) }; runCatching { view.release() } },
    )
}

@Composable
private fun RoundBtn(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    bg: Color,
    tint: Color,
    big: Boolean = false,
    onClick: () -> Unit,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.size(if (big) 72.dp else 62.dp).clip(CircleShape).background(bg).clickable(onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, label, tint = tint, modifier = Modifier.size(if (big) 32.dp else 26.dp))
        }
        Spacer(Modifier.height(6.dp))
        Text(label, color = Color(0xFF9FB2C8), fontSize = 12.sp)
    }
}
