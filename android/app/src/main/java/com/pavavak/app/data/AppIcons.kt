package com.pavavak.app.data

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import com.pavavak.app.MainActivity
import com.pavavak.app.R

/** Launcher disguises: one activity-alias per icon, exactly one enabled. */
object AppIcons {
    data class Option(val id: String, val label: String, val alias: String, val iconRes: Int)

    val OPTIONS = listOf(
        Option("default", "PaVa Vak", ".LauncherDefault", R.mipmap.ic_launcher),
        Option("calculator", "Calculator", ".LauncherCalculator", R.mipmap.ic_launcher_calculator),
        Option("notes", "Notes", ".LauncherNotes", R.mipmap.ic_launcher_notes),
        Option("clock", "Clock", ".LauncherClock", R.mipmap.ic_launcher_clock),
        Option("weather", "Weather", ".LauncherWeather", R.mipmap.ic_launcher_weather),
    )

    fun apply(context: Context, id: String) {
        val pm = context.packageManager
        val target = OPTIONS.firstOrNull { it.id == id } ?: OPTIONS.first()
        // Enable the new entry first so the app is never left without a launcher icon
        pm.setComponentEnabledSetting(component(context, target.alias), PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
        for (option in OPTIONS) if (option != target) {
            pm.setComponentEnabledSetting(component(context, option.alias), PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
        }
    }

    /** Small monochrome status-bar icon matching the current disguise. */
    fun notificationIcon(id: String): Int = when (id) {
        "calculator" -> R.drawable.ic_stat_calculator
        "notes" -> R.drawable.ic_stat_notes
        "clock" -> R.drawable.ic_stat_clock
        "weather" -> R.drawable.ic_stat_weather
        else -> R.drawable.ic_stat_pava
    }

    fun canPinShortcut(context: Context) = ShortcutManagerCompat.isRequestPinShortcutSupported(context)

    /** Adds a home-screen shortcut with any photo and name the user picks. */
    fun pinCustomShortcut(context: Context, imageUri: Uri, label: String): Boolean {
        val bitmap = context.contentResolver.openInputStream(imageUri)?.use { BitmapFactory.decodeStream(it) } ?: return false
        val side = minOf(bitmap.width, bitmap.height)
        val square = Bitmap.createBitmap(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side)
        val icon = Bitmap.createScaledBitmap(square, 256, 256, true)
        val intent = Intent(context, MainActivity::class.java).setAction(Intent.ACTION_MAIN)
        val shortcut = ShortcutInfoCompat.Builder(context, "custom-${System.currentTimeMillis()}")
            .setShortLabel(label.ifBlank { "PaVa" }.take(24))
            .setIcon(IconCompat.createWithBitmap(icon))
            .setIntent(intent)
            .build()
        return ShortcutManagerCompat.requestPinShortcut(context, shortcut, null)
    }

    private fun component(context: Context, alias: String) = ComponentName(context.packageName, "com.pavavak.app$alias")
}
