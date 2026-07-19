# Decision Log

2026-04-02
- Start V3 as a brand new workspace
- No reuse of old code
- New database required
- New Firebase project required
- Backend stack target: Fastify + direct SQL hot paths
- Web and Android will consume the same contract
- Fixed local ports for V3:
  - b3: 3201
  - f3: 3202
  - Android emulator target for b3: http://10.0.2.2:3201

2026-06-14
- Phase 1–4 foundation implemented
- Refresh tokens carry full user identity (displayName, isAdmin)
- Socket.IO realtime on `/socket.io` with JWT handshake
- Receipt flow: delivered, read, batch chat read
- `CHAT_STORAGE_MODE` supports legacy, normalized, dual-write
- Production requires JWT secrets; dev defaults only in non-production
- f3 uses Vite env files; a3 uses product flavors (dev/staging/prod)
