package app.durrazi.screen

import android.content.Context
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.webkit.MimeTypeMap
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Tiny loopback HTTP server (127.0.0.1 only). It serves:
 *  /app/FILE     the screen UI from APK assets
 *  /shared/FILE  shared css/js/fonts/icons from APK assets
 *  /media/ID  downloaded media files (with HTTP Range, so video seeking/looping works on any WebView)
 *  /saf/KEY   files from a folder chosen through the system picker (USB drives etc.)
 *  /fs?p=...  files from a path chosen in the built-in browser fallback
 */
class LocalServer(private val ctx: Context) {
    companion object { const val PORT = 38917 }

    private var ss: ServerSocket? = null
    private val pool = Executors.newCachedThreadPool()
    val mediaDir: File = File(ctx.filesDir, "media").apply { mkdirs() }
    val safMap = ConcurrentHashMap<String, Uri>()

    fun start() {
        try {
            val s = ServerSocket()
            s.reuseAddress = true
            s.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), PORT), 64)
            ss = s
        } catch (e: Exception) { return }
        val t = Thread {
            while (true) {
                try {
                    val c = ss!!.accept()
                    pool.execute { handle(c) }
                } catch (e: Exception) { break }
            }
        }
        t.isDaemon = true
        t.start()
    }

    fun stop() { try { ss?.close() } catch (_: Exception) {} }

    private fun readLine(i: InputStream): String? {
        val sb = StringBuilder()
        while (true) {
            val b = i.read()
            if (b == -1) return if (sb.isEmpty()) null else sb.toString()
            if (b == '\n'.code) break
            if (b != '\r'.code) sb.append(b.toChar())
        }
        return sb.toString()
    }

    private fun handle(s: Socket) {
        try {
            s.soTimeout = 60000
            val inp = BufferedInputStream(s.getInputStream())
            val out = BufferedOutputStream(s.getOutputStream(), 64 * 1024)
            val req = readLine(inp) ?: return
            val parts = req.split(" ")
            if (parts.size < 2) return
            val headers = HashMap<String, String>()
            while (true) {
                val l = readLine(inp) ?: break
                if (l.isEmpty()) break
                val i = l.indexOf(':')
                if (i > 0) headers[l.substring(0, i).trim().lowercase()] = l.substring(i + 1).trim()
            }
            var path = parts[1]
            val q = path.indexOf('?')
            val query = if (q >= 0) path.substring(q + 1) else ""
            if (q >= 0) path = path.substring(0, q)
            path = Uri.decode(path)
            route(parts[0], path, query, headers["range"], out)
            out.flush()
        } catch (_: Exception) {
        } finally {
            try { s.close() } catch (_: Exception) {}
        }
    }

    private fun route(method: String, path: String, query: String, range: String?, out: OutputStream) {
        when {
            path == "/" -> head(out, 302, "Found", mapOf("Location" to "/app/index.html"), 0)
            path.startsWith("/app/") -> asset(out, "web/screen/" + path.removePrefix("/app/"))
            path.startsWith("/shared/") -> asset(out, "web/shared/" + path.removePrefix("/shared/"))
            path.startsWith("/media/") -> {
                val id = path.removePrefix("/media/")
                val f = File(mediaDir, id)
                if (id.contains("/") || id.contains("..") || !f.isFile) notFound(out)
                else serve(out, method, sniff(f), f.length(), range) { s -> FileInputStream(f).also { it.channel.position(s) } }
            }
            path.startsWith("/saf/") -> {
                val u = safMap[path.removePrefix("/saf/")]
                val pfd = if (u == null) null else try { ctx.contentResolver.openFileDescriptor(u, "r") } catch (e: Exception) { null }
                if (u == null || pfd == null) notFound(out)
                else {
                    val len = pfd.statSize
                    pfd.close()
                    val mt = ctx.contentResolver.getType(u) ?: "application/octet-stream"
                    serve(out, method, mt, len, range) { s ->
                        val p2 = ctx.contentResolver.openFileDescriptor(u, "r")!!
                        ParcelFileDescriptor.AutoCloseInputStream(p2).also { it.channel.position(s) }
                    }
                }
            }
            path == "/fs" -> {
                val p = query.split("&").firstOrNull { it.startsWith("p=") }?.substring(2)?.let { Uri.decode(it) }
                val f = if (p != null) File(p) else null
                val cp = try { f?.canonicalPath ?: "" } catch (e: Exception) { "" }
                if (f == null || !f.isFile || !(cp.startsWith("/storage") || cp.startsWith("/mnt") || cp.startsWith("/sdcard"))) notFound(out)
                else serve(out, method, mime(f.name), f.length(), range) { s -> FileInputStream(f).also { it.channel.position(s) } }
            }
            else -> notFound(out)
        }
    }

    private fun mime(name: String): String {
        val ext = name.substringAfterLast('.', "").lowercase()
        return when (ext) {
            "html" -> "text/html; charset=utf-8"
            "js" -> "application/javascript; charset=utf-8"
            "css" -> "text/css; charset=utf-8"
            "json" -> "application/json"
            "woff2" -> "font/woff2"
            "svg" -> "image/svg+xml"
            "mkv" -> "video/x-matroska"
            else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
        }
    }

    // downloaded media has no extension, so detect the type from the first bytes
    private fun sniff(f: File): String {
        val b = ByteArray(16)
        val n = try { FileInputStream(f).use { it.read(b) } } catch (e: Exception) { 0 }
        fun at(i: Int, s: String) = n >= i + s.length && String(b, i, s.length, Charsets.ISO_8859_1) == s
        return when {
            at(4, "ftyp") -> "video/mp4"
            n >= 4 && b[0] == 0x1A.toByte() && b[1] == 0x45.toByte() && b[2] == 0xDF.toByte() && b[3] == 0xA3.toByte() -> "video/webm"
            n >= 2 && b[0] == 0xFF.toByte() && b[1] == 0xD8.toByte() -> "image/jpeg"
            n >= 4 && b[0] == 0x89.toByte() && b[1] == 0x50.toByte() -> "image/png"
            at(0, "GIF8") -> "image/gif"
            at(0, "RIFF") && at(8, "WEBP") -> "image/webp"
            at(0, "%PDF") -> "application/pdf"
            else -> "application/octet-stream"
        }
    }

    private fun head(out: OutputStream, code: Int, msg: String, h: Map<String, String>, len: Long) {
        val sb = StringBuilder("HTTP/1.1 $code $msg\r\n")
        for ((k, v) in h) sb.append(k).append(": ").append(v).append("\r\n")
        sb.append("Content-Length: ").append(len).append("\r\nConnection: close\r\n\r\n")
        out.write(sb.toString().toByteArray())
    }

    private fun notFound(out: OutputStream) = head(out, 404, "Not Found", emptyMap(), 0)

    private fun asset(out: OutputStream, p: String) {
        val clean = p.split("/").filter { it != ".." }.joinToString("/")
        val bytes = try { ctx.assets.open(clean).use { it.readBytes() } } catch (e: Exception) { return notFound(out) }
        head(out, 200, "OK", mapOf("Content-Type" to mime(clean), "Cache-Control" to "no-cache"), bytes.size.toLong())
        out.write(bytes)
    }

    private fun serve(out: OutputStream, method: String, mime: String, len: Long, range: String?, open: (Long) -> InputStream) {
        var start = 0L
        var end = len - 1
        var code = 200
        var msg = "OK"
        if (range != null && range.startsWith("bytes=") && len > 0) {
            val r = range.substring(6).split("-")
            try {
                if (r[0].isNotEmpty()) {
                    start = r[0].toLong()
                    if (r.size > 1 && r[1].isNotEmpty()) end = r[1].toLong()
                } else if (r.size > 1) {
                    start = maxOf(0L, len - r[1].toLong())
                }
            } catch (_: Exception) {}
            if (start >= len) { head(out, 416, "Range Not Satisfiable", mapOf("Content-Range" to "bytes */$len"), 0); return }
            if (end >= len) end = len - 1
            code = 206; msg = "Partial Content"
        }
        val n = if (len > 0) end - start + 1 else 0L
        val h = mutableMapOf("Content-Type" to mime, "Accept-Ranges" to "bytes", "Cache-Control" to "no-cache")
        if (code == 206) h["Content-Range"] = "bytes $start-$end/$len"
        head(out, code, msg, h, n)
        if (method == "HEAD" || n <= 0) return
        open(start).use { ins ->
            val buf = ByteArray(64 * 1024)
            var left = n
            while (left > 0) {
                val r = ins.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
                if (r < 0) break
                out.write(buf, 0, r)
                left -= r
            }
        }
    }
}
