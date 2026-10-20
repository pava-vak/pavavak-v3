package com.pavavak.app

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.toArgb
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pavavak.app.data.ChatRepository
import com.pavavak.app.data.SessionState
import com.pavavak.app.ui.ChatListScreen
import com.pavavak.app.ui.ChatScreen
import com.pavavak.app.ui.LoginScreen
import com.pavavak.app.ui.NewChatScreen
import com.pavavak.app.ui.SplashScreen
import com.pavavak.app.ui.theme.PavaColors
import com.pavavak.app.ui.theme.PavaTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Blocks screenshots, screen recording and the app-switcher preview (debug builds stay capturable for testing)
        if (!BuildConfig.DEBUG) {
            window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        }
        val bars = SystemBarStyle.dark(PavaColors.Background.toArgb())
        enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)

        val repository = (application as PavaApplication).repository
        setContent {
            PavaTheme { PavaRoot(repository) }
        }
    }
}

private sealed interface Screen {
    data object Chats : Screen
    data object NewChat : Screen
    data class Chat(val chatId: String) : Screen
}

@Composable
private fun PavaRoot(repository: ChatRepository) {
    val session by repository.session.collectAsStateWithLifecycle()
    var chatId by rememberSaveable { mutableStateOf<String?>(null) }
    var newChat by rememberSaveable { mutableStateOf(false) }

    when (val s = session) {
        SessionState.Loading -> SplashScreen()
        SessionState.SignedOut -> {
            // A previous account's open chat must not reopen after the next sign-in
            LaunchedEffect(Unit) { chatId = null; newChat = false }
            LoginScreen(onLogin = repository::login)
        }
        is SessionState.SignedIn -> {
            val screen = when {
                chatId != null -> Screen.Chat(chatId!!)
                newChat -> Screen.NewChat
                else -> Screen.Chats
            }
            when (screen) {
                Screen.Chats -> ChatListScreen(
                    repository = repository,
                    user = s.user,
                    onOpenChat = { chatId = it },
                    onNewChat = { newChat = true },
                )
                Screen.NewChat -> {
                    BackHandler { newChat = false }
                    NewChatScreen(
                        repository = repository,
                        onBack = { newChat = false },
                        onChatStarted = { newChat = false; chatId = it },
                    )
                }
                is Screen.Chat -> {
                    BackHandler { chatId = null }
                    ChatScreen(repository = repository, chatId = screen.chatId, onBack = { chatId = null })
                }
            }
        }
    }
}
