@echo off
setlocal

echo Building SigmaSightExtra PORTABLE Windows app...
echo.
echo Final portable app will be created at:
echo dist\SigmaSightExtraPortable
echo.

set "BUILD_ROOT=%TEMP%\SigmaSightExtraBuild"
set "VENV_DIR=%BUILD_ROOT%\venv"
set "PORTABLE_DIR=dist\SigmaSightExtraPortable"
set "PORTABLE_ZIP=dist\SigmaSightExtraPortable.zip"

if exist "%BUILD_ROOT%" rmdir /s /q "%BUILD_ROOT%"
if exist "%PORTABLE_DIR%" rmdir /s /q "%PORTABLE_DIR%"
if exist "%PORTABLE_ZIP%" del /q "%PORTABLE_ZIP%"
mkdir "%BUILD_ROOT%" || goto :error

py -m venv "%VENV_DIR%" || goto :error
call "%VENV_DIR%\Scripts\activate.bat" || goto :error

python -m pip install --upgrade pip || goto :error
python -m pip install -r requirements-desktop.txt || goto :long_path_error

python -m PyInstaller ^
  --noconfirm ^
  --clean ^
  --windowed ^
  --onedir ^
  --collect-all pandas ^
  --collect-all openpyxl ^
  --collect-all numpy ^
  --collect-submodules fastapi ^
  --collect-submodules starlette ^
  --collect-submodules pydantic ^
  --collect-submodules uvicorn ^
  --collect-submodules multipart ^
  --collect-submodules python_multipart ^
  --name SigmaSightExtra ^
  --add-data "index.html;." ^
  --add-data "defects.html;." ^
  --add-data "us.svg;." ^
  --add-data "vendor;vendor" ^
  portable_launcher.py || goto :error

ren dist\SigmaSightExtra SigmaSightExtraPortable || goto :error
copy PORTABLE_README.txt "%PORTABLE_DIR%\README.txt" >nul || goto :error

powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '%PORTABLE_DIR%\*' -DestinationPath '%PORTABLE_ZIP%' -Force" || goto :error

echo.
echo Done.
echo Portable folder:
echo %PORTABLE_DIR%
echo.
echo Portable zip:
echo %PORTABLE_ZIP%
echo.
echo Copy the folder or zip to any Windows laptop and run SigmaSightExtra.exe.
echo No Python or pip install is needed on the laptop that runs it.
echo.
pause
exit /b 0

:long_path_error
echo.
echo Build stopped while installing Python packages on this build computer.
echo Move this source folder to a short path like C:\SigmaSightExtra and run build_windows.bat again.
echo The final portable app will not require installation on the target laptop.
echo.
pause
exit /b 1

:error
echo.
echo Build failed. Please read the error message above.
echo.
pause
exit /b 1
