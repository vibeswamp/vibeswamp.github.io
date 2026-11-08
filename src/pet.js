// Klyop at home: a little pet on the creative page. He walks left and right on his own, reacts to taps, drinks tea,
// catches flies, falls asleep when nobody plays with him, dances while Swamp Radio plays, changes outfits and says
// out loud what you type (the browser's own speech, no microphone). Pictures: public/brand/klyop/*.webp.
// Frame animations: public/brand/klyop/anim/anim.json lists the frames and their timings per action (idle, walk, tea,
// wave, jump, laugh, fly, sleep, dance). When that file is missing he falls back to single poses.
(() => {
  const stage = document.querySelector(".pet");
  if (!stage) return;
  const T = JSON.parse(document.getElementById("pet-text")?.textContent || "{}");
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const VS = () => window.VibeSwamp || {};
  const P = (name) => `/brand/klyop/${name}.webp`;
  const S = (name) => `/brand/stickers/${name}.webp`;
  const ANIM = "/brand/klyop/anim/";
  const F = (name) => `${ANIM}${name}.webp`;
  const body = stage.querySelector(".pet-body");
  const img = stage.querySelector(".pet-img");
  const flip = stage.querySelector(".pet-flip");
  const bubble = stage.querySelector(".pet-say");
  const floor = stage.querySelector(".pet-floor");

  const OUTFITS = ["", "rimworld", "miner", "night-shift", "welder", "chemist", "climber", "lantern", "streamer"];
  let A = null;   // the frame manifest, once loaded
  const ready = fetch(`${ANIM}anim.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => { if (m && m.idle && m.walk) A = m; })
    .catch(() => {});

  // pictures are loaded only when the pet comes into view, so other visits stay light
  // frames load per action (152 frames are about 3 MB): standing and walking at once, the rest on the first tap or when
  // an action plays for the first time
  const warm = (list) => { for (const src of list) { const i = new Image(); i.src = src; } };
  const warmed = new Set();
  const warmAction = (name) => { if (!A || !A[name] || warmed.has(name)) return; warmed.add(name); warm(A[name].frames.map(F)); };
  const warmAll = () => ready.then(() => { if (A) Object.keys(A).forEach(warmAction); });
  stage.addEventListener("pointerdown", warmAll, { once: true });
  stage.addEventListener("focusin", warmAll, { once: true });
  const preload = () => ready.then(() => {
    warm(OUTFITS.filter(Boolean).map(P).concat([P("grumpy"), "/brand/klyop-full.webp"]));
    if (A) { warmAction("idle"); warmAction("walk"); }
    else warm(["walk-1", "walk-2", "walk-3", "walk-4", "asleep", "laugh", "yawn", "jump"].map(P)
      .concat(["smug", "wave", "fly", "vibe", "beat", "shocked"].map(S)));
  });
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) { io.disconnect(); preload(); } }, { rootMargin: "200px" });
    io.observe(stage);
  } else preload();

  let outfit = 0;
  let x = 0.5, dir = 1, mode = "idle", until = 0, frame = 0, idleSince = performance.now(), walkTimer = 0, sayTimer = 0, last = 0;
  let touched = performance.now();   // the visitor's last tap or button: he falls asleep 25 s after it, his own walks don't count
  const touch = () => { touched = idleSince = performance.now(); };
  let seq = null;   // the frame sequence on screen: { action, names, ms, i, at, loop, times, cls, then }

  const standing = () => (OUTFITS[outfit] ? P(OUTFITS[outfit]) : "/brand/klyop-full.webp");
  const show = (src, cls = "") => {
    if (img.getAttribute("src") !== src) img.src = src;
    body.className = "pet-body" + (cls ? " " + cls : "");
  };
  // a single picture: once frames are in, it is shrunk to the frames' framing so Klyop keeps his size
  const showPic = (src, cls = "") => { seq = null; show(src, (A ? "pic " : "") + cls); };
  const say = (text, ms = 2600) => {
    if (!text) return;
    bubble.textContent = text;
    bubble.classList.add("on");
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => bubble.classList.remove("on"), ms);
  };
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  // a frame is mostly empty canvas around him: he is placed by his body width, so he has room to walk on a narrow stage
  const coreW = () => ((img.getAttribute("src") || "").startsWith(ANIM) ? body.offsetHeight * 0.45 : body.offsetWidth);
  const place = () => {
    const w = floor.clientWidth, bw = body.offsetWidth, core = Math.min(w, coreW());
    body.style.transform = `translateX(${Math.round(core / 2 + (w - core) * x - bw / 2)}px)`;
    flip.style.transform = dir < 0 ? "scaleX(-1)" : "";
  };

  // ---------- frame sequences ----------
  const frameNow = () => show(F(seq.names[seq.i]), seq.cls);
  const play = (action, { order, loop = false, times = 1, cls = "", then } = {}) => {
    const a = A && A[action];
    if (!a) return false;
    warmAction(action);
    const idx = (order || a.frames.map((_, i) => i)).filter((i) => i < a.frames.length);
    let names = idx.map((i) => a.frames[i]);
    let ms = idx.map((i) => a.ms[i] || 120);
    if (calm) {   // reduced motion: one still frame for as long as the action lasts
      const k = action === "idle" || action === "walk" ? 0 : Math.floor(idx.length / 2);
      const total = ms.reduce((s, v) => s + v, 0) * times;
      names = [names[k]];
      ms = [loop ? 1e9 : total];
      times = 1;
    }
    seq = { action, names, ms, i: 0, at: performance.now() + ms[0], loop, times, cls, then };
    frameNow();
    return true;
  };
  const stepSeq = (now) => {
    if (!seq || now < seq.at) return;
    seq.i++;
    if (seq.i >= seq.names.length) {
      if (seq.loop || --seq.times > 0) seq.i = 0;
      else { const done = seq.then; seq = null; done?.(); return; }
    }
    // he blinks at uneven times, not like a metronome
    seq.at = now + (seq.action === "idle" && seq.i === 0 ? 1200 + Math.random() * 2600 : seq.ms[seq.i]);
    frameNow();
  };

  // standing still: blinking frames without an outfit, the outfit picture otherwise
  const stand = () => {
    if (!OUTFITS[outfit] && play("idle", { loop: true })) return;
    showPic(standing());
  };
  const backToIdle = () => { mode = "idle"; idleSince = performance.now(); stand(); };

  // a single pose for a while, then back to standing
  const act = (src, ms, text, cls = "") => {
    mode = "act";
    until = performance.now() + ms;
    showPic(src, cls);
    say(text);
  };
  // an action played as frames, then back to standing; the single pose when there are no frames
  const actSeq = (action, opts, text, fallback) => {
    if (!A || !A[action]) return fallback();
    mode = "act";
    until = Infinity;
    play(action, { ...opts, then: opts.then || backToIdle });
    say(text);
  };

  // ---------- walking ----------
  const startWalk = () => {
    if (calm) return;
    mode = "walk";
    dir = x < 0.15 ? 1 : x > 0.85 ? -1 : Math.random() < 0.5 ? -1 : 1;
    until = performance.now() + 2000 + Math.random() * 3000;
    if (!OUTFITS[outfit]) play("walk", { loop: true, cls: "walking" });
    else showPic(P(OUTFITS[outfit]), "waddle");   // stops whatever he was playing
  };

  const fallAsleep = () => {
    if (A && A.sleep) {
      actSeq("sleep", { order: A.sleep.down || [0, 1], then: () => {
        mode = "sleep";
        play("sleep", { order: A.sleep.loop || [2, 3], loop: true, cls: "sleepy" });
        say("z z z", 4000);
      } }, T.yawn);
      return;
    }
    act(P("yawn"), 1800, T.yawn);
    setTimeout(() => { if (mode !== "act") return; mode = "sleep"; showPic(P("asleep"), "sleepy"); say("z z z", 4000); }, 1700);
  };

  const tick = (now) => {
    requestAnimationFrame(tick);
    const dt = Math.min(100, now - (last || now));
    last = now;
    if (document.hidden) return;
    stepSeq(now);
    const radio = !!VS().playing;
    if (mode === "sleep") return;
    if (mode === "act" && now > until) backToIdle();
    if (mode === "idle") {
      if (radio && !calm) { mode = "dance"; play("dance", { loop: true, cls: "dancing" }); }
      else if (now - touched > 25000) fallAsleep();
      else if (now - idleSince > 3500 && Math.random() < 0.004) startWalk();
    }
    if (mode === "dance") {
      if (!radio) { backToIdle(); return; }
      if (!seq && now - walkTimer > 420) { walkTimer = now; frame ^= 1; show(frame ? S("vibe") : S("beat"), "dance"); }
    }
    if (mode === "walk") {
      if (now > until || (dir < 0 && x <= 0.02) || (dir > 0 && x >= 0.98)) { backToIdle(); place(); return; }
      const span = Math.max(1, floor.clientWidth - coreW());
      x = Math.max(0, Math.min(1, x + (dir * 60 * dt) / 1000 / span));   // about 60 px a second on any screen
      if (!seq && now - walkTimer > 130) {
        walkTimer = now;
        frame = (frame + 1) % 4;
        // in an outfit there are no walking frames: he waddles in it instead
        if (OUTFITS[outfit]) showPic(P(OUTFITS[outfit]), "waddle");
        else show(P(`walk-${frame + 1}`), "walking");
      }
      place();
    }
  };

  // ---------- taps ----------
  const wake = () => {
    if (mode !== "sleep") return false;
    actSeq("sleep", { order: A?.sleep?.up || [1, 0] }, T.woke, () => act(P("grumpy"), 1600, T.woke));
    touch();
    return true;
  };
  img.addEventListener("click", (e) => {
    touch();
    if (wake()) return;
    const r = img.getBoundingClientRect();
    const onHead = e.clientY - r.top < r.height * 0.32;
    VS().sound?.(onHead ? "croak" : "plop");
    if (onHead) actSeq("laugh", { times: 2 }, pick(T.tickle || ["хи-хи"]), () => act(P("laugh"), 1500, pick(T.tickle || ["хи-хи"])));
    else actSeq("wave", { order: A?.wave?.order || [0, 1, 2, 3, 2, 3, 1, 0] }, T.hello, () => act(S("wave"), 1500, T.hello));
  });
  img.addEventListener("dblclick", () => {
    touch();
    VS().sound?.("whoosh");
    actSeq("jump", { cls: "hop" }, T.jump, () => act(P("jump"), 900, T.jump, "jumping"));
  });
  const btn = (name, fn) => stage.querySelector(`[data-pet="${name}"]`)?.addEventListener("click", () => { touch(); wake(); fn(); });
  btn("tea", () => actSeq("tea", {}, T.tea, () => act(S("smug"), 2200, T.tea)));
  btn("fly", () => { VS().sound?.("plop"); actSeq("fly", {}, T.fly, () => act(S("fly"), 1300, T.fly)); });
  btn("walk", () => { if (mode !== "sleep") startWalk(); });
  btn("outfit", () => {
    outfit = (outfit + 1) % OUTFITS.length;
    act(standing(), 1200, (T.outfits || [])[outfit] || "");
    if (!OUTFITS[outfit] && A) { until = 0; backToIdle(); }
  });
  const form = stage.querySelector(".pet-talk");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = form.querySelector("input");
    const text = input.value.trim().slice(0, 140);
    if (!text) return;
    touch();
    wake();
    if (A) { backToIdle(); say(text); }
    else { act(S("shocked"), 400); setTimeout(() => act(standing(), 2600, text), 400); }
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = document.documentElement.lang === "uk" ? "uk-UA" : document.documentElement.lang === "ru" ? "ru-RU" : "en-US";
      u.pitch = 1.9; u.rate = 1.15; u.volume = 0.8;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (err) {}
    input.value = "";
  });

  addEventListener("resize", place);
  show(standing());
  place();
  // once the frames are known he starts blinking (unless something already started)
  ready.then(() => { if (A && mode === "idle" && !seq) stand(); place(); });
  requestAnimationFrame(tick);
})();
