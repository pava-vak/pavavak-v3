package com.pavavak.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull

// ── Auth / users ────────────────────────────────────────────────────────────

@Serializable
data class User(
    val userId: Long,
    val username: String,
    val displayName: String = username,
    val isAdmin: Boolean = false,
)

@Serializable
data class Tokens(val accessToken: String)

@Serializable
data class AuthResponse(val tokens: Tokens, val user: User, val sessionId: String? = null)

@Serializable
data class MeResponse(val user: User)

@Serializable
data class UserSearchResult(val userId: Long, val username: String, val displayName: String = username)

@Serializable
data class UserSearchResponse(val items: List<UserSearchResult> = emptyList())

@Serializable
data class Presence(val online: Boolean = false, val lastSeenAt: String? = null)

@Serializable
data class SessionInfo(
    val id: String,
    @kotlinx.serialization.SerialName("device_name") val deviceName: String? = null,
    @kotlinx.serialization.SerialName("ip_address") val ipAddress: String? = null,
    @kotlinx.serialization.SerialName("last_used_at") val lastUsedAt: String? = null,
    val isCurrent: Boolean = false,
)

@Serializable
data class SessionsResponse(val sessions: List<SessionInfo> = emptyList())

// ── Chats ───────────────────────────────────────────────────────────────────

@Serializable
data class LastMessage(
    val messageId: String? = null,
    val text: String? = null,
    val sentAt: String? = null,
    val direction: String? = null,
    val status: String? = null,
)

@Serializable
data class ChatSummary(
    val chatId: String,
    val chatType: String = "direct",
    val title: String? = null,
    val subtitle: String? = null,
    val avatarText: String? = null,
    val unreadCount: Int = 0,
    val muted: Boolean = false,
    val archived: Boolean = false,
    val background: String? = null,
    // Postgres bigint arrives as a JSON string
    val peerId: JsonPrimitive? = null,
    val lastMessage: LastMessage? = null,
) {
    val peerUserId: Long? get() = peerId?.longOrNull ?: peerId?.content?.toLongOrNull()
    val displayTitle: String get() = title?.takeIf { it.isNotBlank() } ?: "Chat"
    val isDirect: Boolean get() = chatType == "direct"
}

@Serializable
data class ChatListResponse(val items: List<ChatSummary> = emptyList())

@Serializable
data class DirectChatResponse(val chat: ChatSummary)

// ── Messages ────────────────────────────────────────────────────────────────

@Serializable
data class Poll(
    val question: String = "",
    val options: List<String> = emptyList(),
    val votes: Map<String, Int> = emptyMap(),
    val myVote: Int? = null,
) {
    val totalVotes: Int get() = votes.values.sum()
}

@Serializable
data class Message(
    val messageId: String,
    val direction: String = "incoming",
    val senderDisplayName: String? = null,
    val text: String = "",
    val sentAt: String = "",
    val status: String = "sent",
    val viewOnce: Boolean = false,
    val viewOnceOpened: Boolean = false,
    val expiresAt: String? = null,
    val deleted: Boolean = false,
    val edited: Boolean = false,
    val editedAt: String? = null,
    val forwarded: Boolean = false,
    val poll: Poll? = null,
    /** Sent without sound or notification. */
    val silent: Boolean = false,
    /** Burn after reading: seconds after the recipient reads it before it is deleted for both. */
    val burnSeconds: Int? = null,
    // Admin monitoring only
    val deletedAt: String? = null,
) {
    val isOutgoing: Boolean get() = direction == "outgoing"
    val isLocal: Boolean get() = messageId.startsWith("local-")
    val content: MessageContent get() = MessageContent.parse(text)
    val isMedia: Boolean get() = content.let {
        it is MessageContent.Image || it is MessageContent.Video || it is MessageContent.Audio || it is MessageContent.Document
    }
}

@Serializable
data class Page(val nextCursor: String? = null, val hasMore: Boolean = false)

@Serializable
data class ThreadResponse(val items: List<Message> = emptyList(), val page: Page = Page())

/** Admin monitoring returns the page fields at the top level. */
@Serializable
data class AdminThreadResponse(val items: List<Message> = emptyList(), val nextCursor: String? = null, val hasMore: Boolean = false)

@Serializable
data class SendResponse(val message: Message)

@Serializable
data class IdResponse(val messageId: String? = null)

data class Reaction(val userId: Long, val displayName: String, val emoji: String)

@Serializable
data class PinnedMessage(val messageId: String, val text: String? = null, val senderName: String? = null)

@Serializable
data class PinnedResponse(val pinned: PinnedMessage? = null)

@Serializable
data class LinkPreview(
    val title: String? = null,
    val description: String? = null,
    @kotlinx.serialization.SerialName("image_url") val imageUrl: String? = null,
    @kotlinx.serialization.SerialName("site_name") val siteName: String? = null,
)

@Serializable
data class LinkPreviewResponse(val preview: LinkPreview? = null)

@Serializable
data class MediaItem(
    val messageId: String,
    val fileId: String,
    val type: String,
    val sentAt: String? = null,
    val senderName: String? = null,
)

@Serializable
data class MediaPage(val items: List<MediaItem> = emptyList(), val hasMore: Boolean = false, val nextCursor: String? = null)

@Serializable
data class FoundMessage(
    val messageId: String,
    val chatId: String,
    val text: String = "",
    val sentAt: String? = null,
    val senderName: String? = null,
    val chatTitle: String? = null,
    val starredAt: String? = null,
)

@Serializable
data class SearchResponse(val messages: List<FoundMessage> = emptyList())

@Serializable
data class ScheduledItem(
    val id: JsonPrimitive,
    val chatId: String,
    val text: String = "",
    val scheduledAt: String? = null,
    val chatTitle: String? = null,
) {
    val key: String get() = id.content
}

@Serializable
data class ScheduledResponse(val items: List<ScheduledItem> = emptyList())

@Serializable
data class UploadResponse(val fileId: String)

@Serializable
data class EditVersion(val text: String = "", val editedAt: String? = null)

@Serializable
data class EditHistoryResponse(val edits: List<EditVersion> = emptyList())

@Serializable
data class IceServer(
    val urls: List<String> = emptyList(),
    val username: String? = null,
    val credential: String? = null,
)

@Serializable
data class IceConfig(
    val enabled: Boolean = false,
    val iceServers: List<IceServer> = emptyList(),
    val ttl: Int = 3600,
)

@Serializable
data class PrivacyResponse(
    val ghostMode: Boolean = false,
    val lastSeenVisibility: String = "everyone",
    val onlineVisibility: String = "everyone",
)

// Latest published Android build, from /download/android.json
@Serializable
data class AppRelease(
    val versionName: String = "",
    val versionCode: Int = 0,
    // Builds below this must update before the app can be used (breaking change floor). 0 = none forced.
    val minVersionCode: Int = 0,
    val url: String = "",
    val sizeBytes: Long = 0,
    val sha256: String? = null,
)

// ── Admin ───────────────────────────────────────────────────────────────────

@Serializable
data class AdminSummary(val users: Int = 0, val conversations: Int = 0, val messages: Int = 0)

@Serializable
data class AdminSummaryResponse(val summary: AdminSummary = AdminSummary())

@Serializable
data class AdminUser(
    val userId: Long,
    val username: String,
    val displayName: String = username,
    val isAdmin: Boolean = false,
    val disabled: Boolean = false,
)

@Serializable
data class AdminUsersResponse(val items: List<AdminUser> = emptyList())

@Serializable
data class Participant(val userId: Long, val username: String = "", val displayName: String = "")

@Serializable
data class AdminChat(
    val chatId: String,
    val chatType: String = "direct",
    val title: String? = null,
    val participants: List<Participant> = emptyList(),
    val lastMessage: LastMessage? = null,
    val lastSentAt: String? = null,
) {
    val label: String get() = if (chatType == "direct" || title.isNullOrBlank())
        participants.joinToString(" & ") { it.displayName.ifBlank { it.username } } else title
}

@Serializable
data class AdminChatsResponse(val items: List<AdminChat> = emptyList())

@Serializable
data class TempPasswordResponse(val temporaryPassword: String = "")

@Serializable
data class ApiError(val error: String? = null)

// ── Body markers ────────────────────────────────────────────────────────────

/** What a message body means, since media is sent as text markers (e.g. "__IMG__:<fileId>"). */
sealed interface MessageContent {
    data class Text(val text: String, val quote: String?) : MessageContent
    data class Image(val fileId: String) : MessageContent
    data class Video(val fileId: String) : MessageContent
    data class Audio(val fileId: String) : MessageContent
    data class Document(val fileId: String, val fileName: String) : MessageContent
    data object Poll : MessageContent
    data object SystemUpdate : MessageContent
    /** Local-only placeholder while a photo/video/file/voice note uploads. */
    data class Uploading(val label: String) : MessageContent

    companion object {
        fun parse(body: String): MessageContent = when {
            body.startsWith(ChatRepository.UPLOADING) -> Uploading(body.removePrefix(ChatRepository.UPLOADING))
            body.startsWith("__IMG__:") -> Image(body.removePrefix("__IMG__:"))
            body.startsWith("__VID__:") -> Video(body.removePrefix("__VID__:"))
            body.startsWith("__AUD__:") -> Audio(body.removePrefix("__AUD__:"))
            body.startsWith("__DOC__:") -> body.removePrefix("__DOC__:").let {
                Document(it.substringBefore(':'), it.substringAfter(':', "Document").ifBlank { "Document" })
            }
            body.startsWith("__POLL__:") -> Poll
            body == "__SYS_UPDATE__" -> SystemUpdate
            // Replies are sent as "> quoted line\nreply text"
            body.startsWith("> ") && body.contains('\n') ->
                Text(body.substringAfter('\n'), body.substringBefore('\n').removePrefix("> "))
            else -> Text(body, null)
        }
    }
}

fun previewText(body: String?, viewOnce: Boolean = false): String {
    if (viewOnce) return "👁 View once message"
    return when (val c = MessageContent.parse(body.orEmpty())) {
        is MessageContent.Image -> "📷 Photo"
        is MessageContent.Video -> "🎥 Video"
        is MessageContent.Audio -> "🎤 Voice note"
        is MessageContent.Document -> "📄 ${c.fileName}"
        MessageContent.Poll -> "📊 Poll"
        MessageContent.SystemUpdate -> "🔄 App update"
        is MessageContent.Uploading -> c.label
        is MessageContent.Text -> c.text.replace('\n', ' ').trim()
    }
}

/** Body sent for a reply, matching the web app: "> {quoted text, 80 chars}\n{reply}". */
fun replyBody(quoted: Message, reply: String): String {
    val q = previewText(quoted.text).replace('\n', ' ').take(80)
    return "> $q\n$reply"
}

internal fun JsonObject.str(key: String): String? =
    (this[key] as? JsonPrimitive)?.takeIf { it.isString || it.content != "null" }?.content

internal fun JsonObject.int(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull

internal fun JsonElement?.asLong(): Long? = (this as? JsonPrimitive)?.let { it.longOrNull ?: it.content.toLongOrNull() }
