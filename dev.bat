@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"

echo.
echo  PaVa-V3 ^| Dev servers
echo  ========================
echo  Backend  -^>  http://localhost:3201
echo  Web app  -^>  http://localhost:3202
echo.

:: ── Kill anything already on port 3201 ──────────────────────────────────
echo  Checking port 3201...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3201 "') do (
  taskkill /PID %%a /F >nul 2>&1
)

:: ── Kill anything already on port 3202 ──────────────────────────────────
echo  Checking port 3202...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3202 "') do (
  taskkill /PID %%a /F >nul 2>&1
)

:: Give OS a moment to release the ports
timeout /t 1 /nobreak >nul

:: ── Install deps if missing ──────────────────────────────────────────────
if not exist "%ROOT%b3\node_modules" (
  echo  Installing b3 dependencies...
  pushd "%ROOT%b3" && call npm install && popd
)

if not exist "%ROOT%f3\node_modules" (
  echo  Installing f3 dependencies...
  pushd "%ROOT%f3" && call npm install && popd
)

:: ── Start servers ────────────────────────────────────────────────────────
start "PaVa  b3  :3201" cmd /k "title PaVa b3 :3201 && cd /d "%ROOT%b3" && npm run dev"
start "PaVa  f3  :3202" cmd /k "title PaVa f3 :3202 && cd /d "%ROOT%f3" && npm run dev"

timeout /t 2 /nobreak >nul
start "" "http://localhost:3202"
