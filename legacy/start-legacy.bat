@echo off
rem The pre-rewrite app, kept for reference (see docs/PARITY.md).
setlocal
title ChatChat (legacy)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH.
  pause
  exit /b 1
)

node tools\serve.js %* --open
if errorlevel 1 pause
endlocal
