package com.pavavak.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pavavak.app.data.AppLock
import com.pavavak.app.data.SettingsStore
import com.pavavak.app.data.User
import com.pavavak.app.ui.theme.PavaColors
import kotlinx.coroutines.launch

private enum class Step { Welcome, Pin, Biometric, Theme, Done }

/** First-run setup after sign-in: app lock, fingerprint and theme. Every step can be skipped. */
@Composable
fun OnboardingScreen(user: User, settingsStore: SettingsStore, lock: AppLock, onFinish: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val settings by settingsStore.values.collectAsStateWithLifecycle()
    val bioAvailable = remember { biometricAvailable(context) }
    var step by remember { mutableStateOf(Step.Welcome) }
    var pinSet by remember { mutableStateOf(lock.hasPin()) }
    val steps = Step.entries
    val index = steps.indexOf(step)

    fun next() {
        step = when (step) {
            Step.Welcome -> Step.Pin
            Step.Pin -> if (bioAvailable) Step.Biometric else Step.Theme
            Step.Biometric -> Step.Theme
            Step.Theme -> Step.Done
            Step.Done -> Step.Done
        }
    }
    BackHandler(enabled = step != Step.Welcome) {
        step = when (step) {
            Step.Theme -> if (bioAvailable) Step.Biometric else Step.Pin
            Step.Biometric -> Step.Pin
            Step.Done -> Step.Theme
            else -> Step.Welcome
        }
    }

    Column(Modifier.fillMaxSize().background(PavaColors.Background).safeDrawingPadding().padding(horizontal = 24.dp, vertical = 16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for (i in steps.indices) Box(
                Modifier.weight(1f).height(4.dp).clip(CircleShape)
                    .background(if (i <= index) PavaColors.Accent else PavaColors.SurfaceHigh),
            )
        }
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(Modifier.height(28.dp))
            when (step) {
                Step.Welcome -> {
                    Hero(Icons.Filled.Shield, "Welcome, ${user.displayName.substringBefore(' ')}",
                        "This app keeps your one-to-one chats private. Let's take a minute to lock it down and make it yours.")
                    Bullet("Photos and videos only load when you tap them")
                    Bullet("View-once messages and disappearing chats")
                    Bullet("PIN and fingerprint lock, with a disguise icon")
                }
                Step.Pin -> {
                    if (pinSet) {
                        Hero(Icons.Filled.Lock, "PIN is set", "You'll enter it each time you open the app.")
                    } else {
                        Text("Set an app PIN", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = PavaColors.TextPrimary)
                        Spacer(Modifier.height(6.dp))
                        Text("Nobody can open your chats without it, even with your phone unlocked.",
                            color = PavaColors.TextMuted, textAlign = TextAlign.Center)
                        Spacer(Modifier.height(24.dp))
                        PinSetupFlow { pin -> scope.launch { lock.setPin(pin); pinSet = true; next() } }
                    }
                }
                Step.Biometric -> {
                    Hero(Icons.Filled.Fingerprint, "Unlock with fingerprint", "Use your fingerprint or face instead of typing the PIN.")
                    if (settings.biometricEnabled) Text("✓ Fingerprint unlock is on", color = PavaColors.Accent, fontWeight = FontWeight.SemiBold)
                    else Button(onClick = {
                        val activity = context.findActivity() ?: return@Button
                        promptBiometric(activity, "Confirm fingerprint", "Turn on fingerprint unlock", onSuccess = {
                            settingsStore.setBiometricEnabled(true); settingsStore.setLockEnabled(true); next()
                        }, onError = { if (it != null) context.toast(it) })
                    }) { Text("Turn on fingerprint unlock") }
                }
                Step.Theme -> {
                    Hero(Icons.Filled.Palette, "Pick a look", "You can change it any time in Settings.")
                    ThemePicker(settings.themeId) { settingsStore.setTheme(it) }
                }
                Step.Done -> {
                    Hero(Icons.Filled.TaskAlt, "You're all set", buildString {
                        append(if (lock.isConfigured()) "App lock is on. " else "App lock is off — you can turn it on in Settings. ")
                        append("Long-press any message for reactions, reply, forward, pin and more.")
                    })
                }
            }
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            if (step == Step.Pin && !pinSet || step == Step.Biometric && !settings.biometricEnabled) {
                TextButton(onClick = { next() }) { Text("Skip", color = PavaColors.TextMuted) }
            }
            Spacer(Modifier.weight(1f))
            if (step != Step.Pin || pinSet) Button(
                onClick = { if (step == Step.Done) { settingsStore.setOnboarded(true); onFinish() } else next() },
                colors = ButtonDefaults.buttonColors(containerColor = PavaColors.Accent, contentColor = PavaColors.OnAccent),
            ) { Text(if (step == Step.Done) "Start chatting" else if (step == Step.Welcome) "Get started" else "Next") }
        }
    }
}

@Composable
private fun Hero(icon: ImageVector, title: String, text: String) {
    Box(Modifier.size(88.dp).clip(CircleShape).background(PavaColors.Accent.copy(alpha = 0.15f)), contentAlignment = Alignment.Center) {
        Icon(icon, null, tint = PavaColors.Accent, modifier = Modifier.size(44.dp))
    }
    Spacer(Modifier.height(20.dp))
    Text(title, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = PavaColors.TextPrimary, textAlign = TextAlign.Center)
    Spacer(Modifier.height(8.dp))
    Text(text, color = PavaColors.TextMuted, textAlign = TextAlign.Center)
    Spacer(Modifier.height(24.dp))
}

@Composable
private fun Bullet(text: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(PavaColors.Accent))
        Spacer(Modifier.size(12.dp))
        Text(text, color = PavaColors.TextPrimary)
    }
}
