@echo off
cd /d "%~dp0"

if not exist package.json (
  echo This launcher has to live inside the PDF Relief project folder.
  echo That folder contains package.json.
  echo Clone or unzip the project, then run this file from inside that folder.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo Node.js is not on your PATH. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)

echo Opening PDF Relief from:
echo   %CD%
echo.
call npm install
call npm run desktop
