package com.pavavak.app.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Non-secret preferences, observable so the UI updates immediately. */
class SettingsStore(context: Context) {
    private val prefs = context.getSharedPreferences("pava_settings", Context.MODE_PRIVATE)

    data class Values(
        val themeId: String,
        val lockEnabled: Boolean,
        val biometricEnabled: Boolean,
        val lockTimerSeconds: Int,
        val lockName: String,
        val lockIconPath: String?,
        val lockIconHidden: Boolean,
        val onboarded: Boolean,
        val appIcon: String,
        val chime: Boolean,
        /** Show "New message" instead of the text in the chat list and banners. */
        val hidePreviews: Boolean,
        /** Shake the phone to lock and hide the app instantly. */
        val shakeToHide: Boolean,
        /** Delete downloaded photos, videos and files whenever the app locks. */
        val wipeMediaOnLock: Boolean,
    )

    private val _values = MutableStateFlow(read())
    val values: StateFlow<Values> = _values
    val current: Values get() = _values.value

    private fun read() = Values(
        themeId = prefs.getString("theme", "midnight") ?: "midnight",
        lockEnabled = prefs.getBoolean("lock_enabled", false),
        biometricEnabled = prefs.getBoolean("biometric_enabled", false),
        lockTimerSeconds = prefs.getInt("lock_timer", 0),
        lockName = prefs.getString("lock_name", "PaVa Vak") ?: "PaVa Vak",
        lockIconPath = prefs.getString("lock_icon", null),
        lockIconHidden = prefs.getBoolean("lock_icon_hidden", false),
        onboarded = prefs.getBoolean("onboarded", false),
        appIcon = prefs.getString("app_icon", "default") ?: "default",
        chime = prefs.getBoolean("chime", true),
        hidePreviews = prefs.getBoolean("hide_previews", false),
        shakeToHide = prefs.getBoolean("shake_to_hide", false),
        wipeMediaOnLock = prefs.getBoolean("wipe_media_on_lock", true),
    )

    private fun edit(block: android.content.SharedPreferences.Editor.() -> Unit) {
        prefs.edit().apply(block).apply()
        _values.value = read()
    }

    fun setTheme(id: String) = edit { putString("theme", id) }
    fun setLockEnabled(on: Boolean) = edit { putBoolean("lock_enabled", on) }
    fun setBiometricEnabled(on: Boolean) = edit { putBoolean("biometric_enabled", on) }
    fun setLockTimer(seconds: Int) = edit { putInt("lock_timer", seconds) }
    fun setLockName(name: String) = edit { putString("lock_name", name.take(40).ifBlank { "PaVa Vak" }) }
    fun setLockIcon(path: String?) = edit { putString("lock_icon", path) }
    fun setLockIconHidden(hidden: Boolean) = edit { putBoolean("lock_icon_hidden", hidden) }
    fun setOnboarded(done: Boolean) = edit { putBoolean("onboarded", done) }
    fun setAppIcon(id: String) = edit { putString("app_icon", id) }
    fun setChime(on: Boolean) = edit { putBoolean("chime", on) }
    fun setHidePreviews(on: Boolean) = edit { putBoolean("hide_previews", on) }
    fun setShakeToHide(on: Boolean) = edit { putBoolean("shake_to_hide", on) }
    fun setWipeMediaOnLock(on: Boolean) = edit { putBoolean("wipe_media_on_lock", on) }

    /** Lock-related settings are per device user; cleared on sign-out together with the PIN. */
    fun clearLock() = edit {
        remove("lock_enabled"); remove("biometric_enabled"); remove("lock_timer"); remove("onboarded")
    }
}
