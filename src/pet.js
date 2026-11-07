// Klyop at home: a little pet on the creative page. He walks left and right on his own, reacts to taps, drinks tea,
// catches flies, falls asleep when nobody plays with him, dances while Swamp Radio plays, changes outfits and says
// out loud what you type (the browser's own speech, no microphone). Pictures: public/brand/klyop/*.webp.
(() => {
  const stage = document.querySelector(".pet");
  if (!stage) return;
  const T = JSON.parse(document.getElementById("pet-text")?.textContent || "{}");
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const VS = () => window.VibeSwamp || {};
  const P = (name) => `/brand/klyop/${name}.webp`;
  const S = (name) => `/brand/stickers/${name}.webp`;
  const body = stage.querySelector(".pet-body");
  const img = stage.querySelector(".pet-img");
  const flip = stage.querySelector(".pet-flip");
  const bubble = stage.querySelector(".pet-say");
  const floor = stage.querySelector(".pet-floor");

  // preload everything he can show, so poses switch without a blink
  const pics = ["walk-1", "walk-2", "walk-3", "walk-4", "asleep", "laugh", "grumpy", "yawn", "jump", "three-quarter",
    "rimworld", "miner", "night-shift", "welder", "chemist", "climber", "lantern", "streamer"].map(P)
    .concat(["smug", "wave", "fly", "vibe", "beat", "shocked", "fixed"].map(S), ["/brand/klyop-full.webp"]);
  // loaded only when the pet comes into view (about 1 MB of pictures), so other visits stay light
  const preload = () => { for (const src of pics) { const i = new Image(); i.src = src; } };
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) { io.disconnect(); preload(); } }, { rootMargin: "200px" });
    io.observe(stage);
  } else preload();

  const OUTFITS = ["", "rimworld", "miner", "night-shift", "welder", "chemist", "climber", "lantern", "streamer"];
  let outfit = 0;
  let x = 0.5, dir = 1, mode = "idle", until = 0, frame = 0, idleSince = performance.now(), walkTimer = 0, sayTimer = 0, last = 0;

  const standing = () => (OUTFITS[outfit] ? P(OUTFITS[outfit]) : "/brand/klyop-full.webp");
  const show = (src, cls = "") => {
    if (img.getAttribute("src") !== src) img.src = src;
    body.className = "pet-body" + (cls ? " " + cls : "");
  };
  const say = (text, ms = 2600) => {
    bubble.textContent = text;
    bubble.classList.add("on");
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => bubble.classList.remove("on"), ms);
  };
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const place = () => {
    const w = floor.clientWidth, bw = body.offsetWidth;
    body.style.transform = `translateX(${Math.round((w - bw) * x)}px)`;
    flip.style.transform = dir < 0 ? "scaleX(-1)" : "";
  };

  // a pose for a while, then back to standing
  const act = (src, ms, text, cls = "") => {
    mode = "act";
    until = performance.now() + ms;
    show(src, cls);
    if (text) say(text);
  };

  // ---------- walking ----------
  const startWalk = () => {
    if (calm) return;
    mode = "walk";
    dir = x < 0.15 ? 1 : x > 0.85 ? -1 : Math.random() < 0.5 ? -1 : 1;
    until = performance.now() + 2000 + Math.random() * 3000;
  };

  const tick = (now) => {
    requestAnimationFrame(tick);
    const dt = Math.min(100, now - (last || now));
    last = now;
    if (document.hidden) return;
    const radio = !!VS().playing;
    if (mode === "sleep") return;
    if (mode === "act" && now > until) { mode = "idle"; show(standing()); idleSince = now; }
    if (mode === "idle") {
      if (radio && !calm) { mode = "dance"; }
      else if (now - idleSince > 25000) { act(P("yawn"), 1800, T.yawn); setTimeout(() => { if (mode !== "act") return; mode = "sleep"; show(P("asleep"), "sleepy"); say("z z z", 4000); }, 1700); }
      else if (now - idleSince > 3500 && Math.random() < 0.004) startWalk();
    }
    if (mode === "dance") {
      if (!radio) { mode = "idle"; show(standing()); idleSince = now; return; }
      if (now - walkTimer > 420) { walkTimer = now; frame ^= 1; show(frame ? S("vibe") : S("beat"), "dance"); }
    }
    if (mode === "walk") {
      if (now > until || (dir < 0 && x <= 0.02) || (dir > 0 && x >= 0.98)) { mode = "idle"; show(standing()); idleSince = now; place(); return; }
      const span = Math.max(1, floor.clientWidth - body.offsetWidth);
      x = Math.max(0, Math.min(1, x + (dir * 60 * dt) / 1000 / span));   // about 60 px a second on any screen
      if (now - walkTimer > 130) {
        walkTimer = now;
        frame = (frame + 1) % 4;
        // in an outfit there are no walking frames: he waddles in it instead
        show(OUTFITS[outfit] ? P(OUTFITS[outfit]) : P(`walk-${frame + 1}`), OUTFITS[outfit] ? "waddle" : "walking");
      }
      place();
    }
  };

  // ---------- taps ----------
  const wake = () => {
    if (mode !== "sleep") return false;
    act(P("grumpy"), 1600, T.woke);
    idleSince = performance.now();
    return true;
  };
  img.addEventListener("click", (e) => {
    idleSince = performance.now();
    if (wake()) return;
    const r = img.getBoundingClientRect();
    const onHead = e.clientY - r.top < r.height * 0.32;
    VS().sound?.(onHead ? "croak" : "plop");
    if (onHead) act(P("laugh"), 1500, pick(T.tickle || ["хи-хи"]));
    else act(S("wave"), 1500, T.hello);
  });
  img.addEventListener("dblclick", () => { idleSince = performance.now(); VS().sound?.("whoosh"); act(P("jump"), 900, T.jump, "jumping"); });
  const btn = (name, fn) => stage.querySelector(`[data-pet="${name}"]`)?.addEventListener("click", () => { idleSince = performance.now(); wake(); fn(); });
  btn("tea", () => act(S("smug"), 2200, T.tea));
  btn("fly", () => { VS().sound?.("plop"); act(S("fly"), 1300, T.fly); });
  btn("walk", () => { if (mode !== "sleep") startWalk(); });
  btn("outfit", () => {
    outfit = (outfit + 1) % OUTFITS.length;
    act(standing(), 1200, (T.outfits || [])[outfit] || "");
  });
  const form = stage.querySelector(".pet-talk");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = form.querySelector("input");
    const text = input.value.trim().slice(0, 140);
    if (!text) return;
    idleSince = performance.now();
    wake();
    act(S("shocked"), 400);
    setTimeout(() => act(standing(), 2600, text), 400);
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
  requestAnimationFrame(tick);
})();
