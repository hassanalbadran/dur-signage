package app.durrazi.signage

import android.app.Activity
import android.app.AlertDialog
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import org.json.JSONArray

/** Asks which screen a new remote widget should control. */
class WidgetConfigActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setResult(RESULT_CANCELED)

        val widgetId = intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            ?: AppWidgetManager.INVALID_APPWIDGET_ID
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return }

        val ids = ArrayList<String>()
        val names = ArrayList<String>()
        try {
            val array = JSONArray(Prefs.screens)
            for (i in 0 until array.length()) {
                val row = array.getJSONObject(i)
                ids.add(row.optString("id"))
                names.add(row.optString("name", row.optString("id")))
            }
        } catch (e: Exception) {
            // handled below
        }

        val builder = AlertDialog.Builder(this)
        builder.setTitle(Msg.t("Which screen?", "أي شاشة؟"))
        builder.setOnCancelListener { finish() }

        if (names.isEmpty()) {
            builder.setMessage(Msg.t("Open the app once and link a screen first.", "افتحي التطبيق مرة واحدة واربطي شاشة أولاً."))
            builder.setPositiveButton("OK") { _, _ -> finish() }
        } else {
            builder.setItems(names.toTypedArray()) { _, which ->
                Prefs.putString("widget.$widgetId", ids[which])
                val manager = AppWidgetManager.getInstance(this)
                manager.updateAppWidget(widgetId, RemoteWidget.build(this, widgetId))
                val result = Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
                setResult(RESULT_OK, result)
                finish()
            }
        }
        builder.show()
    }
}
