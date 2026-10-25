package com.pavavak.app.ui

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Password
import androidx.compose.material.icons.filled.PhonelinkErase
import androidx.compose.material.icons.filled.ScreenRotation
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.SpeakerNotesOff
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material.icons.filled.Warning
import androidx.compose.foundation.clickable
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import com.pavavak.app.data.AppLock
import com.pavavak.app.data.ChatRepository
import com.pavavak.app.data.SettingsStore
import com.pavavak.app.ui.theme.PavaColors
import kotlinx.coroutines.launch
import java.time.Instant
import kotlin.math.sqrt

/**
 * Asks for the real PIN or fingerprint before showing [content] (locked chats, hidden chats).
 * The decoy PIN never opens these.
 */
@Composable
fun AuthGate(
    title: String,
    subtitle: String,
    lock: AppLock,
    settings: SettingsStore.Values,
    unlocked: Boolean,
    onUnlocked: () -> Unit,
    onCancel: () -> Unit,
    content: @Composable () -> Unit,
) {
    if (unlocked) { content(); return }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val canBio = settings.biometricEnabled && remember { biometricAvailable(context) }
    val hasPin = remember { lock.hasPin() }
    var error by remember { mutableStateOf<String?>(null) }
    var prompted by remember { mutableStateOf(false) }
    val onUnlockedNow by rememberUpdatedState(onUnlocked)

    fun bio() {
        val activity = context.findActivity() ?: return
        promptBiometric(activity, title, subtitle, onSuccess = { onUnlockedNow() }, onError = { if (it != null) error = it })
    }
    LaunchedEffect(canBio) {
        if (!canBio) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) { if (!prompted) { prompted = true; bio() } }
    }
    androidx.activity.compose.BackHandler(onBack = onCancel)

    Column(
        Modifier.fillMaxSize().background(PavaColors.Background).safeDrawingPadding().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(Modifier.fillMaxWidth()) { TextButton(onClick = onCancel) { Text("Cancel") } }
        Spacer(Modifier.weight(0.4f))
        Icon(Icons.Filled.Lock, null, tint = PavaColors.Accent, modifier = Modifier.padding(8.dp))
        Text(title, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = PavaColors.TextPrimary)
        Text(subtitle, color = PavaColors.TextMuted, textAlign = TextAlign.Center)
        Spacer(Modifier.height(20.dp))
        when {
            hasPin -> PinEntry(
                title = "Enter your PIN",
                error = error,
                onComplete = { pin, reset ->
                    scope.launch { if (lock.verifyPin(pin)) onUnlockedNow() else { error = "Wrong PIN"; reset() } }
                },
                trailing = if (canBio) ({
                    Surface(onClick = { bio() }, color = androidx.compose.ui.graphics.Color.Transparent) {
                        Icon(Icons.Filled.Fingerprint, "Use fingerprint", tint = PavaColors.Accent, modifier = Modifier.padding(20.dp))
                    }
                }) else null,
            )
            canBio -> {
                if (error != null) Text(error!!, color = PavaColors.Danger)
                TextButton(onClick = { bio() }) { Text("Use fingerprint") }
            }
            else -> Text("Set an app PIN or fingerprint in Settings first.", color = PavaColors.TextMuted, textAlign = TextAlign.Center)
        }
        Spacer(Modifier.weight(1f))
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun HiddenChatsScreen(repository: ChatRepository, lock: AppLock, onOpenChat: (String) -> Unit, onBack: () -> Unit) {
    val chats by repository.chatList.collectAsStateWithLifecycle()
    val hidden by lock.hiddenChats.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val shown = chats.chats.filter { it.chatId in hidden }
    Scaffold(containerColor = PavaColors.Background, topBar = { SimpleTopBar("Hidden chats", onBack) }) { padding ->
        if (shown.isEmpty()) {
            Column(Modifier.padding(padding)) {
                EmptyState(Icons.Filled.VisibilityOff, "No hidden chats", "Long-press a chat in your list and tap Hide chat. It disappears from the list and only shows here.")
            }
            return@Scaffold
        }
        LazyColumn(Modifier.padding(padding).fillMaxSize()) {
            item {
                Text("Long-press a chat to unhide it.", color = PavaColors.TextMuted, fontSize = 13.sp, modifier = Modifier.padding(16.dp))
            }
            items(shown, key = { it.chatId }) { chat ->
                ListItem(
                    headlineContent = { Text(chat.displayTitle, color = PavaColors.TextPrimary, fontWeight = FontWeight.SemiBold) },
                    supportingContent = {
                        Text(if (chat.unreadCount > 0) "${chat.unreadCount} new" else "Hidden", color = if (chat.unreadCount > 0) PavaColors.Unread else PavaColors.TextMuted)
                    },
                    leadingContent = { Avatar(chat.displayTitle, size = 42.dp) },
                    colors = ListItemDefaults.colors(containerColor = PavaColors.Background),
                    modifier = Modifier.combinedClickable(
                        onClick = { onOpenChat(chat.chatId) },
                        onLongClick = { lock.setHidden(chat.chatId, false); context.toast("${chat.displayTitle} is back in your chat list") },
                    ),
                )
            }
        }
    }
}

/** Shown after a real unlock when someone typed wrong PINs while the app was locked. */
@Composable
fun IntruderAlert(lock: AppLock) {
    val report by lock.intruder.collectAsStateWithLifecycle()
    val r = report ?: return
    AlertDialog(
        onDismissRequest = { lock.dismissIntruderReport() },
        icon = { Icon(Icons.Filled.Warning, null, tint = PavaColors.Danger) },
        title = { Text("Someone tried to open this app") },
        text = {
            Text("${r.attempts} wrong PIN ${if (r.attempts == 1) "attempt" else "attempts"} while the app was locked." +
                if (r.lastAt > 0) " Last one: ${formatDateTime(Instant.ofEpochMilli(r.lastAt).toString())}." else "")
        },
        confirmButton = { TextButton(onClick = { lock.dismissIntruderReport() }) { Text("OK") } },
    )
}

/** Settings → Privacy. Ghost mode and hidden chats sync through the server; the rest stays on this phone. */
@Composable
fun PrivacySection(repository: ChatRepository, settingsStore: SettingsStore, lock: AppLock, onHiddenChats: () -> Unit) {
    val settings by settingsStore.values.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var ghost by remember { mutableStateOf<Boolean?>(null) }
    var lastSeen by remember { mutableStateOf<String?>(null) }   // "everyone" | "nobody"
    var online by remember { mutableStateOf<String?>(null) }     // "everyone" | "match"
    var pickLastSeen by remember { mutableStateOf(false) }
    var pickOnline by remember { mutableStateOf(false) }
    var settingDecoy by remember { mutableStateOf(false) }
    var hasDecoy by remember { mutableStateOf(lock.hasDecoyPin()) }
    LaunchedEffect(Unit) {
        runCatching { repository.api.presencePrivacy() }.onSuccess {
            ghost = it.ghostMode; lastSeen = it.lastSeenVisibility; online = it.onlineVisibility
        }
    }

    Section("Privacy")
    SwitchRow(
        Icons.Filled.VisibilityOff, "Ghost mode",
        "Hide your online status, last seen, typing and blue ticks. You won't see others' either.",
        ghost == true, enabled = ghost != null,
    ) { on ->
        ghost = on
        scope.launch {
            runCatching { repository.api.setGhostMode(on) }
                .onSuccess { context.toast(if (on) "Ghost mode on" else "Ghost mode off") }
                .onFailure { ghost = !on; context.toast(it.message ?: "Couldn't change ghost mode") }
        }
    }
    Row_(Icons.Filled.Schedule, "Last seen",
        if (lastSeen == null) "…" else if (lastSeen == "nobody") "Nobody" else "Everyone") {
        if (lastSeen != null) pickLastSeen = true
    }
    Row_(Icons.Filled.Visibility, "Online",
        if (online == null) "…" else if (online == "match") "Same as last seen" else "Everyone") {
        if (online != null) pickOnline = true
    }

    if (pickLastSeen) ChoiceDialog(
        "Last seen", listOf("everyone" to "Everyone", "nobody" to "Nobody"), lastSeen ?: "everyone",
        onPick = { value ->
            pickLastSeen = false
            if (value != lastSeen) {
                val prev = lastSeen; lastSeen = value
                scope.launch {
                    runCatching { repository.api.setLastSeenVisibility(value) }
                        .onFailure { lastSeen = prev; context.toast(it.message ?: "Couldn't update") }
                }
            }
        },
        onDismiss = { pickLastSeen = false },
    )
    if (pickOnline) ChoiceDialog(
        "Online", listOf("everyone" to "Everyone", "match" to "Same as last seen"), online ?: "everyone",
        onPick = { value ->
            pickOnline = false
            if (value != online) {
                val prev = online; online = value
                scope.launch {
                    runCatching { repository.api.setOnlineVisibility(value) }
                        .onFailure { online = prev; context.toast(it.message ?: "Couldn't update") }
                }
            }
        },
        onDismiss = { pickOnline = false },
    )
    Row_(Icons.Filled.VisibilityOff, "Hidden chats", "Also: long-press \"${com.pavavak.app.data.AppIcons.displayName(settings.appIcon, settings.lockName)}\" on the chat list") { onHiddenChats() }
    SwitchRow(Icons.Filled.SpeakerNotesOff, "Hide message previews", "Show \"New message\" instead of the text in the list and alerts", settings.hidePreviews) {
        settingsStore.setHidePreviews(it)
    }
    SwitchRow(Icons.Filled.ScreenRotation, "Shake to hide", "Shake your phone to lock and hide the app instantly", settings.shakeToHide) {
        settingsStore.setShakeToHide(it)
    }
    SwitchRow(Icons.Filled.PhonelinkErase, "Wipe media on lock", "Delete downloaded photos, videos and files from this phone whenever the app locks", settings.wipeMediaOnLock) {
        settingsStore.setWipeMediaOnLock(it)
    }
    if (lock.hasPin()) {
        Row_(Icons.Filled.Password, if (hasDecoy) "Change decoy PIN" else "Set a decoy PIN",
            "A second PIN that opens an empty app. Use it if someone forces you to unlock.") { settingDecoy = true }
        if (hasDecoy) Row_(Icons.Filled.Password, "Remove decoy PIN", null, destructive = true) { lock.removeDecoyPin(); hasDecoy = false }
    }

    if (settingDecoy) PinSetupDialog(
        onDone = { pin ->
            scope.launch {
                if (lock.setDecoyPin(pin)) { hasDecoy = true; context.toast("Decoy PIN set") }
                else context.toast("The decoy PIN must be different from your real PIN")
                settingDecoy = false
            }
        },
        onDismiss = { settingDecoy = false },
    )
}

/** A simple single-choice picker. [options] are (value, label) pairs. */
@Composable
private fun ChoiceDialog(
    title: String,
    options: List<Pair<String, String>>,
    current: String,
    onPick: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                for ((value, label) in options) {
                    Row(
                        Modifier.fillMaxWidth().clickable { onPick(value) }.padding(vertical = 10.dp),
                        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = value == current, onClick = { onPick(value) })
                        Text(label, modifier = Modifier.padding(start = 6.dp))
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** Calls [onShake] on a firm shake while the screen is in front. */
@Composable
fun ShakeDetector(enabled: Boolean, onShake: () -> Unit) {
    if (!enabled) return
    val context = LocalContext.current
    val currentOnShake by rememberUpdatedState(onShake)
    DisposableEffect(Unit) {
        val manager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        val sensor = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        var lastShake = 0L
        var hits = 0
        var firstHitAt = 0L
        val listener = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                val (x, y, z) = Triple(event.values[0], event.values[1], event.values[2])
                val g = sqrt(x * x + y * y + z * z) / SensorManager.GRAVITY_EARTH
                if (g < 2.6f) return
                val now = System.currentTimeMillis()
                if (now - firstHitAt > 800) { hits = 0; firstHitAt = now }
                hits++
                // Two strong jolts within 0.8s; ignore repeats for 2s
                if (hits >= 2 && now - lastShake > 2000) { lastShake = now; hits = 0; currentOnShake() }
            }
            override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
        }
        if (sensor != null) manager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_UI)
        onDispose { manager.unregisterListener(listener) }
    }
}
