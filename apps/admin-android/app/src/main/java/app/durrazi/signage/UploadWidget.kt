package app.durrazi.signage

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/** One-tap shortcut that opens the app straight on the upload sheet. */
class UploadWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        for (id in ids) {
            val intent = Intent(context, MainActivity::class.java)
            intent.action = "app.durrazi.signage.UPLOAD"
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            val pending = PendingIntent.getActivity(context, 1, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

            val views = RemoteViews(context.packageName, R.layout.widget_upload)
            views.setTextViewText(R.id.w_label, Msg.t("Upload", "رفع"))
            views.setOnClickPendingIntent(R.id.w_root, pending)
            manager.updateAppWidget(id, views)
        }
    }
}
