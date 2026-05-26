#!/bin/bash
# Deploy CRM 140 Grammi su Vercel — doppio click da Mac Finder

DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_DIR="$DIR/client"
TMP_DIST="/tmp/crm-vercel-dist-$$"

echo "🚀 CRM 140 Grammi — Deploy su Vercel"
echo "📁 Progetto: $CLIENT_DIR"
echo ""

# 1. Build con vercel build (crea .vercel/output per il prebuilt deploy)
echo "🔨 Build in corso..."
# Build e deploy girano entrambi da DIR (CRM-App/).
# Vercel legge rootDirectory=client dal progetto online e trova client/ correttamente.
# .vercel/output viene creato in CRM-App/.vercel/output, poi usato dal deploy --prebuilt.
cd "$DIR"
npx --yes vercel@latest build --prod --yes
if [ $? -ne 0 ]; then
  echo "❌ Build fallita! Controlla gli errori sopra."
  read -p "Premi Invio per chiudere..."
  exit 1
fi
echo "✅ Build completata (.vercel/output pronto)"
echo ""

# 2. Deploy su Vercel (prebuilt da .vercel/output in CRM-App/)
echo "🌐 Deploy su Vercel (prebuilt)..."
cd "$DIR"
if command -v vercel &> /dev/null; then
    vercel deploy --prod --prebuilt
else
    npx --yes vercel@latest deploy --prod --prebuilt
fi

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Deploy completato!"
  echo "🌐 https://client-dun-three-44.vercel.app"
else
  echo ""
  echo "⚠️  Deploy fallito. Prova manualmente:"
  echo "   cd '$CLIENT_DIR' && npx vercel deploy --prod"
fi

read -p "Premi Invio per chiudere..."
