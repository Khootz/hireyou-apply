@echo off
rem One-click launcher: ensures a FRESH healthy API+web pair, then opens the app.
setlocal
cd /d "%~dp0"

rem If both are already healthy, just open the browser.
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3100/health' -Headers @{Authorization='Bearer dev-local-token-change-me'} -TimeoutSec 2; $w = New-Object Net.Sockets.TcpClient('127.0.0.1',5180); $w.Close(); exit 0 } catch { exit 1 }"
if %errorlevel%==0 goto open

echo Cleaning up any half-dead servers...
powershell -NoProfile -Command "3100,5180 | ForEach-Object { Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue } | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"

echo Starting HireYou Apply servers...
start "HireYou Apply servers" /min cmd /k "npm run dev"

rem Wait until the API actually answers (up to ~30s).
powershell -NoProfile -Command "for ($i=0; $i -lt 30; $i++) { try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3100/health' -Headers @{Authorization='Bearer dev-local-token-change-me'} -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep 1 } }; exit 1"
if not %errorlevel%==0 echo API did not come up - check the minimized "HireYou Apply servers" window for errors.

:open
rem Hosted UI on Vercel; it talks to the local API on 127.0.0.1:3100.
start https://hireyou-apply.vercel.app
endlocal
