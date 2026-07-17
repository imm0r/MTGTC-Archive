@echo off
setlocal
cd /d "%~dp0"

set PORT=8000
set PY=

rem Python finden: Launcher zuerst, dann PATH. Der python.exe-Stub aus dem
rem Microsoft Store meldet sich zwar, kann aber nichts - daher py bevorzugen.
where py >nul 2>&1 && set PY=py
if not defined PY (
  python -c "import sys" >nul 2>&1 && set PY=python
)
if not defined PY (
  echo.
  echo   Python wurde nicht gefunden.
  echo   Installieren ueber: winget install --id Python.Python.3.13 --scope user
  echo   oder https://www.python.org/downloads/  ^(Haken bei "Add python.exe to PATH"^)
  echo.
  pause
  exit /b 1
)

rem Aktuelle WLAN-/LAN-Adresse ermitteln, damit die Handy-URL immer stimmt.
for /f "delims=" %%I in ('powershell -NoProfile -Command ^
  "(Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } ^| Select-Object -First 1 -ExpandProperty IPAddress)"') do set IP=%%I

echo.
echo   ============================================
echo     Arcanum Archive laeuft
echo   ============================================
echo.
echo     Auf diesem PC:  http://localhost:%PORT%/
if defined IP echo     Auf dem Handy:  http://%IP%:%PORT%/
echo.
echo     Handy und PC muessen im selben WLAN sein.
echo     Beim ersten Start fragt die Windows-Firewall nach -
echo     "Zulassen" fuer private Netzwerke waehlen.
echo.
echo     Zum Beenden: dieses Fenster schliessen oder Strg+C
echo.

start "" "http://localhost:%PORT%/"
%PY% -m http.server %PORT%
