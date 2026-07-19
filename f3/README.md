# f3 Web Frontend

Stack
- Vanilla JavaScript + Vite
- Socket.IO client

Status
- Dev auth, chat list, thread, send message
- Automatic token refresh on 401
- Realtime message delivery and typing indicators
- Environment-based API URL via Vite env files

Local
- Dev server: `http://localhost:3202`
- Proxies `/api` and `/socket.io` to b3 in development

Environments
- `.env.development` — local proxy (empty `VITE_API_BASE_URL`)
- `.env.staging` — staging API
- `.env.production` — production API
