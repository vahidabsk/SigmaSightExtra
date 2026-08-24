@echo off
setlocal

echo SigmaSightExtra portable package builder
echo.
echo This file is ONLY for a build computer that already has Python installed.
echo It is NOT the file to run on a coworker's host computer.
echo.
where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher 'py' was not found on this computer.
  echo.
  echo For a host/coworker computer, do not run this build file.
  echo Send the GitHub Actions artifact named SigmaSightExtraPortable instead.
  echo The coworker should extract that artifact and run:
  echo Start SigmaSightExtra.cmd
  echo.
  pause
  exit /b 1
)

echo Python was found. For the recommended build, use GitHub Actions:
echo Actions ^> Build portable Windows app ^> Download artifact SigmaSightExtraPortable
echo.
echo This local build file is intentionally disabled to avoid creating antivirus-blocked PyInstaller EXEs.
echo.
pause
exit /b 0
