package app.durrazi.signage

import android.content.Context
import android.content.SharedPreferences

/** Small app-private key/value store (account, tokens, queue, flags). */
object Prefs {
    private fun sp(): SharedPreferences =
        App.instance.getSharedPreferences("signage", Context.MODE_PRIVATE)

    fun getString(key: String, fallback: String = ""): String = sp().getString(key, fallback) ?: fallback
    fun putString(key: String, value: String) { sp().edit().putString(key, value).apply() }
    fun getLong(key: String, fallback: Long = 0L): Long = sp().getLong(key, fallback)
    fun putLong(key: String, value: Long) { sp().edit().putLong(key, value).apply() }
    fun getBool(key: String, fallback: Boolean): Boolean = sp().getBoolean(key, fallback)
    fun putBool(key: String, value: Boolean) { sp().edit().putBoolean(key, value).apply() }
    fun remove(key: String) { sp().edit().remove(key).apply() }

    var email: String
        get() = getString("email")
        set(value) = putString("email", value)

    var lang: String
        get() = getString("lang", "en")
        set(value) = putString("lang", value)

    var wifiOnly: Boolean
        get() = getBool("wifiOnly", false)
        set(value) = putBool("wifiOnly", value)

    var notifications: Boolean
        get() = getBool("notif", true)
        set(value) = putBool("notif", value)

    /** JSON array of {id, name, rt} copied from the web UI so widgets can work without opening the app. */
    var screens: String
        get() = getString("screens", "[]")
        set(value) = putString("screens", value)
}

/** Bilingual text for notifications and error reasons produced natively. */
object Msg {
    fun t(en: String, ar: String): String = if (Prefs.lang == "ar") ar else en
}
