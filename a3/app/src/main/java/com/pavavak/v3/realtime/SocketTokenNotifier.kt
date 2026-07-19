package com.pavavak.v3.realtime

object SocketTokenNotifier {
    private val listeners = mutableSetOf<() -> Unit>()

    fun addListener(listener: () -> Unit) {
        listeners.add(listener)
    }

    fun removeListener(listener: () -> Unit) {
        listeners.remove(listener)
    }

    fun notifyTokenRefreshed() {
        listeners.forEach { it.invoke() }
    }
}
