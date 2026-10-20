package com.pavavak.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
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
import java.time.temporal.ChronoUnit
import java.util.Locale

private val avatarPalette = listOf(
    Color(0xFF0EA5E9), Color(0xFF8B5CF6), Color(0xFF10B981), Color(0xFFF59E0B),
    Color(0xFFEF4444), Color(0xFFEC4899), Color(0xFF14B8A6), Color(0xFF6366F1),
)

@Composable
fun Avatar(name: String, size: Dp = 46.dp) {
    val letter = name.trim().firstOrNull()?.uppercaseChar()?.toString() ?: "?"
    val color = avatarPalette[(name.hashCode() and Int.MAX_VALUE) % avatarPalette.size]
    Box(
        modifier = Modifier.size(size).clip(CircleShape).background(color.copy(alpha = 0.85f)),
        contentAlignment = Alignment.Center,
    ) {
        Text(letter, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = (size.value * 0.42f).sp)
    }
}

@Composable
fun SplashScreen() {
    Box(Modifier.fillMaxSize().background(PavaColors.Background), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = PavaColors.Accent)
    }
}

private val zone: ZoneId get() = ZoneId.systemDefault()
private val timeFormat = DateTimeFormatter.ofPattern("h:mm a", Locale.getDefault())
private val dayMonthFormat = DateTimeFormatter.ofPattern("d MMM", Locale.getDefault())
private val fullDateFormat = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.getDefault())

fun parseInstant(iso: String?): Instant? = iso?.let { runCatching { Instant.parse(it) }.getOrNull() }

fun formatTime(iso: String?): String =
    parseInstant(iso)?.atZone(zone)?.format(timeFormat)?.lowercase(Locale.getDefault()).orEmpty()

/** Chat list: time for today, "Yesterday", weekday within a week, else date. */
fun formatListTimestamp(iso: String?): String {
    val instant = parseInstant(iso) ?: return ""
    val date = instant.atZone(zone).toLocalDate()
    val today = LocalDate.now(zone)
    return when (val days = ChronoUnit.DAYS.between(date, today)) {
        0L -> formatTime(iso)
        1L -> "Yesterday"
        in 2L..6L -> date.dayOfWeek.getDisplayName(java.time.format.TextStyle.SHORT, Locale.getDefault())
        else -> if (days < 365) date.format(dayMonthFormat) else date.format(fullDateFormat)
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
