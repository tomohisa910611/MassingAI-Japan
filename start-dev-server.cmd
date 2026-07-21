@echo off
cd /d "%~dp0"
"C:\Program Files\nodejs\node.exe" --use-system-ca "node_modules\next\dist\bin\next" dev >> "dev-server.log" 2>> "dev-server-error.log"
