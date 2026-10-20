package com.pavavak.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

object PavaColors {
    val Background = Color(0xFF0B1326)
    val Surface = Color(0xFF131C33)
    val SurfaceHigh = Color(0xFF1B2540)
    val Outline = Color(0xFF26314F)
    val Accent = Color(0xFF38BDF8)
    val OutgoingBubble = Color(0xFF0369A1)
    val IncomingBubble = Color(0xFF1B2540)
    val TextPrimary = Color(0xFFE6EAF2)
    val TextMuted = Color(0xFF8F9BB3)
    val ReadTick = Color(0xFF7DD3FC)
    val Danger = Color(0xFFF87171)
    val Unread = Color(0xFF22C55E)
}

private val scheme = darkColorScheme(
    primary = PavaColors.Accent,
    onPrimary = Color(0xFF04263A),
    background = PavaColors.Background,
    onBackground = PavaColors.TextPrimary,
    surface = PavaColors.Surface,
    onSurface = PavaColors.TextPrimary,
    surfaceVariant = PavaColors.SurfaceHigh,
    onSurfaceVariant = PavaColors.TextMuted,
    outline = PavaColors.Outline,
    error = PavaColors.Danger,
)

@Composable
fun PavaTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, content = content)
}
