#!/bin/bash
# Deploy CRM 140 Grammi su Vercel
cd "$(dirname "$0")/client"
echo "📦 Avvio deploy Vercel dal percorso: $(pwd)"
echo ""

# Controlla se vercel CLI è disponibile
if ! command -v vercel &> /dev/null; then
    # Prova con npx
    echo "✅ Uso npx vercel..."
    npx vercel deploy --prod
else
    echo "✅ Uso vercel CLI..."
    vercel deploy --prod
fi

echo ""
echo "✅ Deploy completato! Visita: https://client-dun-three-44.vercel.app"
