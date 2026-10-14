#!/usr/bin/env sh
# Silhueta: abre o site num servidor local (macOS e Linux).  Uso: sh iniciar.sh
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-5173}"
URL="http://localhost:$PORT"

abrir() {
  sleep 1
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  fi
}

if command -v node >/dev/null 2>&1; then
  abrir &
  exec node scripts/dev-server.mjs "$PORT"
elif command -v python3 >/dev/null 2>&1; then
  abrir &
  exec python3 -m http.server "$PORT"
else
  echo "Não encontrei Node.js nem Python. Instale o Node.js em https://nodejs.org e rode de novo."
  exit 1
fi
