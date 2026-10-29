package com.pavavak.app.update

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.pavavak.app.PavaApplication
import com.pavavak.app.data.AppRelease
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json

/**
 * Runs the update download as a foreground service so it keeps going when the app is backgrounded
 * or swipe-closed (an in-app coroutine would be cancelled). It delegates the actual work to
 * [UpdateManager.runDownloadAndInstall] and mirrors its status into a progress notification.
 */
class UpdateDownloadService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var job: Job? = null
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ensureChannel()
        startForegroundCompat(buildNotification("Downloading update", 0, indeterminate = true))
        val app = application as PavaApplication
        val release = intent?.getStringExtra(EXTRA_RELEASE)?.let { runCatching { json.decodeFromString<AppRelease>(it) }.getOrNull() }
        if (release == null || job?.isActive == true) { stopSelf(); return START_NOT_STICKY }

        job = scope.launch {
            val collector = launch {
                app.update.status.collect { st ->
                    when (st) {
                        is UpdateManager.Status.Downloading ->
                            if (st.percent >= 0) notify(buildNotification("Downloading update", st.percent))
                            else notify(buildNotification("Downloading update", 0, indeterminate = true))
                        is UpdateManager.Status.Verifying -> notify(buildNotification("Verifying update", 0, indeterminate = true))
                        else -> {}
                    }
                }
            }
            runCatching { app.update.runDownloadAndInstall(release) }
            collector.cancel()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
        // Redeliver the release if the OS restarts us so an interrupted download resumes.
        return START_REDELIVER_INTENT
    }

    override fun onDestroy() { job?.cancel(); super.onDestroy() }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = getSystemService(NotificationManager::class.java)
        if (mgr.getNotificationChannel(CHANNEL) == null) {
            mgr.createNotificationChannel(
                NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Download progress"
                    setShowBadge(false)
                },
            )
        }
    }

    private fun buildNotification(title: String, percent: Int, indeterminate: Boolean = false): Notification =
        NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(title)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setProgress(100, percent, indeterminate)
            .build()

    private fun notify(n: Notification) =
        runCatching { getSystemService(NotificationManager::class.java).notify(NOTIF_ID, n) }

    private fun startForegroundCompat(n: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            @Suppress("DEPRECATION") startForeground(NOTIF_ID, n)
        }
    }

    companion object {
        private const val CHANNEL = "downloads"
        private const val NOTIF_ID = 7_314_010
        private const val EXTRA_RELEASE = "release_json"

        /** Start the foreground download for [release]. [json] serializes it into the start intent. */
        fun start(context: Context, release: AppRelease, json: Json) {
            val intent = Intent(context, UpdateDownloadService::class.java)
                .putExtra(EXTRA_RELEASE, json.encodeToString(AppRelease.serializer(), release))
            ContextCompat.startForegroundService(context, intent)
        }
    }
}
