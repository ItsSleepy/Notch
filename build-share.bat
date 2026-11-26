@echo off
rem Rebuilds Notch with Phone share and restarts it.
cd /d "%~dp0"
echo Closing Notch...
taskkill /im notch.exe /f >nul 2>&1
echo Building (first build after new packages takes a few minutes)...
call npm run tauri build -- --no-bundle
if errorlevel 1 (
  echo.
  echo BUILD FAILED - send Claude the error above.
  pause
  exit /b 1
)
copy /y "src-tauri\target\release\notch.exe" "notch.exe" >nul
start "" "%~dp0notch.exe"
echo.
echo Done. Notch is running with Phone share.
echo Open the phone icon on the bar and press "Turn on".
pause
