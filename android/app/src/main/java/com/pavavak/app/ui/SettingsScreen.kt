package com.pavavak.app.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.LockClock
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.Password
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.toBitmap
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pavavak.app.BuildConfig
import com.pavavak.app.data.AppIcons
import com.pavavak.app.data.AppLock
import com.pavavak.app.data.ChatRepository
import com.pavavak.app.data.SessionInfo
import com.pavavak.app.data.SettingsStore
import com.pavavak.app.data.User
import com.pavavak.app.ui.theme.PavaColors
import com.pavavak.app.ui.theme.THEMES
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

val LOCK_TIMERS = listOf(0 to "Immediately", 30 to "After 30 seconds", 60 to "After 1 minute", 300 to "After 5 minutes", 900 to "After 15 minutes")

private enum class SettingsDialog { Name, Password, Timer, LockName, ResetIcon, SignOut, LockOff, CustomIcon }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    repository: ChatRepository, settingsStore: SettingsStore, lock: AppLock, user: User,
    onBack: () -> Unit, onDevices: () -> Unit, onHiddenChats: () -> Unit,
) {
    val settings by settingsStore.values.collectAsStateWithLifecycle()
    // Opened with the decoy PIN: nothing here may reveal or change the real privacy setup
    val decoy by lock.decoy.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var dialog by remember { mutableStateOf<SettingsDialog?>(null) }
    var settingPin by remember { mutableStateOf(false) }
    var hasPin by remember { mutableStateOf(lock.hasPin()) }
    val bioAvailable = remember { biometricAvailable(context) }

    val pickLockIcon = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch {
            val path = withContext(Dispatchers.IO) { runCatching { copyLockIcon(context, uri) }.getOrNull() }
            if (path != null) { settingsStore.setLockIcon(path); settingsStore.setLockIconHidden(false) } else context.toast("Couldn't use that image")
        }
    }

    Scaffold(
        containerColor = PavaColors.Background,
        topBar = {
            TopAppBar(
                title = { Text("Settings", fontWeight = FontWeight.Bold) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = PavaColors.Background),
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).navigationBarsPadding()) {
            // Profile
            Row(Modifier.fillMaxWidth().clickable { dialog = SettingsDialog.Name }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Avatar(user.displayName, size = 64.dp)
                Spacer(Modifier.width(16.dp))
                Column(Modifier.weight(1f)) {
                    Text(user.displayName, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = PavaColors.TextPrimary)
                    Text("@${user.username}" + if (user.isAdmin) " · Admin" else "", color = PavaColors.TextMuted)
                }
                Icon(Icons.Filled.Edit, "Edit name", tint = PavaColors.TextMuted)
            }

            if (!decoy) {
            Section("App lock")
            SwitchRow(Icons.Filled.Lock, "Lock with PIN", if (hasPin) "PIN is set" else "Ask for a 4-digit PIN to open the app", hasPin) { on ->
                if (on) settingPin = true else { lock.removePin(); hasPin = false }
            }
            if (hasPin) Row_(Icons.Filled.Password, "Change PIN", null) { settingPin = true }
            SwitchRow(
                Icons.Filled.Fingerprint, "Unlock with fingerprint",
                if (bioAvailable) "Use your fingerprint or face" else "No fingerprint or face set up on this phone",
                settings.biometricEnabled, enabled = bioAvailable,
            ) { on ->
                if (on) {
                    val activity = context.findActivity() ?: return@SwitchRow
                    promptBiometric(activity, "Confirm fingerprint", "Turn on fingerprint unlock", onSuccess = {
                        settingsStore.setBiometricEnabled(true); settingsStore.setLockEnabled(true)
                    }, onError = { if (it != null) context.toast(it) })
                } else {
                    settingsStore.setBiometricEnabled(false)
                    if (!lock.hasPin()) settingsStore.setLockEnabled(false)
                }
            }
            if (lock.isConfigured() || settings.lockEnabled) {
                Row_(Icons.Filled.Timer, "Auto-lock", LOCK_TIMERS.firstOrNull { it.first == settings.lockTimerSeconds }?.second ?: "Immediately") {
                    dialog = SettingsDialog.Timer
                }
                Row_(Icons.Filled.LockClock, "Lock now", "Lock the app right away") { lock.lockNow() }
                Row_(Icons.Filled.Lock, "Turn off app lock", null, destructive = true) { dialog = SettingsDialog.LockOff }
            }

            PrivacySection(repository, settingsStore, lock, onHiddenChats)
            }

            Section("Lock screen look")
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(56.dp), contentAlignment = Alignment.Center) {
                    if (settings.lockIconHidden) Icon(Icons.Filled.VisibilityOff, null, tint = PavaColors.TextMuted) else LockIcon(settings, 56.dp)
                }
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(settings.lockName, color = PavaColors.TextPrimary, fontWeight = FontWeight.SemiBold)
                    Text("Shown when the app is locked", color = PavaColors.TextMuted, fontSize = 13.sp)
                }
            }
            Row_(Icons.Filled.Edit, "Lock screen name", settings.lockName) { dialog = SettingsDialog.LockName }
            Row_(Icons.Filled.Image, "Lock screen picture", if (settings.lockIconPath != null) "Custom picture" else "Default lock") {
                pickLockIcon.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            }
            if (settings.lockIconPath != null) Row_(Icons.Filled.Image, "Use default picture", null) {
                settings.lockIconPath?.let { File(it).delete() }
                settingsStore.setLockIcon(null)
            }
            SwitchRow(Icons.Filled.VisibilityOff, "Hide picture", "Show only the name on the lock screen", settings.lockIconHidden) {
                settingsStore.setLockIconHidden(it)
            }

            Section("Theme")
            ThemePicker(settings.themeId) { settingsStore.setTheme(it) }

            Section("App icon")
            Text(
                "Disguise how PaVa Vak looks on your home screen. Notifications use the same icon.",
                color = PavaColors.TextMuted, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp),
            )
            AppIconPicker(settings.appIcon) { id ->
                settingsStore.setAppIcon(id)
                AppIcons.apply(context, id)
                context.toast("Icon changed. Your launcher may take a few seconds to update.")
            }
            if (AppIcons.canPinShortcut(context)) {
                Row_(Icons.Filled.Image, "Add a shortcut with your own photo", "Any picture and name you like") { dialog = SettingsDialog.CustomIcon }
            }

            Section("Notifications")
            SwitchRow(Icons.Filled.NotificationsActive, "Message sound", "Play a sound for new messages while the app is open", settings.chime) {
                settingsStore.setChime(it)
            }

            Section("Account")
            if (!decoy) {
                Row_(Icons.Filled.Devices, "Linked devices", "See and sign out other devices") { onDevices() }
                Row_(Icons.Filled.Key, "Change password", null) { dialog = SettingsDialog.Password }
            }
            Row_(Icons.AutoMirrored.Filled.Logout, "Sign out", null, destructive = true) { dialog = SettingsDialog.SignOut }

            Section("About")
            Row_(Icons.Filled.Info, "PaVa Vak for Android", "Version ${BuildConfig.VERSION_NAME}") {}
            Text(
                "🔒 Private and secure by default. Photos and videos only load when you tap them.",
                color = PavaColors.TextMuted, fontSize = 12.sp, modifier = Modifier.padding(16.dp),
            )
            Spacer(Modifier.height(24.dp))
        }
    }

    if (settingPin) PinSetupDialog(
        onDone = { pin -> scope.launch { lock.setPin(pin); hasPin = true; settingPin = false; context.toast("PIN set") } },
        onDismiss = { settingPin = false },
    )

    when (dialog) {
        SettingsDialog.Name -> TextInputDialog("Your name", user.displayName, "Save", maxLength = 40,
            onSave = { name ->
                repository.updateDisplayName(name.trim()) { err -> context.toast(err ?: "Name updated") }
            }, onDismiss = { dialog = null })
        SettingsDialog.LockName -> TextInputDialog("Lock screen name", settings.lockName, "Save", maxLength = 40,
            onSave = { settingsStore.setLockName(it.trim()) }, onDismiss = { dialog = null })
        SettingsDialog.Password -> ChangePasswordDialog(repository) { dialog = null }
        SettingsDialog.Timer -> AlertDialog(
            onDismissRequest = { dialog = null },
            title = { Text("Auto-lock") },
            text = {
                Column {
                    for ((secs, label) in LOCK_TIMERS) Row(
                        Modifier.fillMaxWidth().clickable { settingsStore.setLockTimer(secs); dialog = null }.padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = settings.lockTimerSeconds == secs, onClick = { settingsStore.setLockTimer(secs); dialog = null })
                        Text(label)
                    }
                }
            },
            confirmButton = { TextButton(onClick = { dialog = null }) { Text("Close") } },
        )
        SettingsDialog.LockOff -> ConfirmDialog("Turn off app lock?", "Anyone with your phone will be able to open your chats.", "Turn off",
            destructive = true, onConfirm = { lock.turnOff(); hasPin = false }, onDismiss = { dialog = null })
        SettingsDialog.SignOut -> ConfirmDialog("Sign out?", "Your chats stay on the server. The app lock on this phone is removed.", "Sign out",
            destructive = true, onConfirm = { repository.logout() }, onDismiss = { dialog = null })
        SettingsDialog.CustomIcon -> CustomShortcutDialog { dialog = null }
        SettingsDialog.ResetIcon, null -> Unit
    }
}

private fun copyLockIcon(context: android.content.Context, uri: Uri): String {
    val bitmap = context.contentResolver.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it) } ?: error("unreadable")
    val side = minOf(bitmap.width, bitmap.height)
    val square = android.graphics.Bitmap.createBitmap(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side)
    val scaled = android.graphics.Bitmap.createScaledBitmap(square, 256, 256, true)
    val file = File(context.filesDir, "lock_icon_${System.currentTimeMillis()}.png")
    context.filesDir.listFiles { f -> f.name.startsWith("lock_icon_") }?.forEach { it.delete() }
    file.outputStream().use { scaled.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
    return file.absolutePath
}

@Composable
fun Section(title: String) {
    HorizontalDivider(color = PavaColors.Outline, modifier = Modifier.padding(top = 8.dp))
    Text(title, color = PavaColors.Accent, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
        modifier = Modifier.padding(start = 16.dp, top = 14.dp, bottom = 4.dp))
}

@Composable
fun Row_(icon: ImageVector, title: String, subtitle: String?, destructive: Boolean = false, onClick: () -> Unit) {
    ListItem(
        headlineContent = { Text(title, color = if (destructive) PavaColors.Danger else PavaColors.TextPrimary) },
        supportingContent = subtitle?.let { { Text(it, color = PavaColors.TextMuted) } },
        leadingContent = { Icon(icon, null, tint = if (destructive) PavaColors.Danger else PavaColors.TextMuted) },
        colors = ListItemDefaults.colors(containerColor = PavaColors.Background),
        modifier = Modifier.clickable(onClick = onClick),
    )
}

@Composable
fun SwitchRow(icon: ImageVector, title: String, subtitle: String?, checked: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    ListItem(
        headlineContent = { Text(title, color = if (enabled) PavaColors.TextPrimary else PavaColors.TextMuted) },
        supportingContent = subtitle?.let { { Text(it, color = PavaColors.TextMuted) } },
        leadingContent = { Icon(icon, null, tint = PavaColors.TextMuted) },
        trailingContent = { Switch(checked = checked, onCheckedChange = onChange, enabled = enabled) },
        colors = ListItemDefaults.colors(containerColor = PavaColors.Background),
        modifier = Modifier.clickable(enabled = enabled) { onChange(!checked) },
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ThemePicker(selected: String, onPick: (String) -> Unit) {
    FlowRow(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        for (p in THEMES) {
            val isSelected = p.id == selected
            Column(
                Modifier.width(78.dp).clip(RoundedCornerShape(12.dp)).clickable { onPick(p.id) }.padding(4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    Modifier.size(64.dp).clip(RoundedCornerShape(14.dp))
                        .background(Brush.linearGradient(listOf(p.bg, p.surface)))
                        .border(if (isSelected) 3.dp else 1.dp, if (isSelected) PavaColors.Accent else PavaColors.Outline, RoundedCornerShape(14.dp)),
                ) {
                    Box(Modifier.align(Alignment.TopStart).padding(8.dp).size(width = 30.dp, height = 12.dp).clip(RoundedCornerShape(6.dp)).background(p.bubbleIn))
                    Box(Modifier.align(Alignment.BottomEnd).padding(8.dp).size(width = 30.dp, height = 12.dp).clip(RoundedCornerShape(6.dp)).background(p.bubbleOut))
                    Box(Modifier.align(Alignment.Center).size(10.dp).clip(CircleShape).background(p.accent))
                    if (isSelected) Icon(Icons.Filled.Check, "Selected", tint = p.accent, modifier = Modifier.align(Alignment.TopEnd).padding(4.dp).size(16.dp))
                }
                Text(p.label, fontSize = 12.sp, color = PavaColors.TextPrimary, maxLines = 1)
                Text(if (p.isLight) "Light" else "Dark", fontSize = 10.sp, color = PavaColors.TextMuted, maxLines = 1)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AppIconPicker(selected: String, onPick: (String) -> Unit) {
    val context = LocalContext.current
    FlowRow(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        for (option in AppIcons.OPTIONS) {
            val bitmap = remember(option.id) {
                ContextCompat.getDrawable(context, option.iconRes)?.toBitmap(144, 144)?.asImageBitmap()
            }
            val isSelected = option.id == selected
            Column(
                Modifier.width(72.dp).clip(RoundedCornerShape(12.dp)).clickable { if (!isSelected) onPick(option.id) }.padding(4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(Modifier.size(56.dp).border(if (isSelected) 3.dp else 0.dp, if (isSelected) PavaColors.Accent else PavaColors.Background, CircleShape)
                    .padding(3.dp)) {
                    if (bitmap != null) Image(bitmap, option.label, modifier = Modifier.fillMaxSize().clip(CircleShape))
                }
                Text(option.label, fontSize = 12.sp, color = PavaColors.TextPrimary, maxLines = 1)
            }
        }
    }
}

@Composable
fun TextInputDialog(title: String, initial: String, confirm: String, maxLength: Int, onSave: (String) -> Unit, onDismiss: () -> Unit) {
    var value by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { OutlinedTextField(value, { if (it.length <= maxLength) value = it }, singleLine = true) },
        confirmButton = {
            TextButton(onClick = { onDismiss(); onSave(value) }, enabled = value.isNotBlank()) { Text(confirm) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun ChangePasswordDialog(repository: ChatRepository, onDismiss: () -> Unit) {
    var current by remember { mutableStateOf("") }
    var new by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Change password") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(current, { current = it }, label = { Text("Current password") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation())
                OutlinedTextField(new, { new = it }, label = { Text("New password") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(), supportingText = { Text("At least 8 characters") })
                OutlinedTextField(confirm, { confirm = it }, label = { Text("Confirm new password") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation())
                if (error != null) Text(error!!, color = PavaColors.Danger, fontSize = 13.sp)
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && current.isNotEmpty() && new.length >= 8, onClick = {
                if (new != confirm) { error = "New passwords don't match"; return@TextButton }
                busy = true
                scope.launch {
                    runCatching { repository.api.changePassword(current, new) }
                        .onSuccess { context.toast("Password changed"); onDismiss() }
                        .onFailure { error = it.message ?: "Couldn't change password" }
                    busy = false
                }
            }) { Text("Change") }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("Cancel") } },
    )
}

@Composable
private fun CustomShortcutDialog(onDismiss: () -> Unit) {
    val context = LocalContext.current
    var label by remember { mutableStateOf("") }
    var uri by remember { mutableStateOf<Uri?>(null) }
    val preview = remember(uri) {
        uri?.let { u -> runCatching { context.contentResolver.openInputStream(u)?.use { android.graphics.BitmapFactory.decodeStream(it) }?.asImageBitmap() }.getOrNull() }
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { if (it != null) uri = it }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Shortcut with your photo") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Adds a home-screen shortcut that opens PaVa Vak. For a full disguise, also pick a disguise icon above and remove the original icon from your home screen.",
                    fontSize = 13.sp, color = PavaColors.TextMuted)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(56.dp).clip(CircleShape).background(PavaColors.SurfaceHigh).clickable {
                        pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                    }, contentAlignment = Alignment.Center) {
                        if (preview != null) Image(preview, null, contentScale = androidx.compose.ui.layout.ContentScale.Crop, modifier = Modifier.fillMaxSize())
                        else Icon(Icons.Filled.Image, "Pick a photo", tint = PavaColors.TextMuted)
                    }
                    Spacer(Modifier.width(12.dp))
                    OutlinedTextField(label, { if (it.length <= 24) label = it }, label = { Text("Name") }, singleLine = true)
                }
            }
        },
        confirmButton = {
            TextButton(enabled = uri != null && label.isNotBlank(), onClick = {
                val ok = runCatching { AppIcons.pinCustomShortcut(context, uri!!, label.trim()) }.getOrDefault(false)
                context.toast(if (ok) "Confirm on your home screen to add it" else "Your launcher doesn't allow shortcuts")
                onDismiss()
            }) { Text("Add") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DevicesScreen(repository: ChatRepository, onBack: () -> Unit) {
    var sessions by remember { mutableStateOf<List<SessionInfo>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmAll by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    suspend fun load() {
        runCatching { repository.api.sessions() }.onSuccess { sessions = it; error = null }.onFailure { error = it.message }
    }
    LaunchedEffect(Unit) { load() }
    Scaffold(
        containerColor = PavaColors.Background,
        topBar = {
            TopAppBar(
                title = { Text("Linked devices", fontWeight = FontWeight.Bold) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = PavaColors.Background),
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState())) {
            when {
                error != null -> Text(error!!, color = PavaColors.Danger, modifier = Modifier.padding(16.dp))
                sessions == null -> Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                    androidx.compose.material3.CircularProgressIndicator()
                }
                else -> {
                    for (s in sessions!!) ListItem(
                        headlineContent = { Text(s.deviceName ?: "Unknown device", color = PavaColors.TextPrimary) },
                        supportingContent = {
                            Text(
                                (if (s.isCurrent) "This device" else "Last active ${formatDateTime(s.lastUsedAt)}") + (s.ipAddress?.let { " · $it" } ?: ""),
                                color = if (s.isCurrent) PavaColors.Accent else PavaColors.TextMuted,
                            )
                        },
                        leadingContent = { Icon(Icons.Filled.Devices, null, tint = PavaColors.TextMuted) },
                        trailingContent = {
                            if (!s.isCurrent) TextButton(onClick = {
                                scope.launch {
                                    runCatching { repository.api.revokeSession(s.id) }.onSuccess { load() }
                                        .onFailure { context.toast(it.message ?: "Couldn't sign out that device") }
                                }
                            }) { Text("Sign out", color = PavaColors.Danger) }
                        },
                        colors = ListItemDefaults.colors(containerColor = PavaColors.Background),
                    )
                    if (sessions!!.count { !it.isCurrent } > 0) {
                        TextButton(onClick = { confirmAll = true }, modifier = Modifier.padding(8.dp)) {
                            Text("Sign out everywhere", color = PavaColors.Danger)
                        }
                    }
                }
            }
        }
    }
    if (confirmAll) ConfirmDialog("Sign out everywhere?", "Every phone and browser, including this one, will need to sign in again.", "Sign out all",
        destructive = true, onConfirm = {
            scope.launch {
                runCatching { repository.api.revokeAllSessions() }.onSuccess { repository.logout() }
                    .onFailure { context.toast(it.message ?: "Couldn't sign out devices") }
            }
        }, onDismiss = { confirmAll = false })
}
