package app.durrazi.screen

import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/** Sequential resumable downloader. Files land in mediaDir/<id> (renamed from <id>.part when complete). */
class Downloader(private val dir: File, private val onEvent: (String, Long, Long, String) -> Unit) {
    private val ex = Executors.newSingleThreadExecutor()
    private val queued = ConcurrentHashMap<String, Boolean>()

    fun enqueue(id: String, url: String, size: Long) {
        if (queued.putIfAbsent(id, true) != null) return
        ex.execute {
            try { run(id, url, size) } finally { queued.remove(id) }
        }
    }

    private fun run(id: String, url: String, size: Long) {
        val fin = File(dir, id)
        val part = File(dir, "$id.part")
        if (fin.exists()) {
            if (size <= 0 || fin.length() >= size) { onEvent(id, fin.length(), fin.length(), "done"); return }
            fin.delete()
        }
        if (size > 0 && dir.usableSpace < size + 300L * 1024 * 1024) { onEvent(id, 0, size, "nospace"); return }
        var c: HttpURLConnection? = null
        try {
            var have = if (part.exists()) part.length() else 0L
            c = URL(url).openConnection() as HttpURLConnection
            c.connectTimeout = 20000
            c.readTimeout = 30000
            c.instanceFollowRedirects = true
            if (have > 0) c.setRequestProperty("Range", "bytes=$have-")
            val code = c.responseCode
            if (code == 416 && part.exists()) {            // already complete
                part.renameTo(fin); onEvent(id, fin.length(), fin.length(), "done"); return
            }
            if (code == 200) { have = 0; part.delete() }
            else if (code != 206) { onEvent(id, 0, size, "http$code"); return }
            val len = c.getHeaderField("Content-Length")?.toLongOrNull() ?: -1L
            val total = if (len >= 0) have + len else size
            var done = have
            var last = 0L
            c.inputStream.use { ins ->
                FileOutputStream(part, have > 0).use { o ->
                    val buf = ByteArray(128 * 1024)
                    while (true) {
                        val r = ins.read(buf)
                        if (r < 0) break
                        o.write(buf, 0, r)
                        done += r
                        val now = System.currentTimeMillis()
                        if (now - last > 700) { last = now; onEvent(id, done, total, "progress") }
                    }
                }
            }
            if (total > 0 && part.length() < total) { onEvent(id, part.length(), total, "partial"); return }
            part.renameTo(fin)
            onEvent(id, fin.length(), fin.length(), "done")
        } catch (e: Exception) {
            onEvent(id, if (part.exists()) part.length() else 0L, size, "error")
        } finally {
            try { c?.disconnect() } catch (_: Exception) {}
        }
    }
}
