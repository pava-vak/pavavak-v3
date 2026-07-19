# V3 Database Schema

Status: Active

Decision: Brand new database for V3. No shared schema with older versions.

## Legacy mailbox (default — `CHAT_STORAGE_MODE=legacy`)

Per-user denormalized tables for rapid prototyping:

- `v3_user_chats` — chat list rows per user
- `v3_user_messages` — messages per user/chat

Bootstrap: `b3/sql/001_chat_bootstrap.sql`

## Normalized production schema (`CHAT_STORAGE_MODE=normalized`)

Single source of truth for multi-user messaging:

| Table | Purpose |
|-------|---------|
| `v3_users` | Identity |
| `v3_conversations` | Shared conversations |
| `v3_conversation_members` | Membership |
| `v3_messages` | One row per message |
| `v3_message_receipts` | Per-user delivered/read |
| `v3_user_chat_summaries` | Fast chat list cache |

Bootstrap: `b3/sql/002_normalized_schema.sql`

Receipt indexes: `b3/sql/003_receipt_indexes.sql`

Legacy → normalized migration: `b3/sql/004_migrate_legacy_data.sql`

## Migration

1. Run `npm run db:migrate` from `b3` to apply the SQL files alongside legacy tables
2. Set `CHAT_STORAGE_MODE=dual-write` to write both
3. Run `npm run db:check-parity` from `b3`
4. Switch to `normalized` for reads
5. Retire `v3_user_*` after validation

Recommended cutover commands:

```bash
cd b3
npm run db:migrate
npm run db:check-parity
```

Only set `CHAT_STORAGE_MODE=normalized` after parity passes against the target database.

## Scale guidance

| Users | Legacy model | Normalized model |
|-------|--------------|------------------|
| 100 | OK for dev | Recommended |
| 1,000 | Poor (no shared truth) | Good |
| 10,000 | Fails | Good with summary cache |
| 100,000 | Fails | Needs read replicas + socket Redis adapter |
