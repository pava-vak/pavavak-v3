package com.pavavak.app.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.DialogProperties
import com.pavavak.app.data.AppRelease
import com.pavavak.app.ui.theme.PavaColors
import com.pavavak.app.update.UpdateManager

/**
 * Shown when a newer build is published. Offers Update (download + install in place)
 * or Later. While downloading it turns into a progress bar.
 */
@Composable
fun UpdateDialog(update: UpdateManager, release: AppRelease, onDismiss: () -> Unit, onUpdate: () -> Unit) {
    val status by update.status.collectAsState()
    val mandatory by update.mandatory.collectAsState()
    val busy = status is UpdateManager.Status.Downloading || status is UpdateManager.Status.Verifying

    AlertDialog(
        // A required update can't be dismissed by tapping outside or Back
        onDismissRequest = { if (!busy && !mandatory) onDismiss() },
        properties = DialogProperties(dismissOnBackPress = !mandatory, dismissOnClickOutside = !mandatory),
        icon = { Icon(Icons.Filled.SystemUpdate, contentDescription = null, tint = PavaColors.Accent) },
        title = { Text(if (mandatory) "Update required" else "Update available", fontWeight = FontWeight.SemiBold) },
        text = {
            Column {
                val size = if (release.sizeBytes > 0) " · ${(release.sizeBytes / 1048576f).toInt()} MB" else ""
                Text(
                    if (mandatory) "You need to update to version ${release.versionName}$size to keep using the app."
                    else "Version ${release.versionName}$size is ready to install.",
                    color = PavaColors.TextPrimary,
                )
                when (val s = status) {
                    is UpdateManager.Status.Downloading -> {
                        Spacer(Modifier.height(14.dp))
                        if (s.percent >= 0) {
                            LinearProgressIndicator(progress = { s.percent / 100f }, modifier = Modifier.fillMaxWidth())
                            Spacer(Modifier.height(6.dp))
                            Text("Downloading… ${s.percent}%", color = PavaColors.TextMuted, fontSize = 12.sp)
                        } else {
                            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                            Spacer(Modifier.height(6.dp))
                            Text("Downloading…", color = PavaColors.TextMuted, fontSize = 12.sp)
                        }
                    }
                    is UpdateManager.Status.Verifying -> {
                        Spacer(Modifier.height(14.dp))
                        LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                        Spacer(Modifier.height(6.dp))
                        Text("Verifying…", color = PavaColors.TextMuted, fontSize = 12.sp)
                    }
                    is UpdateManager.Status.NeedsPermission -> {
                        Spacer(Modifier.height(10.dp))
                        Text("Allow this app to install apps, then tap Update again.",
                            color = PavaColors.TextMuted, fontSize = 12.sp)
                    }
                    is UpdateManager.Status.Failed -> {
                        Spacer(Modifier.height(10.dp))
                        Text(s.message, color = PavaColors.Danger, fontSize = 12.sp)
                    }
                    else -> {}
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onUpdate, enabled = !busy) {
                Text(if (status is UpdateManager.Status.Failed) "Retry" else "Update")
            }
        },
        dismissButton = if (mandatory) null else {
            { TextButton(onClick = onDismiss, enabled = !busy) { Text("Later") } }
        },
    )
}
