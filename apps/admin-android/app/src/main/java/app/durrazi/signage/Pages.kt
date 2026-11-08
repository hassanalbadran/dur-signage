package app.durrazi.signage

import java.io.InputStream
import java.util.zip.ZipInputStream

/** Page counting done locally, so the screen can plan how long a slide deck lasts. */
object Pages {
    /** Counts ppt/slides/slideN.xml entries of a .pptx file. */
    fun pptx(input: InputStream): Int {
        var count = 0
        ZipInputStream(input).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                val name = entry.name
                if (name.startsWith("ppt/slides/slide") && name.endsWith(".xml")) count++
            }
        }
        return count
    }

    /** Approximate page count: occurrences of "/Type /Page" that are not "/Type /Pages". */
    fun pdf(input: InputStream): Int {
        val a = "/Type/Page".toByteArray(Charsets.US_ASCII)
        val b = "/Type /Page".toByteArray(Charsets.US_ASCII)
        var count = 0
        val chunk = ByteArray(256 * 1024)
        val tail = ByteArray(16)
        var tailLength = 0

        while (true) {
            val read = input.read(chunk)
            if (read < 0) break
            val window = ByteArray(tailLength + read)
            System.arraycopy(tail, 0, window, 0, tailLength)
            System.arraycopy(chunk, 0, window, tailLength, read)

            count += countIn(window, a) + countIn(window, b)

            tailLength = Math.min(tail.size, window.size)
            System.arraycopy(window, window.size - tailLength, tail, 0, tailLength)
        }
        return count
    }

    private fun countIn(data: ByteArray, pattern: ByteArray): Int {
        var found = 0
        var i = 0
        while (i <= data.size - pattern.size - 1) {
            var match = true
            for (j in pattern.indices) {
                if (data[i + j] != pattern[j]) { match = false; break }
            }
            if (match && data[i + pattern.size] != 's'.code.toByte()) found++
            i++
        }
        return found
    }
}
