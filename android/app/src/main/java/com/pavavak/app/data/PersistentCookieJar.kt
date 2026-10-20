package com.pavavak.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/** Keeps the server's HttpOnly refresh cookie across app restarts, stored encrypted. */
class PersistentCookieJar(private val store: SecureStore) : CookieJar {
    @Serializable
    private data class Stored(
        val name: String, val value: String, val domain: String, val path: String,
        val expiresAt: Long, val secure: Boolean, val httpOnly: Boolean, val hostOnly: Boolean,
    )

    private val json = Json { ignoreUnknownKeys = true }
    private val lock = Any()
    private var cookies: MutableList<Cookie> = load()

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) = synchronized(lock) {
        for (cookie in cookies) {
            this.cookies.removeAll { it.name == cookie.name && it.domain == cookie.domain && it.path == cookie.path }
            if (cookie.expiresAt > System.currentTimeMillis()) this.cookies += cookie
        }
        persist()
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> = synchronized(lock) {
        val now = System.currentTimeMillis()
        if (cookies.removeAll { it.expiresAt <= now }) persist()
        cookies.filter { it.matches(url) }
    }

    fun clear() = synchronized(lock) {
        cookies.clear()
        persist()
    }

    private fun persist() {
        store.cookies = json.encodeToString(cookies.map {
            Stored(it.name, it.value, it.domain, it.path, it.expiresAt, it.secure, it.httpOnly, it.hostOnly)
        })
    }

    private fun load(): MutableList<Cookie> {
        val raw = store.cookies ?: return mutableListOf()
        val stored = runCatching { json.decodeFromString<List<Stored>>(raw) }.getOrDefault(emptyList())
        return stored.map { s ->
            Cookie.Builder().name(s.name).value(s.value).path(s.path).expiresAt(s.expiresAt).apply {
                if (s.hostOnly) hostOnlyDomain(s.domain) else domain(s.domain)
                if (s.secure) secure()
                if (s.httpOnly) httpOnly()
            }.build()
        }.toMutableList()
    }
}
