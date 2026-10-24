package com.pavavak.app

import android.media.RingtoneManager
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.pavavak.app.data.AppLock
import com.pavavak.app.data.ChatRepository
import com.pavavak.app.data.IncomingEvent
import com.pavavak.app.data.SessionState
import com.pavavak.app.data.SettingsStore
import com.pavavak.app.data.User
import com.pavavak.app.data.previewText
import com.pavavak.app.ui.AdminScreen
import com.pavavak.app.ui.EmptyState
import com.pavavak.app.ui.SimpleTopBar
import com.pavavak.app.ui.ShakeDetector
import com.pavavak.app.ui.IntruderAlert
import com.pavavak.app.ui.UpdateDialog
import com.pavavak.app.ui.HiddenChatsScreen
import com.pavavak.app.ui.AuthGate
import com.pavavak.app.ui.Avatar
import com.pavavak.app.ui.ChatListScreen
import com.pavavak.app.ui.ChatScreen
import com.pavavak.app.ui.ContactInfoScreen
import com.pavavak.app.ui.DevicesScreen
import com.pavavak.app.ui.GalleryScreen
import com.pavavak.app.ui.DecoyScreen
import com.pavavak.app.ui.LockScreen
import com.pavavak.app.ui.LoginScreen
import com.pavavak.app.ui.MonitorChatScreen
import com.pavavak.app.ui.NewChatScreen
import com.pavavak.app.ui.OnboardingScreen
import com.pavavak.app.ui.ScheduledScreen
import com.pavavak.app.ui.SearchScreen
import com.pavavak.app.ui.SettingsScreen
import com.pavavak.app.ui.SplashScreen
import com.pavavak.app.ui.StarredScreen
import com.pavavak.app.ui.theme.PavaColors
import com.pavavak.app.ui.theme.PavaTheme
import com.pavavak.app.ui.theme.paletteFor
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** FragmentActivity because BiometricPrompt needs one. */
class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Blocks screenshots, screen recording and the app-switcher preview (debug builds stay capturable for testing)
        if (!BuildConfig.DEBUG) {
            window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        }
        val app = application as PavaApplication
        takeChatFromIntent(intent)
        applyBars(paletteFor(app.settings.current.themeId))
        setContent {
            val settings by app.settings.values.collectAsStateWithLifecycle()
            val palette = paletteFor(settings.themeId)
            LaunchedEffect(palette.id) { applyBars(palette) }
            PavaTheme(palette) { PavaRoot(app.repository, app.settings, app.lock) }
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        takeChatFromIntent(intent)
    }

    /** A notification tap carries the chat to open; it waits until the app is unlocked. */
    private fun takeChatFromIntent(intent: android.content.Intent?) {
        val chatId = intent?.getStringExtra(com.pavavak.app.push.Notifier.EXTRA_CHAT_ID) ?: return
        intent.removeExtra(com.pavavak.app.push.Notifier.EXTRA_CHAT_ID)
        (application as PavaApplication).pendingChat.value = chatId
    }

    override fun onResume() {
        super.onResume()
        (application as PavaApplication).lock.onActivityResumed()
    }

    /** Every outgoing launch (camera, pickers, "Open with") goes through here; keep the app unlocked for the round trip. */
    @Deprecated("Deprecated in Java")
    override fun startActivityForResult(intent: android.content.Intent, requestCode: Int, options: Bundle?) {
        (application as PavaApplication).lock.allowExternalActivity()
        @Suppress("DEPRECATION")
        super.startActivityForResult(intent, requestCode, options)
    }

    private fun applyBars(palette: com.pavavak.app.ui.theme.Palette) {
        val color = palette.bg.toArgb()
        val style = if (palette.isLight) SystemBarStyle.light(color, color) else SystemBarStyle.dark(color)
        enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
    }
}

private object Routes {
    const val CHATS = "chats"
    const val ARCHIVED = "archived"
    const val NEW_CHAT = "new"
    const val CHAT = "chat/{chatId}"
    const val INFO = "info/{chatId}"
    const val GALLERY = "gallery/{chatId}?admin={admin}&title={title}"
    const val SEARCH = "search"
    const val STARRED = "starred"
    const val SCHEDULED = "scheduled"
    const val SETTINGS = "settings"
    const val DEVICES = "devices"
    const val ADMIN = "admin"
    const val MONITOR = "monitor/{chatId}?title={title}"
    const val HIDDEN = "hidden"

    fun chat(id: String) = "chat/${Uri.encode(id)}"
    fun info(id: String) = "info/${Uri.encode(id)}"
    fun gallery(id: String, admin: Boolean, title: String) = "gallery/${Uri.encode(id)}?admin=$admin&title=${Uri.encode(title)}"
    fun monitor(id: String, title: String) = "monitor/${Uri.encode(id)}?title=${Uri.encode(title)}"
}

@Composable
private fun PavaRoot(repository: ChatRepository, settingsStore: SettingsStore, lock: AppLock) {
    val session by repository.session.collectAsStateWithLifecycle()
    val settings by settingsStore.values.collectAsStateWithLifecycle()
    val locked by lock.locked.collectAsStateWithLifecycle()

    // Recents / task-switcher card matches the chosen disguise (name + icon), never "PaVa Vak"
    val rootContext = androidx.compose.ui.platform.LocalContext.current
    LaunchedEffect(settings.appIcon) {
        (rootContext as? android.app.Activity)?.let { act ->
            val icon = com.pavavak.app.data.AppIcons.taskIcon(act, settings.appIcon)
            val label = com.pavavak.app.data.AppIcons.taskLabel(settings.appIcon)
            runCatching {
                act.setTaskDescription(
                    if (icon != null) android.app.ActivityManager.TaskDescription(label, icon)
                    else android.app.ActivityManager.TaskDescription(label)
                )
            }
        }
    }

    Box(Modifier.fillMaxSize()) {
        when (val s = session) {
            SessionState.Loading -> SplashScreen()
            SessionState.SignedOut -> LoginScreen(onLogin = repository::login)
            is SessionState.SignedIn -> {
                if (!settings.onboarded) {
                    OnboardingScreen(s.user, settingsStore, lock, onFinish = {})
                } else {
                    // A new NavHost per account so one user's screens never reopen for the next
                    androidx.compose.runtime.key(s.user.userId) {
                        SignedInApp(repository, settingsStore, lock, s.user)
                    }
                }
            }
        }
        // When a disguise icon is on, the app opens to its decoy (a working calculator/clock/
        // notes/weather); the small "™" reveals the PIN lock. Each re-lock shows the decoy again.
        if (locked && session is SessionState.SignedIn) {
            var revealLock by remember { mutableStateOf(false) }
            LaunchedEffect(locked) { if (locked) revealLock = false }
            if (settings.appIcon != "default" && !revealLock) {
                DecoyScreen(
                    settings.appIcon,
                    onReveal = { revealLock = true },
                    onSecretCode = { code -> lock.tryUnlockSilently(code) },
                )
            } else {
                LockScreen(settings, lock)
            }
        }
    }
}

@Composable
private fun SignedInApp(repository: ChatRepository, settingsStore: SettingsStore, lock: AppLock, user: User) {
    val nav = rememberNavController()
    var banner by remember { mutableStateOf<IncomingEvent?>(null) }
    val context = androidx.compose.ui.platform.LocalContext.current

    LaunchedEffect(Unit) {
        repository.incoming.collect { event ->
            val chat = repository.chat(event.chatId)
            // Silent messages, muted and hidden chats, and the decoy app never make a sound or a banner
            if (chat?.muted == true || event.message.silent || event.chatId in lock.hiddenChats.value || lock.decoy.value) return@collect
            if (settingsStore.current.chime && !lock.locked.value) {
                runCatching { RingtoneManager.getRingtone(context, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))?.play() }
            }
            if (!event.chatOpen) banner = event
        }
    }
    LaunchedEffect(banner) { if (banner != null) { delay(3500); banner = null } }

    // Open the chat from a tapped notification once the app is unlocked
    val app = context.applicationContext as PavaApplication
    val pendingChat by app.pendingChat.collectAsStateWithLifecycle()
    val lockedNow by lock.locked.collectAsStateWithLifecycle()
    LaunchedEffect(pendingChat, lockedNow) {
        val id = pendingChat ?: return@LaunchedEffect
        if (lockedNow) return@LaunchedEffect
        app.pendingChat.value = null
        if (id in lock.hiddenChats.value) return@LaunchedEffect
        nav.navigate(Routes.chat(id)) { launchSingleTop = true }
    }

    // Ask once for notification permission (Android 13+) so closed-app alerts can show
    val notifPermission = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(Unit) {
        val prefs = context.getSharedPreferences("pava_settings", android.content.Context.MODE_PRIVATE)
        if (android.os.Build.VERSION.SDK_INT >= 33 && app.push.isAvailable() && !com.pavavak.app.push.Notifier.canNotify(context)
            && !prefs.getBoolean("asked_notifications", false)) {
            prefs.edit().putBoolean("asked_notifications", true).apply()
            notifPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    // Privacy: leaving the app (minimise, back, app switch) closes any open photo/video and chat and
    // returns to the chat list — unless we're out at the camera or a picker. Combined with instant
    // app lock, reopening always starts on the locked chat list.
    val lifecycleOwner = androidx.lifecycle.compose.LocalLifecycleOwner.current
    fun resetToChatList() {
        banner = null
        app.pendingChat.value = null
        runCatching { nav.popBackStack(Routes.CHATS, false) }
    }
    DisposableEffect(lifecycleOwner) {
        val obs = androidx.lifecycle.LifecycleEventObserver { _, event ->
            if (event == androidx.lifecycle.Lifecycle.Event.ON_STOP && !lock.hasExternalPending()) resetToChatList()
        }
        lifecycleOwner.lifecycle.addObserver(obs)
        onDispose { lifecycleOwner.lifecycle.removeObserver(obs) }
    }
    // When the app locks (instant on leave, Lock now, or shake) also drop back to the chat list
    LaunchedEffect(lockedNow) { if (lockedNow) resetToChatList() }

    val activity = context as? android.app.Activity
    val shake by settingsStore.values.collectAsStateWithLifecycle()
    ShakeDetector(enabled = shake.shakeToHide) {
        banner = null
        lock.lockNow()
        activity?.moveTaskToBack(true)
    }
    IntruderAlert(lock)

    // Offer an in-place update when a newer build is published (checked on sign-in and each unlock)
    val update = app.update
    val updateAvailable by update.available.collectAsStateWithLifecycle()
    val updateScope = rememberCoroutineScope()
    LaunchedEffect(lockedNow) { if (!lockedNow) runCatching { update.check() } }

    Box(Modifier.fillMaxSize()) {
        AppNavHost(nav, repository, settingsStore, lock, user)
        AnimatedVisibility(
            visible = banner != null && !lock.locked.value,
            enter = slideInVertically { -it }, exit = slideOutVertically { -it },
            modifier = Modifier.align(Alignment.TopCenter),
        ) {
            val event = banner
            if (event != null) InAppBanner(
                title = repository.chat(event.chatId)?.displayTitle ?: event.message.senderDisplayName ?: "New message",
                text = if (settingsStore.current.hidePreviews || event.chatId in lock.lockedChats.value) "New message"
                    else previewText(event.message.text, event.message.viewOnce),
                onClick = { banner = null; nav.navigate(Routes.chat(event.chatId)) { launchSingleTop = true } },
            )
        }
    }

    val release = updateAvailable
    if (release != null && !lockedNow) {
        UpdateDialog(
            update, release,
            onDismiss = { update.dismiss() },
            onUpdate = { updateScope.launch { update.downloadAndInstall(release) } },
        )
    }
}

@Composable
private fun InAppBanner(title: String, text: String, onClick: () -> Unit) {
    Surface(
        color = PavaColors.Surface, shape = RoundedCornerShape(16.dp), shadowElevation = 8.dp,
        modifier = Modifier.statusBarsPadding().padding(8.dp).fillMaxWidth().clickable(onClick = onClick),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(title, size = 38.dp)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.SemiBold, color = PavaColors.TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(text, color = PavaColors.TextMuted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun AppNavHost(nav: NavHostController, repository: ChatRepository, settingsStore: SettingsStore, lock: AppLock, user: User) {
    val back: () -> Unit = { nav.popBackStack() }
    val openChat: (String) -> Unit = { id -> nav.navigate(Routes.chat(id)) { launchSingleTop = true } }
    val idArg = listOf(navArgument("chatId") { type = NavType.StringType })

    val settings by settingsStore.values.collectAsStateWithLifecycle()
    val decoy by lock.decoy.collectAsStateWithLifecycle()
    val unlockedChats by lock.unlockedChats.collectAsStateWithLifecycle()
    val lockedChats by lock.lockedChats.collectAsStateWithLifecycle()

    NavHost(nav, startDestination = Routes.CHATS) {
        composable(Routes.CHATS) { ChatList(repository, user, nav, archived = false, lock, settings.hidePreviews) }
        composable(Routes.ARCHIVED) { ChatList(repository, user, nav, archived = true, lock, settings.hidePreviews) }
        composable(Routes.HIDDEN) {
            var open by remember { mutableStateOf(false) }
            AuthGate("Hidden chats", "Confirm it's you to see hidden chats", lock, settings, unlocked = open,
                onUnlocked = { open = true }, onCancel = back) {
                HiddenChatsScreen(repository, lock, onOpenChat = { id -> lock.markChatUnlocked(id); openChat(id) }, onBack = back)
            }
        }
        composable(Routes.NEW_CHAT) {
            NewChatScreen(repository, onBack = back, onChatStarted = { id ->
                nav.navigate(Routes.chat(id)) { popUpTo(Routes.CHATS) }
            })
        }
        composable(Routes.CHAT, idArg) { entry ->
            val chatId = entry.arguments?.getString("chatId").orEmpty()
            AuthGate("Locked chat", "Confirm it's you to open ${repository.chat(chatId)?.displayTitle ?: "this chat"}", lock, settings,
                unlocked = chatId !in lockedChats || chatId in unlockedChats,
                onUnlocked = { lock.markChatUnlocked(chatId) }, onCancel = back) {
                ChatScreen(
                    repository, chatId, onBack = back,
                    onOpenInfo = { nav.navigate(Routes.info(chatId)) },
                    onOpenGallery = { nav.navigate(Routes.gallery(chatId, false, repository.chat(chatId)?.displayTitle ?: "Media")) },
                )
            }
        }
        composable(Routes.INFO, idArg) { entry ->
            val chatId = entry.arguments?.getString("chatId").orEmpty()
            ContactInfoScreen(
                repository, chatId, onBack = back,
                onGallery = { nav.navigate(Routes.gallery(chatId, false, repository.chat(chatId)?.displayTitle ?: "Media")) },
                onSearch = back, // the chat screen has in-chat search; going back is quickest
                onChatGone = { nav.popBackStack(Routes.CHATS, inclusive = false) },
            )
        }
        composable(
            Routes.GALLERY,
            idArg + listOf(
                navArgument("admin") { type = NavType.BoolType; defaultValue = false },
                navArgument("title") { type = NavType.StringType; defaultValue = "Media" },
            ),
        ) { entry ->
            val args = entry.arguments
            GalleryScreen(repository, args?.getString("chatId").orEmpty(), args?.getString("title") ?: "Media",
                admin = args?.getBoolean("admin") == true, onBack = back)
        }
        // The decoy app shows nothing from the real account
        composable(Routes.SEARCH) { if (decoy) DecoyEmpty("Search messages", back) else SearchScreen(repository, onBack = back, onOpenChat = openChat) }
        composable(Routes.STARRED) { if (decoy) DecoyEmpty("Starred messages", back) else StarredScreen(repository, onBack = back, onOpenChat = openChat) }
        composable(Routes.SCHEDULED) { if (decoy) DecoyEmpty("Scheduled messages", back) else ScheduledScreen(repository, onBack = back) }
        composable(Routes.SETTINGS) {
            SettingsScreen(repository, settingsStore, lock, user, onBack = back, onDevices = { nav.navigate(Routes.DEVICES) },
                onHiddenChats = { nav.navigate(Routes.HIDDEN) })
        }
        composable(Routes.DEVICES) { DevicesScreen(repository, onBack = back) }
        composable(Routes.ADMIN) {
            if (user.isAdmin && !decoy) AdminScreen(repository, onBack = back, onMonitor = { c -> nav.navigate(Routes.monitor(c.chatId, c.label)) })
            else LaunchedEffect(Unit) { nav.popBackStack() }
        }
        composable(
            Routes.MONITOR,
            idArg + listOf(navArgument("title") { type = NavType.StringType; defaultValue = "Chat" }),
        ) { entry ->
            val chatId = entry.arguments?.getString("chatId").orEmpty()
            val title = entry.arguments?.getString("title") ?: "Chat"
            if (user.isAdmin && !decoy) MonitorChatScreen(repository, chatId, title, onBack = back,
                onGallery = { nav.navigate(Routes.gallery(chatId, true, title)) })
        }
    }
}

@Composable
private fun DecoyEmpty(title: String, onBack: () -> Unit) {
    androidx.compose.material3.Scaffold(containerColor = PavaColors.Background, topBar = { SimpleTopBar(title, onBack) }) { padding ->
        Box(Modifier.padding(padding)) { EmptyState(androidx.compose.material.icons.Icons.Filled.Inbox, "Nothing here", "No messages yet.") }
    }
}

@Composable
private fun ChatList(repository: ChatRepository, user: User, nav: NavHostController, archived: Boolean, lock: AppLock, hidePreviews: Boolean) {
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    ChatListScreen(
        repository = repository,
        user = user,
        archived = archived,
        onOpenChat = { nav.navigate(Routes.chat(it)) { launchSingleTop = true } },
        onNewChat = { nav.navigate(Routes.NEW_CHAT) },
        onOpenArchived = { nav.navigate(Routes.ARCHIVED) },
        onBack = { nav.popBackStack() },
        onSearch = { nav.navigate(Routes.SEARCH) },
        onStarred = { nav.navigate(Routes.STARRED) },
        onNotesToSelf = {
            scope.launch {
                runCatching { repository.startSelfChat() }
                    .onSuccess { nav.navigate(Routes.chat(it.chatId)) { launchSingleTop = true } }
            }
        },
        onScheduled = { nav.navigate(Routes.SCHEDULED) },
        onSettings = { nav.navigate(Routes.SETTINGS) },
        onAdmin = { nav.navigate(Routes.ADMIN) },
        lock = lock,
        hidePreviews = hidePreviews,
        onHiddenChats = { nav.navigate(Routes.HIDDEN) },
    )
}
