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
  // Bahnhöfe entlang der Strecke (Position in Metern ab Start).
  const STATIONS = [
    { name: "Talheim",        pos: 900,   limit: 100 },
    { name: "Bergkirchen",    pos: 2600,  limit: 80  },
    { name: "Seebrück",       pos: 4600,  limit: 120 },
    { name: "Waldau",         pos: 6900,  limit: 90  },
    { name: "Hafenstadt Hbf", pos: 9500,  limit: 60  },
  ];
  const ROUTE_END = STATIONS[STATIONS.length - 1].pos + 60;
  const PLATFORM_LEN = 120;      // Bahnsteiglänge (m)
  const STOP_TOLERANCE = 8;      // perfekter Halt innerhalb ± m der Bahnsteigmitte

  // Signale entlang der Strecke. state wird dynamisch gesetzt.
  const SIGNALS = [
    { pos: 1900, state: "green" },
    { pos: 3700, state: "green" },
    { pos: 5700, state: "green" },
    { pos: 8100, state: "green" },
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
    // Ferne Berge (langsam)
    layerHills(camPos * 0.12, groundY, groundY - 150, "#2c4a6e", 520, 130, 0.15);
    // Nähere Hügel
    layerHills(camPos * 0.28, groundY, groundY - 70, "#3a6b57", 360, 90, 0.6);
    // Wolken
    drawClouds(camPos * 0.06, groundY);
    // Bäume nahe (schnell), separat in drawGround-Bereich
    drawTrees(camPos * 0.85, groundY);
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
    for (let i = 0; i < STATIONS.length; i++) {
      const st = STATIONS[i];
      const cx = worldToScreen(st.pos, camPos, trainScreenX);
      const halfW = (PLATFORM_LEN / 2) / M_PER_PX;
      if (cx + halfW < -50 || cx - halfW > W + 50) continue;

      const platY = groundY + 6;
      // Bahnsteig
      ctx.fillStyle = "#b9b2a6";
      ctx.fillRect(cx - halfW, platY - 18, halfW * 2, 18);
      ctx.fillStyle = "#d8d2c6";
      ctx.fillRect(cx - halfW, platY - 18, halfW * 2, 4);

      // Haltemarkierung (Bahnsteigmitte)
      ctx.fillStyle = (i === game.stationIdx) ? "#ffd23f" : "#8a8478";
      ctx.fillRect(cx - 2, platY - 30, 4, 14);

      // Stationsgebäude
      const bx = cx - halfW - 8;
      ctx.fillStyle = "#8c4a3a";
      ctx.fillRect(bx - 46, platY - 66, 46, 48);
      ctx.fillStyle = "#5c2f24";
      ctx.beginPath();
      ctx.moveTo(bx - 52, platY - 66);
      ctx.lineTo(bx - 23, platY - 84);
      ctx.lineTo(bx + 6, platY - 66);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ffe08a";
      ctx.fillRect(bx - 38, platY - 56, 12, 12);
      ctx.fillRect(bx - 20, platY - 56, 12, 12);

      // Name
      ctx.fillStyle = "#0e1622";
      ctx.font = "bold 13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(st.name, cx, platY - 36);
      ctx.textAlign = "left";
    }
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

  function drawTrain(x, groundY) {
    const railY = groundY + 26;
    const bodyBottom = railY - 4;
    const spin = -game.pos / (13 * M_PER_PX);

    ctx.save();
    // leichtes Wippen bei Geschwindigkeit
    const bob = Math.sin(game.time * 9) * Math.min(game.vel * 0.03, 0.9);
    ctx.translate(0, bob);

    // Gemeinsamer Schatten unter dem ganzen Zug
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(x - 180, bodyBottom + 8, 370, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    // Zwei angehängte Personenwagen (hinter der Lok, also links)
    drawCar(x - 372, bodyBottom, spin);
    drawCar(x - 210, bodyBottom, spin);
    // Kupplungen
    ctx.fillStyle = "#1a1e24";
    ctx.fillRect(x - 118, bodyBottom - 16, 20, 6);
    ctx.fillRect(x - 292, bodyBottom - 16, 12, 6);

    // Lokomotive (Front zeigt nach rechts)
    drawLoco(x, groundY, bodyBottom, spin);

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

  function drawLoco(cx, groundY, bodyBottom, spin) {
    const len = 168, height = 66;
    const left = cx - len * 0.42;
    const top = bodyBottom - height;
    const noseR = left + len;      // Front rechts
    const wireY = groundY - WIRE_H;

    // ---- Stromabnehmer (Pantograph) auf dem Dach, berührt Fahrdraht ----
    const panX = left + len * 0.4;
    const baseY = top - 2;
    ctx.strokeStyle = "#2b333d"; ctx.lineWidth = 2.4; ctx.lineCap = "round";
    // Sockelisolatoren
    ctx.fillStyle = "#3a424c";
    ctx.fillRect(panX - 20, baseY - 3, 6, 4);
    ctx.fillRect(panX + 14, baseY - 3, 6, 4);
    // Scherenarme
    ctx.beginPath();
    ctx.moveTo(panX - 17, baseY - 2); ctx.lineTo(panX + 4, wireY + 4);
    ctx.moveTo(panX + 17, baseY - 2); ctx.lineTo(panX + 4, wireY + 4);
    ctx.moveTo(panX + 4, wireY + 4); ctx.lineTo(panX - 14, wireY + 2);
    ctx.stroke();
    // Schleifleiste (Kontakt zum Draht)
    ctx.strokeStyle = "#1a1e24"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(panX - 22, wireY + 2); ctx.lineTo(panX + 12, wireY + 2); ctx.stroke();
    ctx.lineWidth = 1;

    // ---- Wagenkasten mit stromlinienförmiger Nase ----
    const g = ctx.createLinearGradient(0, top, 0, bodyBottom);
    g.addColorStop(0, "#ff5a4d");
    g.addColorStop(0.45, "#e23b3b");
    g.addColorStop(1, "#a51f1f");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(left + 8, top);
    ctx.lineTo(noseR - 34, top);
    // Dach->Nase Rundung
    ctx.quadraticCurveTo(noseR + 4, top + 6, noseR + 6, top + height * 0.55);
    ctx.quadraticCurveTo(noseR + 6, bodyBottom, noseR - 14, bodyBottom);
    ctx.lineTo(left + 8, bodyBottom);
    ctx.quadraticCurveTo(left, bodyBottom, left, bodyBottom - 8);
    ctx.lineTo(left, top + 8);
    ctx.quadraticCurveTo(left, top, left + 8, top);
    ctx.closePath();
    ctx.fill();

    // Glanzstreifen (Reflexion) auf der Flanke
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.fillRect(left + 6, top + 14, len - 30, 4);

    // Dachband (dunkler)
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.moveTo(left + 8, top);
    ctx.lineTo(noseR - 34, top);
    ctx.quadraticCurveTo(noseR - 2, top + 4, noseR - 4, top + 12);
    ctx.lineTo(left + 6, top + 12);
    ctx.closePath();
    ctx.fill();
    // Dachtechnik (Lüfter/Kästen)
    ctx.fillStyle = "#5a6470";
    for (let i = 0; i < 3; i++) ctx.fillRect(left + 22 + i * 22, top + 2, 14, 5);

    // Zierstreifen (Livery)
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(left + 2, top + height - 20, len - 20, 6);
    ctx.fillStyle = "#1c2530";
    ctx.fillRect(left + 2, top + height - 12, len - 18, 3);

    // Frontscheibe (schräg)
    ctx.fillStyle = "#0e2438";
    ctx.beginPath();
    ctx.moveTo(noseR - 30, top + 8);
    ctx.lineTo(noseR - 6, top + 12);
    ctx.lineTo(noseR - 4, top + 30);
    ctx.lineTo(noseR - 34, top + 28);
    ctx.closePath();
    ctx.fill();
    // Reflexion
    ctx.fillStyle = "rgba(180,220,255,0.5)";
    ctx.beginPath();
    ctx.moveTo(noseR - 28, top + 10);
    ctx.lineTo(noseR - 16, top + 12);
    ctx.lineTo(noseR - 22, top + 26);
    ctx.lineTo(noseR - 32, top + 25);
    ctx.closePath();
    ctx.fill();

    // Seitenfenster mit Rahmen
    for (let i = 0; i < 3; i++) {
      const wx = left + 24 + i * 34;
      ctx.fillStyle = "#0e2438";
      roundRect(wx - 1, top + 15, 26, 20, 4); ctx.fill();
      const wg = ctx.createLinearGradient(0, top + 15, 0, top + 35);
      wg.addColorStop(0, "#bfe3ff"); wg.addColorStop(1, "#7fb4dc");
      ctx.fillStyle = wg;
      roundRect(wx + 1, top + 17, 22, 16, 3); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      roundRect(wx + 2, top + 18, 8, 14, 2); ctx.fill();
    }

    // Loknummer-Plakette
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    roundRect(left + 6, top + height - 34, 30, 11, 3); ctx.fill();
    ctx.fillStyle = "#e8eefc";
    ctx.font = "bold 8px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("101 042", left + 21, top + height - 25);
    ctx.textAlign = "left";

    // Scheinwerfer + Lichtkegel
    ctx.fillStyle = "#fff7cc";
    ctx.beginPath(); ctx.arc(noseR - 8, top + height - 26, 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(noseR - 8, top + height - 14, 3.5, 0, Math.PI * 2); ctx.fill();
    if (game.vel > 0.5) {
      const glow = Math.min(0.22, 0.08 + game.vel * 0.004);
      ctx.fillStyle = `rgba(255,247,204,${glow})`;
      ctx.beginPath();
      ctx.moveTo(noseR - 4, top + height - 28);
      ctx.lineTo(noseR + 90, top + height - 48);
      ctx.lineTo(noseR + 90, top + height - 2);
      ctx.closePath();
      ctx.fill();
    }

    // Puffer/Bahnräumer vorne
    ctx.fillStyle = "#2a3038";
    ctx.beginPath();
    ctx.moveTo(noseR - 12, bodyBottom);
    ctx.lineTo(noseR + 4, bodyBottom);
    ctx.lineTo(noseR - 6, bodyBottom + 10);
    ctx.lineTo(noseR - 24, bodyBottom + 10);
    ctx.closePath();
    ctx.fill();

    // Drehgestelle
    drawBogie(left + 30, bodyBottom + 4, spin);
    drawBogie(left + len - 44, bodyBottom + 4, spin);

    // Bremsfunken
    if ((game.brake > 0.6 || game.emergency) && game.vel > 4) {
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = `rgba(255,${180 + Math.random() * 60 | 0},80,${Math.random()})`;
        const sx = left + 24 + Math.random() * 40;
        ctx.fillRect(sx, bodyBottom + 8 + Math.random() * 8, 2, 2);
      }
    }
    // Hupen-Dampf
    if (game.horn > 0) {
      ctx.fillStyle = `rgba(255,255,255,${game.horn})`;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(noseR + 8 + i * 12, top - 4 - i * 5, 4 + i, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawCar(cx, bodyBottom, spin) {
    const len = 150, height = 60;
    const left = cx - len / 2;
    const top = bodyBottom - height;

    // Kasten mit gerundetem Dach
    const g = ctx.createLinearGradient(0, top, 0, bodyBottom);
    g.addColorStop(0, "#f0f3f7");
    g.addColorStop(1, "#c3ccd6");
    ctx.fillStyle = g;
    roundRect(left, top, len, height, 12); ctx.fill();

    // Dachband
    ctx.fillStyle = "#9aa5b1";
    roundRect(left + 2, top, len - 4, 12, 10); ctx.fill();

    // Zierstreifen passend zur Lok
    ctx.fillStyle = "#e23b3b";
    ctx.fillRect(left + 4, top + height - 22, len - 8, 7);
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(left + 4, top + height - 14, len - 8, 3);

    // Fensterreihe
    for (let i = 0; i < 5; i++) {
      const wx = left + 14 + i * 27;
      ctx.fillStyle = "#0e2438";
      roundRect(wx - 1, top + 15, 22, 20, 4); ctx.fill();
      const wg = ctx.createLinearGradient(0, top + 15, 0, top + 35);
      wg.addColorStop(0, "#cfeaff"); wg.addColorStop(1, "#8bbde0");
      ctx.fillStyle = wg;
      roundRect(wx + 1, top + 17, 18, 16, 3); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      roundRect(wx + 2, top + 18, 6, 14, 2); ctx.fill();
    }
    // Tür
    ctx.fillStyle = "#8a95a1";
    ctx.fillRect(left + len - 16, top + 14, 10, height - 30);

    // Drehgestelle
    drawBogie(left + 30, bodyBottom + 4, spin);
    drawBogie(left + len - 30, bodyBottom + 4, spin);
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
      time: 0, horn: 0, statusMsg: `Abfahrt Richtung ${STATIONS[0].name}`,
    });
    game.penalizedSignals = new Set();
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
