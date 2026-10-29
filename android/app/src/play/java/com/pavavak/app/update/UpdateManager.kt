package com.pavavak.app.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import com.pavavak.app.BuildConfig
import com.pavavak.app.data.ApiClient
import com.pavavak.app.data.AppRelease
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Play-flavor stub. On Google Play, updates are delivered by the Play Store, so this build
 * never downloads or installs an APK itself (Play policy forbids it). It keeps the same public
 * surface as the sideload [UpdateManager] so the shared UI compiles unchanged: it simply reports
 * "up to date" and, if asked to update, opens the app's Play Store page.
 */
class UpdateManager(private val context: Context, @Suppress("UNUSED_PARAMETER") api: ApiClient) {

    sealed interface Status {
        data object Idle : Status
        data object Checking : Status
        data class Downloading(val percent: Int) : Status
        data object Verifying : Status
        data object NeedsPermission : Status
        data class Failed(val message: String) : Status
    }

    private val _available = MutableStateFlow<AppRelease?>(null)
    val available: StateFlow<AppRelease?> = _available.asStateFlow()

    private val _status = MutableStateFlow<Status>(Status.Idle)
    val status: StateFlow<Status> = _status.asStateFlow()

    private val _upToDate = MutableStateFlow(false)
    val upToDate: StateFlow<Boolean> = _upToDate.asStateFlow()

    private val _mandatory = MutableStateFlow(false)
    val mandatory: StateFlow<Boolean> = _mandatory.asStateFlow()

    val currentVersionName: String get() = BuildConfig.VERSION_NAME

    /** No in-app update prompt on Play — the Store handles updates. */
    suspend fun check(): AppRelease? {
        _available.value = null
        _upToDate.value = true
        return null
    }

    fun dismiss() {
        _available.value = null
        _upToDate.value = false
    }

    /** Send the user to the Play Store listing rather than self-installing. */
    suspend fun downloadAndInstall(release: AppRelease) {
        val pkg = context.packageName
        val market = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$pkg"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val web = Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$pkg"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { context.startActivity(market) }
            .onFailure { runCatching { context.startActivity(web) } }
    }
}
