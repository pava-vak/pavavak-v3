package com.pavavak.app.data

import android.os.SystemClock
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * App lock state. The lock engages on launch and when returning from the background after the
 * configured timer. Unlocking is by fingerprint/face (BiometricPrompt, in the UI) or a 4-digit PIN.
 */
class AppLock(private val settings: SettingsStore, private val secure: SecureStore) {
    private val _locked = MutableStateFlow(isConfigured())
    val locked: StateFlow<Boolean> = _locked

    private var backgroundedAt = 0L

    /** Set just before the app opens the camera, a picker or another app, so returning doesn't ask for the PIN. */
    @Volatile private var externalPending = false
    private var externalLeftAt = 0L

    fun allowExternalActivity() { externalPending = true }

    /** Back in front: the round trip is over even if the other screen never fully hid the app. */
    fun onActivityResumed() { externalPending = false }

    fun isConfigured(): Boolean = settings.current.lockEnabled && (hasPin() || settings.current.biometricEnabled)

    fun hasPin(): Boolean = secure.pinRecord != null

    fun onBackground() {
        backgroundedAt = SystemClock.elapsedRealtime()
        if (externalPending) { externalLeftAt = backgroundedAt; return }
        if (isConfigured() && settings.current.lockTimerSeconds == 0) _locked.value = true
    }

    fun onForeground() {
        if (externalPending) {
            externalPending = false
            // Still lock if the user wandered off for a long time while in the other app
            if (isConfigured() && SystemClock.elapsedRealtime() - externalLeftAt > EXTERNAL_GRACE_MS) _locked.value = true
            return
        }
        if (!isConfigured() || _locked.value) return
        val elapsed = (SystemClock.elapsedRealtime() - backgroundedAt) / 1000
        if (backgroundedAt != 0L && elapsed >= settings.current.lockTimerSeconds) _locked.value = true
    }

    fun lockNow() { if (isConfigured()) _locked.value = true }

    fun unlock() { _locked.value = false }

    suspend fun setPin(pin: String) = withContext(Dispatchers.Default) {
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        secure.pinRecord = "${b64(salt)}:${b64(pbkdf2(pin, salt))}"
        settings.setLockEnabled(true)
    }

    suspend fun verifyPin(pin: String): Boolean = withContext(Dispatchers.Default) {
        val record = secure.pinRecord ?: return@withContext false
        val (salt, hash) = record.split(':').let { Base64.decode(it[0], Base64.NO_WRAP) to Base64.decode(it[1], Base64.NO_WRAP) }
        MessageDigest.isEqual(pbkdf2(pin, salt), hash)
    }

    fun removePin() {
        secure.pinRecord = null
        if (!settings.current.biometricEnabled) settings.setLockEnabled(false)
    }

    fun turnOff() {
        secure.pinRecord = null
        settings.setBiometricEnabled(false)
        settings.setLockEnabled(false)
        _locked.value = false
    }

    /** Called on sign-out so the next account starts without someone else's lock. */
    fun reset() {
        secure.pinRecord = null
        settings.clearLock()
        _locked.value = false
    }

    private companion object { const val EXTERNAL_GRACE_MS = 5 * 60_000L }

    private fun pbkdf2(pin: String, salt: ByteArray): ByteArray =
        SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            .generateSecret(PBEKeySpec(pin.toCharArray(), salt, 200_000, 256)).encoded

    private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)
}
