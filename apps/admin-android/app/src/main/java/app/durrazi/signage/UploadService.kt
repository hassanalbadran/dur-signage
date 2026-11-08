package app.durrazi.signage

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * Foreground service that uploads the queue one file at a time, even when the app is closed.
 * Every file goes to all connected clouds, then the library item is saved through the backend.
 */
class UploadService : Service() {
    private var worker: Thread? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var lastNotify = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = Notif.progress(this, Msg.t("Uploading", "جارٍ الرفع"), "", -1)
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(Notif.ID_UPLOAD, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(Notif.ID_UPLOAD, notification)
        }

        if (worker == null || worker?.isAlive != true) {
            val thread = Thread { runQueue() }
            worker = thread
            thread.start()
        }
        return START_NOT_STICKY
    }

    private fun runQueue() {
        val power = getSystemService(Context.POWER_SERVICE) as PowerManager
        val lock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "signage:upload")
        lock.acquire(60 * 60 * 1000L)
        wakeLock = lock

        var finished = 0
        var failed = 0
        var lastError = ""

        try {
            while (true) {
                val job = UploadQueue.next() ?: break
                try {
                    process(job)
                    finished++
                } catch (e: CloudException) {
                    if (UploadQueue.find(job.id) == null) continue   // cancelled by the person
                    job.status = "fail"
                    job.err = describe(e)
                    lastError = job.err
                    failed++
                } catch (e: SecurityException) {
                    job.status = "fail"
                    job.err = Msg.t("Permission to read the file was lost, please pick it again", "فُقدت صلاحية قراءة الملف، اختاريه مرة أخرى")
                    lastError = job.err
                    failed++
                } catch (e: Exception) {
                    job.status = "fail"
                    job.err = e.message ?: Msg.t("Unknown error", "خطأ غير معروف")
                    lastError = job.err
                    failed++
                }
                UploadQueue.changed()
            }
        } finally {
            if (lock.isHeld) lock.release()
        }

        stopForeground(true)
        if (finished > 0 && failed == 0) {
            Notif.show(this, Notif.CH_DONE, Notif.ID_DONE, Msg.t("Upload finished", "اكتمل الرفع"), Msg.t("$finished file(s) added to the library", "أُضيف $finished ملف إلى المكتبة"))
        } else if (failed > 0) {
            Notif.show(this, Notif.CH_DONE, Notif.ID_DONE, Msg.t("Upload failed", "فشل الرفع"), lastError)
        }
        stopSelf()
    }

    private fun describe(e: CloudException): String = when (e.kind) {
        "net" -> Msg.t("No internet connection", "لا يوجد اتصال بالإنترنت")
        "auth" -> Msg.t("Sign-in expired, open the app and sign in again", "انتهت صلاحية تسجيل الدخول، افتحي التطبيق وسجّلي الدخول")
        "nocloud" -> Msg.t("No cloud is connected", "لا توجد سحابة مربوطة")
        "forbidden" -> Msg.t("This account is not allowed to manage the screens", "هذا الحساب غير مصرح له بإدارة الشاشات")
        else -> e.message ?: Msg.t("Unknown error", "خطأ غير معروف")
    }

    private fun waitForWifi(job: Job) {
        while (Prefs.wifiOnly && !Net.onWifi(this)) {
            if (UploadQueue.find(job.id) == null) throw CloudException("net", "CANCELLED")
            job.status = "wait"
            job.err = Msg.t("Waiting for Wi-Fi", "بانتظار شبكة واي فاي")
            UploadQueue.changed()
            try { Thread.sleep(10000) } catch (e: InterruptedException) { throw CloudException("net", "CANCELLED") }
        }
        job.err = ""
    }

    private fun process(job: Job) {
        waitForWifi(job)
        job.status = "up"
        UploadQueue.changed()

        val clouds = Clouds.connected()
        if (clouds.isEmpty()) throw CloudException("nocloud", "No cloud")
        if (job.size <= 0) throw CloudException("http", Msg.t("The file is empty or unreadable", "الملف فارغ أو غير قابل للقراءة"))

        val uri = Uri.parse(job.uri)
        val done = HashMap<String, JSONObject>()
        for (i in 0 until job.remotes.length()) {
            val saved = job.remotes.getJSONObject(i)
            done[saved.getString("p")] = saved
        }

        val total = clouds.size
        for (cloud in clouds) {
            if (done.containsKey(cloud.id)) continue

            val completed = done.size
            val stream = contentResolver.openInputStream(uri)
                ?: throw CloudException("http", Msg.t("Cannot open the file", "تعذر فتح الملف"))
            val remote = stream.use {
                cloud.upload(it, job.name, job.mime, job.size) { sent ->
                    if (UploadQueue.cancelledId == job.id) throw CloudException("net", "CANCELLED")
                    job.done = (completed * job.size + sent) / total
                    tick(job)
                }
            }

            val entry = JSONObject().put("p", remote.provider).put("id", remote.id).put("url", remote.url)
            job.remotes.put(entry)
            done[cloud.id] = entry
            UploadQueue.changed()
        }

        val item = buildItem(job, uri, done)
        Backend.call(this, "admin.item.save", JSONObject().put("item", item))

        job.status = "done"
        job.done = job.size
        job.remotes = JSONArray()
        UploadQueue.changed()
    }

    private fun buildItem(job: Job, uri: Uri, done: Map<String, JSONObject>): JSONObject {
        val sources = JSONArray()
        var primary = ""
        for (entry in done.values) {
            val source = JSONObject().put("p", entry.getString("p"))
            val url = entry.optString("url", "")
            if (url.isEmpty()) source.put("id", entry.getString("id")) else source.put("url", url)
            sources.put(source)
            if (primary.isEmpty()) primary = entry.getString("id")
        }
        val driveId = done["drive"]?.getString("id") ?: ""
        if (driveId.isNotEmpty()) primary = driveId

        val file = JSONObject().put("id", primary).put("size", job.size).put("mime", job.mime).put("src", sources)
        val item = JSONObject()
        item.put("k", job.kind).put("on", true).put("fit", "contain").put("v", System.currentTimeMillis())
        item.put("ts", 0).put("te", 0).put("sched", JSONObject.NULL)
        item.put("targets", parseTargets(job.targets))
        item.put("file", file)

        if (job.kind == "pdf") {
            val pages = try { contentResolver.openInputStream(uri)?.use { Pages.pdf(it) } ?: 0 } catch (e: Exception) { 0 }
            item.put("pages", pages)
        } else if (job.kind == "gslides") {
            if (driveId.isEmpty()) throw CloudException("nocloud", Msg.t("PowerPoint files need Google Drive", "ملفات PowerPoint تحتاج كوكل درايف"))
            val pages = try { contentResolver.openInputStream(uri)?.use { Pages.pptx(it) } ?: 0 } catch (e: Exception) { 0 }
            item.put("sid", Clouds.drive.convertToSlides(driveId, job.name))
            item.put("pages", pages)
        }
        return item
    }

    private fun parseTargets(text: String): Any {
        return try {
            if (text.startsWith("[")) JSONArray(text) else "all"
        } catch (e: Exception) {
            "all"
        }
    }

    private fun tick(job: Job) {
        val now = System.currentTimeMillis()
        if (now - lastNotify < 600) return
        lastNotify = now

        val counts = UploadQueue.counts()
        val percent = if (job.size > 0) (job.done * 100 / job.size).toInt() else -1
        val title = Msg.t("Uploading ", "جارٍ رفع ") + counts[0] + Msg.t(" file(s)", " ملف")
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        manager.notify(Notif.ID_UPLOAD, Notif.progress(this, title, job.name + "  " + percent + "%", percent))
        UploadQueue.listener?.invoke(UploadQueue.snapshot())
    }

    companion object {
        /** [uris] are passed along as a clip so the service keeps read access to shared files. */
        fun start(context: Context, uris: List<Uri>) {
            val intent = Intent(context, UploadService::class.java)
            if (uris.isNotEmpty()) {
                val clip = android.content.ClipData.newRawUri("files", uris[0])
                for (i in 1 until uris.size) clip.addItem(android.content.ClipData.Item(uris[i]))
                intent.clipData = clip
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            ContextCompat.startForegroundService(context, intent)
        }
    }
}
