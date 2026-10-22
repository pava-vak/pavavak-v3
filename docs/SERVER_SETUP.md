# PaVa Vak server setup

Hostinger VPS `187.127.190.15` (shared with other projects: Srivani, CTG). Only touch the PaVa pieces below.
No secrets in this file. They live on the server in root-only files (see "Secrets").

## Pieces

| Piece | Where |
|---|---|
| Web (f3 build) | `/var/www/pava-vak/f3/dist`, served by nginx (`/etc/nginx/sites-enabled/pava-vak`) |
| Backend (b3) | `/var/www/pava-vak/b3`, pm2 process `pava-vak-backend` |
| Database | docker container `pava-db` (`postgres:15`), db `pava_v3`, user `pava` |
| Android APK | `/var/www/pava-vak/downloads/pava-vak.apk` + `android.json`, served at `/download/...` |
| Nightly DB backup | `/root/pava-backup.sh` via `/etc/cron.d/pava-backup` (uses `docker exec pava-db pg_dump`) |

## Rule: containers publish ports on 127.0.0.1 only

Docker writes its own iptables rules, so a published port is reachable from the internet even when
ufw only allows 22/80/443. **Every container port must be published as `127.0.0.1:<host>:<container>`.**
Apps on the server connect through `127.0.0.1` (the backend's `DATABASE_URL` uses `127.0.0.1:5433`).
If something outside the server ever needs the database, use an SSH tunnel; never open the port.

### pava-db (current)

Not managed by docker compose. Recreate it (same image, same data volume) like this:

```bash
# env file holds POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD (root-only)
docker run -d --name pava-db --restart unless-stopped \
  -p 127.0.0.1:5433:5432 \
  --env-file /root/pava-secrets/pava-db.env \
  -v 5c1e4de14d62e25562a55fa4b6241e846bae469a75d7c759fd32dea8c7945339:/var/lib/postgresql/data \
  postgres:15 postgres
```

The data volume is the unnamed one above. Never `docker rm -v` the container and never prune volumes.

## Secrets (on the server, mode 600, outside git and outside web roots)

- `/var/www/pava-vak/b3/.env`: backend settings (DB URL, JWT keys, VAPID, recovery token…)
- `/root/pava-secrets/pava-db.env`: database container credentials
- `/root/pava-secrets/firebase-service-account.json`: FCM sender key (`FIREBASE_SERVICE_ACCOUNT_PATH`)

## Incident log

### 2026-10-22: PaVa database port 5433 was open to the internet

- Found by a read-only check from the CTG session. `pava-db` published `0.0.0.0:5433`, bypassing ufw.
- Exposure: since the container was created (2026-09-23).
- Who connected: only the PaVa backend on the server (via 127.0.0.1). Backups use `docker exec`. Nothing outside.
- Signs of intrusion: none. No failed logins, FATAL errors, `COPY … PROGRAM`, extension loads or file reads in
  the container log; only the `pava` role; only expected databases; only `plpgsql`; no custom functions or
  triggers; only the app's tables; only the `admin` app admin. (Successful logins were not logged, because
  `log_connections` was off.)
- Fix: backup taken (`/root/pava_db_before_port_fix_20261022_005145.sql.gz`), container recreated with
  `-p 127.0.0.1:5433:5432` on the same image and volume, backend restarted.
- Verified: `Test-NetConnection 187.127.190.15 -Port 5433` fails from outside (443 still works); backend
  health OK, login path reads the DB, a write over the app's connection works.
- Password: not changed. It is 32 random characters and no failed attempts were ever logged.
- Not changed: Srivani's port 5432 (`srivani_postgres`) is also open; that is the Srivani project's to fix.
