# b3 Backend

Stack
- Fastify
- pg for direct SQL hot paths
- Socket.IO for realtime
- JWT access + refresh tokens

Status
- Phase 1 foundation hardening complete
- Realtime Socket.IO active
- Message receipts (sent/delivered/read)
- Legacy + normalized storage modes

Local
- API: `http://localhost:3201`
- Socket path: `/socket.io`

Storage modes (`CHAT_STORAGE_MODE`)
- `legacy` (default) — per-user mailbox tables
- `normalized` — shared conversation model
- `dual-write` — migration mode
