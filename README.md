# 🚄 Zugsimulator — Shinkansen auf der S‑Bahn Salzburg

Ein kleiner, aber vollständiger Zugsimulator, der komplett im Browser läuft —
ohne Build-Schritt, ohne Abhängigkeiten. Reines HTML, CSS und Vanilla-JavaScript
mit HTML5-Canvas.

Du steuerst einen **Shinkansen E5 „Hayabusa"** auf der realen Strecke der
**S‑Bahn Salzburg (Linie S2)** von **Seekirchen am Wallersee** nach
**Salzburg Hauptbahnhof**.

## Spielen / Lokal starten

Es ist eine rein statische Website — kein Build, kein Backend. Drei Wege:

```bash
# 1) Schnellstart-Skript (nur Python 3 nötig)
./serve.sh            # → http://localhost:8000
./serve.sh 9000       # optional anderer Port

# 2) Docker / Docker Compose (z. B. auf dem Proxmox-Host)
docker compose up -d  # → http://localhost:8080
docker compose down   # stoppen

# 3) Datei direkt öffnen (ohne Server)
xdg-open index.html   # Linux
open index.html       # macOS
```

Die Setup-Dateien im Repo:

| Datei | Zweck |
|-------|-------|
| `serve.sh` | Lokaler Schnellstart über `python3 -m http.server` |
| `Dockerfile` | Winziges `nginx:alpine`-Image, das die Spieldateien ausliefert |
| `docker-compose.yml` | Startet den Container auf Port 8080 (`restart: unless-stopped`) |

Für den Betrieb hinter einer eigenen Domain mit automatischem HTTPS eignet sich
ein Reverse Proxy wie Caddy oder Traefik vor dem Container.

## Strecke

Abfahrt in **Seekirchen am Wallersee**, dann in dieser Reihenfolge halten
(reale Halte der Linie S2):

1. **Seekirchen Stadt**
2. **Eugendorf**
3. **Hallwang‑Elixhausen**
4. **Salzburg Kasern**
5. **Salzburg Hauptbahnhof** (Endstation)

Passend zur Strecke: die **Alpenkette** am Horizont, der **Wallersee** bei
Seekirchen und die **Festung Hohensalzburg** kurz vor Salzburg.

## Ziel & Punkte

- 🎯 **Präziser Halt** am Bahnsteig → bis zu **+100 Punkte** (je genauer, desto mehr)
- 🚦 **Rotes Signal überfahren** → **−50 Punkte**
- ⚡ **Tempolimit überschreiten** → laufender Punktabzug
- ❌ **Bahnhof verpassen** → **−30 Punkte**

## Steuerung

| Taste | Funktion |
|-------|----------|
| `W` / `↑` | Schub erhöhen |
| `S` / `↓` | Bremsen |
| `Leertaste` | Notbremse |
| `H` | Hupe |
| `P` | Pause |

Auf Touch-Geräten erscheinen unten am Bildschirm Bedienknöpfe.

## Spielmechanik

- **Realistische Fahrphysik**: Trägheit, Roll- und Luftwiderstand, getrennte
  Betriebs- und Notbremse. Der Zug rollt aus — vorausschauend bremsen!
- **Bahnhöfe** mit Bahnsteig, Bahnsteigdach und Haltemarkierung; der Zug muss
  ruhig zum Stehen kommen. 3 Sekunden Fahrgastwechsel, dann geht es weiter.
- **Oberleitung** mit Masten; der **Stromabnehmer** des Zuges läuft am Fahrdraht.
- **Signale** wechseln in einem festen Rhythmus zwischen Grün, Gelb und Rot.
- **Tacho, Hebelanzeigen, Signalstatus und Kilometerzähler** im HUD.
- **WebAudio-Soundeffekte** (Hupe, Signalgong) ohne externe Dateien.

## Dateien

| Datei | Inhalt |
|-------|--------|
| `index.html` | Struktur, HUD und Overlays |
| `style.css` | Gesamtes Layout und Design |
| `game.js` | Spielkern: Physik, Rendering, Spiellogik |

## Anpassen

Die Strecke lässt sich in `game.js` leicht ändern — siehe `ORIGIN`
(Abfahrtsbahnhof), `STATIONS` (Halte, Positionen in Metern, Tempolimits) und
`SIGNALS` (Signalpositionen). Physikwerte stehen als Konstanten oben in der Datei.

Zum Testen kann per URL-Hash an eine Position gesprungen werden, z. B.
`index.html#km=13.4` startet kurz vor Salzburg.
