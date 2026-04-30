#!/bin/bash
# ====================================================
#   CRM 140 Grammi — Fix DB Lock + Avvio
# ====================================================

cd "$(dirname "${BASH_SOURCE[0]}")"

echo ""
echo "  ════════════════════════════════════"
echo "      CRM 140 Grammi — Fix & Avvio"
echo "  ════════════════════════════════════"
echo ""

# ── Killa TUTTO quello che gira su porte CRM ────────
echo "  🔪 Chiudo processi vecchi CRM (3140, 3001, 5173)..."

for PORT in 3140 3001 5173; do
  PIDS=$(lsof -ti :$PORT 2>/dev/null)
  if [ -n "$PIDS" ]; then
    echo "     → Porta $PORT: kill PID $PIDS"
    echo "$PIDS" | xargs kill -9 2>/dev/null
  fi
done

sleep 1

# ── Rimuove lock SQLite ──────────────────────────────
LOCK_DIR="$HOME/Library/Application Support/CRM140Grammi/crm140.db.lock"
if [ -d "$LOCK_DIR" ]; then
  echo "  🔓 Rimuovo lock database..."
  rm -rf "$LOCK_DIR"
  echo "     ✅ Lock rimosso"
else
  echo "  ✅ Nessun lock database presente"
fi

sleep 1

# ── Verifica dipendenze ──────────────────────────────
if [ ! -d "node_modules" ] || [ ! -d "server/node_modules" ] || [ ! -d "client/node_modules" ]; then
  echo ""
  echo "  📦 Installazione dipendenze..."
  npm install --silent 2>/dev/null
  cd server && npm install --silent 2>/dev/null && cd ..
  cd client && npm install --legacy-peer-deps --silent 2>/dev/null && cd ..
  echo "  ✅ Dipendenze installate"
fi

# ── Apri browser ────────────────────────────────────
(sleep 5 && open "http://localhost:5173") &

# ── Avvio CRM ───────────────────────────────────────
echo ""
echo "  🚀 Avvio CRM 140 Grammi (porta 5173)..."
echo "  → Backend:  http://localhost:3001"
echo "  → Frontend: http://localhost:5173"
echo ""
echo "  Il browser si aprirà tra 5 secondi."
echo "  Per fermare: Ctrl+C"
echo "  ════════════════════════════════════"
echo ""

npm run dev
