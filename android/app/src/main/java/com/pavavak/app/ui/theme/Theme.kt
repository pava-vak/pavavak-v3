package com.pavavak.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/** Colours for one theme; values mirror the web app's CSS variables (f3/src/styles.css). */
data class Palette(
    val id: String,
    val label: String,
    val isLight: Boolean,
    val bg: Color,
    val surface: Color,
    val field: Color,
    val border: Color,
    val text: Color,
    val muted: Color,
    val accent: Color,
    val onAccent: Color,
    val bubbleOut: Color,
    val bubbleIn: Color,
    val bubbleOutText: Color,
)

private fun c(hex: Long) = Color(hex)
private val WHITE_A07 = Color(0x12FFFFFF)
private val WHITE_A06 = Color(0x0FFFFFFF)
private val BLACK_A08 = Color(0x14000000)

private fun dark(id: String, label: String, bg: Long, surface: Long, text: Long, muted: Long, accent: Long, onAccent: Long,
                 out: Long, inc: Long, outText: Long = 0xFFFFFFFF) =
    Palette(id, label, false, c(bg), c(surface), WHITE_A06, WHITE_A07, c(text), c(muted), c(accent), c(onAccent), c(out), c(inc), c(outText))

private fun light(id: String, label: String, bg: Long, chip: Long, text: Long, muted: Long, accent: Long, out: Long) =
    Palette(id, label, true, c(bg), c(0xFFFFFFFF), c(chip), BLACK_A08, c(text), c(muted), c(accent), c(0xFFFFFFFF), c(out), c(0xFFFFFFFF), c(0xFFFFFFFF))

val THEMES: List<Palette> = listOf(
    dark("midnight", "Midnight", 0xFF0B1326, 0xFF131B2E, 0xFFDAE2FD, 0xFF8F9097, 0xFF38BDF8, 0xFF060E20, 0xFF0369A1, 0xFF1E293B),
    dark("emerald", "Emerald", 0xFF06201B, 0xFF0C2F29, 0xFFECFDF5, 0xFF6AAB93, 0xFF10B981, 0xFF002113, 0xFF064E3B, 0xFF0C2F29),
    dark("sandstone", "Sandstone", 0xFF1C1917, 0xFF292524, 0xFFFEFAE0, 0xFFA89880, 0xFFD4A373, 0xFF1C1917, 0xFF78350F, 0xFF292524, 0xFFFEFAE0),
    dark("royal", "Royal", 0xFF0F172A, 0xFF1E1B4B, 0xFFE0E7FF, 0xFF7C7EA8, 0xFF818CF8, 0xFF0F172A, 0xFF4338CA, 0xFF1E1B4B),
    dark("saffron", "Saffron", 0xFF1F1606, 0xFF2E2008, 0xFFFEF3C7, 0xFF9D8050, 0xFFF59E0B, 0xFF1F1606, 0xFF78350F, 0xFF2E2008),
    dark("marigold", "Marigold", 0xFF24140E, 0xFF381A10, 0xFFFFEDD5, 0xFFA07055, 0xFFFB923C, 0xFF24140E, 0xFF9A3412, 0xFF381A10),
    dark("linen", "Linen", 0xFF090D16, 0xFF1E293B, 0xFFF1F5F9, 0xFF64748B, 0xFFE2E8F0, 0xFF090D16, 0xFF334155, 0xFF1E293B, 0xFFF8FAFC),
    light("linen-lt", "Linen", 0xFFFAF9F6, 0xFFF0EDE8, 0xFF1E2022, 0xFF6C727A, 0xFF1F4E5B, 0xFF1F4E5B),
    light("emerald-lt", "Emerald", 0xFFF4F9F6, 0xFFE8F2ED, 0xFF18241E, 0xFF5A7A68, 0xFF2C694E, 0xFF2C694E),
    light("sandstone-lt", "Sandstone", 0xFFFBF7F0, 0xFFF2EBE0, 0xFF2C2520, 0xFF7A6A58, 0xFFC2824C, 0xFF8A532B),
    light("royal-lt", "Royal", 0xFFF6F7FB, 0xFFECEEF8, 0xFF1E2033, 0xFF6368A0, 0xFF4F46E5, 0xFF4F46E5),
    light("saffron-lt", "Saffron", 0xFFFFFDF5, 0xFFFEF3D0, 0xFF292419, 0xFF7A6238, 0xFFD97706, 0xFFB45309),
    light("marigold-lt", "Marigold", 0xFFFFF8F5, 0xFFFDE8DA, 0xFF2B211E, 0xFF7A5040, 0xFFEA580C, 0xFFEA580C),
)

fun paletteFor(id: String): Palette = THEMES.firstOrNull { it.id == id } ?: THEMES.first()

val LocalPalette = staticCompositionLocalOf { THEMES.first() }

/** Theme-aware colours, read from the active palette. */
object PavaColors {
    val Background: Color @Composable @ReadOnlyComposable get() = LocalPalette.current.bg
    val Surface: Color @Composable @ReadOnlyComposable get() = LocalPalette.current.surface
    val SurfaceHigh: Color @Composable @ReadOnlyComposable get() = LocalPalette.current.field
    val Outline: Color @Composable @ReadOnlyComposable get() = LocalPalette.current.border
    val Accent: Color @Composable @ReadOnlyComposable get() = LocalPalette.current.accent
    val OnAccent: Color @Composable @ReadOnlyComposable get() = LocalPalette.current.onAccent
    val OutgoingBubble: Color @Composable @ReadOnlyComposable get() = LocalPalette.current.bubbleOut
    val IncomingBubble: Color @Composable @ReadOnlyComposable get() = LocalPalette.current.bubbleIn
    val OutgoingText: Color @Composable @ReadOnlyComposable get() = LocalPalette.current.bubbleOutText
    val TextPrimary: Color @Composable @ReadOnlyComposable get() = LocalPalette.current.text
    val TextMuted: Color @Composable @ReadOnlyComposable get() = LocalPalette.current.muted
    val IsLight: Boolean @Composable @ReadOnlyComposable get() = LocalPalette.current.isLight
    val ReadTick = Color(0xFF53BDEB)
    val Danger = Color(0xFFEF4444)
    val Unread = Color(0xFF22C55E)
    val Online = Color(0xFF22C55E)
}

/** Chat wallpapers, same gradients as the web app's Contact Info picker. */
val WALLPAPERS: List<Triple<String, String, Pair<Color, Color>>> = listOf(
    Triple("forest", "Forest", Color(0xFF1A3A2A) to Color(0xFF2D5A3D)),
    Triple("ocean", "Ocean", Color(0xFF1A2A4A) to Color(0xFF2D4A7A)),
    Triple("sunset", "Sunset", Color(0xFF4A1A2A) to Color(0xFF7A3D2D)),
    Triple("slate", "Slate", Color(0xFF1E1E2E) to Color(0xFF2E2E4E)),
    Triple("gold", "Gold", Color(0xFF2A1A0A) to Color(0xFF5A3A1A)),
    Triple("purple", "Purple", Color(0xFF1A0A2A) to Color(0xFF3D1A5A)),
    Triple("teal", "Teal", Color(0xFF0A2A2A) to Color(0xFF1A5A5A)),
)

@Composable
fun PavaTheme(palette: Palette, content: @Composable () -> Unit) {
    val scheme = if (palette.isLight) lightColorScheme(
        primary = palette.accent, onPrimary = palette.onAccent, background = palette.bg, onBackground = palette.text,
        surface = palette.surface, onSurface = palette.text, surfaceVariant = palette.field, onSurfaceVariant = palette.muted,
        outline = palette.border, error = PavaColors.Danger, surfaceContainer = palette.surface,
        surfaceContainerHigh = palette.surface, surfaceContainerHighest = palette.field,
    ) else darkColorScheme(
        primary = palette.accent, onPrimary = palette.onAccent, background = palette.bg, onBackground = palette.text,
        surface = palette.surface, onSurface = palette.text, surfaceVariant = palette.field, onSurfaceVariant = palette.muted,
        outline = palette.border, error = PavaColors.Danger, surfaceContainer = palette.surface,
        surfaceContainerHigh = palette.surface, surfaceContainerHighest = palette.field,
    )
    CompositionLocalProvider(LocalPalette provides palette) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
