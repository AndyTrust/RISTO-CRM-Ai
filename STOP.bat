@echo off
chcp 65001 > nul
cls

echo.
echo   ==========================================
echo     CRM 140 Grammi - Stop processi CRM
echo   ==========================================
echo.

:: Killa processi sulle porte CRM
for %%P in (3140 3001 5173) do (
    for /f "tokens=5" %%i in ('netstat -aon ^| findstr ":%%P "') do (
        echo   Porta %%P - kill PID %%i
        taskkill /F /PID %%i >nul 2>nul
    )
)

:: Rimuovi lock SQLite
set LOCK_DIR=%APPDATA%\..\Local\CRM140Grammi\crm140.db.lock
if exist "%LOCK_DIR%" (
    rmdir /S /Q "%LOCK_DIR%"
    echo   Lock database rimosso
)

echo.
echo   Tutti i processi CRM sono stati fermati.
echo   ==========================================
echo.
pause
