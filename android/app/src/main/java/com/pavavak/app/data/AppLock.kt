package com.pavavak.app.data

import android.os.SystemClock
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * App lock state. The lock engages on launch and when returning from the background after the
 * configured timer. Unlocking is by fingerprint/face (BiometricPrompt, in the UI) or a 4-digit PIN.
 *
 * Privacy extras kept here because they all hinge on who unlocked the app:
 *  - a decoy PIN that opens an empty-looking app,
 *  - a record of wrong PIN attempts, shown after the next real unlock,
 *  - hidden chats (synced with the server so they never notify) and per-chat locks (this phone only).
 */
class AppLock(private val settings: SettingsStore, private val secure: SecureStore) {
    enum class PinResult { Real, Decoy, Wrong }

    data class IntruderReport(val attempts: Int, val lastAt: Long)

    private val _locked = MutableStateFlow(isConfigured())
    val locked: StateFlow<Boolean> = _locked

    /** True while the app was opened with the decoy PIN: every chat is hidden. */
    private val _decoy = MutableStateFlow(false)
    val decoy: StateFlow<Boolean> = _decoy

    private val _hiddenChats = MutableStateFlow(secure.hiddenChats)
    val hiddenChats: StateFlow<Set<String>> = _hiddenChats

    private val _lockedChats = MutableStateFlow(secure.lockedChats)
    val lockedChats: StateFlow<Set<String>> = _lockedChats

    /** Locked chats opened since the app was last unlocked. Cleared whenever the app locks or goes away. */
    private val _unlockedChats = MutableStateFlow<Set<String>>(emptySet())
    val unlockedChats: StateFlow<Set<String>> = _unlockedChats

    private val _intruder = MutableStateFlow<IntruderReport?>(null)
    val intruder: StateFlow<IntruderReport?> = _intruder

    /** Tells the server when a chat is hidden or unhidden (set by the application). */
    var onHiddenChanged: ((chatId: String, hidden: Boolean) -> Unit)? = null

    /** Runs whenever the app locks (the application wipes cached media here). */
    var onLocked: (() -> Unit)? = null

    /** While a call/video call is live the app must not auto-lock; only a manual lock may. */
    var isCallActive: () -> Boolean = { false }

    private var backgroundedAt = 0L

    /** Set just before the app opens the camera, a picker or another app, so returning doesn't ask for the PIN. */
    @Volatile private var externalPending = false
    private var externalLeftAt = 0L

    fun allowExternalActivity() { externalPending = true }

    /** True while the app is out at the camera / a picker / another app, so the privacy reset is skipped. */
    fun hasExternalPending(): Boolean = externalPending

    /** Back in front: the round trip is over even if the other screen never fully hid the app. */
    fun onActivityResumed() { externalPending = false }

    fun isConfigured(): Boolean = settings.current.lockEnabled && (hasPin() || settings.current.biometricEnabled)

    fun hasPin(): Boolean = secure.pinRecord != null

    fun hasDecoyPin(): Boolean = secure.decoyPinRecord != null

    fun onBackground() {
        backgroundedAt = SystemClock.elapsedRealtime()
        _unlockedChats.value = emptySet()
        if (externalPending) { externalLeftAt = backgroundedAt; return }
        if (isCallActive()) return // a live call keeps the app open; only a manual lock locks it
        if (isConfigured() && settings.current.lockTimerSeconds == 0) lock()
    }

    fun onForeground() {
        if (externalPending) {
            externalPending = false
            // Still lock if the user wandered off for a long time while in the other app
            if (isConfigured() && !isCallActive() && SystemClock.elapsedRealtime() - externalLeftAt > EXTERNAL_GRACE_MS) lock()
            return
        }
        if (!isConfigured() || _locked.value || isCallActive()) return
        val elapsed = (SystemClock.elapsedRealtime() - backgroundedAt) / 1000
        if (backgroundedAt != 0L && elapsed >= settings.current.lockTimerSeconds) lock()
    }

    fun lockNow() { if (isConfigured()) lock() else onLocked?.invoke() }

    private fun lock() {
        _locked.value = true
        _unlockedChats.value = emptySet()
        onLocked?.invoke()
    }

    /** Fingerprint/face unlock always opens the real app. */
    fun unlock() = unlockAs(decoy = false)

    private fun unlockAs(decoy: Boolean) {
        _decoy.value = decoy
        if (!decoy) {
            val attempts = secure.failedUnlocks
            if (attempts > 0) _intruder.value = IntruderReport(attempts, secure.lastFailedUnlockAt)
            secure.failedUnlocks = 0
        }
        _locked.value = false
    }

    fun dismissIntruderReport() { _intruder.value = null }

    /** Checks the PIN against the real and decoy PINs and unlocks accordingly. */
    suspend fun unlockWithPin(pin: String): PinResult {
        val result = when {
            matches(secure.pinRecord, pin) -> PinResult.Real
            matches(secure.decoyPinRecord, pin) -> PinResult.Decoy
            else -> PinResult.Wrong
        }
        when (result) {
            PinResult.Real -> unlockAs(decoy = false)
            PinResult.Decoy -> unlockAs(decoy = true)
            PinResult.Wrong -> {
                secure.failedUnlocks = secure.failedUnlocks + 1
                secure.lastFailedUnlockAt = System.currentTimeMillis()
            }
        }
        return result
    }

    /** Real PIN only; used to open locked or hidden chats. */
    suspend fun verifyPin(pin: String): Boolean = matches(secure.pinRecord, pin)

    /**
     * For the decoy secret code: unlocks if [pin] is the real or decoy PIN, but a miss costs
     * nothing (no failed-attempt penalty) so normal calculator use is never punished.
     */
    suspend fun tryUnlockSilently(pin: String): Boolean = when {
        matches(secure.pinRecord, pin) -> { unlockAs(decoy = false); true }
        matches(secure.decoyPinRecord, pin) -> { unlockAs(decoy = true); true }
        else -> false
    }

    suspend fun setPin(pin: String) {
        if (matches(secure.decoyPinRecord, pin)) secure.decoyPinRecord = null // the two PINs must never be equal
        secure.pinRecord = record(pin)
        settings.setLockEnabled(true)
    }

    suspend fun setDecoyPin(pin: String): Boolean {
        if (matches(secure.pinRecord, pin)) return false // must differ from the real PIN
        secure.decoyPinRecord = record(pin)
        return true
    }

    fun removeDecoyPin() { secure.decoyPinRecord = null }

    fun removePin() {
        secure.pinRecord = null
        secure.decoyPinRecord = null
        if (!settings.current.biometricEnabled) settings.setLockEnabled(false)
    }

    fun turnOff() {
        secure.pinRecord = null
        secure.decoyPinRecord = null
        settings.setBiometricEnabled(false)
        settings.setLockEnabled(false)
        _locked.value = false
        _decoy.value = false
    }

    // ── Hidden and locked chats ─────────────────────────────────────────────

    fun setHidden(chatId: String, hidden: Boolean) {
        _hiddenChats.update { if (hidden) it + chatId else it - chatId }
        secure.hiddenChats = _hiddenChats.value
        onHiddenChanged?.invoke(chatId, hidden)
    }

    /**
     * Applies the server's list. On this phone's first sync, chats hidden here before syncing
     * existed are kept and returned so the caller can upload them.
     */
    fun mergeHiddenFromServer(server: Set<String>): Set<String> {
        val toUpload = if (secure.hiddenSynced) emptySet() else _hiddenChats.value - server
        _hiddenChats.value = server + toUpload
        secure.hiddenChats = _hiddenChats.value
        secure.hiddenSynced = true
        return toUpload
    }

    fun setChatLocked(chatId: String, locked: Boolean) {
        _lockedChats.update { if (locked) it + chatId else it - chatId }
        secure.lockedChats = _lockedChats.value
        if (!locked) _unlockedChats.update { it - chatId }
    }

    fun markChatUnlocked(chatId: String) = _unlockedChats.update { it + chatId }

    fun needsChatUnlock(chatId: String): Boolean = chatId in _lockedChats.value && chatId !in _unlockedChats.value

    /** Called on sign-out so the next account starts without someone else's lock or hidden chats. */
    fun reset() {
        secure.clearPrivacy()
        settings.clearLock()
        _hiddenChats.value = emptySet()
        _lockedChats.value = emptySet()
        _unlockedChats.value = emptySet()
        _intruder.value = null
        _decoy.value = false
        _locked.value = false
    }

    private suspend fun record(pin: String): String = withContext(Dispatchers.Default) {
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        "${b64(salt)}:${b64(pbkdf2(pin, salt))}"
    }

    private suspend fun matches(record: String?, pin: String): Boolean = withContext(Dispatchers.Default) {
        if (record == null) return@withContext false
        val parts = record.split(':')
        if (parts.size != 2) return@withContext false
        val salt = Base64.decode(parts[0], Base64.NO_WRAP)
        MessageDigest.isEqual(pbkdf2(pin, salt), Base64.decode(parts[1], Base64.NO_WRAP))
    }

    private companion object { const val EXTERNAL_GRACE_MS = 5 * 60_000L }

    private fun pbkdf2(pin: String, salt: ByteArray): ByteArray =
        SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            .generateSecret(PBEKeySpec(pin.toCharArray(), salt, 200_000, 256)).encoded

    private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)
}
