package com.pavavak.v3.ui

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.pavavak.v3.util.SessionStore

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val target = if (SessionStore(this).isSignedIn()) ChatListActivity::class.java else LoginActivity::class.java
        startActivity(Intent(this, target))
        finish()
    }
}