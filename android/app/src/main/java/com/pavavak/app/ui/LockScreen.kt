package com.pavavak.app.ui

import android.content.Context
import android.content.ContextWrapper
import android.graphics.BitmapFactory
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricPrompt
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Backspace
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.pavavak.app.data.AppLock
import com.pavavak.app.data.SettingsStore
import com.pavavak.app.ui.theme.PavaColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

fun Context.findActivity(): FragmentActivity? {
    var c: Context? = this
    while (c is ContextWrapper) {
        if (c is FragmentActivity) return c
        c = c.baseContext
    }
    return null
}

fun biometricAvailable(context: Context): Boolean =
    BiometricManager.from(context).canAuthenticate(BIOMETRIC_STRONG or BIOMETRIC_WEAK) == BiometricManager.BIOMETRIC_SUCCESS

/** Shows the system fingerprint/face sheet. [onError] gets null when the user just cancelled. */
fun promptBiometric(activity: FragmentActivity, title: String, subtitle: String?, onSuccess: () -> Unit, onError: (String?) -> Unit = {}) {
    val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = onSuccess()
        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
            val cancelled = errorCode == BiometricPrompt.ERROR_USER_CANCELED || errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                errorCode == BiometricPrompt.ERROR_CANCELED
            onError(if (cancelled) null else errString.toString())
        }
    })
    val info = BiometricPrompt.PromptInfo.Builder()
        .setTitle(title)
        .apply { if (subtitle != null) setSubtitle(subtitle) }
        .setAllowedAuthenticators(BIOMETRIC_STRONG or BIOMETRIC_WEAK)
        .setNegativeButtonText("Use PIN")
        .setConfirmationRequired(false)
        .build()
    runCatching { prompt.authenticate(info) }.onFailure { onError(it.message) }
}

@Composable
fun LockIcon(settings: SettingsStore.Values, size: androidx.compose.ui.unit.Dp = 72.dp) {
    if (settings.lockIconHidden) return
    val bitmap = remember(settings.lockIconPath) {
        settings.lockIconPath?.let { runCatching { BitmapFactory.decodeFile(it)?.asImageBitmap() }.getOrNull() }
    }
    if (bitmap != null) {
        Image(bitmap, null, contentScale = ContentScale.Crop, modifier = Modifier.size(size).clip(RoundedCornerShape(size / 4)))
    } else {
        Box(Modifier.size(size).clip(RoundedCornerShape(size / 4)).background(PavaColors.Accent), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.Lock, null, tint = PavaColors.OnAccent, modifier = Modifier.size(size / 2))
        }
    }
}

/** Full-screen, opaque lock. Nothing behind it is visible or touchable while it is shown. */
@Composable
fun LockScreen(settings: SettingsStore.Values, lock: AppLock) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val canBio = settings.biometricEnabled && remember { biometricAvailable(context) }
    val hasPin = remember { lock.hasPin() }
    var error by remember { mutableStateOf<String?>(null) }
    var failures by remember { mutableIntStateOf(0) }
    var lockedUntil by remember { mutableLongStateOf(0L) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var autoPrompted by remember { mutableStateOf(false) }
    val keyboard = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    val focusManager = androidx.compose.ui.platform.LocalFocusManager.current
    LaunchedEffect(Unit) { focusManager.clearFocus(force = true); keyboard?.hide() }

    fun bio() {
        val activity = context.findActivity() ?: return
        promptBiometric(activity, "Unlock ${settings.lockName}", null, onSuccess = { lock.unlock() },
            onError = { if (it != null) error = it })
    }

    // Ask for the fingerprint straight away, but only once the activity is in front
    LaunchedEffect(canBio) {
        if (!canBio) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            if (!autoPrompted) { autoPrompted = true; bio() }
        }
    }
    LaunchedEffect(lockedUntil) {
        while (System.currentTimeMillis() < lockedUntil) { now = System.currentTimeMillis(); delay(500) }
        now = System.currentTimeMillis()
    }

    Box(
        Modifier.fillMaxSize().background(PavaColors.Background)
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
    ) {
        Column(
            Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.weight(0.6f))
            LockIcon(settings)
            Spacer(Modifier.height(14.dp))
            Text(settings.lockName, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = PavaColors.TextPrimary)
            Spacer(Modifier.height(28.dp))
            val waiting = lockedUntil > now
            if (hasPin) {
                PinEntry(
                    title = if (waiting) "Try again in ${((lockedUntil - now) / 1000) + 1}s" else "Enter PIN",
                    error = error,
                    enabled = !waiting,
                    onComplete = { pin, reset ->
                        scope.launch {
                            if (lock.verifyPin(pin)) {
                                lock.unlock()
                            } else {
                                failures++
                                error = "Wrong PIN"
                                if (failures % 5 == 0) lockedUntil = System.currentTimeMillis() + 30_000L * (failures / 5)
                                reset()
                            }
                        }
                    },
                    trailing = if (canBio) ({ KeypadIcon(Icons.Filled.Fingerprint, "Unlock with fingerprint") { bio() } }) else null,
                )
            } else {
                if (error != null) Text(error!!, color = PavaColors.Danger, fontSize = 13.sp)
                Spacer(Modifier.height(16.dp))
                Surface(onClick = { bio() }, shape = CircleShape, color = PavaColors.Surface) {
                    Icon(Icons.Filled.Fingerprint, "Unlock with fingerprint", tint = PavaColors.Accent, modifier = Modifier.padding(18.dp).size(48.dp))
                }
                Spacer(Modifier.height(10.dp))
                Text("Touch to unlock", color = PavaColors.TextMuted)
            }
            Spacer(Modifier.weight(1f))
        }
    }
}

/** 4-digit PIN dots plus a number pad. [onComplete] gets a reset callback to clear the dots. */
@Composable
fun PinEntry(
    title: String,
    error: String?,
    enabled: Boolean = true,
    onComplete: (String, reset: () -> Unit) -> Unit,
    trailing: (@Composable () -> Unit)? = null,
) {
    var pin by remember { mutableStateOf("") }
    val shake = remember { Animatable(0f) }
    LaunchedEffect(error) {
        if (error != null) for (x in listOf(18f, -14f, 10f, -6f, 0f)) shake.animateTo(x)
    }
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, color = PavaColors.TextMuted, fontSize = 15.sp)
        Spacer(Modifier.height(16.dp))
        Row(Modifier.offset { IntOffset(shake.value.roundToInt(), 0) }, horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            repeat(4) { i ->
                Box(
                    Modifier.size(16.dp).clip(CircleShape)
                        .background(if (i < pin.length) PavaColors.Accent else PavaColors.Background)
                        .border(1.5.dp, PavaColors.Accent, CircleShape),
                )
            }
        }
        Box(Modifier.height(28.dp), contentAlignment = Alignment.Center) {
            if (error != null) Text(error, color = PavaColors.Danger, fontSize = 13.sp)
        }
        val rows = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"))
        for (row in rows) {
            Row(horizontalArrangement = Arrangement.spacedBy(22.dp)) {
                for (d in row) KeypadKey(d, enabled) {
                    if (pin.length < 4) {
                        pin += d
                        if (pin.length == 4) { val entered = pin; onComplete(entered) { pin = "" } }
                    }
                }
            }
            Spacer(Modifier.height(14.dp))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(22.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(72.dp), contentAlignment = Alignment.Center) { trailing?.invoke() }
            KeypadKey("0", enabled) {
                if (pin.length < 4) {
                    pin += "0"
                    if (pin.length == 4) { val entered = pin; onComplete(entered) { pin = "" } }
                }
            }
            Box(Modifier.size(72.dp), contentAlignment = Alignment.Center) {
                if (pin.isNotEmpty()) KeypadIcon(Icons.AutoMirrored.Filled.Backspace, "Delete digit") { pin = pin.dropLast(1) }
            }
        }
    }
}

@Composable
private fun KeypadKey(label: String, enabled: Boolean, onClick: () -> Unit) {
    Surface(onClick = onClick, enabled = enabled, shape = CircleShape, color = PavaColors.Surface, modifier = Modifier.size(72.dp)) {
        Box(contentAlignment = Alignment.Center) {
            Text(label, fontSize = 28.sp, color = if (enabled) PavaColors.TextPrimary else PavaColors.TextMuted)
        }
    }
}

@Composable
private fun KeypadIcon(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    Surface(onClick = onClick, shape = CircleShape, color = androidx.compose.ui.graphics.Color.Transparent, modifier = Modifier.size(72.dp)) {
        Box(contentAlignment = Alignment.Center) { Icon(icon, label, tint = PavaColors.Accent, modifier = Modifier.size(30.dp)) }
    }
}

/** Choose a PIN, then type it again. Calls [onDone] with the confirmed PIN. */
@Composable
fun PinSetupDialog(onDone: (String) -> Unit, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = PavaColors.Background) {
            Column(Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Row(Modifier.fillMaxWidth()) { TextButton(onClick = onDismiss) { Text("Cancel") } }
                Spacer(Modifier.weight(0.4f))
                PinSetupFlow(onDone)
                Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
fun PinSetupFlow(onDone: (String) -> Unit) {
    var first by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val step = first == null
    // A new key resets the dots between the two steps
    androidx.compose.runtime.key(step) {
        PinEntry(
            title = if (step) "Choose a 4-digit PIN" else "Enter the PIN again",
            error = error,
            onComplete = { pin, reset ->
                when {
                    step && pin.toSet().size == 1 -> { error = "Pick a less obvious PIN"; reset() }
                    step -> { error = null; first = pin }
                    pin == first -> onDone(pin)
                    else -> { error = "PINs didn't match. Start again."; first = null }
                }
            },
        )
    }
}
