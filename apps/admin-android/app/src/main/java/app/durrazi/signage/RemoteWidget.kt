package app.durrazi.signage

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import org.json.JSONArray

/** Home-screen remote for one chosen screen: previous, play/pause, next, mute. */
class RemoteWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        for (id in ids) manager.updateAppWidget(id, build(context, id))
    }

    override fun onDeleted(context: Context, ids: IntArray) {
        for (id in ids) Prefs.remove("widget.$id")
    }

    companion object {
        const val ACTION = "app.durrazi.signage.WIDGET_OP"

        fun screenName(id: String): String {
            try {
                val array = JSONArray(Prefs.screens)
                for (i in 0 until array.length()) {
                    val row = array.getJSONObject(i)
                    if (row.optString("id") == id) return row.optString("name", id)
                }
            } catch (e: Exception) {
                // no cached screens yet
            }
            return Msg.t("Choose a screen", "اختاري شاشة")
        }

        private fun press(context: Context, widgetId: Int, op: String): PendingIntent {
            val intent = Intent(context, WidgetReceiver::class.java)
            intent.action = ACTION
            intent.data = Uri.parse("signage://widget/$widgetId/$op")
            intent.putExtra("widgetId", widgetId)
            intent.putExtra("op", op)
            return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }

        fun build(context: Context, widgetId: Int): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_remote)
            views.setTextViewText(R.id.w_title, screenName(Prefs.getString("widget.$widgetId")))
            views.setOnClickPendingIntent(R.id.w_prev, press(context, widgetId, "prev"))
            views.setOnClickPendingIntent(R.id.w_toggle, press(context, widgetId, "toggle"))
            views.setOnClickPendingIntent(R.id.w_next, press(context, widgetId, "next"))
            views.setOnClickPendingIntent(R.id.w_mute, press(context, widgetId, "mute"))
            return views
        }

        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, RemoteWidget::class.java))
            for (id in ids) manager.updateAppWidget(id, build(context, id))
        }
    }
}
