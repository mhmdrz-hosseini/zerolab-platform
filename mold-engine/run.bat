@echo off
rem MoldForge WebUI - start the server and open the browser
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo Run setup.bat first.
    exit /b 1
)

start "" http://127.0.0.1:8000
".venv\Scripts\python.exe" -m uvicorn webui.server:app --host 127.0.0.1 --port 8000
