-- Group conversations.
--
-- The schema was group-shaped from the start (v3_conversations.type/title, N-member
-- v3_conversation_members with a role, conversation-keyed messages/receipts/summaries),
-- so groups need almost no new structure — just who created a group and its avatar.

-- Who created the group (admin). Null for the pre-existing direct chats.
alter table v3_conversations add column if not exists created_by bigint references v3_users (user_id);

-- Optional single-emoji/short avatar label for a group (direct chats derive theirs from the peer).
alter table v3_conversations add column if not exists avatar_emoji text;

-- A group member's role: 'admin' can rename, add/remove members and promote; 'member' cannot.
-- The column already exists (default 'member'); this is just here for documentation and safety.
alter table v3_conversation_members add column if not exists role text not null default 'member';

-- Lets a member hide/leave a group without affecting others: their summary row is removed on leave,
-- which the existing hideChatForUser path already handles. No extra column needed.

create index if not exists idx_v3_conversations_type on v3_conversations (type);
