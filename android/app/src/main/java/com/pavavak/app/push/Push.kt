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
    private const val CHANNEL = "messages"
    const val EXTRA_CHAT_ID = "open_chat_id"

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "Messages", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "New messages"
                lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
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
        val title = if (lock.isConfigured()) settings.lockName else cached?.title ?: settings.lockName
        val open = Intent(app, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_CHAT_ID, chatId)
        val pending = PendingIntent.getActivity(app, chatId.hashCode(), open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val notification = NotificationCompat.Builder(app, CHANNEL)
            .setSmallIcon(AppIcons.notificationIcon(settings.appIcon))
            .setContentTitle(title)
            .setContentText("New message")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setOnlyAlertOnce(false)
            .setContentIntent(pending)
            .build()
        runCatching { NotificationManagerCompat.from(app).notify(chatId.hashCode(), notification) }
    }

    fun cancel(context: Context, chatId: String) = runCatching { NotificationManagerCompat.from(context).cancel(chatId.hashCode()) }

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
