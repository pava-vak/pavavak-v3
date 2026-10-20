@echo off
rem Runs a Gradle build with Android Studio's JDK.
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "PATH=%JAVA_HOME%\bin;%PATH%"
set "ROOT=%~dp0.."
pushd "%ROOT%"
if exist "%ROOT%\gradlew.bat" (
  call "%ROOT%\gradlew.bat" %*
) else (
  call "%USERPROFILE%\.gradle\wrapper\dists\gradle-8.14.3-all\10utluxaxniiv4wxiphsi49nj\gradle-8.14.3\bin\gradle.bat" %*
)
set "CODE=%ERRORLEVEL%"
popd
echo GRADLE_EXIT=%CODE%
