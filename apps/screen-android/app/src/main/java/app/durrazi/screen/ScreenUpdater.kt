package app.durrazi.screen

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

/**
 * Screen self-update. The phone app announces a new release; this class downloads the APK in the
 * background, verifies it, and later asks the system installer to install it (user presses OK).
 * The link to the phone and all settings survive the update (same package, same signing key).
 */
class ScreenUpdater(
    private val activity: Activity,
    private val report: (state: String, percent: Int) -> Unit
) {
    private val dir = File(activity.filesDir, "updates").apply { mkdirs() }
    private val apk = File(dir, FILE_NAME)

    private var expectedSha = ""
    private var expectedSize = 0L

    private val downloader = Downloader(dir) { _, done, total, state ->
        if (state == "progress") {
            report("downloading", if (total > 0) (done * 100 / total).toInt() else 0)
        } else if (state == "done") {
            finish()
        } else {
            report("failed", 0)
        }
    }

    fun start(json: String) {
        val info = JSONObject(json)
        expectedSha = info.optString("sha", "")
        expectedSize = info.optLong("size", 0L)

        apk.delete()
        File(dir, "$FILE_NAME.part").delete()
        downloader.enqueue(FILE_NAME, listOf(info.getString("url")), expectedSize)
    }

    private fun finish() {
        val sizeOk = expectedSize <= 0 || apk.length() == expectedSize
        val shaOk = expectedSha.isEmpty() || sha256(apk).equals(expectedSha, ignoreCase = true)

        if (sizeOk && shaOk) {
            report("ready", 100)
        } else {
            apk.delete()
            report("failed", 0)
        }
    }

    fun install() {
        if (!apk.exists()) return

        if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
            val settings = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + activity.packageName)
            )
            activity.startActivity(settings)
            return
        }

        val uri = FileProvider.getUriForFile(activity, activity.packageName + ".fileprovider", apk)
        val intent = Intent(Intent.ACTION_VIEW)
        intent.setDataAndType(uri, "application/vnd.android.package-archive")
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.startActivity(intent)
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        val out = StringBuilder()
        for (b in digest.digest()) out.append("%02x".format(b.toInt() and 0xff))
        return out.toString()
    }

    companion object {
        private const val FILE_NAME = "screen-update.apk"
    }
}
