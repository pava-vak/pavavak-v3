package com.pavavak.app.data

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * Media never loads on its own: files are fetched only when the user taps, stored in the app's
 * private cache (not visible to other apps), and wiped on sign-out.
 */
class MediaRepository(private val context: Context, private val api: ApiClient) {
    private val dir = File(context.cacheDir, "media").apply { mkdirs() }
    private val locks = ConcurrentHashMap<String, Mutex>()

    fun cached(fileId: String): File? = File(dir, safe(fileId)).takeIf { it.exists() && it.length() > 0 }

    suspend fun file(fileId: String): File {
        cached(fileId)?.let { return it }
        return locks.getOrPut(fileId) { Mutex() }.withLock {
            cached(fileId) ?: File(dir, safe(fileId)).also { api.download(fileId, it) }
        }
    }

    fun clear() {
        dir.listFiles()?.forEach { it.delete() }
    }

    // ── Sending ─────────────────────────────────────────────────────────────

    suspend fun uploadImage(uri: Uri): String = withContext(Dispatchers.IO) {
        val bitmap = decodeScaled(uri, 1920)
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
        bitmap.recycle()
        val bytes = out.toByteArray()
        if (bytes.size > 4_600_000) throw ApiException(413, "That photo is too large to send (max ~4.5 MB)")
        api.uploadImage(Base64.encodeToString(bytes, Base64.NO_WRAP), "image/jpeg")
    }

    suspend fun uploadVideo(uri: Uri): String = withContext(Dispatchers.IO) {
        val mime = context.contentResolver.getType(uri)?.takeIf { it.startsWith("video/") } ?: "video/mp4"
        val tmp = copyToTemp(uri)
        try {
            if (tmp.length() > 100L * 1024 * 1024) throw ApiException(413, "Videos can be up to 100 MB")
            api.uploadVideo(tmp, mime.substringBefore(';'))
        } finally { tmp.delete() }
    }

    /** Returns the message body for a document: "__DOC__:<fileId>:<name>". */
    suspend fun uploadDocument(uri: Uri): String = withContext(Dispatchers.IO) {
        val mime = (context.contentResolver.getType(uri) ?: "application/octet-stream")
            .let { if (it == "application/x-zip-compressed") "application/zip" else it }
        if (mime !in DOCUMENT_TYPES) throw ApiException(400, "This file type can't be sent. Use PDF, Word, Excel, text, CSV or ZIP.")
        val name = displayName(uri).replace(':', '_').take(120)
        val tmp = copyToTemp(uri)
        try {
            if (tmp.length() > 50L * 1024 * 1024) throw ApiException(413, "Files can be up to 50 MB")
            "__DOC__:${api.uploadBinary(tmp, mime)}:$name"
        } finally { tmp.delete() }
    }

    suspend fun uploadVoice(file: File): String = withContext(Dispatchers.IO) {
        try { api.uploadBinary(file, "audio/mp4") } finally { file.delete() }
    }

    // ── Saving to the phone ─────────────────────────────────────────────────

    /** Copies a downloaded file into Pictures / Movies / Downloads. Returns a short location label. */
    suspend fun saveToDevice(fileId: String, kind: String, displayName: String? = null): String = withContext(Dispatchers.IO) {
        val source = file(fileId)
        val ext = fileId.substringAfterLast('.', "bin")
        val ts = System.currentTimeMillis()
        // Neutral, camera-style names in the standard folders — never an app-branded "PaVa" folder
        // or filename, so saved media doesn't give the app away in the phone's Gallery/Files.
        val (collection, folder, mime, prefix) = when (kind) {
            "image" -> Quad(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, Environment.DIRECTORY_PICTURES, mimeFor(ext, "image/jpeg"), "IMG")
            "video" -> Quad(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, Environment.DIRECTORY_MOVIES, mimeFor(ext, "video/mp4"), "VID")
            else -> Quad(
                if (Build.VERSION.SDK_INT >= 29) MediaStore.Downloads.EXTERNAL_CONTENT_URI else MediaStore.Files.getContentUri("external"),
                Environment.DIRECTORY_DOWNLOADS, mimeFor(ext, "application/octet-stream"), "FILE",
            )
        }
        val name = displayName ?: "${prefix}_$ts.$ext"
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            if (Build.VERSION.SDK_INT >= 29) put(MediaStore.MediaColumns.RELATIVE_PATH, folder)
        }
        val target = context.contentResolver.insert(collection, values) ?: throw ApiException(0, "Couldn't save the file")
        context.contentResolver.openOutputStream(target)!!.use { out -> source.inputStream().use { it.copyTo(out) } }
        folder
    }

    private data class Quad<A, B, C, D>(val a: A, val b: B, val c: C, val d: D)

    // ── Helpers ─────────────────────────────────────────────────────────────

    private fun decodeScaled(uri: Uri, maxSide: Int): Bitmap {
        if (Build.VERSION.SDK_INT >= 28) {
            // ImageDecoder applies EXIF rotation for us
            return ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
                val (w, h) = info.size.width to info.size.height
                val scale = maxSide.toFloat() / maxOf(w, h)
                if (scale < 1f) decoder.setTargetSize((w * scale).toInt(), (h * scale).toInt())
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            }
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)!!.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
        val decoded = context.contentResolver.openInputStream(uri)!!.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: throw ApiException(0, "Couldn't read that image")
        val scale = maxSide.toFloat() / maxOf(decoded.width, decoded.height)
        return if (scale < 1f) Bitmap.createScaledBitmap(decoded, (decoded.width * scale).toInt(), (decoded.height * scale).toInt(), true)
        else decoded
    }

    private fun copyToTemp(uri: Uri): File {
        val tmp = File.createTempFile("upload", null, context.cacheDir)
        context.contentResolver.openInputStream(uri)!!.use { input -> tmp.outputStream().use { input.copyTo(it) } }
        return tmp
    }

    private fun displayName(uri: Uri): String =
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        } ?: "Document"

    private fun safe(fileId: String) = fileId.replace(Regex("[^A-Za-z0-9._-]"), "_")

    private fun mimeFor(ext: String, fallback: String) =
        android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.lowercase()) ?: fallback

    companion object {
        val DOCUMENT_TYPES = setOf(
            "application/pdf", "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "text/plain", "application/zip", "text/csv", "application/x-zip-compressed",
        )
    }
}
