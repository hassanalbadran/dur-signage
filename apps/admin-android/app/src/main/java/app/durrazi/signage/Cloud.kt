package app.durrazi.signage

import java.io.InputStream

/** Where one copy of an uploaded file lives. url is empty for Google Drive (the id is enough). */
class Remote(val provider: String, val id: String, val url: String)

/** A storage provider. Every upload is mirrored to all connected providers. */
interface Cloud {
    val id: String
    val title: String
    fun isConnected(): Boolean
    fun email(): String

    /** Returns [used, total] in bytes, or null when the provider does not say. */
    fun quota(): LongArray?

    fun upload(input: InputStream, name: String, mime: String, size: Long, progress: (Long) -> Unit): Remote
    fun disconnect()
}

object Clouds {
    val drive = DriveCloud()
    val dropbox = OAuthCloud.dropbox()
    val onedrive = OAuthCloud.onedrive()

    fun all(): List<Cloud> = listOf(drive, dropbox, onedrive)
    fun connected(): List<Cloud> = all().filter { it.isConnected() }
    fun byId(id: String): Cloud? = all().firstOrNull { it.id == id }
}

/** Reads a stream in fixed-size chunks and retries a failed chunk without re-reading the stream. */
object Chunks {
    fun read(input: InputStream, buffer: ByteArray): Int {
        var filled = 0
        while (filled < buffer.size) {
            val read = input.read(buffer, filled, buffer.size - filled)
            if (read < 0) break
            filled += read
        }
        return filled
    }

    /** Runs [action] up to [tries] times, waiting longer after every failure. Auth/quota errors are not retried. */
    fun <T> retry(tries: Int, action: () -> T): T {
        var attempt = 0
        while (true) {
            try {
                return action()
            } catch (e: CloudException) {
                if (e.kind == "auth" || e.kind == "quota" || e.kind == "config") throw e
                attempt++
                if (attempt >= tries) throw e
            } catch (e: java.io.IOException) {
                attempt++
                if (attempt >= tries) throw CloudException("net", "NET")
            }
            try {
                Thread.sleep(1500L * attempt * attempt)
            } catch (e: InterruptedException) {
                throw CloudException("net", "CANCELLED")
            }
        }
    }
}
