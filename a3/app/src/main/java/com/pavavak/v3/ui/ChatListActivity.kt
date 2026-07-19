package com.pavavak.v3.ui

import android.content.Intent
import android.os.Bundle
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
import com.pavavak.v3.model.DirectChatRequest
import com.pavavak.v3.realtime.SocketHolder
import com.pavavak.v3.realtime.SocketManager
import com.pavavak.v3.realtime.SocketTokenNotifier
import com.pavavak.v3.util.SessionExpiredNotifier
import com.pavavak.v3.util.SessionNavigator
import com.pavavak.v3.util.SessionStore
import kotlinx.coroutines.launch
import retrofit2.HttpException

class ChatListActivity : AppCompatActivity(), SocketManager.SocketListener {
    private lateinit var adapter: ChatListAdapter
    private lateinit var sessionStore: SessionStore
    private lateinit var socketManager: SocketManager
    private lateinit var titleText: TextView
    private lateinit var statusText: TextView

    private val tokenRefreshListener = { socketManager.connect() }
    private val sessionExpiredListener = { goToLogin() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_chat_list)
        val root = findViewById<View>(R.id.chatListRoot)
        titleText = findViewById(R.id.chatListTitle)
        statusText = findViewById(R.id.chatListStatus)
        val signOutButton = findViewById<Button>(R.id.signOutButton)
        val startChatButton = findViewById<Button>(R.id.startChatButton)
        val startChatInput = findViewById<EditText>(R.id.startChatUserIdInput)
        val recyclerView = findViewById<RecyclerView>(R.id.chatRecyclerView)
        sessionStore = SessionStore(this)
        socketManager = SocketHolder.get(this)
        val baseTop = root.paddingTop
        val baseBottom = root.paddingBottom
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(view.paddingLeft, baseTop + bars.top, view.paddingRight, baseBottom + bars.bottom)
            insets
        }
        adapter = ChatListAdapter { chat ->
            startActivity(
                Intent(this, ChatThreadActivity::class.java)
                    .putExtra("chatId", chat.chatId)
                    .putExtra("chatTitle", chat.title)
                    .putExtra("chatSubtitle", chat.subtitle)
            )
        }
        recyclerView.layoutManager = LinearLayoutManager(this)
        recyclerView.adapter = adapter
        signOutButton.setOnClickListener { goToLogin() }
        startChatButton.setOnClickListener {
            val userId = startChatInput.text.toString().toIntOrNull() ?: return@setOnClickListener
            startChatButton.isEnabled = false
            lifecycleScope.launch {
                runCatching { V3Api.create(this@ChatListActivity).startDirectChat(DirectChatRequest(userId)).chat }
                    .onSuccess { chat ->
                        startChatInput.setText("")
                        loadChats()
                        startActivity(
                            Intent(this@ChatListActivity, ChatThreadActivity::class.java)
                                .putExtra("chatId", chat.chatId)
                                .putExtra("chatTitle", chat.title)
                                .putExtra("chatSubtitle", chat.subtitle)
                        )
                    }
                    .onFailure { error ->
                        statusText.text = error.message ?: getString(R.string.load_failed)
                    }
                startChatButton.isEnabled = true
            }
        }
        loadChats()
    }

    override fun onStart() {
        super.onStart()
        SocketTokenNotifier.addListener(tokenRefreshListener)
        SessionExpiredNotifier.addListener(sessionExpiredListener)
        socketManager.addListener(this)
        socketManager.connect()
    }

    override fun onStop() {
        SessionExpiredNotifier.removeListener(sessionExpiredListener)
        SocketTokenNotifier.removeListener(tokenRefreshListener)
        socketManager.removeListener(this)
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        loadChats()
    }

    private fun loadChats() {
        lifecycleScope.launch {
            runCatching {
                val api = V3Api.create(this@ChatListActivity)
                val me = api.me().user
                val chats = api.chats().items
                me to chats
            }.onSuccess { (me, chats) ->
                titleText.text = me.displayName
                statusText.text = "@${me.username}"
                adapter.submitList(chats)
            }.onFailure { error ->
                if (error is HttpException && error.code() == 401) {
                    goToLogin()
                } else {
                    statusText.text = error.message ?: getString(R.string.load_failed)
                }
            }
        }
    }

    private fun goToLogin() {
        SocketHolder.disconnect()
        V3Api.invalidate()
        sessionStore.clear()
        SessionNavigator.goToLogin(this)
        finish()
    }

    override fun onMessageNew(chatId: String, message: com.pavavak.v3.model.ThreadMessage) {
        loadChats()
    }

    override fun onChatUpdated(chatId: String, unreadCount: Int?) {
        loadChats()
    }

    override fun onMessageStatus(chatId: String, messageId: String, status: String) {
        loadChats()
    }
    override fun onTypingStart(chatId: String, displayName: String) = Unit
    override fun onTypingStop(chatId: String) = Unit
}
