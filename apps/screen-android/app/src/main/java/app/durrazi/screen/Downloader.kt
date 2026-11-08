package app.durrazi.screen

import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Sequential, resumable downloader.
 *
 * A file can live on several clouds, so every download receives a list of URLs and
 * tries them one after another until one works. Files land in dir/<id>
 * (renamed from <id>.part once complete). Events: progress | done | partial | nospace | error | http<code>.
 */
class Downloader(
    private val dir: File,
    private val onEvent: (id: String, done: Long, total: Long, state: String) -> Unit
) {
    private val executor = Executors.newSingleThreadExecutor()
    private val queued = ConcurrentHashMap<String, Boolean>()

    fun enqueue(id: String, urls: List<String>, size: Long) {
        if (queued.putIfAbsent(id, true) != null) return
        executor.execute {
            try {
                runAll(id, urls, size)
            } finally {
                queued.remove(id)
            }
        }
    }

    private fun runAll(id: String, urls: List<String>, size: Long) {
        val finalFile = File(dir, id)

        if (finalFile.exists()) {
            if (size <= 0 || finalFile.length() >= size) {
                onEvent(id, finalFile.length(), finalFile.length(), "done")
                return
            }
            finalFile.delete()
        }

        if (size > 0 && dir.usableSpace < size + MIN_FREE_BYTES) {
            onEvent(id, 0, size, "nospace")
            return
        }

        for (url in urls) {
            if (downloadOne(id, url, size)) return
        }
    }

    /** Returns true when the file is complete. */
    private fun downloadOne(id: String, url: String, size: Long): Boolean {
        val finalFile = File(dir, id)
        val partFile = File(dir, "$id.part")
        var connection: HttpURLConnection? = null

        try {
            var have = if (partFile.exists()) partFile.length() else 0L

            connection = URL(url).openConnection() as HttpURLConnection
            connection.connectTimeout = 20000
            connection.readTimeout = 30000
            connection.instanceFollowRedirects = true
            if (have > 0) connection.setRequestProperty("Range", "bytes=$have-")

            val code = connection.responseCode

            if (code == 416 && partFile.exists()) {         // the partial file was already complete
                partFile.renameTo(finalFile)
                onEvent(id, finalFile.length(), finalFile.length(), "done")
                return true
            }
            if (code == 200) {                               // server ignored the range: start over
                have = 0
                partFile.delete()
            } else if (code != 206) {
                onEvent(id, 0, size, "http$code")
                return false
            }

            val length = connection.getHeaderField("Content-Length")?.toLongOrNull() ?: -1L
            val total = if (length >= 0) have + length else size
            var done = have
            var lastReport = 0L

            connection.inputStream.use { input ->
                FileOutputStream(partFile, have > 0).use { output ->
                    val buffer = ByteArray(128 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        output.write(buffer, 0, read)
                        done += read

                        val now = System.currentTimeMillis()
                        if (now - lastReport > 700) {
                            lastReport = now
                            onEvent(id, done, total, "progress")
                        }
                    }
                }
            }

            if (total > 0 && partFile.length() < total) {
                onEvent(id, partFile.length(), total, "partial")
                return false
            }

            partFile.renameTo(finalFile)
            onEvent(id, finalFile.length(), finalFile.length(), "done")
            return true
        } catch (e: Exception) {
            onEvent(id, if (partFile.exists()) partFile.length() else 0L, size, "error")
            return false
        } finally {
            try { connection?.disconnect() } catch (e: Exception) {}
        }
    }

    companion object {
        private const val MIN_FREE_BYTES = 300L * 1024 * 1024
    }
}
