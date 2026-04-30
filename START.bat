@echo off
chcp 65001 > nul
cls

echo.
echo   ==========================================
echo   🍽️  CRM 140 Grammi — Avvio (Windows)
echo   ==========================================
echo.

:: Vai alla cartella dello script
cd /d "%~dp0"

:: ── Killa processi vecchi sulle porte CRM ──────────
for %%P in (3140 3001 5173) do (
    for /f "tokens=5" %%i in ('netstat -aon ^| findstr ":%%P "') do (
        echo   Porta %%P occupata - chiudo processo...
        taskkill /F /PID %%i >nul 2>nul
    )
)

:: ── Rimuovi lock SQLite ─────────────────────────────
set LOCK_DIR=%APPDATA%\..\Local\CRM140Grammi\crm140.db.lock
if exist "%LOCK_DIR%" (
    rmdir /S /Q "%LOCK_DIR%"
    echo   Lock database rimosso
)

timeout /t 1 /nobreak >nul

:: ── Controlla Node.js ──────────────────────────────
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo   ERRORE: Node.js non trovato!
    echo.
    echo   Installa Node.js da: https://nodejs.org
    echo   Versione consigliata: 20 LTS
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo   OK  Node.js %NODE_VER% trovato

:: ── Prima installazione ────────────────────────────
set NEEDS_INSTALL=0
if not exist "node_modules\" set NEEDS_INSTALL=1
if not exist "server\node_modules\" set NEEDS_INSTALL=1
if not exist "client\node_modules\" set NEEDS_INSTALL=1

if "%NEEDS_INSTALL%"=="1" (
    echo.
    echo   Installazione dipendenze in corso...
    echo   (necessario solo la prima volta - circa 2 minuti)
    echo.

    call npm install --silent
    if errorlevel 1 (
        echo   Errore installazione root - continuo...
    )

    echo   Installazione backend...
    cd server
    call npm install --silent
    if errorlevel 1 (
        echo.
        echo   ERRORE installazione backend.
        echo   Assicurati di avere Visual Studio Build Tools installato.
        echo   Scarica da: https://visualstudio.microsoft.com/visual-cpp-build-tools/
        echo.
        pause
        exit /b 1
    )
    cd ..

    echo   Installazione frontend...
    cd client
    call npm install --silent --legacy-peer-deps
    cd ..

    echo.
    echo   Installazione completata!
    echo.
)

:: ── Verifica .env ──────────────────────────────────
findstr /i "inserisci-qui" .env >nul 2>nul
if %errorlevel% equ 0 (
    echo   ATTENZIONE: API Key Anthropic non configurata nel file .env
    echo   La Chat AI non funzionerà.
    echo.
)

:: ── Apri browser dopo 4 secondi ───────────────────
start "" /B cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:5173"

:: ── Avvio ──────────────────────────────────────────
echo   Avvio CRM 140 Grammi...
echo   Backend:  http://localhost:3001
echo   Frontend: http://localhost:5173
echo.
echo   Il browser si aprirà automaticamente.
echo   Per fermare: Ctrl+C in questa finestra
echo   ==========================================
echo.

call npm run dev
