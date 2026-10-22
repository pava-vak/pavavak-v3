package com.pavavak.app.push

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.pavavak.app.MainActivity
import com.pavavak.app.PavaApplication
import com.pavavak.app.data.ApiClient
import com.pavavak.app.data.AppIcons
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Firebase token handling. Firebase only exists in builds made with google-services.json;
 * without it every call here quietly does nothing.
 */
class PushManager(private val context: Context, private val api: ApiClient) {
    fun isAvailable(): Boolean = runCatching { FirebaseApp.getApps(context).isNotEmpty() }.getOrDefault(false)

    private suspend fun token(): String? = suspendCancellableCoroutine { cont ->
        runCatching {
            FirebaseMessaging.getInstance().token
                .addOnSuccessListener { cont.resume(it) }
                .addOnFailureListener { cont.resume(null) }
        }.onFailure { cont.resume(null) }
    }

    /** After sign-in: tell the server which device to wake for this account. */
    suspend fun register() {
        if (!isAvailable()) return
        val t = token() ?: return
        runCatching { api.registerFcmToken(t) }
    }

    suspend fun registerToken(token: String) {
        if (isAvailable()) runCatching { api.registerFcmToken(token) }
    }

    /** Before sign-out: stop this phone getting the account's notifications, then drop the token. */
    suspend fun unregister() {
        if (!isAvailable()) return
        val t = token() ?: return
        runCatching { api.unregisterFcmToken(t) }
        runCatching { FirebaseMessaging.getInstance().deleteToken() }
    }
}

object Notifier {
    // Real messages: content hidden on the lock screen. Disguised notices: shown in full, because the
    // content is already fake and showing it completes the disguise.
    private const val CHANNEL_MSG = "messages"
    private const val CHANNEL_DISGUISE = "alerts"
    const val EXTRA_CHAT_ID = "open_chat_id"

    // When a disguise icon is on, all alerts collapse into this one id so they look like a single
    // app notice (e.g. one weather update) instead of a stack of identical messages.
    private const val DISGUISE_ID = 7_314_000
    private val DISGUISE_ICONS = setOf("weather", "clock", "notes", "calculator")

    /**
     * For a disguise icon, a plausible generic notice under that app's name — never "new message".
     * Labels are generic category words, not any real product. Returns null for the real icon.
     */
    private fun disguiseNotice(iconId: String): Pair<String, String>? {
        if (iconId !in DISGUISE_ICONS) return null
        val (title, lines) = when (iconId) {
            "weather" -> "Weather" to listOf(
                "Partly cloudy · 26°C", "Light rain expected this evening", "Air quality is moderate today",
                "UV index high this afternoon", "Clear skies tonight", "Chance of showers around 5 PM",
            )
            "clock" -> "Clock" to listOf(
                "Alarm set for 7:00 AM", "Bedtime reminder", "Timer finished", "Upcoming alarm in 8 hours",
            )
            "notes" -> "Notes" to listOf(
                "You have an unsaved note", "Note backup completed", "Reminder: review your list", "1 note needs syncing",
            )
            "calculator" -> "Calculator" to listOf(
                "Calculation history saved", "Backup available", "Tap to resume",
            )
            else -> return null
        }
        return title to lines.random()
    }

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        // Neutral channel names so the system settings list doesn't reveal a chat app
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_MSG, "Updates", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "General updates"
                lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
            },
        )
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_DISGUISE, "Alerts", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "App alerts"
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            },
        )
    }

    fun canNotify(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /**
     * Shows "New message" for [chatId], or nothing at all for hidden or muted chats.
     * With app lock on, the sender is never named: only the lock-screen name appears.
     */
    fun showMessage(app: PavaApplication, chatId: String) {
        if (!canNotify(app) || app.isInForeground) return
        val lock = app.lock
        val settings = app.settings.current
        if (chatId in lock.hiddenChats.value) return
        val cached = app.repository.cachedChat(chatId)
        if (cached?.muted == true) return

        ensureChannel(app)
        val disguise = disguiseNotice(settings.appIcon)
        // Disguised alerts share one id (look like one app notice); real alerts are one per chat
        val notifId = if (disguise != null) DISGUISE_ID else chatId.hashCode()
        val title = disguise?.first
            ?: if (lock.isConfigured()) settings.lockName else cached?.title ?: settings.lockName
        val text = disguise?.second ?: "New message"

        val open = Intent(app, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_CHAT_ID, chatId)
        val pending = PendingIntent.getActivity(app, notifId, open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val notification = NotificationCompat.Builder(app, if (disguise != null) CHANNEL_DISGUISE else CHANNEL_MSG)
            .setSmallIcon(AppIcons.notificationIcon(settings.appIcon))
            .setContentTitle(title)
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            // A disguised notice should not be grouped/categorised as a message
            .setCategory(if (disguise != null) NotificationCompat.CATEGORY_RECOMMENDATION else NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(if (disguise != null) NotificationCompat.VISIBILITY_PUBLIC else NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setOnlyAlertOnce(false)
            .setContentIntent(pending)
            .build()
        runCatching { NotificationManagerCompat.from(app).notify(notifId, notification) }
    }

    /** Clears the alert for [chatId] — or the shared disguised alert when a disguise icon is on. */
    fun cancel(context: Context, chatId: String) = runCatching {
        val iconId = (context.applicationContext as? PavaApplication)?.settings?.current?.appIcon ?: "default"
        val id = if (iconId in DISGUISE_ICONS) DISGUISE_ID else chatId.hashCode()
        NotificationManagerCompat.from(context).cancel(id)
    }

    fun cancelAll(context: Context) = runCatching { NotificationManagerCompat.from(context).cancelAll() }
}

/** Receives data-only pushes. The payload is just { type, chatId }; no message content ever arrives here. */
class PavaMessagingService : FirebaseMessagingService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onNewToken(token: String) {
        val app = application as PavaApplication
        if (app.repository.currentUser != null) scope.launch { app.push.registerToken(token) }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val chatId = message.data["chatId"] ?: return
        if (message.data["type"] != "message") return
        val app = application as PavaApplication
        if (app.repository.currentUser == null) return
        scope.launch { Notifier.showMessage(app, chatId) }
    }
}
