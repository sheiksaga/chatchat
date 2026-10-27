@echo off
setlocal
title ChatChat local server
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)

rem serve.js binds to 127.0.0.1 and falls back to the next free port when the
rem default (8765) is already used, so it will not fight the image server or
rem any other local service. The chosen URL is printed and opened.
node tools\serve.js %* --open
if errorlevel 1 pause
endlocal
