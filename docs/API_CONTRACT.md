# V3 API Contract

Status: Active

Base path: `/api/v3`

## Auth

| Method | Path | Auth | Body |
|--------|------|------|------|
| POST | `/auth/dev-login` | No | `{ userId, username, displayName, isAdmin? }` |
| POST | `/auth/refresh` | No | `{ refreshToken }` → `{ tokens, user }` |
| GET | `/me` | Bearer | — |

## Chats

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/chats` | Bearer | Chat list |
| GET | `/chats/:chatId/messages` | Bearer | `?cursor=&limit=` |
| POST | `/chats/:chatId/read` | Bearer | Mark all incoming messages read |

## Messages

| Method | Path | Auth | Body |
|--------|------|------|------|
| POST | `/messages` | Bearer | `{ chatId, text }` |
| POST | `/messages/:messageId/delivered` | Bearer | `{ chatId }` |
| POST | `/messages/:messageId/read` | Bearer | `{ chatId }` |

## Health

| Method | Path |
|--------|------|
| GET | `/health` |
| GET | `/health/dependencies` |
| GET | `/auth/health` |
