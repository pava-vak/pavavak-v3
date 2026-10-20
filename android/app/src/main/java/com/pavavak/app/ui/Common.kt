package com.pavavak.app.ui

import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pavavak.app.ui.theme.PavaColors
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.time.temporal.ChronoUnit
import java.util.Locale

private val avatarPalette = listOf(
    Color(0xFF0EA5E9), Color(0xFF8B5CF6), Color(0xFF10B981), Color(0xFFF59E0B),
    Color(0xFFEF4444), Color(0xFFEC4899), Color(0xFF14B8A6), Color(0xFF6366F1),
)

@Composable
fun Avatar(name: String, size: Dp = 46.dp, online: Boolean = false) {
    val letter = name.trim().firstOrNull()?.uppercaseChar()?.toString() ?: "?"
    val color = avatarPalette[(name.hashCode() and Int.MAX_VALUE) % avatarPalette.size]
    Box {
        Box(
            modifier = Modifier.size(size).clip(CircleShape).background(color.copy(alpha = 0.85f)),
            contentAlignment = Alignment.Center,
        ) {
            Text(letter, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = (size.value * 0.42f).sp)
        }
        if (online) {
            Box(
                Modifier.align(Alignment.BottomEnd).size(size * 0.28f).clip(CircleShape)
                    .background(PavaColors.Background).padding(2.dp),
            ) { Box(Modifier.fillMaxSize().clip(CircleShape).background(PavaColors.Online)) }
        }
    }
}

@Composable
fun SplashScreen() {
    Box(Modifier.fillMaxSize().background(PavaColors.Background), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = PavaColors.Accent)
    }
}

@Composable
fun ConfirmDialog(
    title: String,
    text: String,
    confirmLabel: String,
    destructive: Boolean = false,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = {
            TextButton(onClick = { onDismiss(); onConfirm() }) {
                Text(confirmLabel, color = if (destructive) PavaColors.Danger else PavaColors.Accent)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

fun Context.toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_SHORT).show()

private val zone: ZoneId get() = ZoneId.systemDefault()
private val timeFormat = DateTimeFormatter.ofPattern("h:mm a", Locale.getDefault())
private val dayMonthFormat = DateTimeFormatter.ofPattern("d MMM", Locale.getDefault())
private val fullDateFormat = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.getDefault())
private val shortDateTime = DateTimeFormatter.ofPattern("d MMM, h:mm a", Locale.getDefault())

fun parseInstant(iso: String?): Instant? = iso?.let { runCatching { Instant.parse(it) }.getOrNull() }

fun formatTime(iso: String?): String =
    parseInstant(iso)?.atZone(zone)?.format(timeFormat)?.lowercase(Locale.getDefault()).orEmpty()

fun formatDateTime(iso: String?): String =
    parseInstant(iso)?.atZone(zone)?.format(shortDateTime)?.replace("AM", "am")?.replace("PM", "pm").orEmpty()

/** Chat list: time for today, "Yesterday", weekday within a week, else date. */
fun formatListTimestamp(iso: String?): String {
    val instant = parseInstant(iso) ?: return ""
    val date = instant.atZone(zone).toLocalDate()
    val today = LocalDate.now(zone)
    return when (val days = ChronoUnit.DAYS.between(date, today)) {
        0L -> formatTime(iso)
        1L -> "Yesterday"
        in 2L..6L -> date.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.getDefault())
        else -> if (days < 365) date.format(dayMonthFormat) else date.format(fullDateFormat)
    }
}

fun formatLastSeen(iso: String?): String {
    val instant = parseInstant(iso) ?: return ""
    val date = instant.atZone(zone).toLocalDate()
    return when (ChronoUnit.DAYS.between(date, LocalDate.now(zone))) {
        0L -> "last seen today at ${formatTime(iso)}"
        1L -> "last seen yesterday at ${formatTime(iso)}"
        else -> "last seen ${date.format(dayMonthFormat)} at ${formatTime(iso)}"
    }
}

fun dayLabel(date: LocalDate): String {
    val today = LocalDate.now(zone)
    return when (ChronoUnit.DAYS.between(date, today)) {
        0L -> "Today"
        1L -> "Yesterday"
        else -> date.format(fullDateFormat)
    }
}

fun localDateOf(iso: String?): LocalDate? = parseInstant(iso)?.atZone(zone)?.toLocalDate()

/** "⏱ 5m" style remaining time for disappearing messages. */
fun remainingLabel(iso: String?): String? {
    val end = parseInstant(iso) ?: return null
    val secs = ChronoUnit.SECONDS.between(Instant.now(), end).coerceAtLeast(0)
    return when {
        secs < 3600 -> "${(secs / 60).coerceAtLeast(1)}m"
        secs < 86_400 -> "${secs / 3600}h"
        else -> "${secs / 86_400}d"
    }
}
