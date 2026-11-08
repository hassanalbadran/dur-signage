package app.durrazi.signage

import android.util.Base64
import org.json.JSONObject
import java.io.InputStream
import java.net.URLEncoder

class OneDriveCloud : OAuthCloud("onedrive", "OneDrive") {
    private val graph = "https://graph.microsoft.com/v1.0"

    // Microsoft requires chunk sizes that are multiples of 320 KiB.
    private val chunkSize = 320 * 1024 * 25

    override fun loadEmail() {
        try {
            val json = Net.request("GET", "$graph/me", auth()).json()
            val mail = json.optString("mail", "")
            Prefs.putString("onedrive.email", if (mail.isNotEmpty()) mail else json.optString("userPrincipalName", ""))
        } catch (e: Exception) {
            // cosmetic only
        }
    }

    override fun quota(): LongArray? {
        return try {
            val json = Net.request("GET", "$graph/me/drive?\$select=quota", auth()).json()
            val quota = json.optJSONObject("quota") ?: return null
            longArrayOf(quota.optLong("used", 0L), quota.optLong("total", 0L))
        } catch (e: Exception) {
            null
        }
    }

    override fun upload(input: InputStream, name: String, mime: String, size: Long, progress: (Long) -> Unit): Remote {
        if (size <= 0) throw CloudException("http", Msg.t("The file is empty", "الملف فارغ"))

        val safeName = name.replace(Regex("[\\\\/:*?\"<>|]"), "_")
        val encoded = URLEncoder.encode(safeName, "UTF-8").replace("+", "%20")
        val body = JSONObject().put("item", JSONObject().put("@microsoft.graph.conflictBehavior", "rename"))
        val created = Net.postJson("$graph/me/drive/root:/Dur%20Al-Razi%20Signage/$encoded:/createUploadSession", body, auth())
        if (!created.ok) throw failure(created)
        val uploadUrl = created.json().getString("uploadUrl")

        val buffer = ByteArray(chunkSize)
        var offset = 0L
        var itemId = ""

        while (offset < size) {
            val filled = Chunks.read(input, buffer)
            if (filled <= 0) throw CloudException("http", Msg.t("The file ended early", "انتهى الملف قبل اكتماله"))
            val data = if (filled == buffer.size) buffer else buffer.copyOf(filled)
            val last = offset + filled - 1

            val response = Chunks.retry(6) {
                val headers = mapOf("Content-Range" to "bytes $offset-$last/$size", "Content-Type" to "application/octet-stream")
                val r = Net.request("PUT", uploadUrl, headers, data, 120000)
                if (r.code == 202 || r.ok) r
                else if (r.code >= 500 || r.code == 429) throw CloudException("http", "HTTP " + r.code)
                else throw failure(r)
            }
            offset += filled
            progress(offset)
            if (response.ok) itemId = response.json().optString("id", "")
        }
        if (itemId.isEmpty()) throw CloudException("http", "Upload did not finish")

        val link = Net.postJson(
            "$graph/me/drive/items/$itemId/createLink",
            JSONObject().put("type", "view").put("scope", "anonymous"), auth()
        )
        val web = link.json().optJSONObject("link")?.optString("webUrl", "") ?: ""
        if (web.isEmpty()) {
            throw CloudException("http", Msg.t("OneDrive did not allow a public link for this account", "لم يسمح OneDrive بإنشاء رابط عام لهذا الحساب"))
        }
        val token = Base64.encodeToString(web.toByteArray(Charsets.UTF_8), Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        return Remote("onedrive", itemId, "https://api.onedrive.com/v1.0/shares/u!$token/root/content")
    }
}
