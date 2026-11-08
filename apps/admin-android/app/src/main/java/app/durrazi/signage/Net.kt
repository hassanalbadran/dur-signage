package app.durrazi.signage

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

class HttpResult(val code: Int, val text: String, val headers: Map<String, String>) {
    fun json(): JSONObject = try { JSONObject(text) } catch (e: Exception) { JSONObject() }
    val ok: Boolean get() = code in 200..299
}

/** Failure with a machine-readable kind: net, auth, quota, http, config, nocloud. */
class CloudException(val kind: String, message: String) : Exception(message)

object Net {
    fun request(
        method: String,
        url: String,
        headers: Map<String, String> = emptyMap(),
        body: ByteArray? = null,
        timeoutMs: Int = 30000
    ): HttpResult {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = timeoutMs
            connection.readTimeout = timeoutMs
            connection.instanceFollowRedirects = true
            for ((key, value) in headers) connection.setRequestProperty(key, value)

            if (body != null) {
                connection.doOutput = true
                connection.setFixedLengthStreamingMode(body.size)
                connection.outputStream.use { it.write(body) }
            }

            val code = connection.responseCode
            val stream = if (code >= 400) connection.errorStream else connection.inputStream
            val text = if (stream == null) "" else stream.use { readAll(it) }

            val map = HashMap<String, String>()
            for ((key, values) in connection.headerFields) {
                if (key != null && values.isNotEmpty()) map[key.lowercase()] = values[0]
            }
            return HttpResult(code, text, map)
        } finally {
            connection.disconnect()
        }
    }

    private fun readAll(input: java.io.InputStream): String {
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(16 * 1024)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            out.write(buffer, 0, read)
        }
        return out.toString("UTF-8")
    }

    fun postJson(url: String, data: JSONObject, headers: Map<String, String> = emptyMap()): HttpResult {
        val all = HashMap<String, String>(headers)
        all["Content-Type"] = "application/json; charset=utf-8"
        return request("POST", url, all, data.toString().toByteArray(Charsets.UTF_8))
    }

    fun postForm(url: String, fields: Map<String, String>): HttpResult {
        val builder = StringBuilder()
        for ((key, value) in fields) {
            if (builder.isNotEmpty()) builder.append('&')
            builder.append(java.net.URLEncoder.encode(key, "UTF-8")).append('=')
                .append(java.net.URLEncoder.encode(value, "UTF-8"))
        }
        val headers = mapOf("Content-Type" to "application/x-www-form-urlencoded")
        return request("POST", url, headers, builder.toString().toByteArray(Charsets.UTF_8))
    }

    fun onWifi(context: Context): Boolean {
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = manager.activeNetwork ?: return false
        val caps = manager.getNetworkCapabilities(network) ?: return false
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
    }

    fun online(context: Context): Boolean {
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = manager.activeNetwork ?: return false
        val caps = manager.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }
}
