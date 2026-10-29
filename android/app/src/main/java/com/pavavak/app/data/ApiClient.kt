package com.pavavak.app.data

import android.os.Build
import com.pavavak.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.concurrent.TimeUnit

class ApiException(val status: Int, message: String) : Exception(message)

enum class RefreshResult { OK, REJECTED, TRANSIENT }

class ApiClient(private val store: SecureStore) {
    val baseUrl: String = BuildConfig.API_BASE_URL
    val cookieJar = PersistentCookieJar(store)

    val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
    }

    private val userAgent =
        "PaVaVak-Android/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE}; ${Build.MANUFACTURER} ${Build.MODEL})"

    val http: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            val builder = chain.request().newBuilder().header("User-Agent", userAgent)
            store.accessToken?.let { builder.header("Authorization", "Bearer $it") }
            store.sessionId?.let { builder.header("X-Session-Id", it) }
            chain.proceed(builder.build())
        }
        .build()

    private val refreshMutex = Mutex()

    // Bumped on logout so a refresh that was already in flight cannot write a session back
    @Volatile private var sessionGeneration = 0

    /** Called when the server rejects the session (not on network errors). */
    var onSessionExpired: (() -> Unit)? = null

    // ── Auth ────────────────────────────────────────────────────────────────

    suspend fun login(username: String, password: String): AuthResponse {
        val body = buildJsonObject { put("username", username); put("password", password) }
        val result: AuthResponse = decode(execute("POST", "/api/v3/auth/login", body.toString(), allowRefresh = false))
        saveSession(result)
        return result
    }

    suspend fun me(): User = decode<MeResponse>(execute("GET", "/api/v3/me")).user.also { store.user = it }

    suspend fun logout() {
        // One refresh is allowed so an expired access token still revokes the session server-side
        runCatching { execute("POST", "/api/v3/auth/logout", "{}", expireSessionOn401 = false) }
        refreshMutex.withLock {
            sessionGeneration++
            store.clearSession()
            cookieJar.clear()
        }
    }

    /** Uses the refresh cookie; concurrent 401s share a single refresh. */
    suspend fun refresh(staleToken: String?): RefreshResult = refreshMutex.withLock {
        if (store.accessToken != null && store.accessToken != staleToken) return@withLock RefreshResult.OK
        val generation = sessionGeneration
        val response = try {
            execute("POST", "/api/v3/auth/refresh", "{}", allowRefresh = false)
        } catch (e: ApiException) {
            return@withLock if (e.status == 401) RefreshResult.REJECTED else RefreshResult.TRANSIENT
        } catch (e: java.io.IOException) {
            return@withLock RefreshResult.TRANSIENT
        }
        val result = runCatching { decode<AuthResponse>(response) }.getOrNull() ?: return@withLock RefreshResult.TRANSIENT
        if (generation != sessionGeneration) return@withLock RefreshResult.REJECTED
        saveSession(result)
        RefreshResult.OK
    }

    /** Clears local credentials after the server rejected them, then notifies the app. */
    fun expireSession() {
        sessionGeneration++
        store.clearSession()
        cookieJar.clear()
        onSessionExpired?.invoke()
    }

    private fun saveSession(result: AuthResponse) {
        store.accessToken = result.tokens.accessToken
        store.user = result.user
        result.sessionId?.let { store.sessionId = it }
    }

    suspend fun updateDisplayName(name: String) =
        execute("PUT", "/api/v3/users/me", obj("displayName" to name).toString())

    suspend fun changePassword(current: String, new: String) =
        execute("PUT", "/api/v3/auth/change-password", obj("currentPassword" to current, "newPassword" to new).toString())

    suspend fun deleteAccount(password: String) =
        execute("DELETE", "/api/v3/account", obj("password" to password).toString())

    suspend fun sessions(): List<SessionInfo> = decode<SessionsResponse>(execute("GET", "/api/v3/auth/sessions")).sessions
    suspend fun revokeSession(id: String) = execute("DELETE", "/api/v3/auth/sessions/${enc(id)}")
    suspend fun revokeAllSessions() = execute("DELETE", "/api/v3/auth/sessions")

    suspend fun registerFcmToken(token: String) = execute("POST", "/api/v3/push/fcm-token", obj("token" to token).toString())
    suspend fun unregisterFcmToken(token: String) = execute("DELETE", "/api/v3/push/fcm-token", obj("token" to token).toString())

    suspend fun hiddenChats(): List<String> =
        ((api(execute("GET", "/api/v3/me/hidden-chats"))["chatIds"] as? JsonArray).orEmpty())
            .mapNotNull { (it as? JsonPrimitive)?.content }
    suspend fun setChatHidden(chatId: String, hidden: Boolean) =
        execute("PUT", "/api/v3/chats/${enc(chatId)}/hidden", obj("hidden" to hidden).toString())

    suspend fun ghostMode(): Boolean =
        (api(execute("GET", "/api/v3/me/privacy"))["ghostMode"] as? JsonPrimitive)?.content == "true"
    suspend fun setGhostMode(on: Boolean) = execute("PUT", "/api/v3/me/privacy", obj("ghostMode" to on).toString())

    suspend fun iceServers(): IceConfig = decode(execute("GET", "/api/v3/calls/ice"))

    suspend fun presencePrivacy(): PrivacyResponse = decode(execute("GET", "/api/v3/me/privacy"))
    suspend fun setLastSeenVisibility(value: String) =
        execute("PUT", "/api/v3/me/privacy", obj("lastSeenVisibility" to value).toString())
    suspend fun setOnlineVisibility(value: String) =
        execute("PUT", "/api/v3/me/privacy", obj("onlineVisibility" to value).toString())

    suspend fun blockedUsers(): List<String> =
        ((api(execute("GET", "/api/v3/blocks"))["blocked"] as? JsonArray).orEmpty()).mapNotNull { (it as? JsonPrimitive)?.content }
    suspend fun setBlocked(userId: Long, blocked: Boolean) =
        execute("PUT", "/api/v3/users/$userId/block", obj("blocked" to blocked).toString())

    suspend fun deleteForMe(messageId: String) = execute("DELETE", "/api/v3/messages/${enc(messageId)}/for-me")

    suspend fun editHistory(messageId: String): List<EditVersion> =
        decode<EditHistoryResponse>(execute("GET", "/api/v3/messages/${enc(messageId)}/history")).edits

    suspend fun startSelfChat(): ChatSummary =
        decode<DirectChatResponse>(execute("POST", "/api/v3/chats/self", "{}")).chat

    suspend fun sendWhenOnline(chatId: String, text: String) =
        execute("POST", "/api/v3/chats/${enc(chatId)}/send-when-online", obj("text" to text).toString())
    suspend fun onlineQueue(): List<ScheduledItem> = decode<ScheduledResponse>(execute("GET", "/api/v3/online-queue")).items
    suspend fun cancelOnlineQueue(id: String) = execute("DELETE", "/api/v3/online-queue/${enc(id)}")

    // ── People ──────────────────────────────────────────────────────────────

    suspend fun searchUsers(query: String): List<UserSearchResult> =
        decode<UserSearchResponse>(get("/api/v3/users", "q" to query)).items

    suspend fun startDirectChat(userId: Long): ChatSummary =
        decode<DirectChatResponse>(execute("POST", "/api/v3/chats/direct", obj("userId" to userId).toString())).chat

    suspend fun presence(userId: Long): Presence = decode(execute("GET", "/api/v3/users/$userId/presence"))

    // ── Groups ────────────────────────────────────────────────────────────────

    suspend fun createGroup(title: String, memberIds: List<Long>, avatarEmoji: String? = null): ChatSummary {
        val body = buildJsonObject {
            put("title", title)
            put("memberIds", JsonArray(memberIds.map { JsonPrimitive(it) }))
            if (avatarEmoji != null) put("avatarEmoji", avatarEmoji)
        }
        return decode<DirectChatResponse>(execute("POST", "/api/v3/groups", body.toString())).chat
    }

    suspend fun groupDetail(chatId: String): GroupDetail =
        decode<GroupDetailResponse>(execute("GET", "/api/v3/chats/${enc(chatId)}/detail")).detail

    suspend fun addGroupMembers(chatId: String, memberIds: List<Long>) {
        val body = buildJsonObject { put("memberIds", JsonArray(memberIds.map { JsonPrimitive(it) })) }
        execute("POST", "/api/v3/chats/${enc(chatId)}/members", body.toString())
    }

    suspend fun removeGroupMember(chatId: String, userId: Long) =
        execute("DELETE", "/api/v3/chats/${enc(chatId)}/members/$userId")

    suspend fun leaveGroup(chatId: String) = execute("POST", "/api/v3/chats/${enc(chatId)}/leave", "{}")

    suspend fun renameGroup(chatId: String, title: String) =
        execute("PATCH", "/api/v3/chats/${enc(chatId)}", obj("title" to title).toString())

    suspend fun setGroupRole(chatId: String, userId: Long, role: String) =
        execute("PATCH", "/api/v3/chats/${enc(chatId)}/members/$userId", obj("role" to role).toString())

    suspend fun activeGroupCall(chatId: String): ActiveCall? =
        decode<ActiveCallResponse>(execute("GET", "/api/v3/chats/${enc(chatId)}/call")).call

    // ── Chats ───────────────────────────────────────────────────────────────

    suspend fun chats(): List<ChatSummary> = decode<ChatListResponse>(execute("GET", "/api/v3/chats")).items

    suspend fun thread(chatId: String, cursor: String? = null): ThreadResponse =
        decode(get("/api/v3/chats/${enc(chatId)}/messages", "limit" to "40", "cursor" to cursor))

    suspend fun send(chatId: String, text: String, viewOnce: Boolean = false, deleteAfter: String = "never",
                     silent: Boolean = false, burn: String = "off"): Message {
        val body = obj("chatId" to chatId, "text" to text, "viewOnce" to viewOnce, "deleteAfter" to deleteAfter,
            "silent" to silent, "burnAfterRead" to burn)
        return decode<SendResponse>(execute("POST", "/api/v3/messages", body.toString())).message
    }

    suspend fun markChatRead(chatId: String) { runCatching { execute("POST", "/api/v3/chats/${enc(chatId)}/read", "{}") } }
    suspend fun markDelivered(chatId: String, messageId: String) {
        runCatching { execute("POST", "/api/v3/messages/${enc(messageId)}/delivered", obj("chatId" to chatId).toString()) }
    }

    suspend fun setArchived(chatId: String, archived: Boolean) =
        execute("PUT", "/api/v3/chats/${enc(chatId)}/archive", obj("archived" to archived).toString())
    suspend fun setMuted(chatId: String, muted: Boolean) =
        execute("PUT", "/api/v3/chats/${enc(chatId)}/mute", obj("muted" to muted).toString())
    suspend fun setBackground(chatId: String, background: String?) =
        execute("PUT", "/api/v3/chats/${enc(chatId)}/background", obj("background" to background).toString())
    suspend fun clearChat(chatId: String) = execute("DELETE", "/api/v3/chats/${enc(chatId)}/messages")
    suspend fun deleteChat(chatId: String) = execute("DELETE", "/api/v3/chats/${enc(chatId)}")

    // ── Message actions ─────────────────────────────────────────────────────

    suspend fun editMessage(messageId: String, text: String) =
        execute("PUT", "/api/v3/messages/${enc(messageId)}", obj("text" to text).toString())
    suspend fun deleteMessage(messageId: String) = execute("DELETE", "/api/v3/messages/${enc(messageId)}")
    suspend fun react(messageId: String, emoji: String) =
        execute("POST", "/api/v3/messages/${enc(messageId)}/react", obj("emoji" to emoji).toString())
    suspend fun forward(messageId: String, toChatId: String) =
        execute("POST", "/api/v3/messages/${enc(messageId)}/forward", obj("chatId" to toChatId).toString())
    suspend fun star(messageId: String) = execute("POST", "/api/v3/messages/${enc(messageId)}/star", "{}")
    suspend fun unstar(messageId: String) = execute("DELETE", "/api/v3/messages/${enc(messageId)}/star")
    suspend fun openViewOnce(messageId: String) = execute("POST", "/api/v3/messages/${enc(messageId)}/view-once-open", "{}")

    suspend fun reactions(chatId: String): Map<String, List<Reaction>> {
        val root = api(execute("GET", "/api/v3/chats/${enc(chatId)}/reactions"))
        val map = root["reactions"] as? JsonObject ?: return emptyMap()
        return map.mapValues { (_, list) ->
            (list as? JsonArray).orEmpty().mapNotNull { el ->
                val o = el as? JsonObject ?: return@mapNotNull null
                Reaction(o["userId"].asLong() ?: 0, o.str("displayName").orEmpty(), o.str("emoji") ?: return@mapNotNull null)
            }
        }
    }

    suspend fun pinned(chatId: String): PinnedMessage? =
        decode<PinnedResponse>(execute("GET", "/api/v3/chats/${enc(chatId)}/pin")).pinned
    suspend fun pin(chatId: String, messageId: String?) =
        execute("PUT", "/api/v3/chats/${enc(chatId)}/pin", obj("messageId" to messageId).toString())

    suspend fun linkPreview(url: String): LinkPreview? =
        runCatching { decode<LinkPreviewResponse>(get("/api/v3/link-preview", "url" to url)).preview }.getOrNull()

    suspend fun mediaPage(chatId: String, cursor: String?, admin: Boolean = false): MediaPage {
        val base = if (admin) "/api/v3/admin/chats/${enc(chatId)}/media" else "/api/v3/chats/${enc(chatId)}/media"
        return decode(get(base, "limit" to "60", "cursor" to cursor))
    }

    suspend fun search(query: String): List<FoundMessage> =
        decode<SearchResponse>(get("/api/v3/search", "q" to query)).messages

    suspend fun starred(): List<FoundMessage> = decode<SearchResponse>(execute("GET", "/api/v3/starred-messages")).messages

    suspend fun schedule(chatId: String, text: String, atIso: String) =
        execute("POST", "/api/v3/scheduled-messages", obj("chatId" to chatId, "text" to text, "scheduledAt" to atIso).toString())
    suspend fun scheduled(): List<ScheduledItem> = decode<ScheduledResponse>(execute("GET", "/api/v3/scheduled-messages")).items
    suspend fun cancelScheduled(id: String) = execute("DELETE", "/api/v3/scheduled-messages/${enc(id)}")

    suspend fun createPoll(chatId: String, question: String, options: List<String>) {
        val body = buildJsonObject {
            put("chatId", chatId); put("question", question)
            put("options", JsonArray(options.map { JsonPrimitive(it) }))
        }
        execute("POST", "/api/v3/polls", body.toString())
    }

    suspend fun vote(messageId: String, optionIndex: Int): Map<String, Int> {
        val root = api(execute("POST", "/api/v3/polls/${enc(messageId)}/vote", obj("optionIndex" to optionIndex).toString()))
        return (root["votes"] as? JsonObject).orEmpty().mapValues { (it.value as? JsonPrimitive)?.content?.toIntOrNull() ?: 0 }
    }

    // ── Media ───────────────────────────────────────────────────────────────

    /** Images go up as base64 JSON (the server re-encodes and limits them to ~4.5 MB). */
    suspend fun uploadImage(base64: String, mimeType: String): String =
        decode<UploadResponse>(execute("POST", "/api/v3/media/upload", obj("data" to base64, "mimeType" to mimeType).toString())).fileId

    suspend fun uploadVideo(file: File, mimeType: String): String =
        decode<UploadResponse>(executeBody("POST", "$baseUrl/api/v3/media/upload-video", file.asRequestBody(mimeType.toMediaType()))).fileId

    suspend fun uploadBinary(file: File, mimeType: String): String =
        decode<UploadResponse>(executeBody("POST", "$baseUrl/api/v3/media/upload-binary", file.asRequestBody(mimeType.toMediaType()))).fileId

    /** Streams an authorised media download into [target]. */
    suspend fun download(fileId: String, target: File) = withContext(Dispatchers.IO) {
        val attempt: suspend () -> Int = {
            http.newCall(Request.Builder().url("$baseUrl/api/v3/media/${enc(fileId)}").build()).execute().use { r ->
                if (r.isSuccessful) {
                    val tmp = File(target.parentFile, target.name + ".part")
                    r.body!!.byteStream().use { input -> tmp.outputStream().use { input.copyTo(it) } }
                    tmp.renameTo(target)
                }
                r.code
            }
        }
        var code = attempt()
        if (code == 401) {
            if (refresh(store.accessToken) == RefreshResult.OK) code = attempt()
        }
        if (code !in 200..299) throw ApiException(code, if (code == 403) "You can't open this file" else "Download failed ($code)")
    }

    // ── Admin ───────────────────────────────────────────────────────────────

    suspend fun adminSummary(): AdminSummary = decode<AdminSummaryResponse>(execute("GET", "/api/v3/admin/summary")).summary
    suspend fun adminUsers(): List<AdminUser> = decode<AdminUsersResponse>(execute("GET", "/api/v3/admin/users")).items
    suspend fun adminSetDisabled(userId: Long, disabled: Boolean) =
        execute("PUT", "/api/v3/admin/users/$userId/disable", obj("disabled" to disabled).toString())
    suspend fun adminResetPassword(userId: Long): String =
        decode<TempPasswordResponse>(execute("POST", "/api/v3/admin/users/$userId/reset-password", "{}")).temporaryPassword
    suspend fun adminCreateUser(username: String, displayName: String, password: String) =
        execute("POST", "/api/v3/admin/users", obj("username" to username, "displayName" to displayName, "password" to password).toString())
    suspend fun adminBroadcastUpdate(): Int =
        (api(execute("POST", "/api/v3/admin/broadcast-update", "{}"))["count"] as? JsonPrimitive)?.content?.toIntOrNull() ?: 0
    suspend fun adminChats(): List<AdminChat> = decode<AdminChatsResponse>(execute("GET", "/api/v3/admin/chats")).items
    suspend fun adminThread(chatId: String, cursor: String?): AdminThreadResponse =
        decode(get("/api/v3/admin/chats/${enc(chatId)}/messages", "cursor" to cursor))

    // ── Plumbing ────────────────────────────────────────────────────────────

    inline fun <reified T> decode(text: String): T = json.decodeFromString(text)

    private fun api(text: String): JsonObject = json.parseToJsonElement(text).jsonObject

    private fun obj(vararg pairs: Pair<String, Any?>): JsonObject = buildJsonObject {
        for ((k, v) in pairs) when (v) {
            null -> put(k, JsonNull)
            is String -> put(k, v)
            is Boolean -> put(k, v)
            is Number -> put(k, v)
            else -> put(k, v.toString())
        }
    }

    private fun enc(value: String) = java.net.URLEncoder.encode(value, "UTF-8").replace("+", "%20")

    private suspend fun get(path: String, vararg query: Pair<String, String?>): String {
        val url = (baseUrl + path).toHttpUrl().newBuilder().apply {
            for ((k, v) in query) if (v != null) addQueryParameter(k, v)
        }.build()
        return executeUrl("GET", url.toString(), null)
    }

    private suspend fun execute(
        method: String, path: String, jsonBody: String? = null,
        allowRefresh: Boolean = true, expireSessionOn401: Boolean = true,
    ): String = executeUrl(method, baseUrl + path, jsonBody, allowRefresh, expireSessionOn401)

    private suspend fun executeUrl(
        method: String, url: String, jsonBody: String?,
        allowRefresh: Boolean = true, expireSessionOn401: Boolean = true,
    ): String = executeBody(method, url, jsonBody?.toRequestBody(JSON_TYPE), allowRefresh, expireSessionOn401)

    private suspend fun executeBody(
        method: String, url: String, body: RequestBody?,
        allowRefresh: Boolean = true, expireSessionOn401: Boolean = true,
    ): String = withContext(Dispatchers.IO) {
        val tokenUsed = store.accessToken
        val requestBody = body ?: if (method == "POST" || method == "PUT") "{}".toRequestBody(JSON_TYPE) else null
        val request = Request.Builder().url(url).method(method, requestBody).build()
        http.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (response.code == 401 && allowRefresh) {
                when (refresh(tokenUsed)) {
                    RefreshResult.OK -> return@withContext executeBody(method, url, body, allowRefresh = false)
                    RefreshResult.TRANSIENT -> throw java.io.IOException("Couldn't reach the server. Check your connection.")
                    RefreshResult.REJECTED -> {
                        if (expireSessionOn401) expireSession()
                        throw ApiException(401, "Session expired")
                    }
                }
            }
            if (!response.isSuccessful) {
                val message = runCatching { json.decodeFromString<ApiError>(text).error }.getOrNull()
                throw ApiException(response.code, message ?: "Request failed (${response.code})")
            }
            text
        }
    }

    private companion object {
        val JSON_TYPE = "application/json".toMediaType()
    }
}

private fun JsonArray?.orEmpty(): List<kotlinx.serialization.json.JsonElement> = this ?: emptyList()
private fun JsonObject?.orEmpty(): Map<String, kotlinx.serialization.json.JsonElement> = this ?: emptyMap()
