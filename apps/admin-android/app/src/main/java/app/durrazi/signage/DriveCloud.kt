package app.durrazi.signage

import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream
import java.net.URLEncoder

/** Google Drive (default provider): resumable uploads into one app folder, files shared as "anyone with the link". */
class DriveCloud : Cloud {
    override val id = "drive"
    override val title = "Google Drive"

    private val api = "https://www.googleapis.com/drive/v3"
    private val chunkSize = 8 * 1024 * 1024

    override fun isConnected(): Boolean = Prefs.email.isNotEmpty()
    override fun email(): String = Prefs.email

    private fun auth(): Map<String, String> =
        mapOf("Authorization" to "Bearer " + GoogleAuth.silentToken(App.instance))

    private fun check(response: HttpResult): HttpResult {
        if (response.ok) return response
        val message = response.json().optJSONObject("error")
        val reason = message?.optJSONArray("errors")?.optJSONObject(0)?.optString("reason", "") ?: ""
        if (reason == "storageQuotaExceeded") throw CloudException("quota", Msg.t("Google Drive storage is full", "مساحة كوكل درايف ممتلئة"))
        if (response.code == 401) { GoogleAuth.invalidate(); throw CloudException("auth", "AUTH") }
        if (response.code == 403) throw CloudException("http", Msg.t("Google refused the request (check the Drive API settings)", "رفضت كوكل الطلب (راجعي إعدادات Drive API)"))
        throw CloudException("http", "HTTP " + response.code)
    }

    override fun quota(): LongArray? {
        return try {
            val response = check(Net.request("GET", "$api/about?fields=storageQuota", auth()))
            val quota = response.json().optJSONObject("storageQuota") ?: return null
            longArrayOf(quota.optLong("usage", 0L), quota.optLong("limit", 0L))
        } catch (e: Exception) {
            null
        }
    }

    private fun folderId(): String {
        val saved = Prefs.getString("driveFolder")
        if (saved.isNotEmpty()) return saved

        val query = "name='DurAlRazi Signage' and mimeType='application/vnd.google-apps.folder' and trashed=false"
        val search = check(Net.request("GET", "$api/files?q=" + URLEncoder.encode(query, "UTF-8") + "&fields=files(id)&spaces=drive", auth()))
        val files = search.json().optJSONArray("files")
        if (files != null && files.length() > 0) {
            val found = files.getJSONObject(0).getString("id")
            Prefs.putString("driveFolder", found)
            return found
        }

        val meta = JSONObject().put("name", "DurAlRazi Signage").put("mimeType", "application/vnd.google-apps.folder")
        val created = check(Net.postJson("$api/files?fields=id", meta, auth()))
        val newId = created.json().getString("id")
        Prefs.putString("driveFolder", newId)
        return newId
    }

    override fun upload(input: InputStream, name: String, mime: String, size: Long, progress: (Long) -> Unit): Remote {
        if (size <= 0) throw CloudException("http", Msg.t("The file is empty", "الملف فارغ"))

        val meta = JSONObject().put("name", name).put("parents", JSONArray().put(folderId()))
        val headers = HashMap<String, String>(auth())
        headers["Content-Type"] = "application/json; charset=UTF-8"
        headers["X-Upload-Content-Type"] = mime
        headers["X-Upload-Content-Length"] = size.toString()

        val start = check(
            Net.request(
                "POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id",
                headers, meta.toString().toByteArray(Charsets.UTF_8)
            )
        )
        val session = start.headers["location"] ?: throw CloudException("http", "No upload session")

        val buffer = ByteArray(chunkSize)
        var offset = 0L
        var fileId = ""

        while (offset < size) {
            val filled = Chunks.read(input, buffer)
            if (filled <= 0) throw CloudException("http", Msg.t("The file ended early", "انتهى الملف قبل اكتماله"))
            val body = if (filled == buffer.size) buffer else buffer.copyOf(filled)
            val last = offset + filled - 1

            val response = Chunks.retry(6) {
                val h = mapOf("Content-Range" to "bytes $offset-$last/$size", "Content-Type" to mime)
                val r = Net.request("PUT", session, h, body, 120000)
                if (r.code == 308 || r.ok) r
                else if (r.code >= 500 || r.code == 429 || r.code == 408) throw CloudException("http", "HTTP " + r.code)
                else check(r)
            }

            offset += filled
            progress(offset)
            if (response.ok) fileId = response.json().optString("id", "")
        }

        if (fileId.isEmpty()) throw CloudException("http", "Upload did not finish")
        share(fileId)
        return Remote("drive", fileId, "")
    }

    private fun share(fileId: String) {
        val permission = JSONObject().put("role", "reader").put("type", "anyone")
        check(Net.postJson("$api/files/$fileId/permissions", permission, auth()))
    }

    /** Copies a PowerPoint file into Google Slides so the screen can show it with full fidelity. */
    fun convertToSlides(fileId: String, name: String): String {
        val meta = JSONObject()
            .put("mimeType", "application/vnd.google-apps.presentation")
            .put("name", name)
            .put("parents", JSONArray().put(folderId()))
        val copy = check(Net.postJson("$api/files/$fileId/copy?fields=id", meta, auth()))
        val slidesId = copy.json().getString("id")
        share(slidesId)
        return slidesId
    }

    override fun disconnect() {
        GoogleAuth.signOut()
        Prefs.remove("driveFolder")
    }
}
