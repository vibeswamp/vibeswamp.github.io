// VibeSwamp: the picture viewer, the toad (eyes, blink, the jump into the header), the fly game, small surprises
// while you scroll, Swamp Radio (the owner's music, the toads nod to it), sound effects, tabs and stickers. No libraries.
// Without JS everything is visible and picture links simply open the picture. Sound is off until you turn it on.
(() => {
  const root = document.documentElement;
  const body = document.body;
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const S = body.dataset;

  // ================= one page at a time =================
  // The site moves between its pages without reloading (the router at the end), so Swamp Radio keeps playing. The header,
  // the player, sound, theme and menu live for the whole visit; everything tied to one page is a "page part": it starts
  // in initPage() and stops when the page is left. A part passes `on` (an AbortSignal) to its listeners on window,
  // document or the header, hands observers, intervals and the like to stop(), and its loops check alive().
  const pageParts = [];
  const page = (fn) => pageParts.push(fn);
  let pageCtl = null, pageGen = 0, pageStops = [];
  const initPage = () => {
    pageCtl = new AbortController();
    const gen = ++pageGen;
    const ctx = { on: pageCtl.signal, alive: () => gen === pageGen, stop: (f) => pageStops.push(f) };
    for (const part of pageParts) { try { part(ctx); } catch (e) { console.error(e); } }
  };
  const endPage = () => {
    pageGen++;
    pageCtl?.abort();
    for (const f of pageStops.splice(0)) { try { f(); } catch (e) {} }
    root.classList.remove("frog-fly", "frog-docked", "frog-away");
    for (const el of document.querySelectorAll("body > .fly, .tongue")) el.remove();
  };

  // ---------- pictures move in as you scroll (the text never fades) ----------
  page(({ stop }) => {
    const revealEls = [...document.querySelectorAll("[data-reveal]")];
    if ("IntersectionObserver" in window && !calm.matches) {
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      }, { rootMargin: "0px 0px -6% 0px" });
      revealEls.forEach((el) => io.observe(el));
      stop(() => io.disconnect());
    } else revealEls.forEach((el) => el.classList.add("in"));
  });

  // ---------- language: a choice made here wins over the browser language next time ----------
  page(({ on }) => {
    for (const a of document.querySelectorAll("a[data-lang]")) a.addEventListener("click", () => store.set("vibeswamp-lang", a.dataset.lang), { signal: on });
  });

  // ================= sound =================
  // Effects are made right here with Web Audio: a croak, a splash, a plop, a click. Quiet, short, never on hover or scroll.
  const Sound = (() => {
    let ctx = null;
    let fxOn = store.get("vibeswamp-fx") === "on";
    const last = {};
    const ac = () => (ctx ??= new (window.AudioContext || window.webkitAudioContext)());
    const gainAt = (c, t, peak, attack, decay) => {
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
      g.connect(c.destination);
      return g;
    };
    const noise = (c, sec) => {
      const b = c.createBuffer(1, Math.ceil(c.sampleRate * sec), c.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const n = c.createBufferSource();
      n.buffer = b;
      return n;
    };
    const kit = {
      croak(c, t) {
        for (const off of [0, 0.13]) {
          const o = c.createOscillator(), f = c.createBiquadFilter(), g = gainAt(c, t + off, 0.16, 0.012, 0.11);
          o.type = "sawtooth";
          o.frequency.setValueAtTime(150, t + off);
          o.frequency.exponentialRampToValueAtTime(82, t + off + 0.11);
          f.type = "lowpass"; f.frequency.value = 650; f.Q.value = 7;
          o.connect(f).connect(g);
          o.start(t + off); o.stop(t + off + 0.14);
        }
      },
      plop(c, t) {
        const o = c.createOscillator(), g = gainAt(c, t, 0.18, 0.006, 0.09);
        o.type = "sine";
        o.frequency.setValueAtTime(720, t);
        o.frequency.exponentialRampToValueAtTime(170, t + 0.09);
        o.connect(g); o.start(t); o.stop(t + 0.11);
      },
      splash(c, t) {
        const n = noise(c, 0.35), f = c.createBiquadFilter(), g = gainAt(c, t, 0.12, 0.01, 0.3);
        f.type = "bandpass"; f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(600, t + 0.3); f.Q.value = 0.8;
        n.connect(f).connect(g); n.start(t);
        kit.plop(c, t + 0.02);
      },
      whoosh(c, t) {
        const n = noise(c, 0.3), f = c.createBiquadFilter(), g = gainAt(c, t, 0.07, 0.08, 0.2);
        f.type = "bandpass"; f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(2400, t + 0.26); f.Q.value = 1.4;
        n.connect(f).connect(g); n.start(t);
      },
      tick(c, t) {
        const o = c.createOscillator(), g = gainAt(c, t, 0.08, 0.003, 0.03);
        o.type = "square"; o.frequency.value = 1700;
        o.connect(g); o.start(t); o.stop(t + 0.04);
      },
      land(c, t) {
        const o = c.createOscillator(), g = gainAt(c, t, 0.12, 0.005, 0.14);
        o.type = "triangle";
        o.frequency.setValueAtTime(260, t);
        o.frequency.exponentialRampToValueAtTime(520, t + 0.07);
        o.connect(g); o.start(t); o.stop(t + 0.16);
      },
    };
    return {
      get on() { return fxOn; },
      set(on) { fxOn = on; store.set("vibeswamp-fx", on ? "on" : "off"); if (on) this.play("tick", true); },
      play(name, force = false) {
        if (!fxOn && !force) return;
        const now = performance.now();
        if (now - (last[name] || 0) < 140) return;
        last[name] = now;
        try {
          const c = ac();
          if (c.state === "suspended") c.resume();
          kit[name](c, c.currentTime + 0.01);
        } catch (e) {}
      },
    };
  })();

  // ================= Swamp Radio =================
  // The clicker (src/swamp.js, its «Radio» +25% while music plays) relies on three things here; keep them or tell the
  // clicker chat first: the button `.radio .r-play` (it clicks it), `window.VibeSwamp.playing`, and the
  // `vibeswamp:radio` event on document after every play/pause.
  // The owner's tracks, one at a time, only after a click. The player at the bottom remembers the track, the place
  // in it, volume, shuffle and repeat, so the next page goes on from where it was (after a first click if the
  // browser asks for one). While it plays, an analyser listens to the bass and the toads nod to it.
  const Radio = (() => {
    let tracks = [];
    try { tracks = JSON.parse(document.getElementById("tracks")?.textContent || "[]"); } catch (e) {}
    const box = document.querySelector(".radio");
    const headBtn = document.querySelector(".snd-music");
    const audio = new Audio();
    audio.preload = "none";
    const KEY = "vibeswamp-radio";
    let st = {};
    try { st = JSON.parse(store.get(KEY) || "{}") || {}; } catch (e) { st = {}; }
    st = { id: tracks[0]?.id, t: 0, vol: 40, muted: false, shuffle: true, repeat: "all", open: false, ...st };
    // 12.11.2026, the owner: «always starts with the same tune», «the player seems to be missing». Once for everyone:
    // shuffle on, and on a wide screen the player is open (track, buttons, progress, volume) instead of a folded plate.
    if (st.v !== 2) { st.v = 2; st.shuffle = true; st.open = matchMedia("(min-width: 901px)").matches; }
    // a new visit starts on a random track (not the last one heard); going from page to page keeps the track and the place
    let freshVisit = false;
    try { freshVisit = !sessionStorage.getItem("vibeswamp-radio-visit"); sessionStorage.setItem("vibeswamp-radio-visit", "1"); } catch (e) {}
    if (freshVisit && st.shuffle && tracks.length > 1) {
      let k;
      do { k = Math.floor(Math.random() * tracks.length); } while (tracks[k].id === st.id);
      st.id = tracks[k].id; st.t = 0;
    }
    let on = store.get("vibeswamp-music") === "on";
    let i = Math.max(0, tracks.findIndex((x) => x.id === st.id));
    let order = tracks.map((_, k) => k);
    const shuffleOrder = () => {
      order = tracks.map((_, k) => k).filter((k) => k !== i);
      for (let k = order.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; }
      order.unshift(i);
    };
    if (st.shuffle) shuffleOrder();
    const persist = () => { st.id = tracks[i]?.id; st.t = audio.currentTime || st.t || 0; store.set(KEY, JSON.stringify(st)); };
    const $ = (s) => box?.querySelector(s);
    const mmss = (s) => (isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");
    const level = () => (st.muted ? 0 : Math.pow(st.vol / 100, 1.6) * 0.45);
    const playing = () => on && !audio.paused;

    // ---- the analyser (made on the first play, because browsers want a click first) ----
    let ctx = null, an = null, bins = null, raf = 0, lastT = 0, bg = 0, midAvg = 0, highAvg = 0, lastBeat = 0, nod = 0, sway = 0, swayLag = 0;
    const set = (k, v) => root.style.setProperty(k, v);
    const listen = () => {
      if (calm.matches || an || !window.AudioContext) return;
      try {
        ctx = new AudioContext();
        const src = ctx.createMediaElementSource(audio);
        an = ctx.createAnalyser();
        an.fftSize = 2048; an.smoothingTimeConstant = 0.65;
        src.connect(an); an.connect(ctx.destination);
        bins = new Uint8Array(an.frequencyBinCount);
      } catch (e) { an = null; }
    };
    const band = (lo, hi) => {
      const hz = ctx.sampleRate / an.fftSize;
      let sum = 0, n = 0;
      for (let k = Math.max(1, Math.floor(lo / hz)); k <= Math.min(bins.length - 1, Math.ceil(hi / hz)); k++) { sum += bins[k]; n++; }
      return n ? sum / n / 255 : 0;
    };
    const vibe = (now) => {
      raf = playing() && !document.hidden ? requestAnimationFrame(vibe) : 0;
      if (now - lastT < 33) return;                       // about 30 times a second
      lastT = now;
      let bass = 0, mid = 0, high = 0;
      if (an) { an.getByteFrequencyData(bins); bass = band(50, 180); mid = band(180, 800); high = band(2000, 6000); }
      else { const ph = (now / 600) % 1; bass = ph < 0.15 ? 0.8 : 0.3; mid = 0.4; high = 0.3; } // no analyser: a calm 100 bpm
      bg = bg ? bg * 0.96 + bass * 0.04 : bass;
      midAvg = midAvg ? midAvg * 0.97 + mid * 0.03 : mid;
      highAvg = highAvg ? highAvg * 0.97 + high * 0.03 : high;
      if (bass > bg * 1.35 && bass > 0.12 && now - lastBeat > 180) { lastBeat = now; nod = 3; }
      nod = Math.max(nod * 0.82, Math.min(2, Math.max(0, (bass - bg) * 25)));   // quiet tracks still move a little
      const tilt = (mid - midAvg) * 30 + Math.sin(now / 900) * 1.2;
      sway = Math.max(-12, Math.min(12, (high - highAvg) * 90 + Math.sin(now / 650) * 3));
      swayLag += (sway - swayLag) * 0.35;                 // the tails follow a little later
      set("--nod", nod.toFixed(2));
      set("--tilt", Math.max(-4, Math.min(4, tilt)).toFixed(2));
      set("--sway", swayLag.toFixed(2));
      set("--squint", Math.min(0.6, 0.25 + mid * 0.5).toFixed(2));
    };
    const vibing = (yes) => {
      root.classList.toggle("vibing", yes && !calm.matches);
      if (yes && !raf && !calm.matches) raf = requestAnimationFrame(vibe);
      if (!yes) { for (const k of ["--nod", "--tilt", "--sway", "--squint"]) root.style.removeProperty(k); }
      document.dispatchEvent(new CustomEvent("vibeswamp:radio", { detail: { playing: yes } }));
    };

    // ---- the screen ----
    const ui = () => {
      const tr = tracks[i];
      const p = playing();
      headBtn?.setAttribute("aria-pressed", p ? "true" : "false");
      if (box) {
        box.classList.toggle("is-playing", p);
        box.dataset.open = st.open ? "true" : "false";
        $(".radio-face")?.setAttribute("aria-expanded", st.open ? "true" : "false");
        const fold = $(".r-fold");
        if (fold) { const l = st.open ? box.dataset.rFold : box.dataset.rOpen; fold.setAttribute("aria-label", l); fold.title = l; fold.setAttribute("aria-expanded", st.open ? "true" : "false"); }
        const play = $(".r-play");
        if (play) { const l = p ? box.dataset.pause : box.dataset.play; play.setAttribute("aria-label", l); play.title = l; play.classList.toggle("on", p); }
        if (tr) {
          $(".radio-title").textContent = tr.title;
          $(".radio-credit").textContent = tr.credit;
          const cover = $(".radio-cover");
          cover.style.setProperty("--tint", tr.tint);
          $(".radio-cover-name").textContent = tr.project;
        }
        $(".r-shuffle")?.setAttribute("aria-pressed", st.shuffle ? "true" : "false");
        const rep = $(".r-repeat");
        if (rep) { rep.dataset.mode = st.repeat; const l = box.dataset[{ off: "rOff", all: "rAll", one: "rOne" }[st.repeat]]; rep.setAttribute("aria-label", l); rep.title = l; }
        $(".r-mute")?.setAttribute("aria-pressed", st.muted ? "true" : "false");
        const vol = $(".r-vol");
        if (vol && +vol.value !== st.vol) vol.value = st.vol;
        for (const li of box.querySelectorAll(".radio-queue li")) li.classList.toggle("now", +li.dataset.i === i);
      }
      for (const li of document.querySelectorAll(".track")) li.classList.toggle("playing", p && +li.querySelector(".play")?.dataset.track === i);
      if ("mediaSession" in navigator && tr) {
        try { navigator.mediaSession.metadata = new MediaMetadata({ title: tr.title, artist: tr.credit, album: tr.project }); } catch (e) {}
        navigator.mediaSession.playbackState = p ? "playing" : "paused";
      }
    };
    const time = () => {
      if (!box) return;
      const d = audio.duration || tracks[i]?.seconds || 0;
      $(".r-cur").textContent = mmss(audio.currentTime || 0);
      $(".r-dur").textContent = mmss(d);
      const seek = $(".r-seek");
      if (seek && !seek.matches(":active")) seek.value = d ? Math.round((1000 * (audio.currentTime || 0)) / d) : 0;
      const bar = $(".radio-progress span");
      if (bar) bar.style.width = `${d ? Math.min(100, (100 * (audio.currentTime || st.t || 0)) / d).toFixed(2) : 0}%`;
    };

    // ---- playing ----
    let fade = 0;
    const ramp = (to, ms, done) => {
      clearInterval(fade);
      const from = audio.volume, steps = Math.max(1, Math.round(ms / 40));
      let k = 0;
      fade = setInterval(() => { k++; audio.volume = Math.max(0, Math.min(1, from + (to - from) * (k / steps))); if (k >= steps) { clearInterval(fade); done?.(); } }, 40);
    };
    const load = (k, at = 0) => {
      i = (k + tracks.length) % tracks.length;
      audio.src = tracks[i].src;
      st.t = at;
      if (at) audio.addEventListener("loadedmetadata", () => { audio.currentTime = at; }, { once: true });
      persist(); ui(); time();
    };
    const start = () => {
      if (!tracks.length) return Promise.resolve();
      if (!audio.src) load(i, st.t || 0);
      listen();
      if (ctx?.state === "suspended") ctx.resume();
      audio.volume = 0;
      return audio.play().then(() => { ramp(level(), 700); ui(); vibing(true); });
    };
    const stop = () => ramp(0, 220, () => { audio.pause(); ui(); vibing(false); persist(); });
    const playOn = () => { on = true; store.set("vibeswamp-music", "on"); start().catch(() => {}); };
    const pause = () => { on = false; store.set("vibeswamp-music", "off"); stop(); };
    const toggle = () => (playing() ? pause() : playOn());
    const step = (dir) => {
      let pos = order.indexOf(i);
      // shuffled and at the end of the round: a new round in a new order that never starts with the track just heard
      if (st.shuffle && dir > 0 && pos === order.length - 1) { shuffleOrder(); pos = 0; }
      const k = order[(pos + dir + order.length) % order.length];
      load(k);
      if (on) start().catch(() => {});
    };
    const next = () => step(1);
    const prev = () => { if ((audio.currentTime || 0) > 3) { audio.currentTime = 0; time(); return; } step(-1); };
    audio.addEventListener("ended", () => {
      if (st.repeat === "one") { audio.currentTime = 0; audio.play().catch(() => {}); return; }
      const last = order.indexOf(i) === order.length - 1;
      if (last && st.repeat === "off") { load(order[0]); pause(); return; }
      next();
    });
    audio.addEventListener("timeupdate", time);
    audio.addEventListener("loadedmetadata", time);
    audio.addEventListener("pause", () => { ui(); if (!document.hidden) vibing(false); });
    audio.addEventListener("play", () => { ui(); vibing(true); });
    addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && !audio.paused) { audio.dataset.wasPlaying = "1"; audio.pause(); persist(); }
      else if (!document.hidden && audio.dataset.wasPlaying) { delete audio.dataset.wasPlaying; audio.play().catch(() => {}); }
    });

    // ---- buttons ----
    // the music button in the header (on phones, in the menu) starts the radio; on a wide screen it also opens the player,
    // on a phone the compact bar is enough
    headBtn?.addEventListener("click", () => { if (!playing() && matchMedia("(min-width: 901px)").matches) { st.open = true; persist(); } toggle(); });
    if (box) {
      $(".r-play")?.addEventListener("click", toggle);
      $(".r-next")?.addEventListener("click", next);
      $(".r-prev")?.addEventListener("click", prev);
      $(".radio-face")?.addEventListener("click", () => { st.open = !st.open; persist(); ui(); Sound.play("tick"); });
      $(".r-fold")?.addEventListener("click", () => { st.open = !st.open; persist(); ui(); });
      $(".r-shuffle")?.addEventListener("click", () => { st.shuffle = !st.shuffle; if (st.shuffle) shuffleOrder(); else order = tracks.map((_, k) => k); persist(); ui(); });
      $(".r-repeat")?.addEventListener("click", () => { st.repeat = { off: "all", all: "one", one: "off" }[st.repeat] || "all"; persist(); ui(); });
      $(".r-mute")?.addEventListener("click", () => { st.muted = !st.muted; audio.volume = level(); persist(); ui(); });
      $(".r-vol")?.addEventListener("input", (e) => { st.vol = +e.target.value; st.muted = st.vol === 0; audio.volume = level(); persist(); ui(); });
      const seek = $(".r-seek");
      seek?.addEventListener("input", () => { const d = audio.duration || tracks[i]?.seconds || 0; if (!audio.src) load(i); if (d) { audio.currentTime = (seek.value / 1000) * d; time(); } });
      const q = $(".radio-queue"), qb = $(".r-queue");
      if (q) {
        q.innerHTML = tracks.map((x, k) => `<li data-i="${k}"><button type="button"><span class="q-title"></span><span class="q-credit"></span><span class="q-time num">${mmss(x.seconds)}</span></button></li>`).join("");
        q.querySelectorAll("li").forEach((li, k) => { li.querySelector(".q-title").textContent = tracks[k].title; li.querySelector(".q-credit").textContent = tracks[k].credit; });
        q.addEventListener("click", (e) => { const li = e.target.closest("li"); if (!li) return; load(+li.dataset.i); playOn(); });
        qb?.addEventListener("click", () => { q.hidden = !q.hidden; qb.setAttribute("aria-expanded", q.hidden ? "false" : "true"); });
      }
      box.addEventListener("keydown", (e) => {
        if (e.target.matches("input")) return;
        if (e.key === "k" || e.key === "K") { e.preventDefault(); toggle(); }
        if (e.key === "j" || e.key === "J") { e.preventDefault(); prev(); }
        if (e.key === "l" || e.key === "L") { e.preventDefault(); next(); }
      });
    }
    // the track list on the creative page: bound again on every page that has one
    const bindTracks = (on) => {
      for (const b of document.querySelectorAll(".play[data-track]")) {
        b.addEventListener("click", () => {
          const k = +b.dataset.track;
          if (k === i && playing()) { pause(); return; }
          if (k !== i || !audio.src) load(k);
          st.open = true;
          playOn();
        }, { signal: on });
      }
      ui();
    };
    if ("mediaSession" in navigator) {
      const ms = navigator.mediaSession;
      const h = (a, f) => { try { ms.setActionHandler(a, f); } catch (e) {} };
      h("play", playOn); h("pause", pause); h("previoustrack", prev); h("nexttrack", next);
      h("seekto", (d) => { if (d.seekTime != null) { audio.currentTime = d.seekTime; time(); } });
    }
    // turned on earlier: go on playing; if the browser wants a click first, the first click anywhere starts it
    if (on && tracks.length) {
      start().catch(() => {
        const go = (e) => {
          removeEventListener("pointerdown", go, true); removeEventListener("keydown", go, true);
          if (e.target?.closest?.(".r-play, .snd-music, .play")) return;   // that button does it itself
          if (on && audio.paused) start().catch(() => {});
        };
        addEventListener("pointerdown", go, true);
        addEventListener("keydown", go, true);
      });
    }
    ui(); time();
    return { get playing() { return playing(); }, bindTracks };
  })();
  window.VibeSwamp = { get playing() { return Radio.playing; }, sound: (name) => Sound.play(name) };
  page(({ on }) => Radio.bindTracks(on));

  // ---------- night and day: the choice is remembered, otherwise the device decides ----------
  const themeBtn = document.querySelector(".snd-theme");
  if (themeBtn) {
    const showTheme = () => themeBtn.setAttribute("aria-pressed", root.dataset.theme === "dark" ? "true" : "false");
    showTheme();
    // the KFSOS radio comments on it: dusk and dawn lines from the pack
    let toast = null, toastTimer = 0;
    const radioSays = (text) => {
      if (!text) return;
      if (!toast) { toast = document.createElement("p"); toast.className = "chrn-toast"; toast.setAttribute("role", "status"); body.appendChild(toast); }
      toast.textContent = text;
      toast.classList.add("on");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove("on"), 3600);
    };
    themeBtn.addEventListener("click", () => {
      // no colour transitions for the one frame of the switch: buttons and links used to fade through grey (12.11.2026)
      root.classList.add("no-trans");
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("no-trans")));
      root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
      store.set("vibeswamp-theme", root.dataset.theme);
      showTheme();
      Sound.play("tick");
      radioSays(root.dataset.theme === "dark" ? themeBtn.dataset.night : themeBtn.dataset.day);
    });
  }

  // ---------- KFSOS Lite PDA: the pack's own interface themes, sections, Chronos radio and loading-screen tips ----------
  page(({ stop }) => {
    for (const kf of document.querySelectorAll(".kf")) {
      let data = {};
      try { data = JSON.parse(kf.querySelector(".kf-data")?.textContent || "{}"); } catch (e) {}
      const radio = data.radio || [], tips = data.tips || [], secs = data.secs || [];
      const thName = kf.querySelector(".kf-thname");
      const setTheme = (th, save) => {
        const b = kf.querySelector(`.kf-th[data-kf-theme="${th}"]`);
        if (!b) return;
        kf.dataset.kf = th;
        for (const x of kf.querySelectorAll(".kf-th")) x.setAttribute("aria-pressed", x === b ? "true" : "false");
        if (thName) thName.textContent = b.getAttribute("aria-label");
        if (save) store.set("vibeswamp-kfsos-ui", th);
      };
      setTheme(store.get("vibeswamp-kfsos-ui") || "neon", false);
      for (const b of kf.querySelectorAll(".kf-th")) b.addEventListener("click", () => { setTheme(b.dataset.kfTheme, true); Sound.play("tick"); });

      const secText = kf.querySelector(".kf-sec-text");
      for (const b of kf.querySelectorAll(".kf-sec")) b.addEventListener("click", () => {
        for (const x of kf.querySelectorAll(".kf-sec")) x.setAttribute("aria-pressed", x === b ? "true" : "false");
        if (secText && secs[+b.dataset.i]) secText.textContent = secs[+b.dataset.i].x;
        Sound.play("tick");
      });

      // the radio types its line like a terminal; a new line every 14 s while the panel is on screen
      const line = kf.querySelector(".kf-line"), tip = kf.querySelector(".kf-tip-t");
      let ri = 0, typing = 0, seen = false;
      const type = (text) => {
        clearInterval(typing);
        if (calm.matches) { line.textContent = text; return; }
        let n = 0;
        line.textContent = "";
        typing = setInterval(() => { n += 2; line.textContent = text.slice(0, n); if (n >= text.length) clearInterval(typing); }, 26);
      };
      const next = (step = 1) => {
        if (!radio.length || !line) return;
        ri = (ri + step + radio.length) % radio.length;
        type(radio[ri]);
        if (tip && tips.length) tip.textContent = tips[Math.floor(Math.random() * tips.length)];
      };
      kf.querySelector(".kf-next")?.addEventListener("click", () => { next(); Sound.play("tick"); });
      if ("IntersectionObserver" in window) {
        const io = new IntersectionObserver((e) => { seen = e[0].isIntersecting; });
        io.observe(kf);
        stop(() => io.disconnect());
      }
      ri = Math.floor(Math.random() * radio.length) - 1;
      next();
      stop(() => clearInterval(typing));
      if (!calm.matches) {
        const every = setInterval(() => { if (seen && !document.hidden) next(); }, 14000);
        stop(() => clearInterval(every));
      }
    }
  });

  const fxBtn = document.querySelector(".snd-fx");
  if (fxBtn) {
    fxBtn.setAttribute("aria-pressed", Sound.on ? "true" : "false");
    fxBtn.addEventListener("click", () => { Sound.set(!Sound.on); fxBtn.setAttribute("aria-pressed", Sound.on ? "true" : "false"); });
  }
  for (const a of document.querySelectorAll(".top nav a")) a.addEventListener("click", () => Sound.play("tick"));

  // ---------- phones: the player bar shows once the page is scrolled a little, so the first screen stays clear (style.css) ----------
  const radioPeek = () => root.classList.toggle("radio-peek", scrollY > 160);
  addEventListener("scroll", radioPeek, { passive: true });
  radioPeek();

  // ---------- phones: the header button opens the menu as a sheet from the bottom; Esc, the shade or ✕ closes it ----------
  const topBar = document.querySelector(".top");
  const menuBtn = topBar?.querySelector(".menu-btn");
  const sheet = document.getElementById("top-menu");
  if (menuBtn && sheet) {
    const shade = topBar.querySelector(".menu-shade");
    const phone = matchMedia("(max-width: 900px)");
    const isOpen = () => topBar.dataset.menu === "open";
    const focusables = () => [...sheet.querySelectorAll("a[href], button:not([disabled])")].filter((el) => el.getClientRects().length);
    const setOpen = (yes, focusBack = true) => {
      if (yes === isOpen()) return;
      if (yes) topBar.dataset.menu = "open"; else delete topBar.dataset.menu;
      root.classList.toggle("menu-open", yes);
      menuBtn.setAttribute("aria-expanded", yes ? "true" : "false");
      if (shade) shade.hidden = !yes;
      if (yes) {
        sheet.setAttribute("role", "dialog");
        sheet.setAttribute("aria-modal", "true");
        requestAnimationFrame(() => (sheet.querySelector("nav a[aria-current]") || focusables()[0])?.focus({ preventScroll: true }));
      } else {
        sheet.removeAttribute("role");
        sheet.removeAttribute("aria-modal");
        if (focusBack) menuBtn.focus({ preventScroll: true });
      }
      Sound.play("tick");
    };
    menuBtn.addEventListener("click", () => setOpen(!isOpen()));
    sheet.querySelector(".menu-close")?.addEventListener("click", () => setOpen(false));
    shade?.addEventListener("click", () => setOpen(false));
    addEventListener("keydown", (e) => {
      if (!isOpen()) return;
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); return; }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
    phone.addEventListener?.("change", () => { if (!phone.matches) setOpen(false, false); });
    addEventListener("pageshow", () => setOpen(false, false));   // back from the next page: the menu is closed
    document.addEventListener("vibeswamp:nav", () => setOpen(false, false));   // a link in the sheet opened another page
  }

  // ---------- strips that scroll sideways on phones (menu, section doors, tabs): a soft fade at the edge shows there is more ----------
  const fadeStrip = (el, on) => {
    const upd = () => {
      const more = el.scrollWidth - el.clientWidth > 4;
      el.classList.toggle("fade-r", more && el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
      el.classList.toggle("fade-l", more && el.scrollLeft > 4);
    };
    el.addEventListener("scroll", upd, { passive: true });
    addEventListener("resize", upd, on ? { signal: on } : undefined);
    upd();
  };
  for (const el of document.querySelectorAll(".top nav")) fadeStrip(el);
  page(({ on }) => { for (const el of document.querySelectorAll(".doors .door-list, .subtabs")) fadeStrip(el, on); });

  // ---------- looping videos play only while on screen ----------
  page(({ stop }) => {
    const videos = [...document.querySelectorAll("video.loop")];
    if (videos.length && "IntersectionObserver" in window) {
      const vo = new IntersectionObserver((entries) => {
        for (const e of entries) { if (e.isIntersecting && !calm.matches) e.target.play().catch(() => {}); else e.target.pause(); }
      }, { threshold: 0.25 });
      videos.forEach((v) => vo.observe(v));
      stop(() => vo.disconnect());
    }
  });

  // ---------- picture viewer: one dialog for the visit, the pictures of each page bound to it ----------
  const Viewer = (() => {
    if (typeof HTMLDialogElement !== "function") return null;
    const svg = (d) => `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    let dlg = null, img, cap, count, prev, next, close;
    let links = [], group = [], i = 0, opener = null, swiped = false;
    const show = (k) => {
      i = (k + group.length) % group.length;
      const a = group[i];
      img.src = a.href;
      img.alt = a.querySelector("img")?.alt ?? "";
      if (a.dataset.w) { img.width = +a.dataset.w; img.height = +a.dataset.h; } else { img.removeAttribute("width"); img.removeAttribute("height"); }
      cap.textContent = a.dataset.caption || "";
      count.textContent = group.length > 1 ? `${i + 1} / ${group.length}` : "";
      prev.hidden = next.hidden = group.length < 2;
      if (group.length > 1) new Image().src = group[(i + 1) % group.length].href;
    };
    const make = () => {
      dlg = document.createElement("dialog");
      dlg.className = "lightbox";
      dlg.innerHTML = `<button type="button" class="lb-btn lb-close">${svg("M6 6l12 12M18 6 6 18")}</button>
<div class="lb-stage"><img alt=""></div>
<div class="lb-bar"><p class="lb-caption"></p><p class="lb-count"></p></div>
<button type="button" class="lb-btn lb-prev">${svg("M15 5l-7 7 7 7")}</button>
<button type="button" class="lb-btn lb-next">${svg("M9 5l7 7-7 7")}</button>`;
      body.append(dlg);
      const $ = (s) => dlg.querySelector(s);
      img = $("img"); cap = $(".lb-caption"); count = $(".lb-count");
      prev = $(".lb-prev"); next = $(".lb-next"); close = $(".lb-close");
      prev.setAttribute("aria-label", S.lbPrev || "Previous");
      next.setAttribute("aria-label", S.lbNext || "Next");
      close.setAttribute("aria-label", S.lbClose || "Close");
      prev.addEventListener("click", () => show(i - 1));
      next.addEventListener("click", () => show(i + 1));
      close.addEventListener("click", () => dlg.close());
      dlg.addEventListener("click", (e) => {
        if (swiped) { swiped = false; return; }
        if (e.target === dlg || e.target.classList.contains("lb-stage") || e.target.classList.contains("lb-bar")) dlg.close();
      });
      dlg.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft" && group.length > 1) { e.preventDefault(); show(i - 1); }
        if (e.key === "ArrowRight" && group.length > 1) { e.preventDefault(); show(i + 1); }
      });
      dlg.addEventListener("close", () => { img.removeAttribute("src"); if (opener?.isConnected) opener.focus({ preventScroll: true }); });
      let x0 = null, y0 = 0;
      dlg.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") { x0 = e.clientX; y0 = e.clientY; } });
      dlg.addEventListener("pointerup", (e) => {
        if (x0 === null) return;
        const dx = e.clientX - x0, dy = e.clientY - y0;
        x0 = null;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) && group.length > 1) { swiped = true; show(i + (dx < 0 ? 1 : -1)); }
      });
    };
    return {
      bind() {
        links = [...document.querySelectorAll("a.zoom")];
        if (!links.length) return;
        if (!dlg) make();
        for (const a of links) {
          a.addEventListener("click", (e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            const seen = new Set();
            group = links.filter((x) => x.dataset.group === a.dataset.group && !seen.has(x.href) && seen.add(x.href));
            opener = a;
            show(Math.max(0, group.findIndex((x) => x.href === a.href)));
            dlg.showModal();
          });
        }
      },
      close() { if (dlg?.open) dlg.close(); },
    };
  })();
  page(() => Viewer?.bind());

  // ================= the toad =================
  let toads = [];
  page(() => { toads = [...document.querySelectorAll(".frog")]; });
  let px = null, py = null, queued = false;
  const look = () => {
    queued = false;
    for (const f of toads) {
      if (!f.isConnected) continue;
      const r = f.getBoundingClientRect();
      if (!r.width || r.bottom < 0 || r.top > innerHeight || !f.viewBox) continue;   // only drawn toads have pupils to move
      const scale = r.width / f.viewBox.baseVal.width;
      for (const p of f.querySelectorAll(".pupil")) {
        const ex = +p.dataset.ex, ey = +p.dataset.ey;
        let dx = px - (r.left + ex * scale), dy = py - (r.top + ey * scale);
        const d = Math.hypot(dx, dy) || 1;
        const reach = 6 * Math.min(1, d / (60 * scale));
        p.setAttribute("transform", `translate(${((dx / d) * reach).toFixed(2)} ${((dy / d) * reach * 0.8).toFixed(2)})`);
      }
    }
  };
  const lookAt = (x, y) => { px = x; py = y; if (!queued) { queued = true; requestAnimationFrame(look); } };
  addEventListener("pointermove", (e) => { if (!calm.matches) lookAt(e.clientX, e.clientY); }, { passive: true });

  const blink = (f) => { if (!f) return; f.classList.add("blink"); setTimeout(() => f.classList.remove("blink"), 170); };
  const wiggle = (f) => { if (!f || calm.matches) return; f.classList.remove("wiggle"); void f.getBoundingClientRect(); f.classList.add("wiggle"); };

  const slot = document.querySelector(".brand .frog");   // his head in the header: there on every page
  slot?.closest(".brand")?.addEventListener("pointerenter", () => blink(slot));
  let isDocked = () => true;   // on pages without the pond the toad simply lives in the header

  // ---------- the tongue ----------
  // where Klyop's mouth is on his head picture (klyop-head / klyop-peek), as parts of its width and height
  const mouthOf = (el) => { const r = el.getBoundingClientRect(), m = (el.dataset.mouth || "0.57,0.7").split(",").map(Number); return [r.left + r.width * m[0], r.top + r.height * m[1]]; };
  const tongue = (from, to, done) => {
    const [mx, my] = from, [fx, fy] = to;
    const len = Math.hypot(fx - mx, fy - my), ang = Math.atan2(fy - my, fx - mx);
    const el = document.createElement("span");
    el.className = "tongue";
    Object.assign(el.style, { left: `${mx}px`, top: `${my}px`, width: `${len}px`, transform: `rotate(${ang}rad) scaleX(0)` });
    body.append(el);
    requestAnimationFrame(() => { el.style.transform = `rotate(${ang}rad) scaleX(1)`; });
    setTimeout(() => { done?.(); el.style.transform = `rotate(${ang}rad) scaleX(0)`; }, 130);
    setTimeout(() => el.remove(), 320);
  };

  // ---------- flies: score kept in the browser ----------
  const FLIES = "vibeswamp-flies";
  let caught = +(store.get(FLIES) || 0);
  const showScore = () => {
    const score = document.querySelector(".fly-score");
    if (caught > 0 && score) score.textContent = `${score.dataset.score}: ${caught}`;
    const tot = document.querySelector(".fly-total");
    if (tot) tot.textContent = `${tot.dataset.label}: ${caught}`;
  };
  page(showScore);
  const gotOne = () => { caught++; store.set(FLIES, String(caught)); showScore(); Sound.play("plop"); };
  const flySvg = '<svg viewBox="0 0 16 12" aria-hidden="true"><ellipse class="fly-wing" cx="5" cy="4" rx="3.4" ry="2.2"/><ellipse class="fly-wing" cx="11" cy="4" rx="3.4" ry="2.2"/><ellipse class="fly-body" cx="8" cy="7.5" rx="3.2" ry="2.6"/></svg>';

  // ---------- the home page: Klyop in the pond, his jump into the header and back, the fly game ----------
  page(({ on, alive, stop }) => {
    const frogBtn = document.querySelector(".frog-btn");
    const bigToad = frogBtn?.querySelector(".frog");
    const home = document.querySelector(".frog-home");
    const pond = document.querySelector(".pond");

    if (frogBtn && bigToad) {
      const say = frogBtn.querySelector(".frog-say");
      frogBtn.setAttribute("aria-label", S.frog || "ribbit");
      let timer = 0;
      frogBtn.addEventListener("click", () => {
        blink(bigToad);
        Sound.play("croak");
        say.textContent = S.frog || "ribbit";
        say.classList.add("on");
        clearTimeout(timer);
        timer = setTimeout(() => say.classList.remove("on"), 1400);
      });
      const idle = () => setTimeout(() => {
        if (!alive()) return;
        const target = isDocked() ? slot : bigToad;
        const r = target?.getBoundingClientRect();
        if (r && !calm.matches && !document.hidden && r.bottom > 0 && r.top < innerHeight) blink(target);
        idle();
      }, 6000 + Math.random() * 8000);
      idle();
    }

    // the jump: one toad leaps from the pond into the header and back, with a splash
    const splash = () => {
      if (!pond || !home || calm.matches) return;
      const x = home.offsetLeft + home.offsetWidth / 2;
      for (const cls of ["splash", "splash s2"]) {
        const r = document.createElement("span");
        r.className = cls;
        r.style.left = `${x}px`;
        r.style.top = "6px";
        pond.append(r);
        setTimeout(() => r.remove(), 900);
      }
      for (let k = 0; k < 5; k++) {
        const d = document.createElement("span");
        d.className = "drop";
        d.style.left = `${x}px`;
        d.style.top = "0px";
        pond.append(d);
        const dx = (k - 2) * 18 + (Math.random() - 0.5) * 10, up = 30 + Math.random() * 30;
        d.animate(
          [{ transform: "translate(0,0)", opacity: 1 }, { transform: `translate(${dx * 0.6}px, ${-up}px)`, opacity: 1, offset: 0.45 }, { transform: `translate(${dx}px, 10px)`, opacity: 0 }],
          { duration: 620, easing: "cubic-bezier(.2,.6,.4,1)" }
        ).onfinish = () => d.remove();
      }
    };

    if (frogBtn && home && slot) {
      root.classList.add("frog-fly");
      frogBtn.style.transformOrigin = "50% 100%";
      let state = "home", raf = 0, jump = null;
      const flySrc = frogBtn.dataset.flySrc || "";   // on the lily pad he flies as a head; the pad stays
      let restSrc = bigToad?.getAttribute("src") || "";
      if (flySrc) new Image().src = flySrc;
      const W = () => home.offsetWidth, H = () => home.offsetHeight;
      const lerp = (a, b, t) => a + (b - a) * t;
      const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      const put = (cx, by, sx, sy, rot) => {
        frogBtn.style.transform = `translate(${(cx - W() / 2).toFixed(1)}px, ${(by - H()).toFixed(1)}px) rotate(${rot.toFixed(2)}deg) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
      };
      const atHome = () => { const h = home.getBoundingClientRect(); put(h.left + h.width / 2, h.bottom, 1, 1, 0); };
      const stretch = (t) => {
        if (t < 0.12) return -0.16 * (t / 0.12);                 // crouch
        if (t < 0.32) return lerp(-0.16, 0.12, (t - 0.12) / 0.2); // spring up
        if (t < 0.84) return lerp(0.12, 0, (t - 0.32) / 0.52);    // fly
        if (t < 0.93) return -0.18 * Math.sin(((t - 0.84) / 0.09) * Math.PI); // land
        return 0;
      };
      const fly = (up) => {
        state = "jumping";
        root.classList.remove("frog-docked");
        const start = performance.now(), D = 760;
        if (up) { splash(); Sound.play("whoosh"); } else Sound.play("whoosh");
        if (flySrc) { if (up) { restSrc = bigToad.getAttribute("src"); bigToad.src = flySrc; } root.classList.add("frog-away"); }
        jump = (now) => {
          if (!alive()) return;
          const t = Math.min(1, (now - start) / D);
          const h = home.getBoundingClientRect(), s = slot.getBoundingClientRect();
          const k = s.width / h.width;
          const e = ease(t);
          const [a, b] = up ? [h, s] : [s, h];
          const [k0, k1] = up ? [1, k] : [k, 1];
          const cx = lerp(a.left + a.width / 2, b.left + b.width / 2, e);
          const by = lerp(a.bottom, b.bottom, e) - (up ? 110 : 80) * Math.sin(Math.PI * t);
          const sc = lerp(k0, k1, e), f = stretch(t);
          put(cx, by, sc * (1 - f * 0.6), sc * (1 + f), (up ? -14 : 12) * Math.sin(Math.PI * t));
          if (t < 1) { raf = requestAnimationFrame(jump); return; }
          jump = null;
          if (up) { state = "docked"; root.classList.add("frog-docked"); wiggle(slot); blink(slot); Sound.play("land"); }
          else { state = "home"; atHome(); splash(); Sound.play("splash"); wiggle(bigToad); if (flySrc) { bigToad.src = restSrc; root.classList.remove("frog-away"); } }
          check();
        };
        raf = requestAnimationFrame(jump);
      };
      const check = () => {
        if (jump || !alive()) return;
        const h = home.getBoundingClientRect(), s = slot.getBoundingClientRect();
        if (calm.matches) {
          const d = h.top < s.bottom + 30;
          state = d ? "docked" : "home";
          root.classList.toggle("frog-docked", d);
          if (!d) atHome();
          return;
        }
        if (state === "home") {
          if (h.top < s.bottom + 40) fly(true); else atHome();
        } else if (state === "docked" && h.top > s.bottom + 120) fly(false);
      };
      let q = 0;
      const queue = () => { if (!q && alive()) q = requestAnimationFrame(() => { q = 0; check(); }); };
      addEventListener("scroll", queue, { passive: true, signal: on });
      addEventListener("resize", queue, { signal: on });
      // the pond can move without a scroll (fonts or pictures arriving above it); without this he stayed where the pond
      // used to be, up to 35 px off his lily pad (12.11.2026)
      document.fonts?.ready.then(queue);
      addEventListener("load", queue, { signal: on });
      if ("ResizeObserver" in window) {
        const ro = new ResizeObserver(queue);
        ro.observe(document.querySelector(".hero") || body);
        stop(() => ro.disconnect());
      }
      check();
      isDocked = () => state === "docked";
      stop(() => { isDocked = () => true; cancelAnimationFrame(raf); cancelAnimationFrame(q); });
    }

    // the fly game on the home page
    const hero = document.querySelector(".hero");
    const layer = document.querySelector(".flies");
    if (hero && layer && bigToad) {
      const flies = [];
      const W = () => hero.clientWidth, H = () => hero.clientHeight;
      // they keep to the strip of air just above the pond, on every screen: never across the heading, the numbers or the
      // reach box (12.11.2026; before, on a wide screen they crossed the subscriber count)
      const zone = () => (pond ? { x: W() * 0.06, w: W() * 0.88, y: pond.offsetTop - 74, h: 60 } : { x: W() * 0.42, w: W() * 0.54, y: H() * 0.12, h: H() * 0.5 });
      const target = (f) => { const z = zone(); f.tx = z.x + Math.random() * z.w; f.ty = z.y + Math.random() * z.h; };
      const draw = (f) => { f.el.style.transform = `translate(${f.x.toFixed(1)}px, ${f.y.toFixed(1)}px)`; };
      const spawn = () => {
        if (!alive()) return;
        const el = document.createElement("button");
        el.type = "button"; el.className = "fly"; el.tabIndex = -1; el.setAttribute("aria-hidden", "true");
        el.innerHTML = flySvg;
        const z0 = zone();
        const f = { el, x: z0.x + Math.random() * z0.w, y: z0.y + Math.random() * z0.h, vx: 0, vy: 0, tx: 0, ty: 0, alive: true };
        target(f);
        el.addEventListener("click", (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          if (!f.alive) return;
          f.alive = false;
          const b = f.el.getBoundingClientRect();
          tongue(mouthOf(isDocked() ? slot : bigToad), [b.left + b.width / 2, b.top + b.height / 2], () => f.el.remove());
          flies.splice(flies.indexOf(f), 1);
          gotOne(); blink(bigToad);
          setTimeout(spawn, 1500 + Math.random() * 2500);
        });
        layer.append(el); flies.push(f); draw(f);
      };
      let visible = true, last = 0;
      const step = (now) => {
        if (!alive()) return;
        const dt = Math.min(50, now - (last || now)) / 16;
        last = now;
        for (const f of flies) {
          const dx = f.tx - f.x, dy = f.ty - f.y, d = Math.hypot(dx, dy) || 1;
          if (d < 14) target(f);
          f.vx = (f.vx + (dx / d) * 0.09 * dt + (Math.random() - 0.5) * 0.5 * dt) * 0.96;
          f.vy = (f.vy + (dy / d) * 0.09 * dt + (Math.random() - 0.5) * 0.5 * dt) * 0.96;
          const sp = Math.hypot(f.vx, f.vy);
          if (sp > 2.4) { f.vx *= 2.4 / sp; f.vy *= 2.4 / sp; }
          f.x += f.vx * dt; f.y += f.vy * dt;
          draw(f);
        }
        if (visible && !document.hidden) requestAnimationFrame(step); else last = 0;
      };
      for (let n = 0; n < 3; n++) spawn();
      if (!calm.matches) {
        const io = new IntersectionObserver((entries) => {
          const was = visible;
          visible = entries[0].isIntersecting;
          if (visible && !was) requestAnimationFrame(step);
        });
        io.observe(hero);
        stop(() => io.disconnect());
        document.addEventListener("visibilitychange", () => { if (!document.hidden && visible) requestAnimationFrame(step); }, { signal: on });
        requestAnimationFrame(step);
      }
    }
  });

  // ---------- while you read: now and then a fly lands on a picture, and the toad in the header catches it ----------
  if (slot && !calm.matches) {
    let idleTimer = 0, lastVisit = 0, visits = 0;
    const pics = () => [...document.querySelectorAll(".shot img, .reel img, .crow-pic img, .gallery-cols img, .prose img, .row-pics img")]
      .filter((im) => { const r = im.getBoundingClientRect(); return r.width > 80 && r.top > 90 && r.bottom < innerHeight - 20; });
    const visit = () => {
      const now = performance.now();
      if (!isDocked() || visits >= 6 || now - lastVisit < 22000 || document.hidden || Math.random() < 0.4) return;
      const list = pics();
      if (!list.length) return;
      lastVisit = now; visits++;
      const r = list[Math.floor(Math.random() * list.length)].getBoundingClientRect();
      const tx = r.right - 18 + scrollX, ty = r.top + 14 + scrollY;
      const el = document.createElement("button");
      el.type = "button"; el.className = "fly"; el.tabIndex = -1; el.setAttribute("aria-hidden", "true");
      el.innerHTML = flySvg;
      Object.assign(el.style, { position: "absolute", zIndex: 15 });
      body.append(el);
      const sx = (Math.random() < 0.5 ? -40 : innerWidth + 40) + scrollX, sy = ty - 120 + Math.random() * 80;
      const path = el.animate(
        [{ transform: `translate(${sx}px, ${sy}px)` }, { transform: `translate(${(sx + tx) / 2}px, ${sy - 60}px)`, offset: 0.4 }, { transform: `translate(${tx}px, ${ty}px)` }],
        { duration: 1400, easing: "ease-out", fill: "forwards" }
      );
      let gone = false;
      const eat = () => {
        if (gone || !el.isConnected) return;
        gone = true;
        const b = el.getBoundingClientRect();
        if (b.bottom < 0 || b.top > innerHeight) { el.remove(); return; }
        lookAt(b.left, b.top);
        tongue(mouthOf(slot), [b.left + b.width / 2, b.top + b.height / 2], () => el.remove());
        gotOne(); blink(slot);
      };
      el.addEventListener("click", (e) => { e.preventDefault(); eat(); });
      path.onfinish = () => {
        if (!el.isConnected) return;
        const b = el.getBoundingClientRect();
        lookAt(b.left, b.top);
        setTimeout(eat, 2200);
      };
    };
    addEventListener("scroll", () => { clearTimeout(idleTimer); idleTimer = setTimeout(visit, 1500); }, { passive: true });
  }

  // ---------- the "not out yet" wire piece swings when it comes into view ----------
  page(({ stop }) => {
    const wires = [...document.querySelectorAll(".wire")];
    if (wires.length && "IntersectionObserver" in window && !calm.matches) {
      const wo = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { e.target.classList.add("swing"); wo.unobserve(e.target); }
      }, { threshold: 1 });
      wires.forEach((w) => wo.observe(w));
      stop(() => wo.disconnect());
    }
  });

  // ---------- wet footprints at the end of the page, once per page ----------
  page(({ stop, alive }) => {
    const prints = document.querySelector(".prints");
    if (prints && "IntersectionObserver" in window && !calm.matches) {
      const step = '<svg viewBox="0 0 18 16" aria-hidden="true"><ellipse cx="9" cy="11" rx="4" ry="3.4" fill="currentColor"/><circle cx="3.6" cy="4.4" r="2" fill="currentColor"/><circle cx="9" cy="2.6" r="2" fill="currentColor"/><circle cx="14.4" cy="4.4" r="2" fill="currentColor"/></svg>';
      const po = new IntersectionObserver((entries) => {
        if (!entries[0].isIntersecting) return;
        po.disconnect();
        const w = prints.clientWidth || innerWidth;
        for (let k = 0; k < 6; k++) {
          setTimeout(() => {
            if (!alive()) return;
            const p = document.createElement("span");
            p.className = "print";
            p.innerHTML = step;
            p.style.left = `${w * 0.2 + k * 46}px`;
            p.style.top = `${k % 2 ? 6 : 22}px`;
            p.style.rotate = "90deg";
            prints.append(p);
            setTimeout(() => p.remove(), 2700);
            if (k === 5) { blink(slot); Sound.play("croak"); }
          }, k * 170);
        }
      }, { threshold: 1 });
      po.observe(prints);
      stop(() => po.disconnect());
    }
  });

  // ---------- the mods page: tabs by game (plain links to the sections without JS) ----------
  page(() => {
    const tabs = [...document.querySelectorAll(".subtab")];
    if (!tabs.length) return;
    const fams = [...document.querySelectorAll(".fam")];
    const pick = (fam, scroll) => {
      for (const t of tabs) t.setAttribute("aria-current", t.dataset.fam === fam ? "true" : "false");
      for (const f of fams) f.hidden = !!fam && f.dataset.fam !== fam;
      if (scroll) document.querySelector(".subtabs")?.scrollIntoView({ block: "start", behavior: calm.matches ? "auto" : "smooth" });
    };
    for (const t of tabs) t.addEventListener("click", (e) => {
      e.preventDefault();
      pick(t.dataset.fam, false);
      history.replaceState(history.state, "", t.dataset.fam ? `#fam-${t.dataset.fam}` : location.pathname);
      Sound.play("tick");
    });
    const m = location.hash.match(/^#fam-(.+)$/);
    if (m && tabs.some((t) => t.dataset.fam === m[1])) pick(m[1], true);
  });

  // ---------- stickers: share the PNG where the browser can, the links download it everywhere ----------
  page(() => {
    for (const b of document.querySelectorAll(".st-share")) {
      if (!navigator.canShare) continue;
      b.hidden = false;
      b.addEventListener("click", async () => {
        try {
          const blob = await (await fetch(b.dataset.png)).blob();
          const file = new File([blob], b.dataset.name, { type: "image/png" });
          if (navigator.canShare({ files: [file] })) await navigator.share({ files: [file] });
          else { const a = document.createElement("a"); a.href = b.dataset.png; a.download = b.dataset.name; a.click(); }
          Sound.play("plop");
        } catch (e) {}
      });
    }
  });

  initPage();

  // ================= moving between pages without a reload, so Swamp Radio does not stop =================
  // (owner, 12.11.2026: «при переходе со страницы на страницу у нас обрывается радио»). A click on a link to another page
  // of this site fetches that page and swaps what changes: <main>, the footer, the language links, the current menu item,
  // the title and the head tags. The header, the player and its <audio> stay. Left to the browser as before: other
  // sites, files, the language switch, links opened in a new tab or window (Ctrl/Cmd, Shift, middle button), anchors on
  // the same page, and the clicker and the 3D swamp (/creative/swamp/...), which load whole with their own scripts. If
  // anything goes wrong, the browser simply opens the page.
  (() => {
    if (!window.fetch || !window.DOMParser || !history.pushState) return;
    if (body.classList.contains("page-swamp")) return;   // leaving the clicker: a whole page, its game stops cleanly
    const WHOLE = /\/creative\/swamp\//;
    const FILE = /\.(xml|json|png|jpe?g|webp|gif|svg|mp4|webm|m4a|mp3|ogg|zip|pdf|txt|glb)$/i;
    try { history.scrollRestoration = "manual"; } catch (e) {}
    let shown = location.pathname + location.search;   // the page on screen (a #hash change alone is not a new page)
    const remember = () => { try { history.replaceState({ ...(history.state || {}), vs: 1, y: scrollY }, ""); } catch (e) {} };
    remember();
    let rt = 0;
    addEventListener("scroll", () => { clearTimeout(rt); rt = setTimeout(remember, 150); }, { passive: true });
    addEventListener("pagehide", remember);

    const wanted = (a, e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
      if (!a.href || (a.target && a.target !== "_self") || a.hasAttribute("download") || a.hasAttribute("data-lang") || a.hasAttribute("hreflang") || "full" in a.dataset) return null;
      const u = new URL(a.href, location.href);
      if (u.origin !== location.origin || WHOLE.test(u.pathname) || FILE.test(u.pathname)) return null;
      if (u.pathname + u.search === shown && u.hash) return null;   // an anchor on this page
      return u;
    };
    const HEAD = 'meta[name="description"], link[rel="canonical"], link[rel="alternate"], meta[property^="og:"], script[type="application/ld+json"]';
    let ctl = null;
    const go = async (url, { push = true, y = null } = {}) => {
      ctl?.abort();
      ctl = new AbortController();
      root.classList.add("nav-wait");
      let doc;
      try {
        const r = await fetch(url, { signal: ctl.signal, credentials: "same-origin" });
        if (!r.ok || !(r.headers.get("content-type") || "").includes("text/html")) throw new Error("not a page");
        doc = new DOMParser().parseFromString(await r.text(), "text/html");
      } catch (err) {
        if (err.name === "AbortError") return;
        location.href = url;
        return;
      }
      const main = doc.querySelector("main#main");
      if (!main || doc.documentElement.lang !== root.lang || doc.body.classList.contains("page-swamp") || !document.querySelector("main#main")) { location.href = url; return; }

      document.dispatchEvent(new CustomEvent("vibeswamp:nav"));
      Viewer?.close();
      endPage();
      if (push) { remember(); history.pushState({ vs: 1, y: 0 }, "", url); }
      shown = location.pathname + location.search;

      document.title = doc.title;
      for (const n of document.head.querySelectorAll(HEAD)) n.remove();
      for (const n of doc.head.querySelectorAll(HEAD)) document.head.append(document.adoptNode(n));
      body.className = doc.body.className;
      document.querySelector("main#main").replaceWith(document.adoptNode(main));
      const foot = doc.querySelector("footer.foot"), myFoot = document.querySelector("footer.foot");
      if (foot && myFoot) myFoot.replaceWith(document.adoptNode(foot));
      const langs = doc.querySelector(".top .langs"), myLangs = document.querySelector(".top .langs");
      if (langs && myLangs) myLangs.innerHTML = langs.innerHTML;
      const current = [...doc.querySelectorAll(".top nav a")].map((a) => a.getAttribute("aria-current"));
      document.querySelectorAll(".top nav a").forEach((a, k) => { if (current[k]) a.setAttribute("aria-current", current[k]); else a.removeAttribute("aria-current"); });
      // the one page script outside site.js on these pages: Klyop the pet on the creative page
      if (document.querySelector(".pet")) {
        const s = document.createElement("script");
        s.src = "/pet.js";
        s.onload = s.onerror = () => s.remove();
        body.append(s);
      }

      const hash = new URL(url, location.href).hash;
      const target = hash && document.getElementById(decodeURIComponent(hash.slice(1)));
      if (y != null) scrollTo(0, y); else if (target) target.scrollIntoView(); else scrollTo(0, 0);
      initPage();
      radioPeek();
      // keyboard and screen readers start at the new page's heading
      const h1 = document.querySelector("main h1");
      if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus({ preventScroll: true }); }
      root.classList.remove("nav-wait");
    };

    document.addEventListener("click", (e) => {
      const a = e.target.closest?.("a[href]");
      if (!a) return;
      const u = wanted(a, e);
      if (!u) return;
      e.preventDefault();
      go(u.href);
    });
    addEventListener("popstate", (e) => {
      if (location.pathname + location.search === shown) return;   // only the #hash changed
      go(location.href, { push: false, y: e.state?.y ?? 0 });
    });
  })();
})();
