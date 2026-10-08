@echo off
setlocal enabledelayedexpansion
rem MoldForge WebUI - one-time setup (idempotent, safe to re-run)
cd /d "%~dp0"

echo === [1/4] Clone the MoldForge add-on (algorithms stay untouched) ===
if not exist "moldforge\core\pipeline.py" (
    git clone https://github.com/Plesuro/MoldForge.git moldforge
    if errorlevel 1 goto :fail
) else (
    echo     already present
)

echo === [2/4] Python environment ===
if not exist ".venv\Scripts\python.exe" (
    python -m venv .venv
    if errorlevel 1 goto :fail
)
".venv\Scripts\python.exe" -m pip install -q -r requirements.txt
if errorlevel 1 goto :fail

echo === [3/4] Blender engine (portable, ~390 MB download on first run) ===
if not exist "engine\blender.exe" (
    if not exist "engine\blender-5.1.2-windows-x64\blender.exe" (
        if not exist "engine\blender-5.1.2-windows-x64.zip" (
            echo     downloading Blender 5.1.2...
            powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest -Uri 'https://download.blender.org/release/Blender5.1/blender-5.1.2-windows-x64.zip' -OutFile 'engine\blender-5.1.2-windows-x64.zip'"
            if errorlevel 1 goto :fail
        )
        echo     extracting...
        powershell -NoProfile -Command "Expand-Archive -Path 'engine\blender-5.1.2-windows-x64.zip' -DestinationPath 'engine' -Force"
        if errorlevel 1 goto :fail
    )
) else (
    echo     already present
)

echo === [4/4] Frontend vendor files (Three.js) ===
if not exist "webui\static\vendor\three\build\three.module.js" (
    echo     run: re-run this script from a shell with internet, or see README-WEBUI.md
    goto :fail
) else (
    echo     already present
)

echo.
echo Setup complete. Start the app with:  run.bat
goto :eof

:fail
echo.
echo SETUP FAILED - see the message above.
exit /b 1
