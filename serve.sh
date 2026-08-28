#!/usr/bin/env bash
# Zugsimulator lokal starten – ohne Installation, nur mit Python 3.
# Nutzung:  ./serve.sh [PORT]      (Standard-Port: 8000)
set -euo pipefail

PORT="${1:-8000}"
cd "$(dirname "$0")"

echo "🚄 Zugsimulator läuft auf  http://localhost:${PORT}"
echo "   (Strg+C zum Beenden)"
exec python3 -m http.server "${PORT}"
