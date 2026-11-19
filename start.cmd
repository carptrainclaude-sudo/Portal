@echo off
rem Procurement portal: one-command start (uses portable Node.js from tools\node if present).
chcp 65001 >nul
cd /d "%~dp0"
if exist "%~dp0tools\node\node.exe" set "PATH=%~dp0tools\node;%PATH%"
where node >nul 2>nul || (echo Node.js not found. See README.md & pause & exit /b 1)
if not exist "%~dp0node_modules" (
  echo Installing dependencies...
  call npm install --no-fund --no-audit || (pause & exit /b 1)
)
node scripts\start.mjs %*
