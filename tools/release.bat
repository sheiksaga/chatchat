@echo off
REM Build and pack a zip with only what a user needs to run chatchat.
REM   npm install, npm run build, then: tar -a (Windows bsdtar) writes a real .zip
REM Excludes data/, legacy/, node_modules/ and the notes: the app creates its own data folder.
setlocal
cd /d "%~dp0.."

call npm run verify || (echo verify failed, not packaging. & pause & exit /b 1)
call npm run build || (echo build failed, not packaging. & pause & exit /b 1)

if not exist dist mkdir dist
if exist dist\chatchat.zip del dist\chatchat.zip

tar -a -c -f dist\chatchat.zip ^
  --exclude data ^
  --exclude legacy ^
  --exclude node_modules ^
  --exclude dist ^
  --exclude _notes ^
  --exclude .git ^
  --exclude .svelte-kit ^
  --exclude .e2e-data ^
  --exclude test-results ^
  .

echo.
echo Wrote dist\chatchat.zip
echo Users unzip it, install Node.js 22+, and double-click start-chatchat.bat.
pause
endlocal
