package app.durrazi.signage

import android.app.Activity
import android.net.Uri
import android.util.Base64
import androidx.browser.customtabs.CustomTabsIntent
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom

/** Static description of an OAuth 2 (PKCE) provider. No client secret is used or needed. */
class OAuthConfig(
    val id: String,
    val authUrl: String,
    val tokenUrl: String,
    val clientId: String,
    val scope: String,
    val extra: Map<String, String>
) {
    val redirect: String get() = "durrazi://auth/$id"
}

object OAuth {
    private var pending: ((error: String?) -> Unit)? = null

    private fun base64Url(bytes: ByteArray): String =
        Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

    fun begin(activity: Activity, config: OAuthConfig, done: (String?) -> Unit) {
        if (config.clientId.isEmpty()) {
            done(Msg.t("This cloud is not configured in the build", "هذه السحابة غير مفعّلة في النسخة"))
            return
        }
        pending = done

        val random = SecureRandom()
        val raw = ByteArray(48)
        random.nextBytes(raw)
        val verifier = base64Url(raw)
        val challenge = base64Url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))
        val stateBytes = ByteArray(16)
        random.nextBytes(stateBytes)
        val state = base64Url(stateBytes)

        Prefs.putString("oauth.verifier", verifier)
        Prefs.putString("oauth.state", state)
        Prefs.putString("oauth.provider", config.id)

        val builder = Uri.parse(config.authUrl).buildUpon()
            .appendQueryParameter("client_id", config.clientId)
            .appendQueryParameter("response_type", "code")
            .appendQueryParameter("redirect_uri", config.redirect)
            .appendQueryParameter("code_challenge", challenge)
            .appendQueryParameter("code_challenge_method", "S256")
            .appendQueryParameter("state", state)
        if (config.scope.isNotEmpty()) builder.appendQueryParameter("scope", config.scope)
        for ((key, value) in config.extra) builder.appendQueryParameter(key, value)

        CustomTabsIntent.Builder().build().launchUrl(activity, builder.build())
    }

    /** Called with durrazi://auth/<provider>?code=...&state=... Runs the token exchange off the main thread. */
    fun finish(uri: Uri, onDone: (provider: String, error: String?) -> Unit) {
        val provider = Prefs.getString("oauth.provider")
        val callback = pending
        pending = null

        fun report(error: String?) {
            callback?.invoke(error)
            onDone(provider, error)
        }

        val config = Providers.config(provider)
        val code = uri.getQueryParameter("code")
        if (config == null || code == null || uri.getQueryParameter("state") != Prefs.getString("oauth.state")) {
            report(uri.getQueryParameter("error_description") ?: "CANCELLED")
            return
        }

        Thread {
            var error: String? = null
            try {
                val fields = HashMap<String, String>()
                fields["grant_type"] = "authorization_code"
                fields["code"] = code
                fields["client_id"] = config.clientId
                fields["redirect_uri"] = config.redirect
                fields["code_verifier"] = Prefs.getString("oauth.verifier")
                if (provider == "onedrive") fields["scope"] = config.scope

                val response = Net.postForm(config.tokenUrl, fields)
                val json = response.json()
                if (!response.ok || !json.has("access_token")) {
                    error = json.optString("error_description", "HTTP " + response.code)
                } else {
                    store(provider, json)
                    val cloud = Clouds.byId(provider)
                    if (cloud is OAuthCloud) cloud.loadEmail()
                }
            } catch (e: Exception) {
                error = Msg.t("No internet connection", "لا يوجد اتصال بالإنترنت")
            }
            report(error)
        }.start()
    }

    private fun store(provider: String, json: JSONObject) {
        Prefs.putString("$provider.access", json.getString("access_token"))
        val refresh = json.optString("refresh_token", "")
        if (refresh.isNotEmpty()) Prefs.putString("$provider.refresh", refresh)
        val seconds = json.optLong("expires_in", 3600L)
        Prefs.putLong("$provider.exp", System.currentTimeMillis() + (seconds - 120) * 1000L)
    }

    /** Blocking. Returns a valid access token, refreshing it when needed. */
    fun accessToken(config: OAuthConfig): String {
        val id = config.id
        val saved = Prefs.getString("$id.access")
        if (saved.isNotEmpty() && System.currentTimeMillis() < Prefs.getLong("$id.exp")) return saved

        val refresh = Prefs.getString("$id.refresh")
        if (refresh.isEmpty()) throw CloudException("auth", "AUTH")

        val fields = HashMap<String, String>()
        fields["grant_type"] = "refresh_token"
        fields["refresh_token"] = refresh
        fields["client_id"] = config.clientId
        if (id == "onedrive") fields["scope"] = config.scope

        val response = Net.postForm(config.tokenUrl, fields)
        val json = response.json()
        if (!response.ok || !json.has("access_token")) throw CloudException("auth", "AUTH")
        store(id, json)
        return json.getString("access_token")
    }

    fun forget(id: String) {
        Prefs.remove("$id.access")
        Prefs.remove("$id.refresh")
        Prefs.remove("$id.exp")
        Prefs.remove("$id.email")
    }
}

object Providers {
    fun config(id: String): OAuthConfig? = when (id) {
        "dropbox" -> OAuthConfig(
            "dropbox", "https://www.dropbox.com/oauth2/authorize", "https://api.dropboxapi.com/oauth2/token",
            BuildConfig.DROPBOX_APP_KEY, "", mapOf("token_access_type" to "offline")
        )
        "onedrive" -> OAuthConfig(
            "onedrive", "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
            "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            BuildConfig.ONEDRIVE_CLIENT_ID, "offline_access Files.ReadWrite User.Read", mapOf("prompt" to "select_account")
        )
        else -> null
    }
}

abstract class OAuthCloud(final override val id: String, final override val title: String) : Cloud {
    protected val config: OAuthConfig get() = Providers.config(id)!!

    override fun isConnected(): Boolean = Prefs.getString("$id.refresh").isNotEmpty()
    override fun email(): String = Prefs.getString("$id.email")

    protected fun auth(): Map<String, String> = mapOf("Authorization" to "Bearer " + OAuth.accessToken(config))

    abstract fun loadEmail()

    override fun disconnect() = OAuth.forget(id)

    protected fun failure(response: HttpResult): CloudException {
        if (response.code == 401) return CloudException("auth", "AUTH")
        if (response.code == 507 || response.text.contains("insufficient_space") || response.text.contains("quotaLimitReached")) {
            return CloudException("quota", Msg.t("$title storage is full", "مساحة $title ممتلئة"))
        }
        return CloudException("http", "$title: HTTP " + response.code)
    }

    companion object {
        fun dropbox(): OAuthCloud = DropboxCloud()
        fun onedrive(): OAuthCloud = OneDriveCloud()
    }
}
