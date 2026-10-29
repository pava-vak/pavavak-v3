package com.pavavak.app.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import com.pavavak.app.BuildConfig
import com.pavavak.app.data.ApiClient
import com.pavavak.app.data.AppRelease
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * Checks the server for a newer published build and installs it in place.
 *
 * The web/download host publishes the current build at /download/android.json
 * ({ versionName, versionCode, url, sizeBytes, sha256 }) and the APK at that url.
 * We compare versionCode against this build, download over the app's own TLS
 * client, verify the sha256, then hand the file to the system installer.
 */
class UpdateManager(private val context: Context, private val api: ApiClient) {

    sealed interface Status {
        data object Idle : Status
        data object Checking : Status
        /** Download in progress; [percent] is -1 while the size is unknown. */
        data class Downloading(val percent: Int) : Status
        data object Verifying : Status
        /** Waiting for the user to allow "install unknown apps", then they tap Update again. */
        data object NeedsPermission : Status
        data class Failed(val message: String) : Status
    }

    private val _available = MutableStateFlow<AppRelease?>(null)
    /** The newer release when one exists, else null. Drives the update dialog. */
    val available: StateFlow<AppRelease?> = _available.asStateFlow()

    private val _status = MutableStateFlow<Status>(Status.Idle)
    val status: StateFlow<Status> = _status.asStateFlow()

    /** True right after a manual check that found nothing, so Settings can say "up to date". */
    private val _upToDate = MutableStateFlow(false)
    val upToDate: StateFlow<Boolean> = _upToDate.asStateFlow()

    /** True when this build is below the server's minVersionCode: the update can't be dismissed. */
    private val _mandatory = MutableStateFlow(false)
    val mandatory: StateFlow<Boolean> = _mandatory.asStateFlow()

    val currentVersionName: String get() = BuildConfig.VERSION_NAME

    /**
     * Fetches the latest release and, if its versionCode is higher than this build,
     * exposes it via [available]. Marks it [mandatory] when this build is below the
     * server's minVersionCode. Returns the newer release or null. Never throws.
     */
    suspend fun check(): AppRelease? = withContext(Dispatchers.IO) {
        _upToDate.value = false
        if (_status.value is Status.Downloading || _status.value is Status.Verifying) return@withContext _available.value
        _status.value = Status.Checking
        val latest = runCatching { fetchLatest() }.getOrNull()
        _status.value = Status.Idle
        if (latest != null && latest.versionCode > BuildConfig.VERSION_CODE) {
            _available.value = latest
            _mandatory.value = latest.minVersionCode > BuildConfig.VERSION_CODE
            latest
        } else {
            _available.value = null
            _mandatory.value = false
            _upToDate.value = (latest != null)
            null
        }
    }

    fun dismiss() {
        if (_mandatory.value) return // a required update stays on screen until installed
        _available.value = null
        _upToDate.value = false
        if (_status.value !is Status.Downloading) _status.value = Status.Idle
    }

    private fun fetchLatest(): AppRelease? {
        val url = BuildConfig.API_BASE_URL.trimEnd('/') + "/download/android.json"
        val req = Request.Builder().url(url).get().header("Cache-Control", "no-cache").build()
        api.http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) return null
            val body = resp.body?.string() ?: return null
            return runCatching { api.json.decodeFromString<AppRelease>(body) }.getOrNull()
        }
    }

    // A download-only client: a stall is caught in 60s (vs the shared client's long read
    // timeout) so we can reconnect and resume quickly instead of hanging the whole transfer.
    private val downloadHttp by lazy {
        api.http.newBuilder().readTimeout(60, TimeUnit.SECONDS).build()
    }

    private fun updatesDir() = File(context.cacheDir, "updates").apply { mkdirs() }
    private fun apkFile() = File(updatesDir(), "update.apk")
    private fun partFile() = File(updatesDir(), "update.apk.part")

    /** The fully-downloaded, integrity-checked APK for [release] if we already have it, else null. */
    private fun verifiedFile(release: AppRelease): File? {
        val f = apkFile()
        if (!f.exists() || f.length() == 0L) return null
        if (!release.sha256.isNullOrBlank()) return if (sha256Of(f).equals(release.sha256, ignoreCase = true)) f else null
        if (release.sizeBytes > 0) return if (f.length() == release.sizeBytes) f else null
        return f
    }

    /**
     * UI entry point. If the app can't install packages yet, sends the user to that setting.
     * If the APK is already downloaded and verified, installs it immediately (no re-download).
     * Otherwise hands the download to a foreground service so it keeps going when the app is closed.
     */
    suspend fun downloadAndInstall(release: AppRelease) {
        if (!canInstall()) {
            _status.value = Status.NeedsPermission
            requestInstallPermission()
            return
        }
        verifiedFile(release)?.let { _status.value = Status.Idle; install(it); return }
        UpdateDownloadService.start(context, release, api.json)
    }

    /** The actual work, run inside the foreground service so it survives backgrounding. */
    suspend fun runDownloadAndInstall(release: AppRelease) {
        verifiedFile(release)?.let { _status.value = Status.Idle; installOrNotify(it); return }
        val file = withContext(Dispatchers.IO) { download(release) } ?: return
        _status.value = Status.Idle
        installOrNotify(file)
    }

    /**
     * Downloads [release] to the .part file, auto-retrying through stalls and resuming from
     * where it left off each time (HTTP Range), so a flaky mobile link finishes on its own
     * instead of failing and waiting for the user to keep tapping Retry. Then verifies and
     * promotes it. Only gives up — showing Retry — after several failed attempts in a row.
     */
    private fun download(release: AppRelease): File? {
        val dest = apkFile()
        val part = partFile()
        val url = if (release.url.startsWith("http")) release.url
        else BuildConfig.API_BASE_URL.trimEnd('/') + "/" + release.url.trimStart('/')

        val maxAttempts = 8
        var attempt = 0
        while (true) {
            attempt++
            val complete = runCatching { downloadPass(url, release, part) }
            if (complete.getOrNull() == true) break
            if (attempt >= maxAttempts) {
                fail("Download kept stopping — check your connection and tap Retry.")
                return null
            }
            // Keep the partial file and the last progress visible; back off, then resume.
            _status.value = Status.Downloading(pctOf(part.length(), release))
            val waitMs = (1000L shl (attempt - 1)).coerceAtMost(15_000L) // 1,2,4,8,15,15…s
            try { Thread.sleep(waitMs) } catch (_: InterruptedException) { return null }
        }

        // Verify integrity when the server gave us a hash; only then promote .part to the final file.
        if (!release.sha256.isNullOrBlank()) {
            _status.value = Status.Verifying
            if (!sha256Of(part).equals(release.sha256, ignoreCase = true)) {
                part.delete(); fail("Downloaded file was corrupted"); return null
            }
        }
        dest.delete()
        if (!part.renameTo(dest)) { part.copyTo(dest, overwrite = true); part.delete() }
        return dest
    }

    private fun pctOf(have: Long, release: AppRelease): Int =
        if (release.sizeBytes > 0) ((have * 100) / release.sizeBytes).toInt().coerceIn(0, 100) else -1

    /**
     * One connect-and-stream pass, appending to [part] from where it left off. Returns true when
     * [part] holds the whole file, false if the stream ended short (resume on the next pass);
     * throws on a network error (also a resume).
     */
    private fun downloadPass(url: String, release: AppRelease, part: File): Boolean {
        var have = if (part.exists()) part.length() else 0L
        if (release.sizeBytes > 0 && have >= release.sizeBytes) return true
        _status.value = Status.Downloading(pctOf(have, release))
        val reqB = Request.Builder().url(url).get()
        if (have > 0) reqB.header("Range", "bytes=$have-")
        downloadHttp.newCall(reqB.build()).execute().use { resp ->
            if (resp.code == 200 && have > 0) { have = 0L; part.delete() } // server ignored Range: start over
            if (!resp.isSuccessful) throw IOException("HTTP ${resp.code}")
            val body = resp.body ?: throw IOException("empty response")
            val total = if (release.sizeBytes > 0) release.sizeBytes
                else body.contentLength().let { if (it > 0) it + have else -1L }
            body.byteStream().use { input ->
                java.io.FileOutputStream(part, have > 0).use { out ->
                    val buf = ByteArray(64 * 1024)
                    var read: Int
                    var done = have
                    var lastPct = -1
                    while (input.read(buf).also { read = it } != -1) {
                        out.write(buf, 0, read)
                        done += read
                        if (total > 0) {
                            val pct = ((done * 100) / total).toInt().coerceIn(0, 100)
                            if (pct != lastPct) { lastPct = pct; _status.value = Status.Downloading(pct) }
                        }
                    }
                }
            }
        }
        // Complete only when the whole file is on disk (when we know its size).
        return release.sizeBytes <= 0 || part.length() >= release.sizeBytes
    }

    /** Foreground: open the installer now. Background: post a tap-to-install notification. */
    private fun installOrNotify(file: File) {
        val fg = (context.applicationContext as? com.pavavak.app.PavaApplication)?.isInForeground ?: false
        if (fg) install(file) else com.pavavak.app.push.Notifier.showUpdateReady(context, file)
    }

    private fun install(file: File) {
        runCatching {
            val uri: Uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        }.onFailure { fail("Couldn't open the installer") }
    }

    private fun canInstall(): Boolean =
        runCatching { context.packageManager.canRequestPackageInstalls() }.getOrDefault(false)

    private fun requestInstallPermission() {
        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { context.startActivity(intent) }
    }

    private fun fail(message: String) { _status.value = Status.Failed(message) }

    private fun sha256Of(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            var read: Int
            while (input.read(buf).also { read = it } != -1) md.update(buf, 0, read)
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}
