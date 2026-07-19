@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "SKIP_ANDROID=0"

if /I "%~1"=="--skip-android" set "SKIP_ANDROID=1"
if /I "%~1"=="--start-only" goto START_SERVERS
if /I "%~1"=="--help" goto HELP

echo.
echo PaVa-V3: test, build, and start local servers
echo Root: %ROOT%
echo.

if not exist "%ROOT%b3\package.json" (
  echo Missing backend package: %ROOT%b3\package.json
  exit /b 1
)

if not exist "%ROOT%f3\package.json" (
  echo Missing frontend package: %ROOT%f3\package.json
  exit /b 1
)

echo [1/4] Backend tests
pushd "%ROOT%b3"
call npm test
if errorlevel 1 (
  popd
  echo Backend tests failed.
  exit /b 1
)
popd

echo.
echo [2/4] Web production build
pushd "%ROOT%f3"
call npm run build
if errorlevel 1 (
  popd
  echo Web build failed.
  exit /b 1
)
popd

if "%SKIP_ANDROID%"=="1" goto SKIP_ANDROID_BUILD

echo.
echo [3/4] Android dev debug build
pushd "%ROOT%a3"
call gradlew.bat assembleDevDebug
if errorlevel 1 (
  popd
  echo Android build failed.
  exit /b 1
)
popd
goto AFTER_ANDROID

:SKIP_ANDROID_BUILD
echo.
echo [3/4] Android dev debug build skipped.

:AFTER_ANDROID
echo.
echo [4/4] Starting backend and web servers

:START_SERVERS
start "PaVa-V3  b3  API :3201" cmd /k "cd /d "%ROOT%b3" && npm run dev"
start "PaVa-V3  f3  Web :3202" cmd /k "cd /d "%ROOT%f3" && npm run dev"

echo.
echo Servers are starting in separate windows:
echo - Backend API: http://localhost:3201
echo - Web app:     http://localhost:3202
echo.
echo Useful options:
echo - start-all-and-test.bat --skip-android
echo - start-all-and-test.bat --start-only
exit /b 0

:HELP
echo Usage:
echo   start-all-and-test.bat
echo   start-all-and-test.bat --skip-android
echo   start-all-and-test.bat --start-only
echo.
echo Default mode runs backend tests, web build, Android dev debug build, then starts b3 and f3.
echo --skip-android skips the Android build.
echo --start-only starts b3 and f3 without running tests/builds.
exit /b 0
