@echo off
rem One-click launcher: boots the API + web servers if needed, then opens the app.
setlocal
cd /d "%~dp0"

powershell -NoProfile -Command "try { (New-Object Net.Sockets.TcpClient('127.0.0.1',3100)).Close(); exit 0 } catch { exit 1 }"
if %errorlevel%==0 goto open

start "HireYou Apply servers" /min cmd /k "npm run dev"
echo Starting HireYou Apply servers...
timeout /t 8 /nobreak >nul

:open
start http://localhost:5180
endlocal
