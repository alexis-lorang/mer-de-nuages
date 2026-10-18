#!/bin/zsh
# Double-cliquer pour lancer le dashboard : démarre le serveur local si besoin et ouvre le navigateur.
cd "$(dirname "$0")"
PORT=8765
URL="http://localhost:$PORT"

if ! lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  python3 -m http.server $PORT >/dev/null 2>&1 &
  sleep 1
fi
open "$URL"
echo "Dashboard ouvert sur $URL"
echo "Laisser cette fenêtre ouverte. Fermer la fenêtre arrête le serveur."
wait
