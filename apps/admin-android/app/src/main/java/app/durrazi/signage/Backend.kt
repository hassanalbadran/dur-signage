package app.durrazi.signage

import android.content.Context
import org.json.JSONObject

/** Calls the Apps Script backend with the person's Google access token. Blocking. */
object Backend {
    fun call(context: Context, action: String, data: JSONObject = JSONObject()): JSONObject {
        if (BuildConfig.GAS_URL.isEmpty()) throw CloudException("config", "Backend address is not configured")

        var attempt = 0
        while (true) {
            val token = GoogleAuth.silentToken(context)
            val body = JSONObject(data.toString())
            body.put("a", action)
            body.put("tok", token)

            val response = Net.request(
                "POST", BuildConfig.GAS_URL,
                mapOf("Content-Type" to "text/plain;charset=utf-8"),
                body.toString().toByteArray(Charsets.UTF_8),
                60000
            )
            val json = response.json()
            val error = json.optString("error", "")

            if (error.isNotEmpty()) {
                if (error.startsWith("auth_") && attempt == 0) {
                    GoogleAuth.invalidate()
                    attempt++
                    continue
                }
                throw CloudException(if (error == "not_allowed") "forbidden" else "backend", error)
            }
            if (!response.ok && json.length() == 0) throw CloudException("http", "HTTP " + response.code)
            return json
        }
    }
}
