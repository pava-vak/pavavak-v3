package com.pavavak.v3.util

object SessionExpiredNotifier {
    private val listeners = mutableSetOf<() -> Unit>()

    fun addListener(listener: () -> Unit) {
        listeners.add(listener)
    }

    fun removeListener(listener: () -> Unit) {
        listeners.remove(listener)
    }

    fun notifySessionExpired() {
        listeners.forEach { it.invoke() }
    }
}
