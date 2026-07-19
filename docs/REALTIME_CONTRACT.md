# V3 Realtime Contract

Status: Active

Transport
- Socket.IO v4
- Path: `/socket.io`
- Auth handshake: `{ auth: { token: <access JWT> } }`

## Server → Client

| Event | Payload | When |
|-------|---------|------|
| `message:new` | `{ chatId, message }` | Message created |
| `chat:updated` | `{ chatId, lastMessage?, unreadCount? }` | Chat summary changed |
| `message:delivered` | `{ chatId, messageId, status }` | Delivery acknowledged; sent to the original sender when sender identity is available |
| `message:read` | `{ chatId, messageId, status, unreadCount? }` | Message read; sent to the original sender when sender identity is available |
| `typing:start` | `{ chatId, userId, displayName }` | Remote user typing |
| `typing:stop` | `{ chatId, userId }` | Remote user stopped typing |
| `presence:online` | `{ chatId, userId, displayName?, lastSeenAt }` | User connected |
| `presence:offline` | `{ chatId, userId, lastSeenAt }` | User disconnected |

## Client → Server

| Event | Payload | Server action |
|-------|---------|---------------|
| `chat:join` | `{ chatId }` | Join `chat:{chatId}` room |
| `typing:start` | `{ chatId }` | Verify membership, then broadcast typing to chat room |
| `typing:stop` | `{ chatId }` | Verify membership, then broadcast stop to chat room |

## Rooms

- `user:{userId}` — personal delivery (all tabs/devices)
- `chat:{chatId}` — typing indicators and future multi-user fan-out

## Reconnection

- Clients reconnect with exponential backoff
- Refresh access token on REST 401 or socket auth failure, then reconnect socket with updated token
