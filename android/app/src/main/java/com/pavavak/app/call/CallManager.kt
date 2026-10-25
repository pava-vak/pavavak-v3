package com.pavavak.app.call

import android.content.Context
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.media.ToneGenerator
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import com.pavavak.app.data.ApiClient
import com.pavavak.app.data.RealtimeClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.webrtc.AudioTrack
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraVideoCapturer
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import java.util.UUID

/** Call media kind. Voice now; video reuses the same flow with a camera track. */
enum class CallMedia { AUDIO, VIDEO }

/** What the caller's device knows about the far end while an outgoing call is still connecting. */
enum class OutgoingPhase { DIALING, RINGING, OFFLINE }

sealed interface CallState {
    data object Idle : CallState
    data class Outgoing(val peerId: Long, val peerName: String, val media: CallMedia, val phase: OutgoingPhase = OutgoingPhase.DIALING) : CallState
    data class Incoming(val callId: String, val peerId: Long, val peerName: String, val media: CallMedia) : CallState
    data class Connecting(val peerId: Long, val peerName: String, val media: CallMedia) : CallState
    data class Active(val peerId: Long, val peerName: String, val media: CallMedia, val startedAt: Long) : CallState
    data class Failed(val reason: String) : CallState
}

/**
 * 1:1 WebRTC calling. Media is peer-to-peer (DTLS-SRTP, end-to-end encrypted); only SDP/ICE
 * signaling goes through the server. TURN credentials are fetched fresh per call.
 */
class CallManager(
    private val appContext: Context,
    private val api: ApiClient,
    private val realtime: RealtimeClient,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow<CallState>(CallState.Idle)
    val state: StateFlow<CallState> = _state.asStateFlow()

    private val _muted = MutableStateFlow(false)
    val muted: StateFlow<Boolean> = _muted.asStateFlow()
    private val _speaker = MutableStateFlow(false)
    val speaker: StateFlow<Boolean> = _speaker.asStateFlow()

    // Video call state. The renderers in the UI observe these to draw local/remote frames.
    private val _localVideo = MutableStateFlow<VideoTrack?>(null)
    val localVideo: StateFlow<VideoTrack?> = _localVideo.asStateFlow()
    private val _remoteVideo = MutableStateFlow<VideoTrack?>(null)
    val remoteVideo: StateFlow<VideoTrack?> = _remoteVideo.asStateFlow()
    private val _cameraOn = MutableStateFlow(true)
    val cameraOn: StateFlow<Boolean> = _cameraOn.asStateFlow()

    private val audioManager = appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val eglBase: EglBase by lazy { EglBase.create() }
    /** Shared GL context the UI renderers must init with. */
    val eglContext: EglBase.Context get() = eglBase.eglBaseContext
    private val factory: PeerConnectionFactory by lazy { buildFactory() }

    private var pc: PeerConnection? = null
    private var localAudio: AudioTrack? = null
    private var localVideoTrack: VideoTrack? = null
    private var videoCapturer: CameraVideoCapturer? = null
    private var videoSource: VideoSource? = null
    private var surfaceHelper: SurfaceTextureHelper? = null
    private var frontFacing = true
    private var toneGen: ToneGenerator? = null   // caller-side ringback ("ring… ring…")
    private var ringtone: Ringtone? = null        // receiver-side ringtone
    private var callId: String? = null
    private var peerId: Long = 0
    private var peerName: String = ""
    private var media: CallMedia = CallMedia.AUDIO
    private var isCaller = false
    private var remoteSet = false
    private val pendingRemoteIce = mutableListOf<IceCandidate>()

    init {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(appContext).createInitializationOptions()
        )
        scope.launch { realtime.events.collect { ev -> onSignal(ev.name, ev.payload) } }
    }

    private fun buildFactory(): PeerConnectionFactory =
        PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .createPeerConnectionFactory()

    // ── Public API ──────────────────────────────────────────────────────────

    /** Place an outgoing call to [peerId]. */
    fun startCall(peerId: Long, peerName: String, media: CallMedia = CallMedia.AUDIO) {
        if (_state.value !is CallState.Idle) return
        this.callId = UUID.randomUUID().toString()
        this.peerId = peerId; this.peerName = peerName; this.media = media; this.isCaller = true
        _state.value = CallState.Outgoing(peerId, peerName, media)
        startRingback() // caller hears ringback immediately; the server's call:ringing upgrades the label
        scope.launch {
            val ice = runCatching { api.iceServers() }.getOrNull()
            if (ice == null || !createPeer(ice)) { fail("Couldn't start call"); return@launch }
            addMic()
            if (media == CallMedia.VIDEO) addCamera()
            pc?.createOffer(sdpObserver(onCreated = { desc ->
                pc?.setLocalDescription(sdpSetObserver {}, desc)
                send("call:offer", JSONObject().apply {
                    put("toUserId", peerId); put("callId", callId); put("chatId", JSONObject.NULL)
                    put("media", if (media == CallMedia.VIDEO) "video" else "audio")
                    put("sdp", sdpJson(desc))
                })
            }), mediaConstraints())
        }
    }

    /** Record an incoming call (from socket or FCM) so the UI can show the ringing screen. */
    fun onIncoming(callId: String, peerId: Long, peerName: String, media: CallMedia, offerSdp: JSONObject?) {
        if (_state.value !is CallState.Idle) { // already busy: auto-decline
            send("call:reject", JSONObject().apply { put("toUserId", peerId); put("callId", callId); put("reason", "busy") })
            return
        }
        this.callId = callId; this.peerId = peerId; this.peerName = peerName; this.media = media; this.isCaller = false
        pendingOffer = offerSdp
        _state.value = CallState.Incoming(callId, peerId, peerName, media)
        startRingtone()
    }

    private var pendingOffer: JSONObject? = null

    /** Accept the current incoming call. */
    fun accept() {
        val incoming = _state.value as? CallState.Incoming ?: return
        stopRingtone()
        _state.value = CallState.Connecting(incoming.peerId, incoming.peerName, incoming.media)
        scope.launch {
            val ice = runCatching { api.iceServers() }.getOrNull()
            if (ice == null || !createPeer(ice)) { fail("Couldn't connect"); return@launch }
            addMic()
            if (incoming.media == CallMedia.VIDEO) addCamera()
            val offer = pendingOffer
            if (offer != null) {
                val desc = SessionDescription(SessionDescription.Type.OFFER, offer.getString("description"))
                pc?.setRemoteDescription(sdpSetObserver {
                    remoteSet = true; drainIce()
                    pc?.createAnswer(sdpObserver(onCreated = { answer ->
                        pc?.setLocalDescription(sdpSetObserver {}, answer)
                        send("call:answer", JSONObject().apply {
                            put("toUserId", peerId); put("callId", callId); put("sdp", sdpJson(answer))
                        })
                    }), mediaConstraints())
                }, desc)
            }
        }
    }

    fun decline() {
        callId?.let { send("call:reject", JSONObject().apply { put("toUserId", peerId); put("callId", it); put("reason", "declined") }) }
        cleanup(CallState.Idle)
    }

    fun hangUp() {
        callId?.let { send("call:end", JSONObject().apply { put("toUserId", peerId); put("callId", it) }) }
        cleanup(CallState.Idle)
    }

    fun toggleMute() {
        _muted.value = !_muted.value
        localAudio?.setEnabled(!_muted.value)
    }

    fun toggleSpeaker() {
        _speaker.value = !_speaker.value
        @Suppress("DEPRECATION")
        audioManager.isSpeakerphoneOn = _speaker.value
    }

    // ── Signaling in ────────────────────────────────────────────────────────

    private fun onSignal(name: String, payload: String) {
        if (!name.startsWith("call:")) return
        val obj = runCatching { JSONObject(payload) }.getOrNull() ?: return
        val id = obj.optString("callId", "")
        when (name) {
            "call:ringing" -> if (id == callId) {
                (_state.value as? CallState.Outgoing)?.let {
                    _state.value = it.copy(phase = OutgoingPhase.RINGING); startRingback()
                }
            }
            "call:offline" -> if (id == callId) {
                (_state.value as? CallState.Outgoing)?.let { _state.value = it.copy(phase = OutgoingPhase.OFFLINE) }
                stopRingback()
            }
            "call:incoming" -> onIncoming(
                id, obj.optLong("fromUserId"), obj.optString("fromName", "Unknown"),
                if (obj.optString("media") == "video") CallMedia.VIDEO else CallMedia.AUDIO,
                obj.optJSONObject("sdp"),
            )
            "call:answer" -> if (id == callId) {
                val sdp = obj.optJSONObject("sdp") ?: return
                pc?.setRemoteDescription(sdpSetObserver { remoteSet = true; drainIce() },
                    SessionDescription(SessionDescription.Type.ANSWER, sdp.getString("description")))
            }
            "call:ice" -> if (id == callId) {
                val c = obj.optJSONObject("candidate") ?: return
                val cand = IceCandidate(c.optString("sdpMid"), c.optInt("sdpMLineIndex"), c.optString("candidate"))
                if (remoteSet) pc?.addIceCandidate(cand) else pendingRemoteIce.add(cand)
            }
            "call:rejected" -> if (id == callId) cleanup(CallState.Idle)
            "call:ended" -> if (id == callId) cleanup(CallState.Idle)
        }
    }

    // ── WebRTC plumbing ───────────────────────────────────────────────────────

    private fun createPeer(ice: com.pavavak.app.data.IceConfig): Boolean {
        val servers = ice.iceServers.map { s ->
            PeerConnection.IceServer.builder(s.urls)
                .apply { if (!s.username.isNullOrEmpty()) { setUsername(s.username); setPassword(s.credential ?: "") } }
                .createIceServer()
        }
        val config = PeerConnection.RTCConfiguration(servers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        pc = factory.createPeerConnection(config, pcObserver()) ?: return false
        startAudioRoute()
        return true
    }

    private fun addMic() {
        val source = factory.createAudioSource(MediaConstraints())
        localAudio = factory.createAudioTrack("audio0", source).also { it.setEnabled(!_muted.value) }
        pc?.addTrack(localAudio, listOf("stream0"))
    }

    private fun addCamera() {
        val capturer = createCameraCapturer() ?: return
        videoCapturer = capturer
        val helper = SurfaceTextureHelper.create("CaptureThread", eglBase.eglBaseContext)
        surfaceHelper = helper
        val source = factory.createVideoSource(false)
        videoSource = source
        capturer.initialize(helper, appContext, source.capturerObserver)
        runCatching { capturer.startCapture(1280, 720, 30) }
        val track = factory.createVideoTrack("video0", source).also { it.setEnabled(_cameraOn.value) }
        localVideoTrack = track
        _localVideo.value = track
        pc?.addTrack(track, listOf("stream0"))
    }

    /** Prefer the front camera; fall back to any available camera. */
    private fun createCameraCapturer(): CameraVideoCapturer? {
        val enumerator = Camera2Enumerator(appContext)
        val names = enumerator.deviceNames
        names.firstOrNull { enumerator.isFrontFacing(it) }?.let { frontFacing = true; return enumerator.createCapturer(it, null) }
        names.firstOrNull { enumerator.isBackFacing(it) }?.let { frontFacing = false; return enumerator.createCapturer(it, null) }
        return names.firstOrNull()?.let { enumerator.createCapturer(it, null) }
    }

    /** Toggle the local camera on/off during a video call. */
    fun toggleVideo() {
        _cameraOn.value = !_cameraOn.value
        localVideoTrack?.setEnabled(_cameraOn.value)
    }

    /** Flip between front and back cameras. */
    fun switchCamera() {
        videoCapturer?.switchCamera(object : CameraVideoCapturer.CameraSwitchHandler {
            override fun onCameraSwitchDone(isFront: Boolean) { frontFacing = isFront }
            override fun onCameraSwitchError(error: String?) {}
        })
    }

    private fun pcObserver() = object : PeerConnection.Observer {
        override fun onIceCandidate(c: IceCandidate) {
            send("call:ice", JSONObject().apply {
                put("toUserId", peerId); put("callId", callId)
                put("candidate", JSONObject().apply {
                    put("sdpMid", c.sdpMid); put("sdpMLineIndex", c.sdpMLineIndex); put("candidate", c.sdp)
                })
            })
        }
        override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
            when (newState) {
                PeerConnection.PeerConnectionState.CONNECTED -> {
                    stopRingback(); stopRingtone()
                    _state.value = CallState.Active(peerId, peerName, media, System.currentTimeMillis())
                }
                PeerConnection.PeerConnectionState.FAILED -> fail("Call failed")
                PeerConnection.PeerConnectionState.DISCONNECTED,
                PeerConnection.PeerConnectionState.CLOSED -> if (_state.value is CallState.Active) cleanup(CallState.Idle)
                else -> {}
            }
        }
        override fun onAddTrack(receiver: org.webrtc.RtpReceiver?, streams: Array<out org.webrtc.MediaStream>?) {
            bindRemoteTrack(receiver?.track())
        }
        override fun onTrack(transceiver: org.webrtc.RtpTransceiver?) {
            bindRemoteTrack(transceiver?.receiver?.track())
        }
        override fun onSignalingChange(p0: PeerConnection.SignalingState?) {}
        override fun onIceConnectionChange(p0: PeerConnection.IceConnectionState?) {}
        override fun onIceConnectionReceivingChange(p0: Boolean) {}
        override fun onIceGatheringChange(p0: PeerConnection.IceGatheringState?) {}
        override fun onIceCandidatesRemoved(p0: Array<out IceCandidate>?) {}
        override fun onAddStream(p0: org.webrtc.MediaStream?) {}
        override fun onRemoveStream(p0: org.webrtc.MediaStream?) {}
        override fun onDataChannel(p0: org.webrtc.DataChannel?) {}
        override fun onRenegotiationNeeded() {}
    }

    private fun bindRemoteTrack(track: MediaStreamTrack?) {
        when (track) {
            is AudioTrack -> track.setEnabled(true)
            is VideoTrack -> { track.setEnabled(true); _remoteVideo.value = track }
        }
    }

    private fun drainIce() {
        pendingRemoteIce.forEach { pc?.addIceCandidate(it) }
        pendingRemoteIce.clear()
    }

    private fun mediaConstraints() = MediaConstraints().apply {
        mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
        mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", if (media == CallMedia.VIDEO) "true" else "false"))
    }

    private fun startAudioRoute() {
        runCatching {
            @Suppress("DEPRECATION")
            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
            @Suppress("DEPRECATION")
            audioManager.isSpeakerphoneOn = _speaker.value
        }
    }

    private fun stopAudioRoute() {
        runCatching {
            @Suppress("DEPRECATION")
            audioManager.mode = AudioManager.MODE_NORMAL
            @Suppress("DEPRECATION")
            audioManager.isSpeakerphoneOn = false
        }
    }

    // ── Ringing tones ─────────────────────────────────────────────────────────

    /** Caller hears a repeating ringback ("ring… ring…") while the far end is ringing. */
    private fun startRingback() {
        if (toneGen != null) return
        runCatching {
            toneGen = ToneGenerator(AudioManager.STREAM_VOICE_CALL, 70).also {
                it.startTone(ToneGenerator.TONE_SUP_RINGTONE, -1)
            }
        }
    }

    private fun stopRingback() {
        runCatching { toneGen?.stopTone(); toneGen?.release() }
        toneGen = null
    }

    /** Receiver's phone rings and vibrates until they answer or decline. */
    private fun startRingtone() {
        runCatching {
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            ringtone = RingtoneManager.getRingtone(appContext, uri)?.apply {
                @Suppress("DEPRECATION")
                runCatching { isLooping = true }
                play()
            }
        }
        startVibrate()
    }

    private fun stopRingtone() {
        runCatching { ringtone?.stop() }
        ringtone = null
        stopVibrate()
    }

    private fun vibrator(): Vibrator? = runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (appContext.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            appContext.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
    }.getOrNull()

    private fun startVibrate() {
        runCatching {
            val pattern = longArrayOf(0, 800, 1000) // wait, buzz, gap — repeats
            vibrator()?.vibrate(VibrationEffect.createWaveform(pattern, 0))
        }
    }

    private fun stopVibrate() { runCatching { vibrator()?.cancel() } }

    private fun send(event: String, data: JSONObject) = realtime.emit(event, data)

    private fun fail(reason: String) {
        _state.value = CallState.Failed(reason)
        scope.launch { kotlinx.coroutines.delay(1500); if (_state.value is CallState.Failed) cleanup(CallState.Idle) }
        teardownPeer()
    }

    private fun cleanup(next: CallState) {
        teardownPeer()
        _muted.value = false; _speaker.value = false; _cameraOn.value = true
        _state.value = next
    }

    private fun teardownPeer() {
        stopRingback(); stopRingtone()
        stopAudioRoute()
        runCatching { videoCapturer?.stopCapture() }
        runCatching { videoCapturer?.dispose() }
        runCatching { surfaceHelper?.dispose() }
        runCatching { localVideoTrack?.dispose() }
        runCatching { videoSource?.dispose() }
        runCatching { localAudio?.dispose() }
        runCatching { pc?.close(); pc?.dispose() }
        pc = null; localAudio = null; callId = null; remoteSet = false
        localVideoTrack = null; videoCapturer = null; videoSource = null; surfaceHelper = null
        _localVideo.value = null; _remoteVideo.value = null
        pendingRemoteIce.clear(); pendingOffer = null
    }

    // ── SDP helpers ───────────────────────────────────────────────────────────

    private fun sdpJson(d: SessionDescription) = JSONObject().apply {
        put("type", d.type.canonicalForm()); put("description", d.description)
    }

    private fun sdpObserver(onCreated: (SessionDescription) -> Unit) = object : SdpObserver {
        override fun onCreateSuccess(desc: SessionDescription) = onCreated(desc)
        override fun onCreateFailure(err: String?) { fail("SDP error") }
        override fun onSetSuccess() {}
        override fun onSetFailure(err: String?) {}
    }

    private fun sdpSetObserver(onSet: () -> Unit) = object : SdpObserver {
        override fun onCreateSuccess(p0: SessionDescription?) {}
        override fun onCreateFailure(p0: String?) {}
        override fun onSetSuccess() = onSet()
        override fun onSetFailure(err: String?) {}
    }
}
