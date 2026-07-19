package com.pavavak.v3.ui

import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.pavavak.v3.R
import com.pavavak.v3.api.V3Api
import com.pavavak.v3.model.ReceiptRequest
import com.pavavak.v3.model.SendMessageRequest
import com.pavavak.v3.model.ThreadMessage
import com.pavavak.v3.realtime.SocketHolder
import com.pavavak.v3.realtime.SocketManager
import com.pavavak.v3.realtime.SocketTokenNotifier
import com.pavavak.v3.util.SessionExpiredNotifier
import com.pavavak.v3.util.SessionNavigator
import com.pavavak.v3.util.SessionStore
import kotlinx.coroutines.launch
import retrofit2.HttpException

class ChatThreadActivity : AppCompatActivity(), SocketManager.SocketListener {
    private lateinit var adapter: ThreadAdapter
    private lateinit var sessionStore: SessionStore
    private lateinit var socketManager: SocketManager
    private lateinit var statusText: TextView
    private lateinit var subtitleText: TextView
    private lateinit var chatId: String
    private var typingHideRunnable: Runnable? = null

    private val tokenRefreshListener = { socketManager.connect() }
    private val sessionExpiredListener = { goToLogin() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_chat_thread)
        chatId = intent.getStringExtra("chatId").orEmpty()
        if (chatId.isBlank()) {
            finish()
            return
        }
        val title = intent.getStringExtra("chatTitle").orEmpty()
        val subtitle = intent.getStringExtra("chatSubtitle").orEmpty()
        val root = findViewById<View>(R.id.threadRoot)
        val titleText = findViewById<TextView>(R.id.threadTitle)
        subtitleText = findViewById(R.id.threadSubtitle)
        statusText = findViewById(R.id.threadStatus)
        val recyclerView = findViewById<RecyclerView>(R.id.threadRecyclerView)
        val composerInput = findViewById<EditText>(R.id.composerInput)
        val sendButton = findViewById<Button>(R.id.sendButton)
        sessionStore = SessionStore(this)
        socketManager = SocketHolder.get(this)
        val baseTop = root.paddingTop
        val baseBottom = root.paddingBottom
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(view.paddingLeft, baseTop + bars.top, view.paddingRight, baseBottom + bars.bottom)
            insets
        }
        titleText.text = title
        subtitleText.text = subtitle
        adapter = ThreadAdapter()
        recyclerView.layoutManager = LinearLayoutManager(this)
        recyclerView.adapter = adapter

        composerInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                socketManager.emitTypingStart(chatId)
                typingHideRunnable?.let { composerInput.removeCallbacks(it) }
                typingHideRunnable = Runnable { socketManager.emitTypingStop(chatId) }
                composerInput.postDelayed(typingHideRunnable!!, 1200)
            }
            override fun afterTextChanged(s: Editable?) = Unit
        })

        lifecycleScope.launch { loadThread() }
        sendButton.setOnClickListener {
            val text = composerInput.text.toString().trim()
            if (text.isEmpty()) return@setOnClickListener
            sendButton.isEnabled = false
            statusText.text = getString(R.string.sending)
            lifecycleScope.launch {
                runCatching { V3Api.create(this@ChatThreadActivity).send(SendMessageRequest(chatId, text)).message }
                    .onSuccess { message ->
                        composerInput.setText("")
                        adapter.append(message)
                        recyclerView.scrollToPosition(adapter.itemCount - 1)
                        statusText.text = getString(R.string.thread_ready)
                    }
                    .onFailure { error ->
                        if (error is HttpException && error.code() == 401) goToLogin()
                        else statusText.text = error.message ?: getString(R.string.send_failed)
                    }
                sendButton.isEnabled = true
            }
        }
    }

    override fun onStart() {
        super.onStart()
        SocketTokenNotifier.addListener(tokenRefreshListener)
        SessionExpiredNotifier.addListener(sessionExpiredListener)
        socketManager.addListener(this)
        socketManager.connect()
        socketManager.joinChat(chatId)
    }

    override fun onStop() {
        socketManager.emitTypingStop(chatId)
        typingHideRunnable?.let { findViewById<EditText>(R.id.composerInput).removeCallbacks(it) }
        SessionExpiredNotifier.removeListener(sessionExpiredListener)
        SocketTokenNotifier.removeListener(tokenRefreshListener)
        socketManager.removeListener(this)
        super.onStop()
    }

    private suspend fun loadThread() {
        runCatching { V3Api.create(this).thread(chatId) }
            .onSuccess { response ->
                adapter.submitList(response.items)
                if (response.items.isNotEmpty()) {
                    findViewById<RecyclerView>(R.id.threadRecyclerView).scrollToPosition(response.items.lastIndex)
                }
                statusText.text = getString(R.string.thread_ready)
                runCatching { V3Api.create(this@ChatThreadActivity).markChatRead(chatId) }
                    .onSuccess { adapter.markIncomingRead() }
                response.items.filter { it.direction == "incoming" && it.status == "sent" }.forEach { item ->
                    runCatching {
                        V3Api.create(this@ChatThreadActivity).markDelivered(item.messageId, ReceiptRequest(chatId))
                    }
                }
            }
            .onFailure { error ->
                if (error is HttpException && error.code() == 401) goToLogin()
                else statusText.text = error.message ?: getString(R.string.load_failed)
            }
    }

    private fun goToLogin() {
        SocketHolder.disconnect()
        V3Api.invalidate()
        sessionStore.clear()
        finishAffinity()
        SessionNavigator.goToLogin(this)
    }

    override fun onMessageNew(chatId: String, message: ThreadMessage) {
        if (chatId != this.chatId) return
        adapter.append(message)
        findViewById<RecyclerView>(R.id.threadRecyclerView).scrollToPosition(adapter.itemCount - 1)
        if (message.direction == "incoming") {
            lifecycleScope.launch {
                runCatching {
                    V3Api.create(this@ChatThreadActivity).markDelivered(message.messageId, ReceiptRequest(chatId))
                    V3Api.create(this@ChatThreadActivity).markChatRead(chatId)
                }.onSuccess {
                    adapter.updateStatus(message.messageId, "read")
                }
            }
        }
    }

    override fun onChatUpdated(chatId: String, unreadCount: Int?) = Unit

    override fun onMessageStatus(chatId: String, messageId: String, status: String) {
        if (chatId != this.chatId) return
        adapter.updateStatus(messageId, status)
    }

    override fun onTypingStart(chatId: String, displayName: String) {
        if (chatId != this.chatId) return
        subtitleText.text = "$displayName typing..."
    }

    override fun onTypingStop(chatId: String) {
        if (chatId != this.chatId) return
        subtitleText.text = intent.getStringExtra("chatSubtitle").orEmpty()
    }

    override fun onPresenceOnline(chatId: String, displayName: String) {
        if (chatId != this.chatId) return
        subtitleText.text = if (displayName.isBlank()) getString(R.string.presence_online) else getString(R.string.presence_online_named, displayName)
    }

    override fun onPresenceOffline(chatId: String) {
        if (chatId != this.chatId) return
        subtitleText.text = getString(R.string.presence_offline)
    }
}
