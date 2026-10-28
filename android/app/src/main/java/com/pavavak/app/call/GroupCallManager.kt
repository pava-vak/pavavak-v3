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
import java.util.concurrent.ConcurrentHashMap

/**
 * Multi-party (group) calling over a full WebRTC mesh: every participant holds a direct,
 * end-to-end encrypted (DTLS-SRTP) PeerConnection to every other participant, so the server
 * never sees call media — just like the 1:1 path. The signaling is the room protocol in
 * groupCalls.js (gcall:*). Glare is avoided by a single rule: the *later joiner* always sends
 * the offer to everyone already in the room (the server hands them the peer list on join).
 *
 * Mesh is right for small, private groups (caps at [MAX_MESH]); the room protocol is SFU-ready,
 * so a media server can later replace the mesh without changing this client's event shapes.
 */
enum class GroupCallMedia { AUDIO, VIDEO }

sealed interface GroupCallState {
    data object Idle : GroupCallState
    data class Incoming(val callId: String, val chatId: String, val fromName: String, val media: GroupCallMedia) : GroupCallState
    data class Active(val callId: String, val chatId: String, val title: String, val media: GroupCallMedia, val startedAt: Long) : GroupCallState
}

class GroupCallManager(
    private val appContext: Context,
    private val api: ApiClient,
    private val realtime: RealtimeClient,
    private val scope: CoroutineScope,
) {
    companion object { const val MAX_MESH = 6 } // self + 5 others; above this a mesh gets heavy

    private val _state = MutableStateFlow<GroupCallState>(GroupCallState.Idle)
    val state: StateFlow<GroupCallState> = _state.asStateFlow()

    private val _muted = MutableStateFlow(false);   val muted: StateFlow<Boolean> = _muted.asStateFlow()
    private val _speaker = MutableStateFlow(false);  val speaker: StateFlow<Boolean> = _speaker.asStateFlow()
    private val _cameraOn = MutableStateFlow(true);  val cameraOn: StateFlow<Boolean> = _cameraOn.asStateFlow()

    private val _localVideo = MutableStateFlow<VideoTrack?>(null); val localVideo: StateFlow<VideoTrack?> = _localVideo.asStateFlow()
    /** Remote peers currently in the call, and their video tracks (null = audio-only or camera off). */
    private val _remoteVideos = MutableStateFlow<Map<Long, VideoTrack?>>(emptyMap()); val remoteVideos: StateFlow<Map<Long, VideoTrack?>> = _remoteVideos.asStateFlow()
    private val _participants = MutableStateFlow<Set<Long>>(emptySet()); val participants: StateFlow<Set<Long>> = _participants.asStateFlow()

    private val audioManager = appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val eglBase: EglBase by lazy { EglBase.create() }
    val eglContext: EglBase.Context get() = eglBase.eglBaseContext
    private val factory: PeerConnectionFactory by lazy { buildFactory() }

    // One shared local audio/video track fans out to every peer connection.
    private var localAudio: AudioTrack? = null
    private var localVideoTrack: VideoTrack? = null
    private var videoCapturer: CameraVideoCapturer? = null
    private var videoSource: VideoSource? = null
    private var surfaceHelper: SurfaceTextureHelper? = null
    private var frontFacing = true

    private val peers = ConcurrentHashMap<Long, PeerConnection>()
    private val remoteSet = ConcurrentHashMap<Long, Boolean>()
    private val pendingIce = ConcurrentHashMap<Long, MutableList<IceCandidate>>()

    private var callId: String? = null
    private var chatId: String? = null
    private var media: GroupCallMedia = GroupCallMedia.AUDIO
    private var iceConfig: com.pavavak.app.data.IceConfig? = null

    private var ringtone: Ringtone? = null
    private var toneGen: ToneGenerator? = null
    private val disposeExecutor = java.util.concurrent.Executors.newSingleThreadExecutor()
    private val lifecycleLock = Any()

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

    /** Start a group call in [chatId] and ring every other member. */
    fun startCall(chatId: String, title: String, media: GroupCallMedia) {
        if (_state.value !is GroupCallState.Idle) return
        val id = UUID.randomUUID().toString()
        this.callId = id; this.chatId = chatId; this.media = media
        _state.value = GroupCallState.Active(id, chatId, title, media, System.currentTimeMillis())
        startRingback()
        scope.launch {
            if (!prepareLocalMedia()) { cleanup(); return@launch }
            send("gcall:start", JSONObject().apply { put("callId", id); put("chatId", chatId); put("title", title)
                put("media", if (media == GroupCallMedia.VIDEO) "video" else "audio") })
        }
    }

    /** An incoming group-call ring (from socket or FCM). */
    fun onIncoming(callId: String, chatId: String, fromName: String, media: GroupCallMedia) {
        if (_state.value !is GroupCallState.Idle) return
        this.callId = callId; this.chatId = chatId; this.media = media
        _state.value = GroupCallState.Incoming(callId, chatId, fromName, media)
        startRingtone()
    }

    /** Accept the ringing group call and join the room. */
    fun accept() {
        val inc = _state.value as? GroupCallState.Incoming ?: return
        stopRingtone()
        runCatching { com.pavavak.app.push.Notifier.cancelCall(appContext) }
        _state.value = GroupCallState.Active(inc.callId, inc.chatId, inc.fromName, inc.media, System.currentTimeMillis())
        scope.launch {
            if (!prepareLocalMedia()) { cleanup(); return@launch }
            send("gcall:join", JSONObject().apply { put("callId", inc.callId) })
        }
    }

    /** Join an already-ongoing group call (e.g. tapped "Join" on an active call). */
    fun joinOngoing(callId: String, chatId: String, title: String, media: GroupCallMedia) {
        if (_state.value !is GroupCallState.Idle) return
        this.callId = callId; this.chatId = chatId; this.media = media
        _state.value = GroupCallState.Active(callId, chatId, title, media, System.currentTimeMillis())
        scope.launch {
            if (!prepareLocalMedia()) { cleanup(); return@launch }
            send("gcall:join", JSONObject().apply { put("callId", callId) })
        }
    }

    fun decline() {
        callId?.let { send("gcall:decline", JSONObject().apply { put("callId", it) }) }
        cleanup()
    }

    fun hangUp() {
        callId?.let { send("gcall:leave", JSONObject().apply { put("callId", it) }) }
        cleanup()
    }

    fun toggleMute() { _muted.value = !_muted.value; localAudio?.setEnabled(!_muted.value) }
    fun toggleSpeaker() {
        _speaker.value = !_speaker.value
        @Suppress("DEPRECATION") run { audioManager.isSpeakerphoneOn = _speaker.value }
    }
    fun toggleVideo() { _cameraOn.value = !_cameraOn.value; localVideoTrack?.setEnabled(_cameraOn.value) }
    fun switchCamera() {
        videoCapturer?.switchCamera(object : CameraVideoCapturer.CameraSwitchHandler {
            override fun onCameraSwitchDone(isFront: Boolean) { frontFacing = isFront }
            override fun onCameraSwitchError(error: String?) {}
        })
    }

    // ── Local media ───────────────────────────────────────────────────────────

    private suspend fun prepareLocalMedia(): Boolean {
        val ice = runCatching { api.iceServers() }.getOrNull() ?: return false
        iceConfig = ice
        startAudioRoute()
        val audioSource = factory.createAudioSource(MediaConstraints())
        localAudio = factory.createAudioTrack("gaudio", audioSource).also { it.setEnabled(!_muted.value) }
        if (media == GroupCallMedia.VIDEO) addCamera()
        return true
    }

    private fun addCamera() {
        val capturer = createCameraCapturer() ?: return
        videoCapturer = capturer
        val helper = SurfaceTextureHelper.create("GCaptureThread", eglBase.eglBaseContext)
        surfaceHelper = helper
        val source = factory.createVideoSource(false)
        videoSource = source
        capturer.initialize(helper, appContext, source.capturerObserver)
        runCatching { capturer.startCapture(1280, 720, 30) }
        val track = factory.createVideoTrack("gvideo", source).also { it.setEnabled(_cameraOn.value) }
        localVideoTrack = track
        _localVideo.value = track
    }

    private fun createCameraCapturer(): CameraVideoCapturer? {
        val enumerator = Camera2Enumerator(appContext)
        val names = enumerator.deviceNames
        names.firstOrNull { enumerator.isFrontFacing(it) }?.let { frontFacing = true; return enumerator.createCapturer(it, null) }
        names.firstOrNull { enumerator.isBackFacing(it) }?.let { frontFacing = false; return enumerator.createCapturer(it, null) }
        return names.firstOrNull()?.let { enumerator.createCapturer(it, null) }
    }

    // ── Peer connections ────────────────────────────────────────────────────

    private fun createPeer(peerId: Long): PeerConnection? {
        val ice = iceConfig ?: return null
        val servers = ice.iceServers.map { s ->
            PeerConnection.IceServer.builder(s.urls)
                .apply { if (!s.username.isNullOrEmpty()) { setUsername(s.username); setPassword(s.credential ?: "") } }
                .createIceServer()
        }
        val config = PeerConnection.RTCConfiguration(servers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        val pc = factory.createPeerConnection(config, pcObserver(peerId)) ?: return null
        localAudio?.let { pc.addTrack(it, listOf("gstream")) }
        localVideoTrack?.let { pc.addTrack(it, listOf("gstream")) }
        peers[peerId] = pc
        _participants.value = _participants.value + peerId
        return pc
    }

    /** Create an offer to [peerId] — called by the later joiner for everyone already present. */
    private fun offerTo(peerId: Long) {
        if (peers.containsKey(peerId)) return
        val pc = createPeer(peerId) ?: return
        pc.createOffer(sdpObserver { desc ->
            pc.setLocalDescription(sdpSetObserver {}, desc)
            send("gcall:signal", signal(peerId, "offer", sdpJson(desc)))
        }, offerConstraints())
    }

    private fun onRemoteOffer(peerId: Long, sdp: JSONObject) {
        val pc = peers[peerId] ?: createPeer(peerId) ?: return
        pc.setRemoteDescription(sdpSetObserver {
            remoteSet[peerId] = true; drainIce(peerId)
            pc.createAnswer(sdpObserver { answer ->
                pc.setLocalDescription(sdpSetObserver {}, answer)
                send("gcall:signal", signal(peerId, "answer", sdpJson(answer)))
            }, offerConstraints())
        }, SessionDescription(SessionDescription.Type.OFFER, sdp.getString("description")))
    }

    private fun onRemoteAnswer(peerId: Long, sdp: JSONObject) {
        val pc = peers[peerId] ?: return
        pc.setRemoteDescription(sdpSetObserver { remoteSet[peerId] = true; drainIce(peerId) },
            SessionDescription(SessionDescription.Type.ANSWER, sdp.getString("description")))
    }

    private fun onRemoteIce(peerId: Long, c: JSONObject) {
        val cand = IceCandidate(c.optString("sdpMid"), c.optInt("sdpMLineIndex"), c.optString("candidate"))
        if (remoteSet[peerId] == true) peers[peerId]?.addIceCandidate(cand)
        else pendingIce.getOrPut(peerId) { mutableListOf() }.add(cand)
    }

    private fun drainIce(peerId: Long) {
        pendingIce[peerId]?.forEach { peers[peerId]?.addIceCandidate(it) }
        pendingIce.remove(peerId)
    }

    private fun removePeer(peerId: Long) {
        val pc = peers.remove(peerId)
        remoteSet.remove(peerId); pendingIce.remove(peerId)
        _participants.value = _participants.value - peerId
        _remoteVideos.value = _remoteVideos.value - peerId
        if (pc != null) disposeExecutor.execute { runCatching { pc.close(); pc.dispose() } }
    }

    private fun pcObserver(peerId: Long) = object : PeerConnection.Observer {
        override fun onIceCandidate(c: IceCandidate) {
            send("gcall:signal", signal(peerId, "ice", JSONObject().apply {
                put("sdpMid", c.sdpMid); put("sdpMLineIndex", c.sdpMLineIndex); put("candidate", c.sdp)
            }))
        }
        override fun onAddTrack(receiver: org.webrtc.RtpReceiver?, streams: Array<out org.webrtc.MediaStream>?) = bind(peerId, receiver?.track())
        override fun onTrack(transceiver: org.webrtc.RtpTransceiver?) = bind(peerId, transceiver?.receiver?.track())
        override fun onConnectionChange(s: PeerConnection.PeerConnectionState) {
            if (s == PeerConnection.PeerConnectionState.FAILED || s == PeerConnection.PeerConnectionState.CLOSED) removePeer(peerId)
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

    private fun bind(peerId: Long, track: MediaStreamTrack?) {
        when (track) {
            is AudioTrack -> track.setEnabled(true)
            is VideoTrack -> { track.setEnabled(true); _remoteVideos.value = _remoteVideos.value + (peerId to track) }
        }
    }

    // ── Signaling in ──────────────────────────────────────────────────────────

    private fun onSignal(name: String, payload: String) {
        if (!name.startsWith("gcall:")) return
        val obj = runCatching { JSONObject(payload) }.getOrNull() ?: return
        when (name) {
            "gcall:incoming" -> onIncoming(
                obj.optString("callId"), obj.optString("chatId"),
                obj.optString("title").ifEmpty { obj.optString("fromName", "Group") },
                if (obj.optString("media") == "video") GroupCallMedia.VIDEO else GroupCallMedia.AUDIO,
            )
            "gcall:peers" -> if (obj.optString("callId") == callId) {
                // We just joined: offer to everyone already in the room.
                val arr = obj.optJSONArray("peers") ?: return
                for (i in 0 until arr.length()) offerTo(arr.getLong(i))
            }
            "gcall:peer-joined" -> if (obj.optString("callId") == callId) {
                // A later joiner will offer to us — just note they exist so the roster updates.
                _participants.value = _participants.value + obj.optLong("userId")
            }
            "gcall:signal" -> if (obj.optString("callId") == callId) {
                val from = obj.optLong("fromUserId")
                val p = obj.optJSONObject("payload") ?: return
                when (obj.optString("kind")) {
                    "offer" -> onRemoteOffer(from, p)
                    "answer" -> onRemoteAnswer(from, p)
                    "ice" -> onRemoteIce(from, p)
                }
            }
            "gcall:peer-left" -> if (obj.optString("callId") == callId) removePeer(obj.optLong("userId"))
            "gcall:ended" -> if (obj.optString("callId") == callId) cleanup()
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private fun signal(toUserId: Long, kind: String, payload: JSONObject) = JSONObject().apply {
        put("callId", callId); put("toUserId", toUserId); put("kind", kind); put("payload", payload)
    }

    private fun offerConstraints() = MediaConstraints().apply {
        mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
        mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", if (media == GroupCallMedia.VIDEO) "true" else "false"))
    }

    private fun send(event: String, data: JSONObject) = realtime.emit(event, data)

    private fun startAudioRoute() = runCatching {
        @Suppress("DEPRECATION") run { audioManager.mode = AudioManager.MODE_IN_COMMUNICATION; audioManager.isSpeakerphoneOn = _speaker.value }
    }
    private fun stopAudioRoute() = runCatching {
        @Suppress("DEPRECATION") run { audioManager.mode = AudioManager.MODE_NORMAL; audioManager.isSpeakerphoneOn = false }
    }

    private fun startRingback() {
        if (toneGen != null) return
        runCatching { toneGen = ToneGenerator(AudioManager.STREAM_VOICE_CALL, 70).also { it.startTone(ToneGenerator.TONE_SUP_RINGTONE, -1) } }
    }
    private fun stopRingback() { runCatching { toneGen?.stopTone(); toneGen?.release() }; toneGen = null }

    private fun startRingtone() {
        runCatching {
            ringtone = RingtoneManager.getRingtone(appContext, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))?.apply {
                @Suppress("DEPRECATION") runCatching { isLooping = true }; play()
            }
        }
        startVibrate()
    }
    private fun stopRingtone() { runCatching { ringtone?.stop() }; ringtone = null; stopVibrate() }

    private fun vibrator(): Vibrator? = runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            (appContext.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        else @Suppress("DEPRECATION") (appContext.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator)
    }.getOrNull()
    private fun startVibrate() = runCatching { vibrator()?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 800, 1000), 0)) }
    private fun stopVibrate() { runCatching { vibrator()?.cancel() } }

    private fun cleanup() = synchronized(lifecycleLock) {
        if (_state.value is GroupCallState.Idle) return
        stopRingback(); stopRingtone(); stopAudioRoute()
        runCatching { com.pavavak.app.push.Notifier.cancelCall(appContext) }
        val oldPeers = peers.values.toList(); peers.clear()
        val oldCap = videoCapturer; val oldSrc = videoSource; val oldHelper = surfaceHelper
        val oldVideo = localVideoTrack; val oldAudio = localAudio
        videoCapturer = null; videoSource = null; surfaceHelper = null; localVideoTrack = null; localAudio = null
        remoteSet.clear(); pendingIce.clear()
        callId = null; chatId = null
        _participants.value = emptySet(); _remoteVideos.value = emptyMap(); _localVideo.value = null
        _muted.value = false; _speaker.value = false; _cameraOn.value = true
        _state.value = GroupCallState.Idle
        disposeExecutor.execute {
            runCatching { oldCap?.stopCapture() }; runCatching { oldCap?.dispose() }
            runCatching { oldHelper?.dispose() }; runCatching { oldVideo?.dispose() }
            runCatching { oldSrc?.dispose() }; runCatching { oldAudio?.dispose() }
            oldPeers.forEach { runCatching { it.close(); it.dispose() } }
        }
    }

    private fun sdpJson(d: SessionDescription) = JSONObject().apply { put("type", d.type.canonicalForm()); put("description", d.description) }

    private fun sdpObserver(onCreated: (SessionDescription) -> Unit) = object : SdpObserver {
        override fun onCreateSuccess(desc: SessionDescription) = onCreated(desc)
        override fun onCreateFailure(err: String?) {}
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
