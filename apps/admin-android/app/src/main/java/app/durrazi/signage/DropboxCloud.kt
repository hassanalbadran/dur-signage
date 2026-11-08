package app.durrazi.signage

import org.json.JSONObject
import java.io.InputStream

class DropboxCloud : OAuthCloud("dropbox", "Dropbox") {
    private val chunkSize = 8 * 1024 * 1024

    /** Header values must be ASCII: escape everything else as \\uXXXX. */
    private fun asciiJson(json: JSONObject): String {
        val text = json.toString()
        val out = StringBuilder()
        for (ch in text) {
            if (ch.code < 128) out.append(ch) else out.append(String.format("\\u%04x", ch.code))
        }
        return out.toString()
    }

    private fun content(endpoint: String, arg: JSONObject, body: ByteArray): HttpResult {
        val headers = HashMap<String, String>(auth())
        headers["Dropbox-API-Arg"] = asciiJson(arg)
        headers["Content-Type"] = "application/octet-stream"
        val response = Net.request("POST", "https://content.dropboxapi.com/2/$endpoint", headers, body, 120000)
        if (!response.ok) throw failure(response)
        return response
    }

    private fun rpc(endpoint: String, body: JSONObject?): HttpResult {
        val headers = HashMap<String, String>(auth())
        val response = if (body == null) {
            Net.request("POST", "https://api.dropboxapi.com/2/$endpoint", headers, ByteArray(0))
        } else {
            Net.postJson("https://api.dropboxapi.com/2/$endpoint", body, headers)
        }
        return response
    }

    override fun loadEmail() {
        try {
            val response = rpc("users/get_current_account", null)
            Prefs.putString("dropbox.email", response.json().optString("email", ""))
        } catch (e: Exception) {
            // the address is cosmetic
        }
    }

    override fun quota(): LongArray? {
        return try {
            val json = rpc("users/get_space_usage", null).json()
            val total = json.optJSONObject("allocation")?.optLong("allocated", 0L) ?: 0L
            longArrayOf(json.optLong("used", 0L), total)
        } catch (e: Exception) {
            null
        }
    }

    override fun upload(input: InputStream, name: String, mime: String, size: Long, progress: (Long) -> Unit): Remote {
        if (size <= 0) throw CloudException("http", Msg.t("The file is empty", "الملف فارغ"))
        val buffer = ByteArray(chunkSize)

        var filled = Chunks.read(input, buffer)
        var body = buffer.copyOf(filled)
        val startResponse = Chunks.retry(5) { content("files/upload_session/start", JSONObject().put("close", false), body) }
        val session = startResponse.json().getString("session_id")
        var offset = filled.toLong()
        progress(offset)

        while (size - offset > chunkSize) {
            filled = Chunks.read(input, buffer)
            if (filled <= 0) break
            body = buffer.copyOf(filled)
            val cursor = JSONObject().put("session_id", session).put("offset", offset)
            val current = offset
            Chunks.retry(5) {
                content("files/upload_session/append_v2", JSONObject().put("cursor", cursor).put("close", false), body)
            }
            offset = current + filled
            progress(offset)
        }

        filled = Chunks.read(input, buffer)
        body = buffer.copyOf(filled)
        val cursor = JSONObject().put("session_id", session).put("offset", offset)
        val safeName = name.replace(Regex("[\\\\/:*?\"<>|]"), "_")
        val commit = JSONObject().put("path", "/Dur Al-Razi Signage/$safeName").put("mode", "add").put("autorename", true).put("mute", true)
        val finish = Chunks.retry(5) {
            content("files/upload_session/finish", JSONObject().put("cursor", cursor).put("commit", commit), body)
        }
        progress(size)

        val meta = finish.json()
        val path = meta.optString("path_lower", "")
        return Remote("dropbox", meta.optString("id", path), directLink(path))
    }

    private fun directLink(path: String): String {
        val settings = JSONObject().put("path", path)
        var response = rpc("sharing/create_shared_link_with_settings", settings)
        var url = response.json().optString("url", "")

        if (url.isEmpty() && response.text.contains("shared_link_already_exists")) {
            response = rpc("sharing/list_shared_links", JSONObject().put("path", path).put("direct_only", true))
            val links = response.json().optJSONArray("links")
            if (links != null && links.length() > 0) url = links.getJSONObject(0).optString("url", "")
        }
        if (url.isEmpty()) throw failure(response)

        return if (url.contains("dl=0")) url.replace("dl=0", "raw=1") else url + (if (url.contains("?")) "&" else "?") + "raw=1"
    }
}
