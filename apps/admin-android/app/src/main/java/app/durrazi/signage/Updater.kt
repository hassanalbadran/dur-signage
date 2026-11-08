package app.durrazi.signage

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Checks the project's GitHub releases. A newer admin app is downloaded in the background and the person is notified.
 * The release also carries the screen app: its location is announced to the screens through the backend.
 */
object Updater {
    const val ADMIN_ASSET = "signage-admin.apk"
    const val SCREEN_ASSET = "signage-screen.apk"

    @Volatile var state = "none"      // none | checking | downloading | ready | uptodate | error
    @Volatile var percent = 0
    @Volatile var tag = ""
    @Volatile var notes = ""
    var listener: ((String) -> Unit)? = null

    private fun dir(context: Context): File = File(context.filesDir, "updates").apply { mkdirs() }
    private fun apk(context: Context): File = File(dir(context), "admin-update.apk")

    fun stateJson(): String {
        val json = JSONObject()
        json.put("state", state).put("pct", percent).put("v", tag).put("notes", notes)
        return json.toString()
    }

    private fun publish(newState: String) {
        state = newState
        listener?.invoke(stateJson())
    }

    private fun numberOf(tagName: String): Int = tagName.substringAfterLast('.').filter { it.isDigit() }.toIntOrNull() ?: 0

    /** Blocking. [notify] is true from the background worker. */
    fun check(context: Context, notify: Boolean) {
        if (BuildConfig.GITHUB_REPO.isEmpty()) { publish("error"); return }
        if (state == "downloading") return
        publish("checking")

        try {
            val response = Net.request(
                "GET", "https://api.github.com/repos/" + BuildConfig.GITHUB_REPO + "/releases/latest",
                mapOf("Accept" to "application/vnd.github+json")
            )
            if (!response.ok) { publish("error"); return }

            val release = response.json()
            tag = release.optString("tag_name", "")
            notes = release.optString("body", "").substringBefore("<!--end-->").trim()
            val remote = numberOf(tag)

            val assets = release.optJSONArray("assets")
            var admin: JSONObject? = null
            var screen: JSONObject? = null
            if (assets != null) {
                for (i in 0 until assets.length()) {
                    val asset = assets.getJSONObject(i)
                    if (asset.optString("name") == ADMIN_ASSET) admin = asset
                    if (asset.optString("name") == SCREEN_ASSET) screen = asset
                }
            }

            announceScreen(context, screen, remote)

            if (admin == null || remote <= BuildConfig.VERSION_CODE) {
                apk(context).delete()
                publish("uptodate")
                return
            }
            download(context, admin, notify)
        } catch (e: Exception) {
            publish("error")
        }
    }

    private fun digestOf(asset: JSONObject): String = asset.optString("digest", "").removePrefix("sha256:")

    /** Tells the screens (through the backend) where the new screen app is. Silent when not signed in. */
    private fun announceScreen(context: Context, screen: JSONObject?, number: Int) {
        if (screen == null || !Prefs.getBool("announce", true) || Prefs.email.isEmpty()) return
        try {
            val info = JSONObject()
            info.put("v", number).put("name", tag).put("url", screen.getString("browser_download_url"))
            info.put("size", screen.optLong("size", 0L)).put("sha", digestOf(screen)).put("notes", notes)
            Backend.call(context, "admin.cfg.set", JSONObject().put("screenUpdate", info))
        } catch (e: Exception) {
            // not signed in yet or no network: the next check tries again
        }
    }

    private fun download(context: Context, asset: JSONObject, notify: Boolean) {
        val file = apk(context)
        val size = asset.optLong("size", 0L)
        val sha = digestOf(asset)

        if (file.exists() && valid(file, size, sha)) { publish("ready"); return }

        file.delete()
        percent = 0
        publish("downloading")

        val connection = URL(asset.getString("browser_download_url")).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 20000
            connection.readTimeout = 30000
            connection.instanceFollowRedirects = true
            val total = if (size > 0) size else connection.contentLengthLong
            var done = 0L
            var last = 0L

            connection.inputStream.use { input ->
                FileOutputStream(file).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        output.write(buffer, 0, read)
                        done += read
                        val now = System.currentTimeMillis()
                        if (now - last > 800 && total > 0) {
                            last = now
                            percent = (done * 100 / total).toInt()
                            listener?.invoke(stateJson())
                        }
                    }
                }
            }
        } finally {
            connection.disconnect()
        }

        if (!valid(file, size, sha)) {
            file.delete()
            publish("error")
            return
        }
        percent = 100
        publish("ready")
        if (notify) {
            Notif.show(context, Notif.CH_UPDATE, Notif.ID_UPDATE, Msg.t("Update ready", "تحديث جاهز"), Msg.t("Open the app to install $tag", "افتحي التطبيق لتثبيت $tag"))
        }
    }

    private fun valid(file: File, size: Long, sha: String): Boolean {
        if (size > 0 && file.length() != size) return false
        if (sha.isEmpty()) return file.length() > 0
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        val hex = StringBuilder()
        for (b in digest.digest()) hex.append(String.format("%02x", b.toInt() and 0xff))
        return hex.toString().equals(sha, ignoreCase = true)
    }

    fun install(activity: Activity) {
        val file = apk(activity)
        if (!file.exists()) return

        if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
            val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.packageName))
            activity.startActivity(intent)
            return
        }
        val uri = FileProvider.getUriForFile(activity, activity.packageName + ".fileprovider", file)
        val intent = Intent(Intent.ACTION_VIEW)
        intent.setDataAndType(uri, "application/vnd.android.package-archive")
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        activity.startActivity(intent)
    }

    fun clearCache(context: Context) {
        apk(context).delete()
        if (state == "ready") publish("none")
    }
}
