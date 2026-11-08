package app.durrazi.signage

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.IntentCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

/** Hosts the web UI (from the APK assets) and connects it to Android features. */
class MainActivity : Activity() {
    lateinit var webView: WebView
    private lateinit var bridge: Bridge

    private var webReady = false
    private var shareUris: List<Uri> = emptyList()
    private var gotoTab = ""
    private var gotoUpload = false

    private var pickCallback = ""
    private var pickKind = "video"
    private var pickTargets = "all"
    private var chooser: ValueCallback<Array<Uri>>? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        webView.setBackgroundColor(Color.TRANSPARENT)
        setContentView(webView)

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.mediaPlaybackRequiresUserGesture = false
        settings.textZoom = 100
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                return loader.shouldInterceptRequest(request.url)
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val host = request.url.host ?: ""
                if (host == "appassets.androidplatform.net") return false
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams
            ): Boolean {
                chooser?.onReceiveValue(null)
                chooser = callback
                try {
                    startActivityForResult(params.createIntent(), REQ_CHOOSER)
                } catch (e: Exception) {
                    chooser = null
                    return false
                }
                return true
            }
        }

        bridge = Bridge(this)
        webView.addJavascriptInterface(bridge, "NativeBridge")

        UploadQueue.listener = { json -> emit("upload", "{\"queue\":$json}") }
        Updater.listener = { json -> emit("update", json) }

        handleIntent(intent)
        webView.loadUrl("https://appassets.androidplatform.net/assets/web/admin/index.html")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onDestroy() {
        UploadQueue.listener = null
        Updater.listener = null
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webReady) emit("back", "null") else super.onBackPressed()
    }

    /** Sends an event to the web UI. */
    fun emit(name: String, json: String) {
        runOnUiThread {
            val script = "window.__native&&window.__native.event(" + JSONObject.quote(name) + "," + JSONObject.quote(json) + ")"
            webView.evaluateJavascript(script, null)
        }
    }

    /** The web UI finished booting: deliver anything that arrived before. */
    fun onWebReady() {
        webReady = true
        emit("upload", "{\"queue\":" + UploadQueue.snapshot() + "}")
        deliverPending()
    }

    private fun deliverPending() {
        if (!webReady) return
        if (shareUris.isNotEmpty()) emit("share", "{\"count\":" + shareUris.size + "}")
        if (gotoUpload) { emit("goto", "{\"upload\":true}"); gotoUpload = false }
        if (gotoTab.isNotEmpty()) { emit("goto", "{\"tab\":\"$gotoTab\"}"); gotoTab = "" }
    }

    private fun handleIntent(intent: Intent?) {
        if (intent == null) return

        when (intent.action) {
            Intent.ACTION_SEND -> {
                val uri = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
                if (uri != null) shareUris = listOf(uri)
            }
            Intent.ACTION_SEND_MULTIPLE -> {
                val list = IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
                if (list != null) shareUris = list.toList()
            }
            Intent.ACTION_VIEW -> {
                val data = intent.data
                if (data != null && data.scheme == "durrazi") {
                    OAuth.finish(data) { _, _ -> emit("cloud", "null") }
                }
            }
            "app.durrazi.signage.UPLOAD" -> gotoUpload = true
            "app.durrazi.signage.REMOTE" -> gotoTab = "remote"
        }
        deliverPending()
    }

    /* ---------- sharing from other apps ---------- */

    fun startShare(targets: String) {
        val uris = shareUris
        shareUris = emptyList()
        if (uris.isEmpty()) return
        UploadQueue.add(this, uris, "video", targets)
        UploadService.start(this, uris)
    }

    fun cancelShare() { shareUris = emptyList() }

    /* ---------- file picking ---------- */

    fun pickFiles(kind: String, targets: String, callbackId: String) {
        pickCallback = callbackId
        pickKind = kind
        pickTargets = targets

        val types = when (kind) {
            "image" -> arrayOf("image/*")
            "video" -> arrayOf("video/*")
            else -> arrayOf(
                "application/pdf", "application/vnd.ms-powerpoint",
                "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            )
        }
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
        intent.addCategory(Intent.CATEGORY_OPENABLE)
        intent.type = "*/*"
        intent.putExtra(Intent.EXTRA_MIME_TYPES, types)
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        intent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        startActivityForResult(intent, REQ_PICK)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)

        when (requestCode) {
            GoogleAuth.REQUEST_CODE -> GoogleAuth.onActivityResult(this, resultCode, data)
            REQ_CHOOSER -> {
                val result = WebChromeClient.FileChooserParams.parseResult(resultCode, data)
                chooser?.onReceiveValue(result)
                chooser = null
            }
            REQ_PICK -> {
                val callback = pickCallback
                pickCallback = ""
                val uris = ArrayList<Uri>()
                if (resultCode == RESULT_OK && data != null) {
                    val clip: ClipData? = data.clipData
                    if (clip != null) {
                        for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri)
                    } else if (data.data != null) {
                        uris.add(data.data!!)
                    }
                }
                if (uris.isEmpty()) {
                    if (callback.isNotEmpty()) bridge.reply(callback, false, JSONObject().put("error", "CANCELLED"))
                    return
                }
                for (uri in uris) {
                    try {
                        contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    } catch (e: Exception) {
                        // not every provider offers persistable access; the clip below still grants it to the service
                    }
                }
                UploadQueue.add(this, uris, pickKind, pickTargets)
                UploadService.start(this, uris)
                if (callback.isNotEmpty()) bridge.reply(callback, true, JSONObject())
            }
        }
    }

    /* ---------- notification permission (Android 13+) ---------- */

    fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIF)
        }
    }

    companion object {
        private const val REQ_PICK = 4102
        private const val REQ_CHOOSER = 4103
        private const val REQ_NOTIF = 4104
    }
}
