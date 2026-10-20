package com.pavavak.app.data

import android.os.Build
import com.pavavak.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
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
        .readTimeout(60, TimeUnit.SECONDS)
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

    // ── Chats ───────────────────────────────────────────────────────────────

    suspend fun chats(): List<ChatSummary> = decode<ChatListResponse>(execute("GET", "/api/v3/chats")).items

    suspend fun thread(chatId: String, cursor: String? = null): ThreadResponse {
        val url = "$baseUrl/api/v3/chats/${enc(chatId)}/messages".toHttpUrl().newBuilder()
            .addQueryParameter("limit", "40")
            .apply { cursor?.let { addQueryParameter("cursor", it) } }
            .build()
        return decode(executeUrl("GET", url.toString(), null))
    }

    suspend fun send(chatId: String, text: String): Message {
        val body = buildJsonObject { put("chatId", chatId); put("text", text) }
        return decode<SendResponse>(execute("POST", "/api/v3/messages", body.toString())).message
    }

    suspend fun markChatRead(chatId: String) {
        runCatching { execute("POST", "/api/v3/chats/${enc(chatId)}/read", "{}") }
    }

    suspend fun searchUsers(query: String): List<UserSearchResult> {
        val url = "$baseUrl/api/v3/users".toHttpUrl().newBuilder().addQueryParameter("q", query).build()
        return decode<UserSearchResponse>(executeUrl("GET", url.toString(), null)).items
    }

    suspend fun startDirectChat(userId: Long): ChatSummary {
        val body = buildJsonObject { put("userId", userId) }
        return decode<DirectChatResponse>(execute("POST", "/api/v3/chats/direct", body.toString())).chat
    }

    // ── Plumbing ────────────────────────────────────────────────────────────

    inline fun <reified T> decode(text: String): T = json.decodeFromString(text)

    private fun enc(value: String) = java.net.URLEncoder.encode(value, "UTF-8").replace("+", "%20")

    private suspend fun execute(
        method: String, path: String, jsonBody: String? = null,
        allowRefresh: Boolean = true, expireSessionOn401: Boolean = true,
    ): String = executeUrl(method, baseUrl + path, jsonBody, allowRefresh, expireSessionOn401)

    private suspend fun executeUrl(
        method: String, url: String, jsonBody: String?,
        allowRefresh: Boolean = true, expireSessionOn401: Boolean = true,
    ): String =
        withContext(Dispatchers.IO) {
            val tokenUsed = store.accessToken
            val body: RequestBody? = jsonBody?.toRequestBody(JSON_TYPE)
            val request = Request.Builder().url(url).method(method, body).build()
            http.newCall(request).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (response.code == 401 && allowRefresh) {
                    when (refresh(tokenUsed)) {
                        RefreshResult.OK -> return@withContext executeUrl(method, url, jsonBody, allowRefresh = false)
                        RefreshResult.TRANSIENT -> throw java.io.IOException("Couldn't reach PaVa. Check your connection.")
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
