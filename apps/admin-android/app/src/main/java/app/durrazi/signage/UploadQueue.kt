package app.durrazi.signage

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import org.json.JSONArray
import org.json.JSONObject

class Job(
    val id: String,
    val uri: String,
    var name: String,
    var mime: String,
    var size: Long,
    val kind: String,
    val targets: String
) {
    var status = "wait"
    var done = 0L
    var err = ""
    var remotes = JSONArray()

    fun toJson(): JSONObject {
        val json = JSONObject()
        json.put("id", id).put("uri", uri).put("name", name).put("mime", mime).put("size", size)
        json.put("kind", kind).put("targets", targets).put("status", status).put("done", done)
        json.put("err", err).put("remotes", remotes)
        return json
    }

    /** What the web UI needs to draw the row. */
    fun toUi(): JSONObject {
        val json = JSONObject()
        json.put("id", id).put("name", name).put("kind", kind).put("size", size)
        json.put("done", done).put("status", status).put("err", err)
        return json
    }

    companion object {
        fun fromJson(json: JSONObject): Job {
            val job = Job(
                json.getString("id"), json.getString("uri"), json.optString("name", ""), json.optString("mime", ""),
                json.optLong("size", 0L), json.optString("kind", "video"), json.optString("targets", "\"all\"")
            )
            job.status = json.optString("status", "wait")
            job.done = json.optLong("done", 0L)
            job.err = json.optString("err", "")
            job.remotes = json.optJSONArray("remotes") ?: JSONArray()
            return job
        }
    }
}

/** Persistent upload list shared by the web UI, the foreground service and the share sheet. */
object UploadQueue {
    private val jobs = ArrayList<Job>()
    private var loaded = false
    var listener: ((String) -> Unit)? = null
    @Volatile var cancelledId = ""

    @Synchronized
    private fun ensureLoaded() {
        if (loaded) return
        loaded = true
        try {
            val array = JSONArray(Prefs.getString("queue", "[]"))
            for (i in 0 until array.length()) {
                val job = Job.fromJson(array.getJSONObject(i))
                if (job.status == "up") job.status = "wait"   // the app was killed mid-upload: start over
                jobs.add(job)
            }
        } catch (e: Exception) {
            jobs.clear()
        }
    }

    @Synchronized
    private fun persist() {
        val array = JSONArray()
        for (job in jobs) array.put(job.toJson())
        Prefs.putString("queue", array.toString())
    }

    @Synchronized
    fun snapshot(): String {
        ensureLoaded()
        val array = JSONArray()
        for (job in jobs) array.put(job.toUi())
        return array.toString()
    }

    fun changed() {
        persist()
        listener?.invoke(snapshot())
    }

    @Synchronized
    fun next(): Job? {
        ensureLoaded()
        return jobs.firstOrNull { it.status == "wait" }
    }

    @Synchronized
    fun hasWaiting(): Boolean {
        ensureLoaded()
        return jobs.any { it.status == "wait" }
    }

    @Synchronized
    fun counts(): IntArray {
        ensureLoaded()
        return intArrayOf(jobs.count { it.status == "wait" || it.status == "up" }, jobs.count { it.status == "done" }, jobs.count { it.status == "fail" })
    }

    @Synchronized
    fun find(id: String): Job? {
        ensureLoaded()
        return jobs.firstOrNull { it.id == id }
    }

    fun add(context: Context, uris: List<Uri>, pickedKind: String, targets: String): Int {
        ensureLoaded()
        var added = 0
        for (uri in uris) {
            val job = describe(context, uri, pickedKind, targets) ?: continue
            synchronized(this) { jobs.add(job) }
            added++
        }
        changed()
        return added
    }

    private fun describe(context: Context, uri: Uri, pickedKind: String, targets: String): Job? {
        var name = ""
        var size = 0L
        try {
            context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (nameIndex >= 0) name = cursor.getString(nameIndex) ?: ""
                    if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex)
                }
            }
        } catch (e: Exception) {
            // fall back to the stream length below
        }
        if (size <= 0) {
            try {
                context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { size = it.length }
            } catch (e: Exception) {
                size = 0L
            }
        }
        if (name.isEmpty()) name = uri.lastPathSegment ?: "file"

        val mime = context.contentResolver.getType(uri) ?: ""
        val lower = name.lowercase()
        val kind = when {
            lower.endsWith(".pptx") || lower.endsWith(".ppt") || mime.contains("presentation") || mime.contains("powerpoint") -> "gslides"
            lower.endsWith(".pdf") || mime == "application/pdf" -> "pdf"
            mime.startsWith("image/") -> "image"
            mime.startsWith("video/") -> "video"
            pickedKind == "image" -> "image"
            else -> "video"
        }
        return Job(randomId(), uri.toString(), name, mime.ifEmpty { "application/octet-stream" }, size, kind, targets)
    }

    @Synchronized
    fun retry(id: String) {
        ensureLoaded()
        jobs.firstOrNull { it.id == id && it.status == "fail" }?.let { it.status = "wait"; it.err = "" }
        changed()
    }

    @Synchronized
    fun remove(id: String) {
        ensureLoaded()
        val job = jobs.firstOrNull { it.id == id } ?: return
        if (job.status == "up") cancelledId = id
        jobs.remove(job)
        changed()
    }

    @Synchronized
    fun clearDone() {
        ensureLoaded()
        jobs.removeAll { it.status == "done" }
        changed()
    }

    private fun randomId(): String {
        val chars = "abcdefghijklmnopqrstuvwxyz0123456789"
        val random = java.util.Random()
        val builder = StringBuilder()
        for (i in 0 until 9) builder.append(chars[random.nextInt(chars.length)])
        return builder.toString()
    }
}
