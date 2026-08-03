#!/usr/bin/env bash
# =============================================================================
#  Zugsimulator – Spieldateien in einem laufenden LXC-Container aktualisieren.
#
#  Nutzung (auf dem Proxmox-Host):
#      ./update-lxc.sh <CTID>
#
#  Quelle der Dateien:
#    1. Liegen index.html/style.css/game.js neben diesem Skript, werden sie
#       per `pct push` übertragen (offline, kein Internet nötig).
#    2. Sonst werden sie per wget vom GitHub-Branch geholt.
#
#  Statische Dateien sind sofort aktiv – kein nginx-Neustart nötig.
#  Im Browser danach hart neu laden (Strg+F5), um den Cache zu umgehen.
#
#  Überschreibbar:  BRANCH=main WEBROOT=/var/www/html ./update-lxc.sh 108
# =============================================================================
set -euo pipefail

CTID="${1:?Nutzung: ./update-lxc.sh <CTID>}"
BRANCH="${BRANCH:-claude/browser-train-simulator-jn4wzn}"
WEBROOT="${WEBROOT:-/var/www/html}"
FILES=(index.html style.css game.js)

command -v pct >/dev/null || { echo "✖ 'pct' nicht gefunden – bitte auf dem Proxmox-Host ausführen." >&2; exit 1; }
pct status "$CTID" &>/dev/null || { echo "✖ Container $CTID existiert nicht." >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pct exec "$CTID" -- mkdir -p "$WEBROOT"

have_local=1
for f in "${FILES[@]}"; do [[ -f "$SCRIPT_DIR/$f" ]] || have_local=0; done

if [[ $have_local -eq 1 ]]; then
  echo "➜ Übertrage lokale Dateien nach Container $CTID …"
  for f in "${FILES[@]}"; do
    pct push "$CTID" "$SCRIPT_DIR/$f" "$WEBROOT/$f" && echo "  ✔ $f"
  done
else
  echo "➜ Lade Dateien vom GitHub-Branch '$BRANCH' in Container $CTID …"
  BASE="https://raw.githubusercontent.com/strassert/Test/refs/heads/${BRANCH}"
  for f in "${FILES[@]}"; do
    pct exec "$CTID" -- wget -qO "$WEBROOT/$f" "$BASE/$f" \
      && echo "  ✔ $f ($(pct exec "$CTID" -- wc -c < "$WEBROOT/$f" 2>/dev/null || echo '?') Byte)" \
      || { echo "  ✖ $f – Download fehlgeschlagen (privates Repo? Branch falsch?)"; exit 1; }
  done
fi

echo "✔ Fertig. Im Browser mit Strg+F5 neu laden."
