@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"

echo.
echo  PaVa-V3 ^| Production Build
echo  ==============================
echo.

:: ── 1. Backend tests ────────────────────────────────────────────────────
echo  [1/3] Running backend tests...
pushd "%ROOT%b3"
call npm test
if errorlevel 1 (
  popd
  echo.
  echo  FAILED: Backend tests did not pass. Fix errors before building.
  pause
  exit /b 1
)
popd
echo  Backend tests passed.
echo.

:: ── 2. Frontend production build ────────────────────────────────────────
echo  [2/3] Building frontend (Vite production build)...
pushd "%ROOT%f3"
call npm run build
if errorlevel 1 (
  popd
  echo.
  echo  FAILED: Frontend build failed.
  pause
  exit /b 1
)
popd
echo  Frontend built to f3\dist\
echo.

:: ── 3. Verify backend loads ─────────────────────────────────────────────
echo  [3/3] Checking backend startup...
pushd "%ROOT%b3"
node --check server.js
if errorlevel 1 (
  popd
  echo.
  echo  FAILED: Backend has syntax errors.
  pause
  exit /b 1
)
popd
echo  Backend OK.
echo.

echo  ==============================
echo  Build complete.
echo.
echo  To deploy:
echo    1. Copy b3\ to your VPS
echo    2. Copy f3\dist\ to your VPS (serve with Nginx)
echo    3. Run: pm2 start b3\server.js --name pava-b3
echo.
pause
