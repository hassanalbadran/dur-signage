package app.durrazi.signage

import android.content.Intent
import android.net.Uri
import android.util.Base64
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.concurrent.Executors

/**
 * Single entry point used by the web UI: window.NativeBridge.call(method, argsJson, callbackId).
 * Work runs on a background thread; results return through window.__native.cb(...).
 */
class Bridge(private val activity: MainActivity) {
    private val pool = Executors.newCachedThreadPool()

    @JavascriptInterface
    fun call(method: String, argsJson: String, callbackId: String) {
        pool.execute {
            try {
                val args = try { JSONObject(argsJson) } catch (e: Exception) { JSONObject() }
                val result = dispatch(method, args, callbackId)
                if (result !== DEFERRED) reply(callbackId, true, result)
            } catch (e: CloudException) {
                reply(callbackId, false, JSONObject().put("error", if (e.kind == "forbidden") "not_allowed" else e.message ?: e.kind))
            } catch (e: Exception) {
                reply(callbackId, false, JSONObject().put("error", e.message ?: e.javaClass.simpleName))
            }
        }
    }

    fun reply(callbackId: String, ok: Boolean, value: Any?) {
        val payload = if (value == null) "" else value.toString()
        activity.runOnUiThread {
            val script = "window.__native&&window.__native.cb(" + JSONObject.quote(callbackId) + "," + ok + "," + JSONObject.quote(payload) + ")"
            activity.webView.evaluateJavascript(script, null)
        }
    }

    private fun dispatch(method: String, a: JSONObject, cb: String): Any? {
        when (method) {
            "auth.token" -> {
                val token = GoogleAuth.silentToken(activity)
                return JSONObject().put("token", token).put("email", Prefs.email)
            }
            "auth.signIn" -> {
                activity.runOnUiThread {
                    GoogleAuth.signIn(activity) { error ->
                        if (error == null) reply(cb, true, JSONObject().put("email", Prefs.email))
                        else reply(cb, false, JSONObject().put("error", error))
                    }
                }
                return DEFERRED
            }
            "cloud.list" -> return cloudList()
            "cloud.connect" -> {
                val provider = a.optString("p")
                val config = Providers.config(provider) ?: throw CloudException("config", "Unknown provider")
                activity.runOnUiThread {
                    OAuth.begin(activity, config) { error ->
                        if (error == null) reply(cb, true, JSONObject()) else reply(cb, false, JSONObject().put("error", error))
                    }
                }
                return DEFERRED
            }
            "cloud.disconnect" -> {
                Clouds.byId(a.optString("p"))?.disconnect()
                return JSONObject()
            }
            "upload.pick" -> {
                val targets = a.opt("targets")?.toString() ?: "all"
                activity.runOnUiThread { activity.pickFiles(a.optString("kind", "video"), targets, cb) }
                return DEFERRED
            }
            "upload.retry" -> { UploadQueue.retry(a.optString("id")); UploadService.start(activity, emptyList()); return JSONObject() }
            "upload.cancel" -> { UploadQueue.remove(a.optString("id")); return JSONObject() }
            "upload.clear" -> { UploadQueue.clearDone(); return JSONObject() }
            "upload.dataUrl" -> return uploadDataUrl(a)
            "share.start" -> {
                val targets = a.opt("targets")?.toString() ?: "all"
                activity.runOnUiThread { activity.startShare(targets) }
                return JSONObject()
            }
            "share.cancel" -> { activity.cancelShare(); return JSONObject() }
            "screens.cache" -> {
                val devices = a.optJSONArray("devices") ?: JSONArray()
                Prefs.screens = devices.toString()
                RemoteWidget.updateAll(activity)
                return JSONObject()
            }
            "update.check" -> { Updater.check(activity, false); return JSONObject(Updater.stateJson()) }
            "update.state" -> return JSONObject(Updater.stateJson())
            "update.install" -> { activity.runOnUiThread { Updater.install(activity) }; return JSONObject() }
            "app.version" -> return JSONObject().put("name", BuildConfig.VERSION_NAME).put("code", BuildConfig.VERSION_CODE)
            "app.openUrl" -> {
                val url = a.optString("url")
                if (url.startsWith("https://")) {
                    activity.runOnUiThread { activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
                }
                return JSONObject()
            }
            "app.exit" -> { activity.runOnUiThread { activity.finish() }; return JSONObject() }
            "app.ready" -> { activity.runOnUiThread { activity.onWebReady() }; return JSONObject() }
            "app.notifPerm" -> { activity.runOnUiThread { activity.askNotificationPermission() }; return JSONObject() }
            "app.clearCache" -> {
                Updater.clearCache(activity)
                activity.cacheDir.deleteRecursively()
                return JSONObject()
            }
            "prefs.set" -> {
                if (a.has("wifiOnly")) Prefs.wifiOnly = a.optBoolean("wifiOnly")
                if (a.has("notif")) Prefs.notifications = a.optBoolean("notif")
                if (a.has("lang")) Prefs.lang = a.optString("lang", "en")
                return JSONObject()
            }
        }
        throw CloudException("config", "Unknown method $method")
    }

    private fun cloudList(): JSONArray {
        val list = JSONArray()
        for (cloud in Clouds.all()) {
            val row = JSONObject()
            row.put("p", cloud.id).put("connected", cloud.isConnected()).put("email", cloud.email()).put("def", cloud.id == "drive")
            if (cloud.isConnected()) {
                val quota = cloud.quota()
                if (quota != null) row.put("used", quota[0]).put("total", quota[1])
            }
            list.put(row)
        }
        return list
    }

    /** Text-slide pictures arrive as data: URLs; store them in Google Drive and return the file id. */
    private fun uploadDataUrl(a: JSONObject): JSONObject {
        val dataUrl = a.getString("dataUrl")
        val comma = dataUrl.indexOf(',')
        val head = dataUrl.substring(0, comma)
        val mime = head.removePrefix("data:").substringBefore(';')
        val bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT)
        val ext = if (mime.endsWith("jpeg")) "jpg" else mime.substringAfter('/')
        val name = a.optString("name", "slide") + "-" + System.currentTimeMillis() + "." + ext

        val remote = Chunks.retry(3) { Clouds.drive.upload(ByteArrayInputStream(bytes), name, mime, bytes.size.toLong()) { } }
        return JSONObject().put("id", remote.id).put("size", bytes.size)
    }

    companion object {
        private val DEFERRED = Any()
    }
}
