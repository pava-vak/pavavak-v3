package com.pavavak.app

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.pavavak.app.data.ApiClient
import com.pavavak.app.data.AppLock
import com.pavavak.app.data.ChatRepository
import com.pavavak.app.data.MediaRepository
import com.pavavak.app.data.RealtimeClient
import com.pavavak.app.data.SecureStore
import com.pavavak.app.data.SettingsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

class PavaApplication : Application() {
    lateinit var repository: ChatRepository
        private set
    lateinit var settings: SettingsStore
        private set
    lateinit var lock: AppLock
        private set

    override fun onCreate() {
        super.onCreate()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        val store = SecureStore(this)
        settings = SettingsStore(this)
        lock = AppLock(settings, store)
        val api = ApiClient(store)
        val realtime = RealtimeClient(api, store, scope)
        repository = ChatRepository(api, store, realtime, MediaRepository(this, api), lock, scope)
        repository.restoreSession()
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                lock.onForeground()
                repository.onAppForeground()
            }
            override fun onStop(owner: LifecycleOwner) {
                lock.onBackground()
                repository.onAppBackground()
            }
        })
    }
}
