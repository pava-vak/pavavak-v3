alter table v3_users
  add column if not exists token_version integer not null default 0;
