package com.pavavak.v3.util

import android.content.Context

class SessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("pavav3_session", Context.MODE_PRIVATE)

    fun accessToken(): String = prefs.getString("access_token", "") ?: ""
    fun refreshToken(): String = prefs.getString("refresh_token", "") ?: ""

    fun saveTokens(accessToken: String, refreshToken: String) {
        prefs.edit().putString("access_token", accessToken).putString("refresh_token", refreshToken).apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    fun isSignedIn(): Boolean = accessToken().isNotBlank()
}