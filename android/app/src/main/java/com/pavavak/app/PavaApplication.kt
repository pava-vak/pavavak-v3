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
import kotlinx.coroutines.launch

class PavaApplication : Application() {
    lateinit var repository: ChatRepository
        private set
    lateinit var settings: SettingsStore
        private set
    lateinit var lock: AppLock
        private set
    lateinit var push: com.pavavak.app.push.PushManager
        private set
    lateinit var update: com.pavavak.app.update.UpdateManager
        private set
    lateinit var calls: com.pavavak.app.call.CallManager
        private set

    /** True while any screen of the app is visible; push notifications are skipped then. */
    @Volatile var isInForeground = false
        private set

    /** Chat to open after a notification tap (consumed by the UI once unlocked). */
    val pendingChat = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)

    override fun onCreate() {
        super.onCreate()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        val store = SecureStore(this)
        settings = SettingsStore(this)
        lock = AppLock(settings, store)
        val api = ApiClient(store)
        val realtime = RealtimeClient(api, store, scope)
        val media = MediaRepository(this, api)
        repository = ChatRepository(api, store, realtime, media, lock, scope)
        push = com.pavavak.app.push.PushManager(this, api)
        update = com.pavavak.app.update.UpdateManager(this, api)
        calls = com.pavavak.app.call.CallManager(this, api, realtime, scope)
        // A live call must keep the app unlocked (auto-lock is suppressed; manual lock still works)
        lock.isCallActive = { calls.state.value !is com.pavavak.app.call.CallState.Idle }
        repository.beforeLogout = { push.unregister(); com.pavavak.app.push.Notifier.cancelAll(this) }
        lock.onHiddenChanged = { chatId, hidden -> scope.launch { runCatching { api.setChatHidden(chatId, hidden) } } }
        // Register for push on every sign-in (and on launch when already signed in)
        scope.launch {
            repository.session.collect { s ->
                if (s is com.pavavak.app.data.SessionState.SignedIn) {
                    push.register()
                    // Quietly see whether a newer build has been published
                    runCatching { update.check() }
                    // Hidden chats are shared by all of this account's devices
                    runCatching { api.hiddenChats().toSet() }.onSuccess { server ->
                        for (id in lock.mergeHiddenFromServer(server)) runCatching { api.setChatHidden(id, true) }
                    }
                }
            }
        }
        // Nothing decrypted stays on disk while the app is locked
        lock.onLocked = { if (settings.current.wipeMediaOnLock) media.clear() }
        repository.restoreSession()
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                isInForeground = true
                lock.onForeground()
                // Retry push registration: Play services may not have been ready at the last attempt
                if (repository.currentUser != null) scope.launch { push.register() }
                repository.onAppForeground()
            }
            override fun onStop(owner: LifecycleOwner) {
                isInForeground = false
                lock.onBackground()
                repository.onAppBackground()
            }
        })
    }
}
