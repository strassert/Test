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
    // Kindermodus
    kidMode: false,
    going: false,        // Kindermodus: fährt der Zug gerade?
    celebrate: 0,        // Jubel-Timer (s)
    arrivedName: "",     // zuletzt erreichter Bahnhof (für Jubel-Banner)
    stars: 0,            // erreichte Bahnhöfe
    confetti: [],
  };

  // Kindermodus-Fahrwerte
  const KID_CRUISE = 44;   // flotte, aber ruhige Reisegeschwindigkeit (m/s)
  const KID_SLOW = 340;    // ab dieser Distanz (m) sanft zum Bahnhof abbremsen

  // ---------- Eingabe ----------
  const input = { throttleUp: false, brakeDown: false };

  const keyMap = {
    ArrowUp: "throttleUp", KeyW: "throttleUp",
    ArrowDown: "brakeDown", KeyS: "brakeDown",
  };

  function hornPress() { sound.horn(); game.horn = 0.6; }

  window.addEventListener("keydown", (e) => {
    if (game.kidMode) {
      // Kindermodus: nur Los / Stopp / Hupe (auch für mitspielende Eltern)
      if (e.code === "Space" || e.code === "Enter" || e.code === "ArrowUp" || e.code === "KeyW") { kidGo(); e.preventDefault(); }
      else if (e.code === "ArrowDown" || e.code === "KeyS") { kidStop(); e.preventDefault(); }
      else if (e.code === "KeyH") { hornPress(); }
      return;
    }
    if (keyMap[e.code]) { input[keyMap[e.code]] = true; e.preventDefault(); }
    else if (e.code === "Space") { game.emergency = true; e.preventDefault(); }
    else if (e.code === "KeyH") { hornPress(); }
    else if (e.code === "KeyP") { togglePause(); }
  });
  window.addEventListener("keyup", (e) => {
    if (game.kidMode) return;
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
    // Fröhliche Melodie beim Ankommen (Kindermodus)
    function cheer() {
      const a = ensure(); if (!a) return;
      const t = a.currentTime;
      [523, 659, 784, 1047].forEach((f, i) => {
        const o = a.createOscillator(), g = a.createGain();
        o.type = "triangle"; o.frequency.value = f;
        const s = t + i * 0.12;
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(0.16, s + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.28);
        o.connect(g); g.connect(a.destination);
        o.start(s); o.stop(s + 0.3);
      });
    }
    // Sanfter Abfahrts-Ton (Kindermodus)
    function toot() {
      const a = ensure(); if (!a) return;
      const t = a.currentTime;
      const o = a.createOscillator(), g = a.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(330, t);
      o.frequency.exponentialRampToValueAtTime(440, t + 0.18);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.1, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g); g.connect(a.destination);
      o.start(t); o.stop(t + 0.32);
    }
    return { horn, ding, cheer, toot, ensure };
  })();

  // ---------- Physik-Update ----------
  function update(dt) {
    if (!game.running || game.paused || game.finished) return;
    game.time += dt;
    if (game.horn > 0) game.horn = Math.max(0, game.horn - dt);
    if (game.celebrate > 0) game.celebrate = Math.max(0, game.celebrate - dt);

    if (game.kidMode) { updateKid(dt); return; }

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
    document.getElementById("start-btn").addEventListener("click", () => startGame("classic"));
  }

  // ======================= KINDERMODUS =======================
  function updateKid(dt) {
    if (game.stationIdx < STATIONS.length) {
      const st = STATIONS[game.stationIdx];
      const dist = st.pos - game.pos;
      if (game.going) {
        // Wunschgeschwindigkeit: cruisen, nahe am Bahnhof sanft bis auf Kriechtempo
        // (Wurzel-Kennlinie: bleibt länger zügig, bremst dann weich ein)
        let desired = KID_CRUISE;
        if (dist < KID_SLOW) desired = Math.max(3.5, KID_CRUISE * Math.sqrt(Math.max(0, dist / KID_SLOW)));
        game.vel += (desired - game.vel) * Math.min(1, dt * 2);
        game.pos += game.vel * dt;
        // Am Bahnhof angekommen -> sanft andocken und jubeln
        if (dist <= 5) {
          game.pos = st.pos; game.vel = 0; game.going = false;
          arriveKid(st);
        }
      } else {
        // sanft ausrollen
        game.vel += (0 - game.vel) * Math.min(1, dt * 2.2);
        if (game.vel < 0.05) game.vel = 0;
        game.pos += game.vel * dt;
      }
    } else {
      game.vel += (0 - game.vel) * Math.min(1, dt * 2.2);
      game.pos += game.vel * dt;
    }
    document.body.classList.toggle("ready", !game.going && game.celebrate <= 0 && game.stationIdx < STATIONS.length);
    updateKidHUD();
  }

  function arriveKid(st) {
    game.stars++;
    game.arrivedName = st.name;
    game.celebrate = 2.4;
    spawnConfetti();
    sound.cheer();
    game.stationIdx++;
    if (game.stationIdx >= STATIONS.length) {
      // Endstation Salzburg erreicht -> großes Finale
      setTimeout(showKidFinish, 1900);
    }
    updateKidHUD();
  }

  function kidGo() {
    if (!game.running || game.finished) return;
    if (game.stationIdx >= STATIONS.length) return;   // schon am Ziel
    if (!game.going) { game.going = true; sound.toot(); }
  }

  function kidStop() {
    if (!game.running || game.finished) return;
    game.going = false;
  }

  function spawnConfetti() {
    const cols = ["#ff5a8a", "#ffd23f", "#4ade80", "#57c8ff", "#c084fc", "#ff9a3f"];
    for (let i = 0; i < 70; i++) {
      game.confetti.push({
        x: Math.random() * W,
        y: -20 - Math.random() * 60,
        vx: (Math.random() - 0.5) * 60,
        vy: 60 + Math.random() * 120,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 8,
        size: 6 + Math.random() * 6,
        col: cols[(Math.random() * cols.length) | 0],
      });
    }
  }

  function showKidFinish() {
    const box = document.querySelector(".overlay-box");
    box.innerHTML = `
      <h1>🎉 Angekommen! 🎉</h1>
      <p class="tagline" style="font-size:18px;">Der Zug ist in <b>Salzburg</b>!<br>
        Alle Bahnhöfe geschafft: <span style="font-size:26px;">${"⭐".repeat(STATIONS.length)}</span></p>
      <div class="mode-buttons">
        <button id="start-kid" class="mode-btn kid">
          <span class="emoji">🚂</span><span class="mt">Nochmal!</span>
          <span class="ms">wieder losfahren</span>
        </button>
      </div>
    `;
    document.getElementById("overlay").classList.remove("hidden");
    document.getElementById("start-kid").addEventListener("click", () => startGame("kid"));
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

    if (game.kidMode) {
      stepConfetti(1 / 60);
      drawConfetti();
      if (game.celebrate > 0) drawCelebration();
    }

    if (game.paused) drawPauseOverlay();
  }

  // Konfetti (Kindermodus)
  function stepConfetti(dt) {
    for (let i = game.confetti.length - 1; i >= 0; i--) {
      const p = game.confetti[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 60 * dt;
      p.rot += p.vrot * dt;
      if (p.y > H + 20) game.confetti.splice(i, 1);
    }
  }
  function drawConfetti() {
    for (const p of game.confetti) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.col;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
  }
  // Jubel-Banner beim Ankommen (Kindermodus)
  function drawCelebration() {
    const pop = Math.min(1, (2.4 - game.celebrate) * 6);   // kleiner „Pop" beim Erscheinen
    const scale = 0.7 + 0.3 * pop;
    ctx.save();
    ctx.translate(W / 2, H * 0.26);
    ctx.scale(scale, scale);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "bold 30px system-ui, sans-serif";
    const txt = "🎉 " + game.arrivedName + "! 🎉";
    const w = ctx.measureText(txt).width + 48;
    ctx.fillStyle = "rgba(15,22,34,0.85)";
    roundRect(-w / 2, -34, w, 52, 26); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(txt, 0, -8);
    ctx.font = "26px system-ui, sans-serif";
    ctx.fillText("⭐".repeat(Math.min(game.stars, STATIONS.length)), 0, 34);
    ctx.restore();
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

  // ===== Shinkansen E5 „Hayabusa" =====
  const SK_GREEN_TOP = "#14684a";
  const SK_GREEN_BOT = "#083c28";
  const SK_WHITE_TOP = "#f6f9fb";
  const SK_WHITE_BOT = "#dbe2e8";
  const SK_PINK = "#e5006e";
  const SK_WIN = "#0b1922";

  const CAR_L = 150;   // Länge des geraden Wagenkastens (px)
  const CAR_H = 58;    // Höhe des Wagenkastens
  const GAP = 12;      // Lücke (Übergang) zwischen benachbarten Wagen
  const NOSE = 104;    // Länge des Bugs über den Kasten hinaus
  const GREEN_H = 22;  // Höhe des grünen Dachbands
  const WHEEL_R = 9;   // Radradius

  function drawTrain(x, groundY) {
    const railY = groundY + 26;
    const bodyBottom = railY - 6;                    // Kastenunterkante (über den Drehgestellen)
    // Räder rollen vorwärts (nach rechts) => im Uhrzeigersinn => positive Rotation
    const spin = game.pos / (WHEEL_R * M_PER_PX);

    ctx.save();
    const bob = Math.sin(game.time * 9) * Math.min(game.vel * 0.03, 0.8);
    ctx.translate(0, bob);

    // Einheitliche Wagenmittelpunkte: Triebkopf bei x, Wagen im festen Raster
    const leadC = x;
    const c1 = x - (CAR_L + GAP);
    const c2 = x - 2 * (CAR_L + GAP);
    const top = bodyBottom - CAR_H;
    const noseTip = leadC + CAR_L / 2 + NOSE;
    const tailX = c2 - CAR_L / 2;

    // Gemeinsamer Schatten unter dem ganzen Zug
    ctx.fillStyle = "rgba(0,0,0,0.26)";
    ctx.beginPath();
    ctx.ellipse((noseTip + tailX) / 2, railY + 11, (noseTip - tailX) / 2 + 8, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Wagenübergänge (Faltenbälge) in den Lücken – zuerst, damit Kästen sie überdecken
    drawGangway(c2 + CAR_L / 2, c1 - CAR_L / 2, top, bodyBottom);
    drawGangway(c1 + CAR_L / 2, leadC - CAR_L / 2, top, bodyBottom);

    // Wagen von hinten nach vorne (Triebkopf zuletzt = ganz vorn)
    drawMidCar(c2, bodyBottom, railY, spin, false);
    drawMidCar(c1, bodyBottom, railY, spin, true);   // dieser Wagen trägt den Pantograph
    drawLeadCar(leadC, bodyBottom, railY, spin);

    ctx.restore();
  }

  // Faltenbalg-Übergang zwischen zwei Wagen
  function drawGangway(xL, xR, top, bodyBottom) {
    const y0 = top + 12, y1 = bodyBottom - 3;
    ctx.fillStyle = "#171b21";
    ctx.fillRect(xL - 3, y0, (xR - xL) + 6, y1 - y0);
    ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 1;
    for (let gx = xL; gx <= xR; gx += 3) {
      ctx.beginPath(); ctx.moveTo(gx, y0 + 2); ctx.lineTo(gx, y1 - 2); ctx.stroke();
    }
  }

  // Ein Drehgestell mit zwei Rädern, korrekt auf der Schiene sitzend
  function drawBogie(cx, bodyBottom, railY, spin) {
    const r = WHEEL_R;
    const cy = railY + 3;                 // Achsmitte: Radunterkante ~ Schiene
    // Drehgestellrahmen / Schürze (verbindet Kasten und Achsen)
    ctx.fillStyle = "#181c22";
    roundRect(cx - 29, bodyBottom - 1, 58, cy - bodyBottom + 1, 4); ctx.fill();
    ctx.fillStyle = "#252b33";
    ctx.fillRect(cx - 24, bodyBottom + 1, 48, 3);
    for (const dx of [-17, 17]) {
      ctx.save();
      ctx.translate(cx + dx, cy);
      // Reifen
      ctx.fillStyle = "#0f1216";
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      // Radscheibe (Stahl)
      ctx.fillStyle = "#5a636f";
      ctx.beginPath(); ctx.arc(0, 0, r - 2.4, 0, Math.PI * 2); ctx.fill();
      // Speichen (drehen sich mit)
      ctx.rotate(spin);
      ctx.strokeStyle = "#1f252c"; ctx.lineWidth = 1.6;
      for (let s = 0; s < 6; s++) {
        const a = s * Math.PI / 3;
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * (r - 2.4), Math.sin(a) * (r - 2.4));
        ctx.stroke();
      }
      // Nabe
      ctx.fillStyle = "#d0d8e2";
      ctx.beginPath(); ctx.arc(0, 0, 2.1, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  // Einholm-Pantograph, berührt den Fahrdraht der Oberleitung
  function drawPantograph(cx, roofY, railY) {
    const wireY = (railY - 26) - WIRE_H;   // groundY = railY - 26
    // Dachisolatoren
    ctx.fillStyle = "#9aa3ac";
    ctx.fillRect(cx - 18, roofY - 4, 5, 5);
    ctx.fillRect(cx + 13, roofY - 4, 5, 5);
    ctx.fillStyle = "#2b333d";
    ctx.fillRect(cx - 20, roofY - 1, 40, 3);       // Grundrahmen
    // Einholmarm
    ctx.strokeStyle = "#2b333d"; ctx.lineWidth = 2.6; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(cx - 13, roofY - 1);
    ctx.lineTo(cx + 7, wireY + 8);
    ctx.lineTo(cx - 8, wireY + 4);
    ctx.stroke();
    // Schleifleiste (Kontakt zum Draht)
    ctx.strokeStyle = "#12161b"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx - 22, wireY + 3); ctx.lineTo(cx + 16, wireY + 3); ctx.stroke();
    ctx.lineWidth = 1;
  }

  // Getöntes Fensterband mit einzelnen Scheiben und Reflex
  function windowStrip(x0, x1, y, h) {
    ctx.fillStyle = SK_WIN;
    roundRect(x0, y, x1 - x0, h, 3); ctx.fill();
    const paneW = 19, gap = 6;
    for (let px = x0 + 6; px + paneW <= x1 - 3; px += paneW + gap) {
      const rg = ctx.createLinearGradient(0, y, 0, y + h);
      rg.addColorStop(0, "rgba(160,208,240,0.6)");
      rg.addColorStop(1, "rgba(70,120,158,0.4)");
      ctx.fillStyle = rg;
      roundRect(px, y + 2, paneW, h - 4, 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.fillRect(px + 2, y + 3, 4, h - 6);
    }
  }

  function drawDoors(left, right, beltY, bodyBottom) {
    ctx.strokeStyle = "rgba(120,140,155,0.55)"; ctx.lineWidth = 1;
    for (const dx of [30, (right - left) - 42]) {
      const x = left + dx;
      for (const ox of [0, 13]) {
        ctx.beginPath(); ctx.moveTo(x + ox, beltY + 5); ctx.lineTo(x + ox, bodyBottom - 6); ctx.stroke();
      }
    }
  }

  // Gemeinsame Lackierung des geraden Kastenteils
  function fillBodyLivery(left, right, top, beltY, bodyBottom) {
    const w = right - left;
    const wg = ctx.createLinearGradient(0, top, 0, bodyBottom);
    wg.addColorStop(0, SK_WHITE_TOP); wg.addColorStop(1, SK_WHITE_BOT);
    ctx.fillStyle = wg; ctx.fillRect(left - 6, top - 6, w + 12, CAR_H + 12);
    const gg = ctx.createLinearGradient(0, top, 0, beltY);
    gg.addColorStop(0, SK_GREEN_TOP); gg.addColorStop(1, SK_GREEN_BOT);
    ctx.fillStyle = gg; ctx.fillRect(left - 6, top - 6, w + 12, (beltY - top) + 6);
    ctx.fillStyle = SK_PINK; ctx.fillRect(left - 6, beltY, w + 12, 3);           // Signaturlinie
    ctx.fillStyle = "rgba(255,255,255,0.16)"; ctx.fillRect(left + 5, top + 3, w - 10, 3); // Dachglanz
    ctx.fillStyle = "rgba(0,0,0,0.05)"; ctx.fillRect(left - 6, bodyBottom - 7, w + 12, 7); // Schürzenschatten
  }

  // Mittelwagen im E5-Design
  function drawMidCar(cx, bodyBottom, railY, spin, hasPanto) {
    const left = cx - CAR_L / 2, right = cx + CAR_L / 2;
    const top = bodyBottom - CAR_H;
    const beltY = top + GREEN_H;

    if (hasPanto) drawPantograph(cx, top, railY);

    ctx.save();
    roundRect(left, top, CAR_L, CAR_H, 11); ctx.clip();
    fillBodyLivery(left, right, top, beltY, bodyBottom);
    // Dachlüfter auf dem Grün
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    for (let i = 0; i < 3; i++) ctx.fillRect(left + 30 + i * 34, top + 4, 18, 4);
    ctx.restore();

    windowStrip(left + 12, right - 12, beltY + 5, 15);
    drawDoors(left, right, beltY, bodyBottom);

    drawBogie(left + 30, bodyBottom, railY, spin);
    drawBogie(right - 30, bodyBottom, railY, spin);
  }

  // Triebkopf mit langem „Hayabusa"-Bug (Front nach rechts)
  function drawLeadCar(cx, bodyBottom, railY, spin) {
    const left = cx - CAR_L / 2;
    const right = cx + CAR_L / 2;          // Übergang Kasten -> Bug
    const top = bodyBottom - CAR_H;
    const beltY = top + GREEN_H;
    const tipX = right + NOSE;
    const tipY = bodyBottom - 11;          // Bugspitze knapp über den Schienen

    // ---- Umriss: Kasten + langer, flach auslaufender Bug ----
    const outline = () => {
      ctx.beginPath();
      ctx.moveTo(left + 10, top);
      ctx.lineTo(right, top);
      ctx.bezierCurveTo(right + NOSE * 0.55, top + 2, tipX - 8, tipY - 22, tipX, tipY);
      ctx.quadraticCurveTo(right + NOSE * 0.5, bodyBottom + 2, right, bodyBottom);
      ctx.lineTo(left + 8, bodyBottom);
      ctx.quadraticCurveTo(left, bodyBottom, left, bodyBottom - 8);
      ctx.lineTo(left, top + 8);
      ctx.quadraticCurveTo(left, top, left + 10, top);
      ctx.closePath();
    };

    ctx.save();
    outline(); ctx.clip();
    // Weiß (Basis)
    const wg = ctx.createLinearGradient(0, top, 0, bodyBottom);
    wg.addColorStop(0, SK_WHITE_TOP); wg.addColorStop(1, SK_WHITE_BOT);
    ctx.fillStyle = wg; ctx.fillRect(left - 6, top - 6, tipX - left + 14, CAR_H + 14);
    // Grün: Dach + über den gesamten Bugrücken bis zur Spitze
    const gg = ctx.createLinearGradient(0, top, 0, beltY + 12);
    gg.addColorStop(0, SK_GREEN_TOP); gg.addColorStop(1, SK_GREEN_BOT);
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.moveTo(left - 6, top - 6);
    ctx.lineTo(right, top);
    ctx.bezierCurveTo(right + NOSE * 0.55, top + 2, tipX - 8, tipY - 22, tipX, tipY);
    ctx.quadraticCurveTo(right + NOSE * 0.4, tipY - 3, right, beltY);
    ctx.lineTo(left - 6, beltY);
    ctx.closePath(); ctx.fill();
    // Pinke Signaturlinie entlang Gürtel und Bug
    ctx.strokeStyle = SK_PINK; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(left, beltY + 1.5);
    ctx.lineTo(right, beltY + 1.5);
    ctx.quadraticCurveTo(right + NOSE * 0.42, tipY + 1, tipX - 9, tipY + 3);
    ctx.stroke();
    // Dachglanz
    ctx.fillStyle = "rgba(255,255,255,0.16)"; ctx.fillRect(left + 6, top + 3, CAR_L - 22, 3);
    // Bug-Glanz (Sheen entlang des Bugrückens) für den lackierten Hochglanz-Look
    ctx.strokeStyle = "rgba(255,255,255,0.20)"; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(right + 4, top + 6);
    ctx.quadraticCurveTo(right + NOSE * 0.6, top + 2, tipX - 16, tipY - 13);
    ctx.stroke();
    ctx.restore();

    // ---- Cockpit-Frontscheibe (schwarz, umlaufend) an der Bugwurzel ----
    ctx.fillStyle = SK_WIN;
    ctx.beginPath();
    ctx.moveTo(right - 6, top + 8);
    ctx.quadraticCurveTo(right + 28, top + 10, right + 42, beltY - 2);
    ctx.lineTo(right + 20, beltY + 7);
    ctx.lineTo(right - 6, top + 26);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(165,212,247,0.45)";
    ctx.beginPath();
    ctx.moveTo(right - 2, top + 12); ctx.lineTo(right + 16, top + 14);
    ctx.lineTo(right + 5, beltY); ctx.closePath(); ctx.fill();

    // ---- Seitenfenster ----
    windowStrip(left + 12, right - 8, beltY + 5, 15);
    drawDoors(left, right, beltY, bodyBottom);

    // ---- Scheinwerfer (zwei) am Bug + Lichtkegel ----
    const hlx = right + NOSE * 0.52, hly = tipY - 7;
    ctx.fillStyle = "#f4faff";
    ctx.beginPath(); ctx.ellipse(hlx, hly, 4.5, 3, -0.15, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(hlx + 11, hly + 4, 3.4, 2.3, -0.15, 0, Math.PI * 2); ctx.fill();
    if (game.vel > 0.5) {
      const glow = Math.min(0.22, 0.06 + game.vel * 0.003);
      ctx.fillStyle = `rgba(240,248,255,${glow})`;
      ctx.beginPath();
      ctx.moveTo(hlx + 4, hly - 4);
      ctx.lineTo(tipX + 82, tipY - 30);
      ctx.lineTo(tipX + 82, tipY + 14);
      ctx.closePath(); ctx.fill();
    }
    // Kupplungsklappe an der Spitze
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.beginPath(); ctx.ellipse(tipX - 5, tipY + 1, 4, 6, 0, 0, Math.PI * 2); ctx.fill();

    // ---- Kennung ----
    ctx.textAlign = "left";
    ctx.fillStyle = SK_PINK; ctx.font = "bold 11px system-ui, sans-serif";
    ctx.fillText("E5", left + 12, beltY - 6);
    ctx.fillStyle = "rgba(20,30,40,0.7)"; ctx.font = "italic bold 8px system-ui, sans-serif";
    ctx.fillText("HAYABUSA", left + 30, beltY - 7);

    // ---- Drehgestelle (unter dem Kasten, nicht unter dem Bug) ----
    drawBogie(left + 30, bodyBottom, railY, spin);
    drawBogie(right - 34, bodyBottom, railY, spin);

    // ---- Effekte ----
    if ((game.brake > 0.6 || game.emergency) && game.vel > 4) {
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = `rgba(255,${180 + Math.random() * 60 | 0},80,${Math.random()})`;
        const sx = left + 20 + Math.random() * (CAR_L - 50);
        ctx.fillRect(sx, railY + Math.random() * 5, 2, 2);
      }
    }
    if (game.horn > 0) {
      ctx.fillStyle = `rgba(255,255,255,${game.horn})`;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(tipX + 6 + i * 12, tipY - 10 - i * 5, 4 + i, 0, Math.PI * 2);
        ctx.fill();
      }
    }
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

  // ---------- Kinder-HUD ----------
  const kidEl = {
    stars: document.getElementById("kid-stars"),
    nextName: document.getElementById("kid-next-name"),
  };
  function updateKidHUD() {
    const total = STATIONS.length;
    kidEl.stars.textContent = "⭐".repeat(game.stars) + "☆".repeat(Math.max(0, total - game.stars));
    if (game.stationIdx < STATIONS.length) {
      kidEl.nextName.textContent = STATIONS[game.stationIdx].name;
    } else {
      kidEl.nextName.textContent = "Angekommen! 🎉";
    }
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
  function startGame(mode) {
    const kid = mode === "kid";
    Object.assign(game, {
      running: true, paused: false, pos: 0, vel: 0, throttle: 0, brake: 0,
      emergency: false, limit: STATIONS[0].limit, score: 0, finished: false,
      stationIdx: 0, dwellTimer: 0, dwelling: false, overspeedTimer: 0,
      time: 0, horn: 0, kidMode: kid, going: false, celebrate: 0,
      arrivedName: "", stars: 0, confetti: [],
      statusMsg: kid ? "" : `Abfahrt ${ORIGIN.name} → ${STATIONS[0].name}`,
    });
    game.penalizedSignals = new Set();
    // Im Kindermodus alle Signale freundlich auf Grün
    if (kid) SIGNALS.forEach((s) => (s.state = "green"));
    document.body.classList.toggle("kid", kid);
    document.body.classList.remove("ready");
    // Debug-Startpunkt: URL-Hash #km=<n> setzt die Anfangsposition (nur zum Testen)
    const dbg = /[#&]km=([\d.]+)/.exec(location.hash);
    if (dbg) {
      game.pos = parseFloat(dbg[1]) * 1000;
      game.stationIdx = STATIONS.findIndex((s) => s.pos > game.pos);
      if (game.stationIdx < 0) game.stationIdx = STATIONS.length;
    }
    document.getElementById("overlay").classList.add("hidden");
    sound.ensure(); // AudioContext bei User-Geste freischalten
    if (kid) updateKidHUD(); else updateHUD();
  }

  function togglePause() {
    if (!game.running || game.finished) return;
    game.paused = !game.paused;
  }

  // Modus-Auswahl im Start-Overlay
  document.getElementById("start-kid").addEventListener("click", () => startGame("kid"));
  document.getElementById("start-classic").addEventListener("click", () => startGame("classic"));

  // Große Kinder-Knöpfe (Pointer = Maus + Touch)
  function bindKid(id, fn) {
    const b = document.getElementById(id);
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); fn(); });
  }
  bindKid("kid-go", kidGo);
  bindKid("kid-stop", kidStop);
  bindKid("kid-horn", hornPress);

  // ---------- Init ----------
  if (location.hash.includes("debug")) window.__ZUG = game;
  resize();
  updateHUD();
  requestAnimationFrame(loop);
})();
