package com.pavavak.v3.util

import android.content.Context
import android.content.Intent

object SessionNavigator {
    fun goToLogin(context: Context) {
        val intent = Intent(context, com.pavavak.v3.ui.LoginActivity::class.java)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        context.startActivity(intent)
    }
}
