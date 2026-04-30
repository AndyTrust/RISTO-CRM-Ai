#!/bin/bash
# ====================================================
# 🍽️  CRM 140 Grammi — Script di avvio (Mac/Linux)
# ====================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

clear
echo ""
echo "  ════════════════════════════════════"
echo "      CRM 140 Grammi — Gestionale"
echo "  ════════════════════════════════════"
echo ""

# ── Killa processi vecchi sulle porte CRM ─────────
for PORT in 3140 3001 5173; do
  PIDS=$(lsof -ti :$PORT 2>/dev/null)
  if [ -n "$PIDS" ]; then
    echo "  🔪 Porta $PORT occupata — chiudo processo..."
    echo "$PIDS" | xargs kill -9 2>/dev/null
  fi
done

# ── Rimuove lock SQLite ───────────────────────────
LOCK_DIR="$HOME/Library/Application Support/CRM140Grammi/crm140.db.lock"
if [ -d "$LOCK_DIR" ]; then
  rm -rf "$LOCK_DIR"
  echo "  🔓 Lock database rimosso"
fi

sleep 1

# ── Controlla Node.js ──────────────────────────────
if ! command -v node &> /dev/null; then
  echo "  ❌ Node.js non trovato!"
  echo ""
  echo "  Installa Node.js da: https://nodejs.org  (versione 20 LTS)"
  echo ""
  read -p "  Premi Invio per chiudere..." dummy
  exit 1
fi

NODE_VER=$(node -v)
ARCH=$(uname -m)
echo "  ✅ Node.js $NODE_VER — arch: $ARCH"

# ── Pulizia node_modules da piattaforma diversa ───
# Controlla se il node_modules del client è stato installato su una
# architettura diversa (es. Linux sandbox → Mac ARM64).
# IMPORTANTE: controlla il file binario .node vero (non solo la cartella,
# che npm crea anche su altri OS come placeholder vuoto).
CLIENT_NM="$SCRIPT_DIR/client/node_modules"
NEEDS_REINSTALL=0

if [ -d "$CLIENT_NM" ]; then
  ROLLUP_BINARY=""
  if [ "$ARCH" = "arm64" ]; then
    ROLLUP_BINARY="$CLIENT_NM/@rollup/rollup-darwin-arm64/rollup.darwin-arm64.node"
  elif [ "$ARCH" = "x86_64" ]; then
    ROLLUP_BINARY="$CLIENT_NM/@rollup/rollup-darwin-x64/rollup.darwin-x64.node"
  fi

  if [ -n "$ROLLUP_BINARY" ] && [ ! -f "$ROLLUP_BINARY" ]; then
    echo ""
    echo "  ⚠️  node_modules installati su piattaforma diversa (Linux → Mac)."
    echo "     Pulizia completa e reinstallazione per Mac $ARCH..."
    echo ""
    NEEDS_REINSTALL=1
    rm -rf "$CLIENT_NM"
    rm -f "$SCRIPT_DIR/client/package-lock.json"
    rm -rf "$SCRIPT_DIR/node_modules"
    rm -f "$SCRIPT_DIR/package-lock.json"
    rm -rf "$SCRIPT_DIR/server/node_modules"
    rm -f "$SCRIPT_DIR/server/package-lock.json"
  fi
fi

# ── Prima installazione ────────────────────────────
if [ "$NEEDS_REINSTALL" -eq 1 ] || [ ! -d "node_modules" ] || [ ! -d "server/node_modules" ] || [ ! -d "client/node_modules" ]; then
  echo ""
  echo "  📦 Installazione dipendenze in corso..."
  echo "     (necessario solo la prima volta — circa 2-3 minuti)"
  echo ""

  # Root (concurrently)
  npm install --silent 2>/dev/null
  [ $? -ne 0 ] && npm install 2>&1 | tail -3

  # Backend (usa node-sqlite3-wasm, nessuna compilazione nativa necessaria)
  echo "  → Backend (Node.js + SQLite WebAssembly)..."
  cd server
  npm install --silent 2>/dev/null
  [ $? -ne 0 ] && npm install 2>&1 | tail -5
  cd ..

  # Frontend
  echo "  → Frontend (React + Vite)..."
  cd client
  npm install --legacy-peer-deps --silent 2>/dev/null
  [ $? -ne 0 ] && npm install --legacy-peer-deps 2>&1 | tail -5
  cd ..

  echo ""
  echo "  ✅ Installazione completata!"
fi

# ── Verifica .env ──────────────────────────────────
if grep -q "inserisci-qui" .env 2>/dev/null; then
  echo ""
  echo "  ⚠️  API Key Anthropic non configurata nel file .env"
  echo "     La chat AI non funzionerà senza la chiave."
  echo ""
fi

# ── Apri browser ──────────────────────────────────
(sleep 5 && open "http://localhost:5173") &

# ── Avvio ─────────────────────────────────────────
echo ""
echo "  🚀 Avvio CRM 140 Grammi..."
echo ""
echo "  → Backend:  http://localhost:3001"
echo "  → Frontend: http://localhost:5173"
echo ""
echo "  Il browser si aprirà automaticamente tra 5 secondi."
echo "  Per fermare il CRM: premi Ctrl+C"
echo "  ════════════════════════════════════"
echo ""

npm run dev
