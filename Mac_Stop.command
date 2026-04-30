#!/bin/bash
# ====================================================
#   CRM 140 Grammi — Stop tutti i processi CRM
# ====================================================

echo ""
echo "  ════════════════════════════════════"
echo "      CRM 140 Grammi — Stop"
echo "  ════════════════════════════════════"
echo ""

KILLED=0

for PORT in 3140 3001 5173; do
  PIDS=$(lsof -ti :$PORT 2>/dev/null)
  if [ -n "$PIDS" ]; then
    echo "  🔪 Porta $PORT — kill PID $PIDS"
    echo "$PIDS" | xargs kill -9 2>/dev/null
    KILLED=1
  fi
done

# Rimuove lock SQLite se presente
LOCK_DIR="$HOME/Library/Application Support/CRM140Grammi/crm140.db.lock"
if [ -d "$LOCK_DIR" ]; then
  rm -rf "$LOCK_DIR"
  echo "  🔓 Lock database rimosso"
fi

if [ "$KILLED" -eq 0 ]; then
  echo "  ✅ Nessun processo CRM in esecuzione"
else
  echo ""
  echo "  ✅ Tutti i processi CRM fermati"
fi

echo "  ════════════════════════════════════"
echo ""
