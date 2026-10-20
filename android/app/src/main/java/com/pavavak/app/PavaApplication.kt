package com.pavavak.app

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.pavavak.app.data.ApiClient
import com.pavavak.app.data.ChatRepository
import com.pavavak.app.data.RealtimeClient
import com.pavavak.app.data.SecureStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

class PavaApplication : Application() {
    lateinit var repository: ChatRepository
        private set

    override fun onCreate() {
        super.onCreate()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        val store = SecureStore(this)
        val api = ApiClient(store)
        val realtime = RealtimeClient(api, store, scope)
        repository = ChatRepository(api, store, realtime, scope)
        repository.restoreSession()
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) = repository.onAppForeground()
            override fun onStop(owner: LifecycleOwner) = repository.onAppBackground()
        })
    }
}
