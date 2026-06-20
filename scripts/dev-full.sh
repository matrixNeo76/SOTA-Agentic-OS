#!/bin/bash
# Dev full: avvia Next.js + WebSocket service in parallelo
# Risolve il problema del WS service da avviare manualmente

set -e

# Verifica che il WS service sia avviato, altrimenti avvialo
if ! curl -s http://localhost:3004/health > /dev/null 2>&1; then
  echo "🔌 Avvio WebSocket service..."
  cd mini-services/sensorium-ws
  nohup bun run dev > ws.log 2>&1 &
  WS_PID=$!
  echo "✓ WS service avviato (PID: $WS_PID)"
  cd ../..
  sleep 3
else
  echo "✓ WS service già attivo"
fi

echo "🚀 Avvio Next.js dev server..."
exec bun run dev
