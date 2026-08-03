#!/usr/bin/env bash
# =============================================================================
#  Zugsimulator – Proxmox-LXC-Deployer
#
#  Erstellt auf dem PROXMOX-VE-HOST einen unprivilegierten LXC-Container,
#  installiert nginx und hostet das Spiel automatisch.
#
#  Ausführen als root auf dem Proxmox-Host:
#      ./deploy-proxmox-lxc.sh
#
#  Alle Einstellungen lassen sich per Umgebungsvariable überschreiben, z. B.:
#      CTID=150 HOSTNAME=zug DISK_STORAGE=local-lvm ./deploy-proxmox-lxc.sh
#
#  Die Spieldateien werden bevorzugt aus dem Verzeichnis dieses Skripts
#  übernommen (index.html/style.css/game.js). Fehlen sie, klont das Skript
#  stattdessen REPO_URL im Container.
# =============================================================================
set -euo pipefail

# ---------- Konfiguration (per Env überschreibbar) ---------------------------
CTID="${CTID:-}"                              # leer = nächste freie ID
HOSTNAME="${HOSTNAME:-zugsimulator}"
PASSWORD="${PASSWORD:-}"                       # leer = zufälliges Root-Passwort
DISK_STORAGE="${DISK_STORAGE:-}"              # z. B. local-lvm (auto, wenn leer)
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
BRIDGE="${BRIDGE:-vmbr0}"
IPCONF="${IPCONF:-dhcp}"                       # dhcp  oder  192.168.1.50/24
GATEWAY="${GATEWAY:-}"                         # nur nötig bei statischer IP
DISK_GB="${DISK_GB:-4}"
CORES="${CORES:-1}"
RAM_MB="${RAM_MB:-512}"
HTTP_PORT="${HTTP_PORT:-80}"
REPO_URL="${REPO_URL:-https://github.com/strassert/Test.git}"

# ---------- Ausgabe-Helfer ---------------------------------------------------
c_g="\033[1;32m"; c_y="\033[1;33m"; c_r="\033[1;31m"; c_b="\033[1;34m"; c_0="\033[0m"
info()  { echo -e "${c_b}➜${c_0} $*"; }
ok()    { echo -e "${c_g}✔${c_0} $*"; }
warn()  { echo -e "${c_y}⚠${c_0} $*"; }
die()   { echo -e "${c_r}✖${c_0} $*" >&2; exit 1; }

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }

# ---------- Vorbedingungen ---------------------------------------------------
[[ $EUID -eq 0 ]] || die "Bitte als root auf dem Proxmox-Host ausführen."
command -v pct   >/dev/null || die "'pct' nicht gefunden – dies ist kein Proxmox-VE-Host."
command -v pveam >/dev/null || die "'pveam' nicht gefunden – dies ist kein Proxmox-VE-Host."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------- CTID bestimmen ---------------------------------------------------
if [[ -z "$CTID" ]]; then
  CTID="$(pvesh get /cluster/nextid)"
fi
pct status "$CTID" &>/dev/null && die "Container $CTID existiert bereits – anderes CTID wählen."
info "Verwende Container-ID ${c_g}$CTID${c_0}"

# ---------- Speicher automatisch wählen --------------------------------------
if [[ -z "$DISK_STORAGE" ]]; then
  DISK_STORAGE="$(pvesm status -content rootdir 2>/dev/null | awk 'NR==2{print $1}')"
  [[ -n "$DISK_STORAGE" ]] || die "Kein Storage für 'rootdir' gefunden – DISK_STORAGE setzen."
  info "Rootfs-Storage automatisch: ${c_g}$DISK_STORAGE${c_0}"
fi

# ---------- LXC-Template sicherstellen ---------------------------------------
info "Suche aktuelles Debian-12-Template …"
pveam update >/dev/null 2>&1 || true
TEMPLATE="$(pveam available --section system | awk '/debian-12-standard/{print $2}' | sort -V | tail -1)"
[[ -n "$TEMPLATE" ]] || die "Kein debian-12-standard-Template verfügbar (pveam available)."

if ! pveam list "$TEMPLATE_STORAGE" 2>/dev/null | grep -q "$TEMPLATE"; then
  info "Lade Template $TEMPLATE herunter …"
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE" >/dev/null
fi
TEMPLATE_REF="${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}"
ok "Template bereit: $TEMPLATE"

# ---------- Netzwerk-Parameter -----------------------------------------------
if [[ "$IPCONF" == "dhcp" ]]; then
  NET="name=eth0,bridge=${BRIDGE},ip=dhcp"
else
  [[ -n "$GATEWAY" ]] || die "Bei statischer IP bitte GATEWAY setzen (z. B. GATEWAY=192.168.1.1)."
  NET="name=eth0,bridge=${BRIDGE},ip=${IPCONF},gw=${GATEWAY}"
fi

[[ -n "$PASSWORD" ]] || PASSWORD="$(openssl rand -base64 12 2>/dev/null || echo "zug-$RANDOM$RANDOM")"

# ---------- Container erstellen ----------------------------------------------
info "Erstelle LXC-Container …"
pct create "$CTID" "$TEMPLATE_REF" \
  --hostname "$HOSTNAME" \
  --cores "$CORES" \
  --memory "$RAM_MB" \
  --swap "$RAM_MB" \
  --rootfs "${DISK_STORAGE}:${DISK_GB}" \
  --net0 "$NET" \
  --unprivileged 1 \
  --features nesting=1 \
  --password "$PASSWORD" \
  --onboot 1 \
  --description "Zugsimulator (nginx) – automatisch erstellt" >/dev/null
ok "Container $CTID erstellt."

info "Starte Container …"
pct start "$CTID"

# ---------- Auf Netzwerk warten ----------------------------------------------
info "Warte auf Netzwerk im Container …"
IP=""
for _ in $(seq 1 30); do
  IP="$(pct exec "$CTID" -- ip -4 -o addr show eth0 2>/dev/null | awk '{print $4}' | cut -d/ -f1)"
  [[ -n "$IP" ]] && break
  sleep 2
done
[[ -n "$IP" ]] || die "Container hat keine IP bekommen – Netzwerk/Bridge prüfen."
ok "Container-IP: ${c_g}$IP${c_0}"

# ---------- Hilfsfunktion: Befehl im Container mit Retry ----------------------
in_ct() { pct exec "$CTID" -- bash -c "$1"; }
apt_retry() {
  for _ in 1 2 3 4 5; do
    in_ct "DEBIAN_FRONTEND=noninteractive apt-get $*" && return 0
    warn "apt fehlgeschlagen – neuer Versuch in 5s …"; sleep 5
  done
  die "apt-Befehl endgültig fehlgeschlagen: apt-get $*"
}

# ---------- nginx installieren -----------------------------------------------
info "Installiere nginx …"
apt_retry "update -y" >/dev/null
apt_retry "install -y --no-install-recommends nginx" >/dev/null
ok "nginx installiert."

# ---------- Spieldateien deployen --------------------------------------------
WEBROOT="/var/www/html"
in_ct "mkdir -p $WEBROOT && rm -f $WEBROOT/index.nginx-debian.html"

FILES=(index.html style.css game.js)
have_local=1
for f in "${FILES[@]}"; do [[ -f "$SCRIPT_DIR/$f" ]] || have_local=0; done

if [[ $have_local -eq 1 ]]; then
  info "Übertrage lokale Spieldateien aus $SCRIPT_DIR …"
  for f in "${FILES[@]}"; do
    pct push "$CTID" "$SCRIPT_DIR/$f" "$WEBROOT/$f"
  done
else
  warn "Lokale Spieldateien nicht gefunden – klone $REPO_URL im Container …"
  apt_retry "install -y --no-install-recommends git" >/dev/null
  in_ct "rm -rf /tmp/zug && git clone --depth 1 '$REPO_URL' /tmp/zug" \
    || die "git clone fehlgeschlagen (privates Repo? REPO_URL prüfen oder Skript aus dem Repo-Ordner starten)."
  for f in "${FILES[@]}"; do
    in_ct "cp /tmp/zug/$f $WEBROOT/$f" || die "Datei $f nicht im Repo gefunden."
  done
fi

# ---------- Optional: anderen HTTP-Port konfigurieren ------------------------
if [[ "$HTTP_PORT" != "80" ]]; then
  info "Konfiguriere nginx auf Port $HTTP_PORT …"
  in_ct "sed -i 's/listen 80 default_server;/listen ${HTTP_PORT} default_server;/; s/listen \[::\]:80 default_server;/listen [::]:${HTTP_PORT} default_server;/' /etc/nginx/sites-available/default"
fi

in_ct "systemctl enable --now nginx >/dev/null 2>&1; systemctl restart nginx"
ok "nginx läuft und liefert das Spiel aus."

# ---------- Funktionsprüfung -------------------------------------------------
info "Prüfe Erreichbarkeit …"
CODE="$(in_ct "wget -qO- -S http://localhost:${HTTP_PORT}/ 2>&1 | awk '/HTTP\//{print \$2; exit}'" || true)"
[[ "$CODE" == "200" ]] && ok "HTTP $CODE – Spiel erreichbar." || warn "Unerwartete Antwort (HTTP ${CODE:-?}) – bitte manuell prüfen."

# ---------- Zusammenfassung --------------------------------------------------
echo
echo -e "${c_g}════════════════════════════════════════════════════════════${c_0}"
echo -e "  🚄  ${c_g}Zugsimulator ist deployt!${c_0}"
echo -e "  ────────────────────────────────────────────────────────"
echo -e "  Container-ID : ${c_g}$CTID${c_0}   Hostname: $HOSTNAME"
echo -e "  URL          : ${c_g}http://${IP}$( [[ "$HTTP_PORT" != 80 ]] && echo ":$HTTP_PORT" )/${c_0}"
echo -e "  Root-Passwort: $PASSWORD"
echo -e "  Konsole      : pct enter $CTID"
echo -e "  Stoppen      : pct stop $CTID    Löschen: pct destroy $CTID"
echo -e "${c_g}════════════════════════════════════════════════════════════${c_0}"
echo
echo "  Update später:  pct push $CTID ./game.js $WEBROOT/game.js  (usw.)"
