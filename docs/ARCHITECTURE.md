# V3 Architecture

Status: Active

Goal: Lightning-fast messenger built from zero with no code carryover from older versions.

## Layers

```
Clients (f3 web, a3 Android)
    │  REST /api/v3/*
    │  WebSocket /socket.io
    ▼
b3 (Fastify + Socket.IO)
    │  chatAdapter (legacy | normalized | dual-write)
    ▼
PostgreSQL (optional) or in-memory demo store
```

## Principles

- Speed first
- One clean backend contract
- One shared realtime contract
- Web and Android built against the same API/events
- No reuse of old code

## Auth

- JWT access + refresh tokens (HS256)
- Dev login for local/staging (`ALLOW_DEV_LOGIN`)
- Socket handshake uses access token

## Storage modes (`CHAT_STORAGE_MODE`)

| Mode | Description |
|------|-------------|
| `legacy` | Per-user mailbox tables (`v3_user_*`) — default |
| `normalized` | Shared conversation model (`v3_conversations`, `v3_messages`, receipts) |
| `dual-write` | Writes to both schemas during migration |

## Realtime

See [REALTIME_CONTRACT.md](./REALTIME_CONTRACT.md).

## Performance targets

See [PERFORMANCE_BUDGET.md](./PERFORMANCE_BUDGET.md).
