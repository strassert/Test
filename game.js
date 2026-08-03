/* =========================================================================
 * Zugsimulator — Browser Train Simulator
 * Reiner Vanilla-JS-Canvas-Spielkern: Physik, Bahnhöfe, Signale, Parallax.
 * ========================================================================= */

(() => {
  "use strict";

  // ---------- Canvas-Setup ----------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", resize);

  // ---------- Konstanten (Welt in Metern, Zeit in Sekunden) ----------
  const M_PER_PX = 0.15;         // Weltmeter pro Bildschirmpixel (Zoom) – kleiner = mehr Speed-Gefühl
  const MAX_THROTTLE_ACCEL = 4.4;  // m/s² bei vollem Schub
  const SERVICE_BRAKE = 4.6;     // m/s² Betriebsbremse
  const EMERGENCY_BRAKE = 7.5;   // m/s² Notbremse
  const ROLLING_DRAG = 0.07;     // konstanter Rollwiderstand m/s²
  const AIR_DRAG = 0.00025;      // Luftwiderstand ~ v²
  const LEVER_RATE = 3.6;        // wie schnell sich Hebel bewegen (pro s)
  const KMH = 3.6;               // m/s -> km/h

  // ---------- Streckendefinition ----------
  // Reale S-Bahn-Strecke Salzburg, Linie S2:
  // Seekirchen am Wallersee → Seekirchen Stadt → Eugendorf →
  // Hallwang-Elixhausen → Salzburg Kasern → Salzburg Hauptbahnhof.
  // Abfahrtsbahnhof (Start, pos 0); der Zug fährt von hier ab.
  const ORIGIN = { name: "Seekirchen am Wallersee", pos: 0 };

  // Anzufahrende Halte (Position in Metern ab Seekirchen am Wallersee,
  // ~streckengetreue Abstände; limit = Streckenhöchsttempo bis zum Halt).
  const STATIONS = [
    { name: "Seekirchen Stadt",     pos: 1400,  limit: 80  },
    { name: "Eugendorf",            pos: 3200,  limit: 100 },
    { name: "Hallwang-Elixhausen",  pos: 7400,  limit: 110 },
    { name: "Salzburg Kasern",      pos: 10900, limit: 100 },
    { name: "Salzburg Hauptbahnhof", pos: 14500, limit: 80 },
  ];
  const ROUTE_END = STATIONS[STATIONS.length - 1].pos + 60;
  const PLATFORM_LEN = 120;      // Bahnsteiglänge (m)
  const STOP_TOLERANCE = 8;      // perfekter Halt innerhalb ± m der Bahnsteigmitte

  // Signale zwischen den Halten. state wird dynamisch gesetzt.
  const SIGNALS = [
    { pos: 2300, state: "green" },
    { pos: 5300, state: "green" },
    { pos: 9000, state: "green" },
    { pos: 12700, state: "green" },
  ];

  // ---------- Spielzustand ----------
  const game = {
    running: false,
    paused: false,
    pos: 0,              // Zugposition (m, Vorderkante Führerstand)
    vel: 0,              // Geschwindigkeit (m/s)
    throttle: 0,         // 0..1
    brake: 0,            // 0..1
    emergency: false,
    limit: 100,
    score: 0,
    finished: false,
    stationIdx: 0,       // nächster anzufahrender Bahnhof
    dwellTimer: 0,       // Haltezeit am Bahnsteig
    dwelling: false,
    overspeedTimer: 0,   // Zeit über dem Limit (für Strafe)
    penalizedSignals: new Set(),
    time: 0,
    horn: 0,             // visueller Hupen-Timer
    statusMsg: "Bereit zur Abfahrt",
  };

  // ---------- Eingabe ----------
  const input = { throttleUp: false, brakeDown: false };

  const keyMap = {
    ArrowUp: "throttleUp", KeyW: "throttleUp",
    ArrowDown: "brakeDown", KeyS: "brakeDown",
  };

  window.addEventListener("keydown", (e) => {
    if (keyMap[e.code]) { input[keyMap[e.code]] = true; e.preventDefault(); }
    else if (e.code === "Space") { game.emergency = true; e.preventDefault(); }
    else if (e.code === "KeyH") { sound.horn(); game.horn = 0.6; }
    else if (e.code === "KeyP") { togglePause(); }
  });
  window.addEventListener("keyup", (e) => {
    if (keyMap[e.code]) { input[keyMap[e.code]] = false; e.preventDefault(); }
    else if (e.code === "Space") { game.emergency = false; }
  });

  // Touch-Steuerung
  document.querySelectorAll(".touch-btn").forEach((btn) => {
    const key = btn.dataset.key;
    const on = (e) => {
      e.preventDefault();
      if (key === "throttle") input.throttleUp = true;
      else if (key === "brake") input.brakeDown = true;
      else if (key === "horn") { sound.horn(); game.horn = 0.6; }
    };
    const off = (e) => {
      e.preventDefault();
      if (key === "throttle") input.throttleUp = false;
      else if (key === "brake") input.brakeDown = false;
    };
    btn.addEventListener("touchstart", on, { passive: false });
    btn.addEventListener("touchend", off, { passive: false });
    btn.addEventListener("mousedown", on);
    btn.addEventListener("mouseup", off);
    btn.addEventListener("mouseleave", off);
  });

  // ---------- Sound (WebAudio, ohne Assets) ----------
  const sound = (() => {
    let actx = null;
    function ensure() {
      if (!actx) {
        try { actx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch { actx = null; }
      }
      return actx;
    }
    function horn() {
      const a = ensure(); if (!a) return;
      const t = a.currentTime;
      [220, 277].forEach((f) => {
        const o = a.createOscillator(), g = a.createGain();
        o.type = "sawtooth"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
        o.connect(g); g.connect(a.destination);
        o.start(t); o.stop(t + 0.75);
      });
    }
    function ding(ok) {
      const a = ensure(); if (!a) return;
      const t = a.currentTime;
      const o = a.createOscillator(), g = a.createGain();
      o.type = "sine"; o.frequency.value = ok ? 880 : 200;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(g); g.connect(a.destination);
      o.start(t); o.stop(t + 0.42);
    }
    return { horn, ding, ensure };
  })();

  // ---------- Physik-Update ----------
  function update(dt) {
    if (!game.running || game.paused || game.finished) return;
    game.time += dt;
    if (game.horn > 0) game.horn = Math.max(0, game.horn - dt);

    // Hebel bewegen sich sanft zum Ziel
    const tTarget = input.throttleUp ? 1 : 0;
    const bTarget = input.brakeDown ? 1 : 0;
    game.throttle += clamp(tTarget - game.throttle, -LEVER_RATE * dt, LEVER_RATE * dt);
    game.brake += clamp(bTarget - game.brake, -LEVER_RATE * dt, LEVER_RATE * dt);
    // Schub und Bremse schließen sich aus
    if (game.brake > 0.02) game.throttle = Math.max(0, game.throttle - LEVER_RATE * dt);

    // Kräfte -> Beschleunigung
    let accel = 0;
    accel += game.throttle * MAX_THROTTLE_ACCEL;

    if (game.emergency) {
      accel -= EMERGENCY_BRAKE;
    } else {
      accel -= game.brake * SERVICE_BRAKE;
    }

    // Widerstände wirken nur bei Bewegung
    if (game.vel > 0.01) {
      accel -= ROLLING_DRAG;
      accel -= AIR_DRAG * game.vel * game.vel;
    }

    game.vel += accel * dt;
    if (game.vel < 0) game.vel = 0;      // kein Rückwärtsfahren
    game.pos += game.vel * dt;

    // Tempolimit aus aktuellem Streckenabschnitt bestimmen
    game.limit = currentLimit(game.pos);

    // Übergeschwindigkeit bestrafen
    const spdKmh = game.vel * KMH;
    if (spdKmh > game.limit + 1) {
      game.overspeedTimer += dt;
      if (game.overspeedTimer > 1) {
        game.score = Math.max(0, game.score - Math.round(20 * dt));
        game.statusMsg = "⚠️ Zu schnell!";
      }
    } else {
      game.overspeedTimer = 0;
    }

    // Signale aktualisieren + Verstöße prüfen
    updateSignals();

    // Bahnhofslogik
    handleStations(dt);

    // Streckenende
    if (game.pos >= ROUTE_END && game.vel < 0.2) {
      finishRoute();
    }

    updateHUD();
  }

  function currentLimit(pos) {
    // Das Limit gilt bis zum jeweiligen Bahnhof; danach der nächste Abschnitt.
    for (const s of STATIONS) {
      if (pos <= s.pos) return s.limit;
    }
    return STATIONS[STATIONS.length - 1].limit;
  }

  function updateSignals() {
    for (const sig of SIGNALS) {
      const d = sig.pos - game.pos;
      // Signal zeigt gelb kurz vor, rot bis Zug fast dran ist, dann wieder frei
      // Deterministisches Muster: alle 12 s wechselt ein Signal in Warnung
      const cyc = (game.time + sig.pos * 0.01) % 16;
      if (d < -10) sig.state = "green";
      else if (cyc < 5) sig.state = "red";
      else if (cyc < 7) sig.state = "amber";
      else sig.state = "green";

      // Verstoß: rotes Signal mit Tempo überfahren
      if (d < 0 && d > -6 && sig.state === "red" && !game.penalizedSignals.has(sig.pos) && game.vel > 2) {
        game.penalizedSignals.add(sig.pos);
        game.score = Math.max(0, game.score - 50);
        game.statusMsg = "🚦 Rotes Signal überfahren! −50";
        sound.ding(false);
      }
    }
  }

  function nearestSignalState() {
    let best = null, bestD = Infinity;
    for (const sig of SIGNALS) {
      const d = sig.pos - game.pos;
      if (d > -20 && d < bestD) { bestD = d; best = sig; }
    }
    return best ? best.state : "green";
  }

  function handleStations(dt) {
    if (game.stationIdx >= STATIONS.length) return;
    const st = STATIONS[game.stationIdx];
    const center = st.pos;
    const dist = center - game.pos;

    // Am Bahnsteig zum Stehen gekommen?
    if (!game.dwelling && Math.abs(dist) <= PLATFORM_LEN / 2 && game.vel < 0.15) {
      // Halt registrieren
      const err = Math.abs(dist);
      let pts, msg;
      if (err <= STOP_TOLERANCE) { pts = 100; msg = `🎯 Perfekter Halt in ${st.name}! +100`; }
      else if (err <= 25) { pts = 70; msg = `✅ Guter Halt in ${st.name}. +70`; }
      else if (err <= 55) { pts = 40; msg = `🅿️ Halt in ${st.name}. +40`; }
      else { pts = 15; msg = `Halt am Rand des Bahnsteigs. +15`; }
      game.score += pts;
      game.statusMsg = msg;
      game.dwelling = true;
      game.dwellTimer = 3;      // 3 s Fahrgastwechsel
      sound.ding(true);
    }

    if (game.dwelling) {
      game.dwellTimer -= dt;
      if (game.dwellTimer <= 0 && game.vel < 0.15) {
        // Weiterfahrt: nächster Bahnhof
        game.dwelling = false;
        game.stationIdx++;
        if (game.stationIdx < STATIONS.length) {
          game.statusMsg = `Weiter nach ${STATIONS[game.stationIdx].name}`;
        }
      } else if (game.dwellTimer > 0) {
        game.statusMsg = `Fahrgastwechsel… ${game.dwellTimer.toFixed(0)} s`;
      }
    }

    // Durchfahren ohne Halt (verpasst)
    if (!game.dwelling && dist < -PLATFORM_LEN / 2 - 5 && game.stationIdx < STATIONS.length) {
      if (game.pos > center + PLATFORM_LEN) {
        game.score = Math.max(0, game.score - 30);
        game.statusMsg = `❌ ${st.name} verpasst! −30`;
        game.stationIdx++;
        sound.ding(false);
      }
    }
  }

  function finishRoute() {
    game.finished = true;
    game.running = false;
    const box = document.querySelector(".overlay-box");
    box.innerHTML = `
      <h1>🏁 Zielbahnhof erreicht!</h1>
      <p class="tagline">Endstation ${STATIONS[STATIONS.length - 1].name}.</p>
      <div style="font-size:52px;font-weight:800;color:var(--amber);margin:10px 0;">${game.score}</div>
      <p class="tagline">Punkte gesamt</p>
      <button id="start-btn">Neue Fahrt</button>
    `;
    document.getElementById("overlay").classList.remove("hidden");
    document.getElementById("start-btn").addEventListener("click", startGame);
  }

  // ========================================================================
  //  RENDERING
  // ========================================================================
  function draw() {
    ctx.clearRect(0, 0, W, H);

    const groundY = H * 0.72;
    const camPos = game.pos;            // Weltmeter im Bildschirmzentrum-ish
    const trainScreenX = W * 0.32;      // Zug bleibt links des Zentrums

    drawSky(groundY);
    drawParallax(camPos, groundY);
    drawLandmarks(camPos, groundY, trainScreenX);
    drawGround(groundY);
    drawTrack(camPos, groundY, trainScreenX);
    drawStations(camPos, groundY, trainScreenX);
    drawSignals(camPos, groundY, trainScreenX);
    drawCatenary(camPos, groundY, trainScreenX);
    drawTrain(trainScreenX, groundY);

    if (game.paused) drawPauseOverlay();
  }

  // Weltposition (m) -> Bildschirm-X (px)
  function worldToScreen(worldPos, camPos, trainScreenX) {
    return trainScreenX + (worldPos - camPos) / M_PER_PX;
  }

  function drawSky(groundY) {
    const g = ctx.createLinearGradient(0, 0, 0, groundY);
    g.addColorStop(0, "#12305c");
    g.addColorStop(0.6, "#4a86c9");
    g.addColorStop(1, "#a9d4ef");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, groundY);

    // Sonne
    ctx.fillStyle = "rgba(255,244,214,0.9)";
    ctx.beginPath();
    ctx.arc(W * 0.78, groundY * 0.32, 42, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawParallax(camPos, groundY) {
    // Alpenkette am Horizont (Salzburger Land: Untersberg, Gaisberg …)
    drawAlps(camPos * 0.07, groundY);
    // Ferne Berge (langsam)
    layerHills(camPos * 0.12, groundY, groundY - 140, "#3a5c7a", 520, 120, 0.15);
    // Nähere Hügel (Voralpenland)
    layerHills(camPos * 0.28, groundY, groundY - 66, "#3f7a5c", 360, 90, 0.6);
    // Wolken
    drawClouds(camPos * 0.06, groundY);
    // Bäume nahe (schnell), separat in drawGround-Bereich
    drawTrees(camPos * 0.85, groundY);
  }

  // Schneebedeckte Alpengipfel am Horizont
  function drawAlps(offset, groundY) {
    const baseY = groundY - 40;
    const peakSpacing = 150;
    const heights = [150, 205, 120, 178, 138, 225, 160, 110, 190];
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    let idx = 0;
    for (let x = -peakSpacing; x <= W + peakSpacing; x += peakSpacing) {
      const px = x - (offset % peakSpacing);
      const h = heights[(idx++) % heights.length];
      ctx.lineTo(px, baseY - h);
      ctx.lineTo(px + peakSpacing / 2, baseY);
    }
    ctx.lineTo(W, baseY);
    ctx.closePath();
    ctx.fillStyle = "#5f7793";
    ctx.fill();
    ctx.clip();
    // Schneekappen (heller oberer Bereich)
    ctx.fillStyle = "rgba(240,246,252,0.92)";
    idx = 0;
    for (let x = -peakSpacing; x <= W + peakSpacing; x += peakSpacing) {
      const px = x - (offset % peakSpacing);
      const h = heights[(idx++) % heights.length];
      const peakY = baseY - h;
      ctx.beginPath();
      ctx.moveTo(px, peakY);
      ctx.lineTo(px - h * 0.16, peakY + h * 0.28);
      ctx.lineTo(px - h * 0.05, peakY + h * 0.20);
      ctx.lineTo(px + h * 0.06, peakY + h * 0.30);
      ctx.lineTo(px + h * 0.16, peakY + h * 0.24);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function layerHills(offset, groundY, baseY, color, wavelength, amp, alpha) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    const step = 20;
    for (let x = 0; x <= W; x += step) {
      const wx = x + (offset % wavelength);
      const y = baseY - Math.sin(wx / wavelength * Math.PI * 2) * amp * alpha
                       - Math.sin(wx / (wavelength * 0.37)) * amp * 0.3;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, groundY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawClouds(offset, groundY) {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    const spacing = 420;
    for (let i = -1; i < W / spacing + 2; i++) {
      const base = i * spacing - (offset % spacing);
      const y = groundY * (0.18 + (i % 3) * 0.09);
      cloud(base, y, 34 + (i % 2) * 10);
    }
  }
  function cloud(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.arc(x + r, y + 6, r * 0.8, 0, Math.PI * 2);
    ctx.arc(x - r * 0.9, y + 8, r * 0.7, 0, Math.PI * 2);
    ctx.arc(x + r * 0.4, y - r * 0.5, r * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawTrees(offset, groundY) {
    const spacing = 150;
    for (let i = -1; i < W / spacing + 2; i++) {
      const x = i * spacing - (offset % spacing);
      const y = groundY - 4;
      // Stamm
      ctx.fillStyle = "#5b3a22";
      ctx.fillRect(x - 3, y - 30, 6, 30);
      // Krone
      ctx.fillStyle = "#2f7d4f";
      ctx.beginPath();
      ctx.arc(x, y - 40, 18, 0, Math.PI * 2);
      ctx.arc(x - 12, y - 30, 13, 0, Math.PI * 2);
      ctx.arc(x + 12, y - 30, 13, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Streckenspezifische Landmarken: Wallersee (Start) & Festung Hohensalzburg (Ziel)
  function drawLandmarks(camPos, groundY, trainScreenX) {
    const par = 0.42;
    const sx = (wp) => trainScreenX + (wp - camPos) / M_PER_PX * par;

    // --- Wallersee bei Seekirchen (rund um Streckenkilometer 0) ---
    const lakeX = sx(600);
    if (lakeX > -360 && lakeX < W + 360) {
      const ly = groundY - 3;
      const lg = ctx.createLinearGradient(0, ly - 16, 0, ly + 6);
      lg.addColorStop(0, "#6ea9c9"); lg.addColorStop(1, "#3f7fa6");
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.ellipse(lakeX, ly, 300, 20, 0, 0, Math.PI * 2);
      ctx.fill();
      // Glitzernde Reflexe
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      for (let i = -4; i <= 4; i++) {
        ctx.fillRect(lakeX + i * 44 - 8, ly - 4 + (i % 2) * 4, 16, 1.5);
      }
      // Schilfufer
      ctx.strokeStyle = "#4c7a3e"; ctx.lineWidth = 2;
      for (let i = -5; i <= 5; i++) {
        const rx = lakeX + i * 52;
        ctx.beginPath(); ctx.moveTo(rx, ly + 2); ctx.lineTo(rx, ly - 8); ctx.stroke();
      }
    }

    // --- Festung Hohensalzburg auf dem Festungsberg (vor Salzburg Hbf) ---
    const fX = sx(13600);
    if (fX > -260 && fX < W + 260) {
      const base = groundY - 2;
      // Festungsberg
      ctx.fillStyle = "#4a6b4a";
      ctx.beginPath();
      ctx.moveTo(fX - 170, base);
      ctx.quadraticCurveTo(fX - 60, base - 150, fX + 30, base - 158);
      ctx.quadraticCurveTo(fX + 130, base - 150, fX + 180, base);
      ctx.closePath();
      ctx.fill();
      // Baumbewuchs (dunkler)
      ctx.fillStyle = "rgba(30,60,40,0.5)";
      ctx.beginPath();
      ctx.moveTo(fX - 170, base);
      ctx.quadraticCurveTo(fX - 90, base - 70, fX - 30, base - 90);
      ctx.lineTo(fX - 30, base); ctx.closePath(); ctx.fill();
      // Festung (Mauern + Türme)
      const cy = base - 158;
      ctx.fillStyle = "#e8e4da";
      ctx.fillRect(fX - 58, cy, 116, 40);       // Hauptmauer
      ctx.fillRect(fX - 70, cy + 14, 140, 26);  // untere Mauer
      // Türme mit Zinnen
      for (const [tx, tw, th] of [[-70, 22, 30], [-8, 20, 46], [50, 22, 34]]) {
        ctx.fillStyle = "#f0ede5";
        ctx.fillRect(fX + tx, cy - th + 30, tw, th);
        ctx.fillStyle = "#b8342a"; // rote Dächer
        ctx.beginPath();
        ctx.moveTo(fX + tx - 2, cy - th + 30);
        ctx.lineTo(fX + tx + tw / 2, cy - th + 18);
        ctx.lineTo(fX + tx + tw + 2, cy - th + 30);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#6b7078"; // Fenster
        ctx.fillRect(fX + tx + tw / 2 - 2, cy - th + 36, 4, 8);
      }
    }
  }

  function drawGround(groundY) {
    const g = ctx.createLinearGradient(0, groundY, 0, H);
    g.addColorStop(0, "#4f7d3f");
    g.addColorStop(1, "#2f4d27");
    ctx.fillStyle = g;
    ctx.fillRect(0, groundY, W, H - groundY);
  }

  function drawTrack(camPos, groundY, trainScreenX) {
    const railY = groundY + 26;
    // Schotterbett
    ctx.fillStyle = "#6b6157";
    ctx.fillRect(0, railY - 6, W, 26);

    // Schwellen (mit Weltposition, damit sie sich mitbewegen)
    ctx.fillStyle = "#3d332a";
    const sleeperSpacing = 12; // Meter
    const startM = Math.floor((camPos - trainScreenX * M_PER_PX) / sleeperSpacing) * sleeperSpacing;
    for (let m = startM; m < camPos + (W - trainScreenX) * M_PER_PX; m += sleeperSpacing) {
      const x = worldToScreen(m, camPos, trainScreenX);
      ctx.fillRect(x - 4, railY - 4, 8, 20);
    }

    // Schienen
    ctx.fillStyle = "#c9d0d8";
    ctx.fillRect(0, railY - 2, W, 3);
    ctx.fillRect(0, railY + 12, W, 3);
  }

  function drawStations(camPos, groundY, trainScreenX) {
    // Abfahrtsbahnhof (Start) + alle Halte zeichnen
    drawPlatform(ORIGIN, false, true, camPos, groundY, trainScreenX);
    for (let i = 0; i < STATIONS.length; i++) {
      drawPlatform(STATIONS[i], i === game.stationIdx, false, camPos, groundY, trainScreenX);
    }
  }

  function drawPlatform(st, isNext, isOrigin, camPos, groundY, trainScreenX) {
    const cx = worldToScreen(st.pos, camPos, trainScreenX);
    const halfW = (PLATFORM_LEN / 2) / M_PER_PX;
    if (cx + halfW < -60 || cx - halfW > W + 60) return;

    const platY = groundY + 6;
    // Bahnsteig
    ctx.fillStyle = "#b9b2a6";
    ctx.fillRect(cx - halfW, platY - 18, halfW * 2, 18);
    ctx.fillStyle = "#d8d2c6";
    ctx.fillRect(cx - halfW, platY - 18, halfW * 2, 4);
    // Bahnsteigdach (ÖBB-typisch)
    ctx.fillStyle = "rgba(40,55,70,0.85)";
    ctx.fillRect(cx - halfW + 6, platY - 46, halfW * 2 - 12, 5);
    for (let px = cx - halfW + 16; px < cx + halfW - 12; px += 46) {
      ctx.fillStyle = "#5a6470";
      ctx.fillRect(px, platY - 41, 3, 23);
    }

    // Haltemarkierung (Bahnsteigmitte)
    ctx.fillStyle = isNext ? "#ffd23f" : "#8a8478";
    ctx.fillRect(cx - 2, platY - 30, 4, 14);

    // Empfangsgebäude
    const bx = cx - halfW - 8;
    ctx.fillStyle = isOrigin ? "#7a8a5a" : "#b23a2f";
    ctx.fillRect(bx - 48, platY - 60, 48, 42);
    ctx.fillStyle = "#3a4657";
    ctx.beginPath();
    ctx.moveTo(bx - 54, platY - 60);
    ctx.lineTo(bx - 24, platY - 78);
    ctx.lineTo(bx + 6, platY - 60);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffe08a";
    ctx.fillRect(bx - 40, platY - 50, 11, 11);
    ctx.fillRect(bx - 22, platY - 50, 11, 11);
    ctx.fillStyle = "#6b4a3a";
    ctx.fillRect(bx - 31, platY - 34, 12, 16);

    // Stationsschild (ÖBB-blau)
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    const tw = ctx.measureText(st.name).width;
    ctx.fillStyle = "#1f4e8c";
    roundRect(cx - tw / 2 - 8, platY - 40, tw + 16, 17, 3); ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(st.name, cx, platY - 28);
    if (isOrigin) {
      ctx.fillStyle = "#cfe0f5";
      ctx.font = "9px system-ui, sans-serif";
      ctx.fillText("Start", cx, platY - 46);
    }
    ctx.textAlign = "left";
  }

  function drawSignals(camPos, groundY, trainScreenX) {
    for (const sig of SIGNALS) {
      const x = worldToScreen(sig.pos, camPos, trainScreenX);
      if (x < -30 || x > W + 30) continue;
      const baseY = groundY + 8;
      // Mast
      ctx.fillStyle = "#2b3038";
      ctx.fillRect(x - 2, baseY - 70, 4, 70);
      // Signalkasten
      ctx.fillStyle = "#15191f";
      ctx.fillRect(x - 9, baseY - 96, 18, 30);
      // Lampen
      const lamps = [
        { c: "#f87171", on: sig.state === "red", y: baseY - 90 },
        { c: "#fbbf24", on: sig.state === "amber", y: baseY - 81 },
        { c: "#4ade80", on: sig.state === "green", y: baseY - 72 },
      ];
      for (const l of lamps) {
        ctx.beginPath();
        ctx.arc(x, l.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = l.on ? l.c : "#2c333d";
        if (l.on) { ctx.shadowColor = l.c; ctx.shadowBlur = 12; }
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  }

  // Höhe der Oberleitung über dem Boden (px)
  const WIRE_H = 118;

  function drawCatenary(camPos, groundY, trainScreenX) {
    const wireY = groundY - WIRE_H;
    // Fahrdraht (durchgehend, mit leichtem Durchhang zwischen den Masten)
    const span = 60; // Meter zwischen Masten
    const startM = Math.floor((camPos - trainScreenX * M_PER_PX) / span) * span;
    ctx.strokeStyle = "#20262e";
    ctx.lineWidth = 1.5;
    // Tragseil (oben) + Fahrdraht (unten) mit Durchhang
    for (let m = startM; m < camPos + (W - trainScreenX) * M_PER_PX + span; m += span) {
      const x1 = worldToScreen(m, camPos, trainScreenX);
      const x2 = worldToScreen(m + span, camPos, trainScreenX);
      const mid = (x1 + x2) / 2;
      // Fahrdraht mit Durchhang
      ctx.beginPath();
      ctx.moveTo(x1, wireY);
      ctx.quadraticCurveTo(mid, wireY + 6, x2, wireY);
      ctx.stroke();
      // Tragseil
      ctx.beginPath();
      ctx.moveTo(x1, wireY - 22);
      ctx.quadraticCurveTo(mid, wireY - 30, x2, wireY - 22);
      ctx.stroke();
      // Hänger
      ctx.beginPath();
      ctx.moveTo(mid, wireY - 27); ctx.lineTo(mid, wireY + 3);
      ctx.stroke();
    }
    // Masten
    for (let m = startM; m < camPos + (W - trainScreenX) * M_PER_PX + span; m += span) {
      const x = worldToScreen(m, camPos, trainScreenX);
      ctx.fillStyle = "#3a4652";
      ctx.fillRect(x - 3, wireY - 24, 6, groundY - (wireY - 24));
      // Ausleger
      ctx.fillRect(x - 3, wireY - 24, 34, 4);
      ctx.strokeStyle = "#3a4652";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 28, wireY - 20); ctx.lineTo(x + 28, wireY - 2);
      ctx.stroke();
    }
  }

  // Shinkansen-E5-Farben ("Hayabusa")
  const SK_GREEN_TOP = "#12653f";
  const SK_GREEN_BOT = "#0c4a30";
  const SK_WHITE_TOP = "#f3f6f9";
  const SK_WHITE_BOT = "#d5dde3";
  const SK_PINK = "#e5006e";
  const SK_WIN = "#0c1a24";

  function drawTrain(x, groundY) {
    const railY = groundY + 26;
    const bodyBottom = railY - 4;
    // Räder rollen vorwärts (nach rechts) => im Uhrzeigersinn => positive Rotation
    const spin = game.pos / (11 * M_PER_PX);

    ctx.save();
    // leichtes Wippen bei Geschwindigkeit
    const bob = Math.sin(game.time * 9) * Math.min(game.vel * 0.03, 0.9);
    ctx.translate(0, bob);

    // Gemeinsamer Schatten unter dem ganzen Zug
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(x - 150, bodyBottom + 8, 400, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    // Angehängte Wagen (hinter dem Triebkopf, also links); mittlerer trägt Pantograph
    drawCar(x - 372, groundY, bodyBottom, spin, false);
    drawCar(x - 210, groundY, bodyBottom, spin, true);
    // Übergänge/Kupplungen
    ctx.fillStyle = "#1a1e24";
    ctx.fillRect(x - 108, bodyBottom - 30, 14, 24);
    ctx.fillRect(x - 285, bodyBottom - 30, 12, 24);

    // Triebkopf (Front mit langem Bug zeigt nach rechts)
    drawLead(x, groundY, bodyBottom, spin);

    ctx.restore();
  }

  // Drehgestell mit zwei Achsen
  function drawBogie(cx, bottom, spin) {
    const r = 11;
    // Rahmen
    ctx.fillStyle = "#20252c";
    roundRect(cx - 34, bottom - 20, 68, 16, 4);
    ctx.fill();
    for (const dx of [-20, 20]) {
      ctx.save();
      ctx.translate(cx + dx, bottom);
      // Reifen
      ctx.fillStyle = "#15181d";
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      // Felge
      ctx.fillStyle = "#4b535e";
      ctx.beginPath(); ctx.arc(0, 0, r - 4, 0, Math.PI * 2); ctx.fill();
      // Speichen (drehen sich)
      ctx.rotate(spin);
      ctx.strokeStyle = "#20252c"; ctx.lineWidth = 2;
      for (let s = 0; s < 4; s++) {
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(s * Math.PI / 2) * (r - 4), Math.sin(s * Math.PI / 2) * (r - 4));
        ctx.stroke();
      }
      // Nabe
      ctx.fillStyle = "#cbd3dd";
      ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  // Stromabnehmer (Einholm-Pantograph), berührt den Fahrdraht
  function drawPantograph(panX, roofY, wireY) {
    ctx.strokeStyle = "#2b333d"; ctx.lineWidth = 2.4; ctx.lineCap = "round";
    ctx.fillStyle = "#3a424c";
    ctx.fillRect(panX - 16, roofY - 3, 32, 4);           // Sockel
    ctx.beginPath();
    ctx.moveTo(panX - 12, roofY - 1); ctx.lineTo(panX + 6, wireY + 5);   // Unterarm
    ctx.moveTo(panX + 6, wireY + 5);  ctx.lineTo(panX - 10, wireY + 2);  // Oberarm
    ctx.stroke();
    ctx.strokeStyle = "#1a1e24"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(panX - 20, wireY + 2); ctx.lineTo(panX + 14, wireY + 2); ctx.stroke(); // Schleifleiste
    ctx.lineWidth = 1;
  }

  // Fensterband (durchgehend, getönt) mit Glanzsegmenten
  function windowBand(x0, x1, y, h) {
    ctx.fillStyle = SK_WIN;
    roundRect(x0, y, x1 - x0, h, h / 2); ctx.fill();
    ctx.fillStyle = "rgba(150,200,235,0.28)";
    const n = Math.floor((x1 - x0) / 22);
    for (let i = 0; i < n; i++) roundRect(x0 + 6 + i * 22, y + 2, 13, h - 4, 2), ctx.fill();
  }

  // Triebkopf mit langem "Hayabusa"-Bug (Front nach rechts)
  function drawLead(cx, groundY, bodyBottom, spin) {
    const height = 62;
    const top = bodyBottom - height;
    const beltY = top + 30;                 // Übergang Grün/Weiß (pinke Linie)
    const bodyLeft = cx - 74;
    const bodyRight = cx + 44;               // Bug/Körper-Übergang
    const tipX = cx + 132, tipY = bodyBottom - 15;

    // ---- Körper-Umriss (Körper + langer Bug) ----
    ctx.beginPath();
    ctx.moveTo(bodyLeft + 8, top);
    ctx.lineTo(bodyRight, top);
    ctx.quadraticCurveTo(bodyRight + 76, top + 3, tipX, tipY);        // Bugrücken
    ctx.quadraticCurveTo(bodyRight + 58, bodyBottom + 1, bodyRight, bodyBottom); // Bugunterseite
    ctx.lineTo(bodyLeft + 6, bodyBottom);
    ctx.quadraticCurveTo(bodyLeft, bodyBottom, bodyLeft, bodyBottom - 8);
    ctx.lineTo(bodyLeft, top + 8);
    ctx.quadraticCurveTo(bodyLeft, top, bodyLeft + 8, top);
    ctx.closePath();

    ctx.save();
    ctx.clip();
    // Weiß (Basis)
    const wg = ctx.createLinearGradient(0, top, 0, bodyBottom);
    wg.addColorStop(0, SK_WHITE_TOP); wg.addColorStop(1, SK_WHITE_BOT);
    ctx.fillStyle = wg;
    ctx.fillRect(bodyLeft - 4, top - 4, tipX - bodyLeft + 12, height + 8);
    // Grün (Dach + über den Bug laufend)
    const gg = ctx.createLinearGradient(0, top, 0, beltY);
    gg.addColorStop(0, SK_GREEN_TOP); gg.addColorStop(1, SK_GREEN_BOT);
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.moveTo(bodyLeft - 4, top - 4);
    ctx.lineTo(bodyRight, top);
    ctx.quadraticCurveTo(bodyRight + 76, top + 3, tipX, tipY);
    ctx.quadraticCurveTo(bodyRight + 40, tipY + 9, bodyRight, beltY);
    ctx.lineTo(bodyLeft - 4, beltY);
    ctx.closePath();
    ctx.fill();
    // Pinke Signaturlinie entlang Gürtellinie und Bug
    ctx.strokeStyle = SK_PINK; ctx.lineWidth = 3.2; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(bodyLeft, beltY + 1.5);
    ctx.lineTo(bodyRight, beltY + 1.5);
    ctx.quadraticCurveTo(bodyRight + 42, tipY + 11, tipX - 6, tipY + 5);
    ctx.stroke();
    // Glanz auf dem Dach
    ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bodyLeft + 8, top + 5); ctx.lineTo(bodyRight + 4, top + 6); ctx.stroke();
    ctx.restore();

    // ---- Fensterband (weißer Bereich) ----
    windowBand(bodyLeft + 12, bodyRight - 4, beltY + 6, 15);

    // ---- Frontscheibe (Fahrerstand, schräg an der Bugwurzel) ----
    ctx.fillStyle = SK_WIN;
    ctx.beginPath();
    ctx.moveTo(bodyRight - 6, top + 9);
    ctx.quadraticCurveTo(bodyRight + 24, top + 11, bodyRight + 30, beltY - 2);
    ctx.lineTo(bodyRight + 8, beltY - 1);
    ctx.lineTo(bodyRight - 6, top + 24);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(170,215,250,0.5)";
    ctx.beginPath();
    ctx.moveTo(bodyRight - 2, top + 12);
    ctx.lineTo(bodyRight + 14, top + 14);
    ctx.lineTo(bodyRight + 4, beltY - 3);
    ctx.closePath();
    ctx.fill();

    // ---- Scheinwerfer am Bug + Lichtkegel ----
    ctx.fillStyle = "#eaf6ff";
    ctx.beginPath(); ctx.ellipse(bodyRight + 60, tipY - 4, 5, 3, -0.2, 0, Math.PI * 2); ctx.fill();
    if (game.vel > 0.5) {
      const glow = Math.min(0.22, 0.07 + game.vel * 0.003);
      ctx.fillStyle = `rgba(235,246,255,${glow})`;
      ctx.beginPath();
      ctx.moveTo(bodyRight + 62, tipY - 6);
      ctx.lineTo(tipX + 70, tipY - 26);
      ctx.lineTo(tipX + 70, tipY + 12);
      ctx.closePath();
      ctx.fill();
    }
    // Baureihen-Kennung
    ctx.fillStyle = SK_PINK;
    ctx.font = "bold 9px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("E5", bodyLeft + 10, beltY - 6);

    // Drehgestelle
    drawBogie(bodyLeft + 26, bodyBottom + 4, spin);
    drawBogie(bodyRight - 6, bodyBottom + 4, spin);

    // Bremsfunken
    if ((game.brake > 0.6 || game.emergency) && game.vel > 4) {
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = `rgba(255,${180 + Math.random() * 60 | 0},80,${Math.random()})`;
        const sx = bodyLeft + 20 + Math.random() * 40;
        ctx.fillRect(sx, bodyBottom + 8 + Math.random() * 8, 2, 2);
      }
    }
    // Signalhorn-Effekt
    if (game.horn > 0) {
      ctx.fillStyle = `rgba(255,255,255,${game.horn})`;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(tipX + 6 + i * 12, tipY - 8 - i * 5, 4 + i, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Mittel-/Endwagen im E5-Design
  function drawCar(cx, groundY, bodyBottom, spin, pantograph) {
    const len = 150, height = 62;
    const left = cx - len / 2;
    const top = bodyBottom - height;
    const beltY = top + 30;

    if (pantograph) drawPantograph(cx, top - 1, groundY - WIRE_H);

    // Körper (weiße Basis, gerundetes Dach)
    ctx.save();
    roundRect(left, top, len, height, 13);
    ctx.clip();
    const wg = ctx.createLinearGradient(0, top, 0, bodyBottom);
    wg.addColorStop(0, SK_WHITE_TOP); wg.addColorStop(1, SK_WHITE_BOT);
    ctx.fillStyle = wg;
    ctx.fillRect(left, top, len, height);
    // Grünes Dach bis zur Gürtellinie
    const gg = ctx.createLinearGradient(0, top, 0, beltY);
    gg.addColorStop(0, SK_GREEN_TOP); gg.addColorStop(1, SK_GREEN_BOT);
    ctx.fillStyle = gg;
    ctx.fillRect(left, top, len, beltY - top);
    // Pinke Signaturlinie
    ctx.fillStyle = SK_PINK;
    ctx.fillRect(left, beltY, len, 3);
    // Dachglanz
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(left + 6, top + 4, len - 12, 3);
    ctx.restore();

    // Fensterband
    windowBand(left + 10, left + len - 10, beltY + 6, 15);
    // Türen (weiß, schmale Fugen)
    ctx.strokeStyle = "rgba(120,140,155,0.7)"; ctx.lineWidth = 1;
    for (const dx of [24, len - 24]) {
      ctx.beginPath(); ctx.moveTo(left + dx, beltY + 4); ctx.lineTo(left + dx, bodyBottom - 6); ctx.stroke();
    }

    // Drehgestelle
    drawBogie(left + 28, bodyBottom + 4, spin);
    drawBogie(left + len - 28, bodyBottom + 4, spin);
  }

  function drawPauseOverlay() {
    ctx.fillStyle = "rgba(3,5,12,0.55)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#e8eefc";
    ctx.font = "bold 44px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("⏸ Pause", W / 2, H / 2);
    ctx.font = "16px system-ui, sans-serif";
    ctx.fillText("Taste P zum Fortsetzen", W / 2, H / 2 + 36);
    ctx.textAlign = "left";
  }

  // ---------- Hilfsfunktionen ----------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ---------- HUD ----------
  const el = {
    speed: document.getElementById("speed"),
    limit: document.getElementById("limit"),
    throttleFill: document.getElementById("throttle-fill"),
    brakeFill: document.getElementById("brake-fill"),
    throttleNum: document.getElementById("throttle-num"),
    brakeNum: document.getElementById("brake-num"),
    nextStation: document.getElementById("next-station"),
    nextDist: document.getElementById("next-dist"),
    signalState: document.getElementById("signal-state"),
    odometer: document.getElementById("odometer"),
    score: document.getElementById("score"),
    statusMsg: document.getElementById("status-msg"),
    speedPanel: document.getElementById("speed-panel"),
  };

  function updateHUD() {
    const spd = Math.round(game.vel * KMH);
    el.speed.textContent = spd;
    el.limit.textContent = game.limit;
    el.speedPanel.classList.toggle("over-limit", spd > game.limit + 1);

    el.throttleFill.style.height = (game.throttle * 100) + "%";
    el.brakeFill.style.height = ((game.emergency ? 1 : game.brake) * 100) + "%";
    el.throttleNum.textContent = Math.round(game.throttle * 100) + "%";
    el.brakeNum.textContent = Math.round((game.emergency ? 1 : game.brake) * 100) + "%";

    if (game.stationIdx < STATIONS.length) {
      const st = STATIONS[game.stationIdx];
      el.nextStation.textContent = st.name;
      const d = st.pos - game.pos;
      el.nextDist.textContent = d > 0 ? formatDist(d) : "am Bahnsteig";
    } else {
      el.nextStation.textContent = "Endstation";
      el.nextDist.textContent = formatDist(Math.max(0, ROUTE_END - game.pos));
    }

    const sig = nearestSignalState();
    el.signalState.textContent = sig === "red" ? "HALT" : sig === "amber" ? "Vorsicht" : "frei";
    el.signalState.className = sig === "red" ? "sig-red" : sig === "amber" ? "sig-amber" : "sig-green";

    el.odometer.textContent = (game.pos / 1000).toFixed(2);
    el.score.textContent = game.score;
    el.statusMsg.textContent = game.statusMsg;
  }

  function formatDist(m) {
    return m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m";
  }

  // ---------- Game-Loop ----------
  let lastT = 0;
  function loop(t) {
    const dt = Math.min((t - lastT) / 1000, 0.05) || 0;
    lastT = t;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // ---------- Steuerung Start/Pause ----------
  function startGame() {
    Object.assign(game, {
      running: true, paused: false, pos: 0, vel: 0, throttle: 0, brake: 0,
      emergency: false, limit: STATIONS[0].limit, score: 0, finished: false,
      stationIdx: 0, dwellTimer: 0, dwelling: false, overspeedTimer: 0,
      time: 0, horn: 0, statusMsg: `Abfahrt ${ORIGIN.name} → ${STATIONS[0].name}`,
    });
    game.penalizedSignals = new Set();
    // Debug-Startpunkt: URL-Hash #km=<n> setzt die Anfangsposition (nur zum Testen)
    const dbg = /[#&]km=([\d.]+)/.exec(location.hash);
    if (dbg) {
      game.pos = parseFloat(dbg[1]) * 1000;
      game.stationIdx = STATIONS.findIndex((s) => s.pos > game.pos);
      if (game.stationIdx < 0) game.stationIdx = STATIONS.length;
    }
    document.getElementById("overlay").classList.add("hidden");
    sound.ensure(); // AudioContext bei User-Geste freischalten
    updateHUD();
  }

  function togglePause() {
    if (!game.running || game.finished) return;
    game.paused = !game.paused;
  }

  document.getElementById("start-btn").addEventListener("click", startGame);

  // ---------- Init ----------
  resize();
  updateHUD();
  requestAnimationFrame(loop);
})();
