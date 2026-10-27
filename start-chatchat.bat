@echo off
setlocal
title chatchat
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH.
  echo Install Node.js 22 or newer from nodejs.org, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo First run: installing dependencies. This can take a few minutes.
  call npm install || (echo npm install failed. & pause & exit /b 1)
)

rem Rebuild when there is no build yet, or when the source is newer than it (set CHATCHAT_REBUILD=1
rem to force). Nothing here talks to the network except npm install on the very first run.
if not exist "build\index.js" set NEED_BUILD=1
if "%CHATCHAT_REBUILD%"=="1" set NEED_BUILD=1
if defined NEED_BUILD (
  echo Building...
  call npm run build || (echo Build failed. & pause & exit /b 1)
)

rem LAN access: bind to all interfaces so a phone on the same network (or Tailscale)
rem can reach the app. A token in CHATCHAT_TOKEN gates non-loopback requests; without
rem one, only this machine can connect.
if "%HOST%"=="" set HOST=0.0.0.0
if "%PORT%"=="" set PORT=4173

echo.
echo   chatchat is starting on http://localhost:%PORT%
if not "%CHATCHAT_TOKEN%"=="" echo   LAN devices: http://^<this-pc-ip^>:%PORT%/login?token=%CHATCHAT_TOKEN%
echo   Press Ctrl+C to stop.
echo.
node build
if errorlevel 1 pause
endlocal
