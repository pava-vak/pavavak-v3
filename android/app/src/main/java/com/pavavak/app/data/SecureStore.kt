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

    /** App-lock PIN as "salt:hash" (PBKDF2); never the PIN itself. */
    var pinRecord: String?
        get() = prefs.getString(KEY_PIN, null)
        set(value) = prefs.edit().putString(KEY_PIN, value).apply()

    /** Decoy PIN as "salt:hash": unlocking with it opens an empty-looking app. */
    var decoyPinRecord: String?
        get() = prefs.getString(KEY_DECOY_PIN, null)
        set(value) = prefs.edit().putString(KEY_DECOY_PIN, value).apply()

    /** Chats hidden from the list (cached here; synced with the server for this account only). */
    var hiddenChats: Set<String>
        get() = prefs.getStringSet(KEY_HIDDEN, emptySet())?.toSet() ?: emptySet()
        set(value) = prefs.edit().putStringSet(KEY_HIDDEN, value).apply()

    /** Chats that need the PIN or fingerprint to open. */
    var lockedChats: Set<String>
        get() = prefs.getStringSet(KEY_LOCKED, emptySet())?.toSet() ?: emptySet()
        set(value) = prefs.edit().putStringSet(KEY_LOCKED, value).apply()

    /** Wrong PIN attempts since the last successful unlock, and when the last one happened. */
    var failedUnlocks: Int
        get() = prefs.getInt(KEY_FAILED, 0)
        set(value) = prefs.edit().putInt(KEY_FAILED, value).apply()
    var lastFailedUnlockAt: Long
        get() = prefs.getLong(KEY_FAILED_AT, 0L)
        set(value) = prefs.edit().putLong(KEY_FAILED_AT, value).apply()

    /** Chat titles and mute state, so a push that arrives while the app is closed can be labelled without a network call. */
    var chatCache: String?
        get() = prefs.getString(KEY_CHAT_CACHE, null)
        set(value) = prefs.edit().putString(KEY_CHAT_CACHE, value).apply()

    /** True once this phone's hidden chats were merged with the server's list. */
    var hiddenSynced: Boolean
        get() = prefs.getBoolean(KEY_HIDDEN_SYNCED, false)
        set(value) = prefs.edit().putBoolean(KEY_HIDDEN_SYNCED, value).apply()

    /** Everything tied to the signed-in person's privacy setup on this phone. */
    fun clearPrivacy() {
        prefs.edit().remove(KEY_PIN).remove(KEY_DECOY_PIN).remove(KEY_HIDDEN).remove(KEY_HIDDEN_SYNCED).remove(KEY_LOCKED)
            .remove(KEY_FAILED).remove(KEY_FAILED_AT).apply()
    }

    fun clearSession() {
        prefs.edit().remove(KEY_ACCESS).remove(KEY_SESSION).remove(KEY_COOKIES).remove(KEY_USER).remove(KEY_CHAT_CACHE).apply()
    }

    private companion object {
        const val FILE_NAME = "pava_secure"
        const val KEY_ACCESS = "access_token"
        const val KEY_SESSION = "session_id"
        const val KEY_COOKIES = "cookies"
        const val KEY_USER = "user"
        const val KEY_PIN = "app_lock_pin"
        const val KEY_DECOY_PIN = "decoy_pin"
        const val KEY_CHAT_CACHE = "chat_cache"
        const val KEY_HIDDEN = "hidden_chats"
        const val KEY_HIDDEN_SYNCED = "hidden_chats_synced"
        const val KEY_LOCKED = "locked_chats"
        const val KEY_FAILED = "failed_unlocks"
        const val KEY_FAILED_AT = "failed_unlock_at"
    }
}
