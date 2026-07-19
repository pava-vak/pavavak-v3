package com.pavavak.v3.realtime

import android.content.Context
import com.pavavak.v3.util.SessionStore

object SocketHolder {
    private var manager: SocketManager? = null

    fun get(context: Context): SocketManager {
        if (manager == null) {
            manager = SocketManager(context.applicationContext, SessionStore(context.applicationContext))
        }
        return manager!!
    }

    fun disconnect() {
        manager?.disconnect()
        manager = null
    }
}
