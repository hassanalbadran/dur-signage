package app.durrazi.signage

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONArray
import org.json.JSONObject

/** Handles widget buttons: publishes the command to the screen's instant channel. */
class WidgetReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != RemoteWidget.ACTION) return
        val widgetId = intent.getIntExtra("widgetId", 0)
        var op = intent.getStringExtra("op") ?: return

        val screenId = Prefs.getString("widget.$widgetId")
        val rt = rtOf(screenId)
        if (rt.isEmpty()) return

        // The mute button toggles; the widget remembers which way it went last.
        if (op == "mute") {
            val muted = Prefs.getBool("widget.$widgetId.muted", false)
            op = if (muted) "unmute" else "mute"
            Prefs.putBool("widget.$widgetId.muted", !muted)
        }

        val pending = goAsync()
        val command = op
        Thread {
            try {
                val message = JSONObject().put("id", "w" + System.currentTimeMillis()).put("op", command).put("arg", 0)
                val response = Net.request("POST", BuildConfig.RT_SERVER + "/" + rt, emptyMap(), message.toString().toByteArray(Charsets.UTF_8), 8000)
                if (!response.ok) {
                    Backend.call(context, "admin.rc", JSONObject().put("id", screenId).put("op", command).put("arg", 0))
                }
            } catch (e: Exception) {
                // nothing else to do from a widget
            } finally {
                pending.finish()
            }
        }.start()
    }

    private fun rtOf(screenId: String): String {
        try {
            val array = JSONArray(Prefs.screens)
            for (i in 0 until array.length()) {
                val row = array.getJSONObject(i)
                if (row.optString("id") == screenId) return row.optString("rt", "")
            }
        } catch (e: Exception) {
            // not cached
        }
        return ""
    }
}
