package com.pavavak.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull

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
data class AuthResponse(
    val tokens: Tokens,
    val user: User,
    val sessionId: String? = null,
)

@Serializable
data class MeResponse(val user: User)

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
    // Postgres bigint arrives as a JSON string
    val peerId: JsonPrimitive? = null,
    val lastMessage: LastMessage? = null,
) {
    val peerUserId: Long? get() = peerId?.longOrNull ?: peerId?.content?.toLongOrNull()
    val displayTitle: String get() = title?.takeIf { it.isNotBlank() } ?: "Chat"
}

@Serializable
data class ChatListResponse(val items: List<ChatSummary> = emptyList())

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
) {
    val isOutgoing: Boolean get() = direction == "outgoing"
}

@Serializable
data class Page(val nextCursor: String? = null, val hasMore: Boolean = false)

@Serializable
data class ThreadResponse(val items: List<Message> = emptyList(), val page: Page = Page())

@Serializable
data class SendResponse(val message: Message)

@Serializable
data class UserSearchResult(val userId: Long, val username: String, val displayName: String = username)

@Serializable
data class UserSearchResponse(val items: List<UserSearchResult> = emptyList())

@Serializable
data class DirectChatResponse(val chat: ChatSummary)

@Serializable
data class ApiError(val error: String? = null)

/** What a message body means, since media is sent as text markers (e.g. "__IMG__:<fileId>"). */
sealed interface MessageContent {
    data class Text(val text: String) : MessageContent
    data class Image(val fileId: String) : MessageContent
    data class Video(val fileId: String) : MessageContent
    data class Audio(val fileId: String) : MessageContent
    data class Document(val fileId: String, val fileName: String) : MessageContent
    data object Poll : MessageContent
    data object SystemUpdate : MessageContent

    companion object {
        fun parse(body: String): MessageContent = when {
            body.startsWith("__IMG__:") -> Image(body.removePrefix("__IMG__:"))
            body.startsWith("__VID__:") -> Video(body.removePrefix("__VID__:"))
            body.startsWith("__AUD__:") -> Audio(body.removePrefix("__AUD__:"))
            body.startsWith("__DOC__:") -> body.removePrefix("__DOC__:").let {
                Document(it.substringBefore(':'), it.substringAfter(':', "Document"))
            }
            body.startsWith("__POLL__:") -> Poll
            body == "__SYS_UPDATE__" -> SystemUpdate
            else -> Text(body)
        }
    }
}

fun previewText(body: String?): String = when (val c = MessageContent.parse(body.orEmpty())) {
    is MessageContent.Image -> "📷 Photo"
    is MessageContent.Video -> "🎥 Video"
    is MessageContent.Audio -> "🎤 Voice note"
    is MessageContent.Document -> "📄 ${c.fileName}"
    MessageContent.Poll -> "📊 Poll"
    MessageContent.SystemUpdate -> "🔄 App update"
    is MessageContent.Text -> c.text.lineSequence().firstOrNull { !it.startsWith("> ") }?.trim()
        ?: c.text
}
