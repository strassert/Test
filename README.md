# 🚂 Zugsimulator — Browser Train Simulator

Ein kleiner, aber vollständiger Zugsimulator, der komplett im Browser läuft —
ohne Build-Schritt, ohne Abhängigkeiten. Reines HTML, CSS und Vanilla-JavaScript
mit HTML5-Canvas.

## Spielen

Einfach `index.html` im Browser öffnen:

```bash
# Variante 1: Datei direkt öffnen
xdg-open index.html      # Linux
open index.html          # macOS

# Variante 2: lokaler Webserver (empfohlen)
python3 -m http.server 8000
# dann http://localhost:8000 aufrufen
```

## Ziel

Fahre deinen Zug von **Talheim** bis zur **Hafenstadt Hbf** und sammle Punkte:

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
- **Bahnhöfe** mit Bahnsteig und Haltemarkierung; der Zug muss ruhig zum Stehen
  kommen. 3 Sekunden Fahrgastwechsel, dann geht es weiter.
- **Signale** wechseln in einem festen Rhythmus zwischen Grün, Gelb und Rot.
- **Tacho, Hebelanzeigen, Signalstatus und Kilometerzähler** im HUD.
- **Parallax-Landschaft** mit Bergen, Hügeln, Wolken und Bäumen.
- **WebAudio-Soundeffekte** (Hupe, Signalgong) ohne externe Dateien.

## Dateien

| Datei | Inhalt |
|-------|--------|
| `index.html` | Struktur, HUD und Overlays |
| `style.css` | Gesamtes Layout und Design |
| `game.js` | Spielkern: Physik, Rendering, Spiellogik |

## Anpassen

Die Strecke lässt sich in `game.js` leicht ändern — siehe die Arrays
`STATIONS` (Bahnhöfe, Positionen, Tempolimits) und `SIGNALS` (Signalpositionen).
Physikwerte stehen als Konstanten oben in der Datei.
