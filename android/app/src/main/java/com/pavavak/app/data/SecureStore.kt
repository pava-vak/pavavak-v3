package com.pavavak.app.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/** Tokens, the refresh cookie and the cached user, encrypted with a Keystore-backed key. */
class SecureStore(context: Context) {
    // Keystore corruption (seen on some OEM devices and after OS updates) makes the encrypted file
    // unreadable; wipe it and start signed out instead of crashing on every launch.
    private val prefs: SharedPreferences = try {
        open(context)
    } catch (e: Exception) {
        context.deleteSharedPreferences(FILE_NAME)
        runCatching {
            java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
                .deleteEntry(MasterKey.DEFAULT_MASTER_KEY_ALIAS)
        }
        open(context)
    }

    private fun open(context: Context): SharedPreferences = EncryptedSharedPreferences.create(
        context,
        FILE_NAME,
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
    private val json = Json { ignoreUnknownKeys = true }

    var accessToken: String?
        get() = prefs.getString(KEY_ACCESS, null)
        set(value) = prefs.edit().putString(KEY_ACCESS, value).apply()

    var sessionId: String?
        get() = prefs.getString(KEY_SESSION, null)
        set(value) = prefs.edit().putString(KEY_SESSION, value).apply()

    var cookies: String?
        get() = prefs.getString(KEY_COOKIES, null)
        set(value) = prefs.edit().putString(KEY_COOKIES, value).apply()

    var user: User?
        get() = prefs.getString(KEY_USER, null)?.let { runCatching { json.decodeFromString<User>(it) }.getOrNull() }
        set(value) = prefs.edit().putString(KEY_USER, value?.let { json.encodeToString(it) }).apply()

    fun clearSession() {
        prefs.edit().remove(KEY_ACCESS).remove(KEY_SESSION).remove(KEY_COOKIES).remove(KEY_USER).apply()
    }

    private companion object {
        const val FILE_NAME = "pava_secure"
        const val KEY_ACCESS = "access_token"
        const val KEY_SESSION = "session_id"
        const val KEY_COOKIES = "cookies"
        const val KEY_USER = "user"
    }
}
