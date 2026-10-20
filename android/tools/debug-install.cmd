@echo off
rem Builds the debug APK, installs it on the connected device/emulator and launches it.
call "%~dp0gradle-run.cmd" assembleDebug --console=plain -q
set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
"%ADB%" install -r "%~dp0..\app\build\outputs\apk\debug\app-debug.apk"
"%ADB%" shell am start -n com.pavavak.app.debug/com.pavavak.app.MainActivity
echo INSTALL_DONE
