@echo off
setlocal
cd /d "%~dp0"

if not exist "python\python.exe" (
  echo Missing portable Python runtime.
  echo This folder is incomplete. Please use the full SigmaSightExtraPortable package from GitHub Actions.
  pause
  exit /b 1
)

echo Starting SigmaSightExtra offline...
echo Keep this window open while using the dashboard.
echo.
"%~dp0python\python.exe" "%~dp0portable_server.py"

if errorlevel 1 (
  echo.
  echo SigmaSightExtra did not start correctly.
  echo If a log file exists, send SigmaSightExtra-startup.log for troubleshooting.
  pause
)
