# a3 Android App

Package: `com.pavavak.v3`

Stack
- Native Kotlin + Activities
- Retrofit + OkHttp (token refresh authenticator)
- Socket.IO client

Status
- Dev login, chat list, thread, send message
- Automatic token refresh on 401
- Realtime delivery and typing indicators
- Product flavors: `dev`, `staging`, `prod`

Build
```bash
./gradlew assembleDevDebug
```

Flavors
- `dev` — `http://10.0.2.2:3201/` (emulator)
- `staging` / `prod` — Cloud Run API URL
