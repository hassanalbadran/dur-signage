package app.durrazi.screen

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Starts the player after the screen powers on. On Android 10+ this needs "Display over other apps" to be allowed (see README). */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        val s = Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { c.startActivity(s) } catch (e: Exception) {}
    }
}
