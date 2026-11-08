package app.durrazi.signage

import android.app.Application

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        instance = this
        Notif.createChannels(this)
        UpdateWorker.schedule(this)
    }

    companion object {
        lateinit var instance: App
            private set
    }
}
