package com.pavavak.v3.realtime

import android.content.Context
import android.util.Log
import com.pavavak.v3.BuildConfig
import com.pavavak.v3.api.V3Api
import com.pavavak.v3.model.ThreadMessage
import com.pavavak.v3.util.SessionStore
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.URI

class SocketManager(private val appContext: Context, private val sessionStore: SessionStore) {
    private var socket: Socket? = null
    private var refreshingSocketToken = false
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val listeners = mutableSetOf<SocketListener>()

    interface SocketListener {
        fun onMessageNew(chatId: String, message: ThreadMessage)
        fun onChatUpdated(chatId: String, unreadCount: Int?)
        fun onMessageStatus(chatId: String, messageId: String, status: String)
        fun onTypingStart(chatId: String, displayName: String)
        fun onTypingStop(chatId: String)
        fun onPresenceOnline(chatId: String, displayName: String) = Unit
        fun onPresenceOffline(chatId: String) = Unit
    }

    fun addListener(listener: SocketListener) {
        listeners.add(listener)
    }

    fun removeListener(listener: SocketListener) {
        listeners.remove(listener)
    }

    fun connect() {
        val token = sessionStore.accessToken()
        if (token.isBlank()) return

        disconnect()
        val options = IO.Options.builder()
            .setPath("/socket.io")
            .setAuth(mapOf("token" to token))
            .setReconnection(true)
            .build()

        socket = IO.socket(URI.create(BuildConfig.API_BASE_URL.trimEnd('/')), options).also { client ->
            client.on(Socket.EVENT_CONNECT) {
                Log.d(TAG, "socket connected")
            }
            client.on(Socket.EVENT_CONNECT_ERROR) {
                refreshSocketToken()
            }
            client.on("message:new") { args ->
                val payload = args.firstOrNull() as? JSONObject ?: return@on
                val chatId = payload.optString("chatId")
                val messageJson = payload.optJSONObject("message") ?: return@on
                val message = ThreadMessage(
                    messageId = messageJson.optString("messageId"),
                    direction = messageJson.optString("direction"),
                    senderDisplayName = messageJson.optString("senderDisplayName"),
                    text = messageJson.optString("text"),
                    sentAt = messageJson.optString("sentAt"),
                    status = messageJson.optString("status")
                )
                listeners.forEach { it.onMessageNew(chatId, message) }
            }
            client.on("chat:updated") { args ->
                val payload = args.firstOrNull() as? JSONObject ?: return@on
                val chatId = payload.optString("chatId")
                val unreadCount = if (payload.has("unreadCount")) payload.optInt("unreadCount") else null
                listeners.forEach { it.onChatUpdated(chatId, unreadCount) }
            }
            client.on("message:delivered") { args ->
                val payload = args.firstOrNull() as? JSONObject ?: return@on
                listeners.forEach {
                    it.onMessageStatus(
                        payload.optString("chatId"),
                        payload.optString("messageId"),
                        payload.optString("status")
                    )
                }
            }
            client.on("message:read") { args ->
                val payload = args.firstOrNull() as? JSONObject ?: return@on
                listeners.forEach {
                    it.onMessageStatus(
                        payload.optString("chatId"),
                        payload.optString("messageId"),
                        payload.optString("status")
                    )
                }
            }
            client.on("typing:start") { args ->
                val payload = args.firstOrNull() as? JSONObject ?: return@on
                listeners.forEach {
                    it.onTypingStart(payload.optString("chatId"), payload.optString("displayName"))
                }
            }
            client.on("typing:stop") { args ->
                val payload = args.firstOrNull() as? JSONObject ?: return@on
                listeners.forEach { it.onTypingStop(payload.optString("chatId")) }
            }
            client.on("presence:online") { args ->
                val payload = args.firstOrNull() as? JSONObject ?: return@on
                listeners.forEach {
                    it.onPresenceOnline(payload.optString("chatId"), payload.optString("displayName"))
                }
            }
            client.on("presence:offline") { args ->
                val payload = args.firstOrNull() as? JSONObject ?: return@on
                listeners.forEach { it.onPresenceOffline(payload.optString("chatId")) }
            }
            client.connect()
        }
    }

    private fun refreshSocketToken() {
        if (refreshingSocketToken || sessionStore.refreshToken().isBlank()) return
        refreshingSocketToken = true
        scope.launch {
            val refreshed = V3Api.refreshForRealtime(appContext)
            refreshingSocketToken = false
            if (refreshed) {
                connect()
            }
        }
    }

    fun disconnect() {
        socket?.off()
        socket?.disconnect()
        socket = null
    }

    fun joinChat(chatId: String) {
        socket?.emit("chat:join", JSONObject(mapOf("chatId" to chatId)))
    }

    fun emitTypingStart(chatId: String) {
        socket?.emit("typing:start", JSONObject(mapOf("chatId" to chatId)))
    }

    fun emitTypingStop(chatId: String) {
        socket?.emit("typing:stop", JSONObject(mapOf("chatId" to chatId)))
    }

    companion object {
        private const val TAG = "SocketManager"
    }
}
