package com.pavavak.app.data

import io.socket.client.IO
import io.socket.client.Socket
import io.socket.engineio.client.transports.WebSocket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

data class RealtimeEvent(val name: String, val payload: String)

/** socket.io connection to the backend; events are re-emitted as raw JSON strings. */
class RealtimeClient(
    private val api: ApiClient,
    private val store: SecureStore,
    private val scope: CoroutineScope,
) {
    @Volatile private var socket: Socket? = null
    @Volatile private var activeChatId: String? = null
    private val refreshing = AtomicBoolean(false)
    @Volatile private var lastRefreshAttempt = 0L

    private val _events = MutableSharedFlow<RealtimeEvent>(extraBufferCapacity = 256)
    val events: SharedFlow<RealtimeEvent> = _events

    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected

    fun connect() {
        val token = store.accessToken ?: return
        socket?.let {
            if (!it.connected()) it.connect()
            return
        }
        val options = IO.Options.builder()
            .setPath("/socket.io")
            .setTransports(arrayOf(WebSocket.NAME))
            .setAuth(mapOf("token" to token))
            .setReconnection(true)
            .setReconnectionDelayMax(5000)
            .build()
            .apply {
                callFactory = api.http
                webSocketFactory = api.http
            }
        val s = IO.socket(api.baseUrl, options)
        s.on(Socket.EVENT_CONNECT) {
            _connected.value = true
            activeChatId?.let { join(it) }
            _events.tryEmit(RealtimeEvent("connect", "{}"))
        }
        s.on(Socket.EVENT_DISCONNECT) {
            _connected.value = false
            _events.tryEmit(RealtimeEvent("disconnect", "{}"))
        }
        s.on(Socket.EVENT_CONNECT_ERROR) { args -> if (isAuthError(args.firstOrNull())) onAuthError() }
        EVENTS.forEach { name ->
            s.on(name) { args -> _events.tryEmit(RealtimeEvent(name, (args.firstOrNull() as? JSONObject)?.toString() ?: "{}")) }
        }
        socket = s
        s.connect()
    }

    private fun isAuthError(arg: Any?): Boolean = when (arg) {
        is JSONObject -> arg.optString("message") == "Unauthorized"
        is Throwable -> arg.message?.contains("Unauthorized") == true
        else -> false
    }

    /** The server refused our access token: refresh it (rate-limited) and reconnect, or sign out if refused. */
    private fun onAuthError() {
        val now = System.currentTimeMillis()
        if (now - lastRefreshAttempt < MIN_REFRESH_INTERVAL_MS || !refreshing.compareAndSet(false, true)) return
        lastRefreshAttempt = now
        scope.launch {
            try {
                when (api.refresh(store.accessToken)) {
                    RefreshResult.OK -> { disconnect(); connect() }
                    RefreshResult.REJECTED -> { disconnect(); api.expireSession() }
                    RefreshResult.TRANSIENT -> Unit // socket.io keeps retrying; the next auth error refreshes again
                }
            } finally {
                refreshing.set(false)
            }
        }
    }

    fun disconnect() {
        socket?.off()
        socket?.disconnect()
        socket = null
        _connected.value = false
        _events.tryEmit(RealtimeEvent("disconnect", "{}"))
    }

    fun join(chatId: String?) {
        activeChatId = chatId
        if (chatId != null) socket?.emit("chat:join", JSONObject().put("chatId", chatId))
    }

    fun typing(chatId: String, start: Boolean) {
        socket?.emit(if (start) "typing:start" else "typing:stop", JSONObject().put("chatId", chatId))
    }

    private companion object {
        const val MIN_REFRESH_INTERVAL_MS = 15_000L
        val EVENTS = listOf(
            "message:new", "message:deleted", "message:edited", "message:delivered", "message:read",
            "chat:new", "chat:updated", "chat:removed", "typing:start", "typing:stop",
            "presence:online", "presence:offline", "message:reaction", "chat:pinned", "poll:voted", "message:expiry",
        )
    }
}
