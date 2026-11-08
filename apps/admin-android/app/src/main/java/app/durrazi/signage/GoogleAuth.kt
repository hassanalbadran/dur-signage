package app.durrazi.signage

import android.accounts.Account
import android.app.Activity
import android.content.Context
import android.content.Intent
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import com.google.android.gms.tasks.Tasks
import java.util.concurrent.TimeUnit

/**
 * Google sign-in through the Play Services Authorization API.
 * The person signs in once (consent screen); afterwards tokens are obtained silently in the background.
 */
object GoogleAuth {
    const val REQUEST_CODE = 4101
    private const val SCOPE_DRIVE = "https://www.googleapis.com/auth/drive.file"
    private const val SCOPE_EMAIL = "https://www.googleapis.com/auth/userinfo.email"

    private var token = ""
    private var tokenExpires = 0L
    private var pending: ((error: String?) -> Unit)? = null

    private fun buildRequest(): AuthorizationRequest {
        val builder = AuthorizationRequest.builder()
            .setRequestedScopes(listOf(Scope(SCOPE_DRIVE), Scope(SCOPE_EMAIL)))
        val email = Prefs.email
        if (email.isNotEmpty()) builder.setAccount(Account(email, "com.google"))
        return builder.build()
    }

    fun invalidate() {
        token = ""
        tokenExpires = 0L
    }

    /** Blocking. Never call from the main thread. */
    fun silentToken(context: Context): String {
        if (token.isNotEmpty() && System.currentTimeMillis() < tokenExpires) return token

        val client = Identity.getAuthorizationClient(context)
        val result: AuthorizationResult = try {
            Tasks.await(client.authorize(buildRequest()), 30, TimeUnit.SECONDS)
        } catch (e: Exception) {
            throw CloudException("auth", "AUTH")
        }
        if (result.hasResolution()) throw CloudException("auth", "AUTH")

        val access = result.accessToken ?: throw CloudException("auth", "AUTH")
        token = access
        tokenExpires = System.currentTimeMillis() + 45 * 60 * 1000L
        return access
    }

    /** Shows the Google consent screen when needed. [done] receives null on success or an error text. */
    fun signIn(activity: Activity, done: (error: String?) -> Unit) {
        pending = done
        Identity.getAuthorizationClient(activity).authorize(buildRequest())
            .addOnSuccessListener { result ->
                val intentSender = result.pendingIntent?.intentSender
                if (result.hasResolution() && intentSender != null) {
                    try {
                        activity.startIntentSenderForResult(intentSender, REQUEST_CODE, null, 0, 0, 0)
                    } catch (e: Exception) {
                        finish("AUTH")
                    }
                } else {
                    complete(activity, result)
                }
            }
            .addOnFailureListener { finish("AUTH") }
    }

    fun onActivityResult(activity: Activity, resultCode: Int, data: Intent?) {
        if (resultCode != Activity.RESULT_OK || data == null) {
            finish("CANCELLED")
            return
        }
        try {
            val result = Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(data)
            complete(activity, result)
        } catch (e: Exception) {
            finish("AUTH")
        }
    }

    private fun complete(activity: Activity, result: AuthorizationResult) {
        val access = result.accessToken
        if (access == null) {
            finish("AUTH")
            return
        }
        token = access
        tokenExpires = System.currentTimeMillis() + 45 * 60 * 1000L

        Thread {
            try {
                val info = Net.request("GET", "https://www.googleapis.com/oauth2/v3/userinfo", mapOf("Authorization" to "Bearer $access"))
                val email = info.json().optString("email", "")
                if (email.isNotEmpty()) Prefs.email = email
            } catch (e: Exception) {
                // the email is only a hint for later silent sign-ins
            }
            activity.runOnUiThread { finish(null) }
        }.start()
    }

    private fun finish(error: String?) {
        val callback = pending
        pending = null
        callback?.invoke(error)
    }

    fun signOut() {
        invalidate()
        Prefs.email = ""
    }
}
