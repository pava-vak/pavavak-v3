package com.pavavak.v3.ui

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.pavavak.v3.R
import com.pavavak.v3.api.V3Api
import com.pavavak.v3.model.AuthResponse
import com.pavavak.v3.model.LoginRequest
import com.pavavak.v3.model.RegisterRequest
import com.pavavak.v3.util.SessionStore
import kotlinx.coroutines.launch

class LoginActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)

        val usernameInput = findViewById<EditText>(R.id.usernameInput)
        val passwordInput = findViewById<EditText>(R.id.passwordInput)
        val displayNameInput = findViewById<EditText>(R.id.displayNameInput)
        val loginButton = findViewById<Button>(R.id.loginButton)
        val registerButton = findViewById<Button>(R.id.registerButton)
        val statusText = findViewById<TextView>(R.id.statusText)

        fun completeAuth(response: AuthResponse) {
            SessionStore(this).saveTokens(response.tokens.accessToken, response.tokens.refreshToken)
            startActivity(Intent(this, ChatListActivity::class.java))
            finish()
        }

        fun setLoading(loading: Boolean) {
            loginButton.isEnabled = false
            registerButton.isEnabled = false
            if (!loading) {
                loginButton.isEnabled = true
                registerButton.isEnabled = true
            }
        }

        loginButton.setOnClickListener {
            val request = LoginRequest(
                usernameInput.text.toString().trim().ifBlank { "admin" },
                passwordInput.text.toString()
            )

            setLoading(true)
            statusText.text = getString(R.string.signing_in)

            lifecycleScope.launch {
                runCatching { V3Api.create(this@LoginActivity).login(request) }
                    .onSuccess { response -> completeAuth(response) }
                    .onFailure { error ->
                        setLoading(false)
                        statusText.text = error.message ?: getString(R.string.login_failed)
                    }
            }
        }

        registerButton.setOnClickListener {
            val request = RegisterRequest(
                usernameInput.text.toString().trim(),
                displayNameInput.text.toString().trim().ifBlank { usernameInput.text.toString().trim() },
                passwordInput.text.toString()
            )

            setLoading(true)
            statusText.text = getString(R.string.signing_in)

            lifecycleScope.launch {
                runCatching { V3Api.create(this@LoginActivity).register(request) }
                    .onSuccess { response -> completeAuth(response) }
                    .onFailure { error ->
                        setLoading(false)
                        statusText.text = error.message ?: getString(R.string.login_failed)
                    }
            }
        }
    }
}
