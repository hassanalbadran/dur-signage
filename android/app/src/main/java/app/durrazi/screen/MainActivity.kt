package app.durrazi.screen

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.StatFs
import android.provider.DocumentsContract
import android.provider.Settings
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Thin full-screen shell around the web UI. All logic is in web/screen/screen.js. */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var server: LocalServer
    private lateinit var dl: Downloader
    private val prefs by lazy { getSharedPreferences("dr", MODE_PRIVATE) }
    private val pickCode = 41

    private fun js(code: String) { runOnUiThread { try { web.evaluateJavascript(code, null) } catch (_: Exception) {} } }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        server = LocalServer(this)
        server.start()
        dl = Downloader(server.mediaDir) { id, done, total, state ->
            js("window.__dl&&window.__dl(${JSONObject.quote(id)},$done,$total,${JSONObject.quote(state)})")
        }
        web = WebView(this)
        web.setBackgroundColor(0xFF141C21.toInt())
        setContentView(web)
        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.mediaPlaybackRequiresUserGesture = false
        s.allowFileAccess = false
        s.cacheMode = WebSettings.LOAD_DEFAULT
        if (Build.VERSION.SDK_INT >= 21) s.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        web.addJavascriptInterface(Bridge(), "Native")
        web.webChromeClient = WebChromeClient()
        web.webViewClient = WebViewClient()
        web.isFocusable = true
        web.requestFocus()
        web.loadUrl("http://127.0.0.1:${LocalServer.PORT}/app/index.html")
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideBars()
    }

    @Suppress("DEPRECATION")
    private fun hideBars() {
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        // never exit: the web UI decides what Back means
        js("window.onNativeBack&&window.onNativeBack()")
    }

    override fun onDestroy() {
        server.stop()
        super.onDestroy()
    }

    override fun onActivityResult(rc: Int, res: Int, data: Intent?) {
        super.onActivityResult(rc, res, data)
        if (rc != pickCode) return
        val u = data?.data
        if (res == RESULT_OK && u != null) {
            try { contentResolver.takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: Exception) {}
            prefs.edit().putString("tree", u.toString()).apply()
            Thread { scanTree(u) }.start()
        } else {
            js("window.__picked&&window.__picked('[]')")
        }
    }

    /* ---------- folder picked through the system picker (USB, SD card, internal) ---------- */
    private fun scanTree(tree: Uri) {
        val out = JSONArray()
        val rootId = DocumentsContract.getTreeDocumentId(tree)
        fun walk(docId: String, depth: Int) {
            val kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId)
            var c: Cursor? = null
            try {
                c = contentResolver.query(
                    kids,
                    arrayOf(
                        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                        DocumentsContract.Document.COLUMN_MIME_TYPE
                    ), null, null, null
                )
                val rows = ArrayList<Triple<String, String, String>>()
                while (c != null && c.moveToNext()) rows.add(Triple(c.getString(0) ?: "", c.getString(1) ?: "", c.getString(2) ?: ""))
                rows.sortBy { r -> r.second.lowercase() }
                for ((id, name, mime) in rows) {
                    if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
                        if (depth < 3) walk(id, depth + 1)
                    } else if ((mime.startsWith("video/") || mime.startsWith("image/")) && out.length() < 500) {
                        val key = "t" + Integer.toHexString(id.hashCode()) + Integer.toHexString(name.hashCode())
                        server.safMap[key] = DocumentsContract.buildDocumentUriUsingTree(tree, id)
                        out.put(JSONObject().put("id", key).put("k", if (mime.startsWith("video/")) "video" else "image")
                            .put("name", name).put("url", "/saf/$key").put("fit", "contain"))
                    }
                }
            } catch (_: Exception) {
            } finally {
                c?.close()
            }
        }
        walk(rootId, 0)
        js("window.__picked&&window.__picked(${JSONObject.quote(out.toString())})")
    }

    private fun hasAllFiles(): Boolean =
        if (Build.VERSION.SDK_INT >= 30) Environment.isExternalStorageManager()
        else if (Build.VERSION.SDK_INT >= 23) checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        else true

    private fun askAllFiles() {
        runOnUiThread {
            try {
                if (Build.VERSION.SDK_INT >= 30) {
                    startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:$packageName")))
                } else if (Build.VERSION.SDK_INT >= 23) {
                    requestPermissions(arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE), 7)
                }
            } catch (_: Exception) {
                try { startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)) } catch (_: Exception) {}
            }
        }
    }

    private val exts = mapOf(
        "mp4" to "video", "m4v" to "video", "mov" to "video", "mkv" to "video", "webm" to "video", "3gp" to "video",
        "jpg" to "image", "jpeg" to "image", "png" to "image", "webp" to "image", "gif" to "image", "bmp" to "image"
    )

    inner class Bridge {
        private fun safe(id: String) = id.isNotEmpty() && !id.contains("/") && !id.contains("..")

        @JavascriptInterface fun getPref(k: String): String = prefs.getString(k, "") ?: ""
        @JavascriptInterface fun setPref(k: String, v: String) { prefs.edit().putString(k, v).apply() }

        @JavascriptInterface fun download(id: String, url: String, size: Long) { if (safe(id)) dl.enqueue(id, url, size) }
        @JavascriptInterface fun deleteMedia(id: String) {
            if (!safe(id)) return
            File(server.mediaDir, id).delete()
            File(server.mediaDir, "$id.part").delete()
        }
        @JavascriptInterface fun listMedia(): String {
            val a = JSONArray()
            val files: Array<File> = server.mediaDir.listFiles() ?: emptyArray()
            for (f in files) {
                if (f.isFile && !f.name.endsWith(".part")) a.put(JSONObject().put("id", f.name).put("size", f.length()))
            }
            return a.toString()
        }
        @JavascriptInterface fun freeBytes(): Long = try { StatFs(server.mediaDir.absolutePath).availableBytes } catch (e: Exception) { 0L }
        @JavascriptInterface fun clearCache() {
            val files: Array<File> = server.mediaDir.listFiles() ?: emptyArray()
            for (f in files) f.delete()
            runOnUiThread { try { web.clearCache(true) } catch (_: Exception) {} }
        }

        @JavascriptInterface fun pickLocal() {
            runOnUiThread {
                try { startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), pickCode) }
                catch (e: ActivityNotFoundException) { js("window.__pickFail&&window.__pickFail()") }
            }
        }

        @JavascriptInterface fun reloadLocal() {
            val u = prefs.getString("tree", null)
            if (u == null) js("window.__picked&&window.__picked('[]')") else Thread { scanTree(Uri.parse(u)) }.start()
        }

        @JavascriptInterface fun listDir(p: String): String {
            val o = JSONObject()
            if (!hasAllFiles()) { askAllFiles(); return o.put("perm", false).put("entries", JSONArray()).toString() }
            val arr = JSONArray()
            val kids: Array<File> = File(p).listFiles() ?: emptyArray()
            for (f in kids.sortedBy { x -> x.name.lowercase() }) {
                if (!f.name.startsWith(".")) arr.put(JSONObject().put("n", f.name).put("d", f.isDirectory).put("p", f.absolutePath))
            }
            return o.put("perm", true).put("entries", arr).toString()
        }

        @JavascriptInterface fun scanDir(p: String): String {
            val out = JSONArray()
            fun walk(d: File, depth: Int) {
                val kids: Array<File> = d.listFiles() ?: emptyArray()
                val list = kids.sortedBy { x -> x.name.lowercase() }
                for (f in list) {
                    if (f.name.startsWith(".")) continue
                    if (f.isDirectory) { if (depth < 3) walk(f, depth + 1) }
                    else {
                        val k = exts[f.name.substringAfterLast('.', "").lowercase()] ?: continue
                        if (out.length() >= 500) return
                        out.put(JSONObject().put("id", "f" + Integer.toHexString(f.absolutePath.hashCode())).put("k", k)
                            .put("name", f.name).put("url", "/fs?p=" + Uri.encode(f.absolutePath)).put("fit", "contain"))
                    }
                }
            }
            walk(File(p), 0)
            return out.toString()
        }
    }
}
