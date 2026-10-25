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
import java.security.MessageDigest

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

    /**
     * Downloads [release], verifies it, and launches the installer. If the app may not
     * install packages yet, sends the user to that system setting and returns (they
     * tap Update again afterwards).
     */
    suspend fun downloadAndInstall(release: AppRelease) {
        if (!canInstall()) {
            _status.value = Status.NeedsPermission
            requestInstallPermission()
            return
        }
        val file = withContext(Dispatchers.IO) { download(release) } ?: return
        _status.value = Status.Idle
        install(file)
    }

    private fun download(release: AppRelease): File? {
        val dir = File(context.cacheDir, "updates").apply { mkdirs() }
        // Keep one file; overwrite any partial download from before.
        val dest = File(dir, "update.apk")
        val url = if (release.url.startsWith("http")) release.url
        else BuildConfig.API_BASE_URL.trimEnd('/') + "/" + release.url.trimStart('/')
        try {
            _status.value = Status.Downloading(-1)
            val req = Request.Builder().url(url).get().build()
            api.http.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) { fail("Download failed (${resp.code})"); return null }
                val bodyStream = resp.body?.byteStream() ?: run { fail("Empty download"); return null }
                val total = if (release.sizeBytes > 0) release.sizeBytes else resp.body?.contentLength() ?: -1L
                dest.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    var read: Int
                    var done = 0L
                    var lastPct = -1
                    while (bodyStream.read(buf).also { read = it } != -1) {
                        out.write(buf, 0, read)
                        done += read
                        if (total > 0) {
                            val pct = ((done * 100) / total).toInt().coerceIn(0, 100)
                            if (pct != lastPct) { lastPct = pct; _status.value = Status.Downloading(pct) }
                        }
                    }
                }
            }
        } catch (e: Exception) {
            fail(e.message ?: "Download failed"); return null
        }
        // Verify integrity when the server gave us a hash.
        if (!release.sha256.isNullOrBlank()) {
            _status.value = Status.Verifying
            val actual = sha256Of(dest)
            if (!actual.equals(release.sha256, ignoreCase = true)) {
                dest.delete(); fail("Downloaded file was corrupted"); return null
            }
        }
        return dest
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
