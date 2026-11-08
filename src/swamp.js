// Klyop builds the swamp: a light clicker with the site toad. Texts come from content/swamp.json (built into the page),
// the save lives in localStorage ("vibeswamp-swamp"). Flies caught in the pond on the home page come in here too.
// Pictures: public/brand/swamp/ (the eight buildings and the dusk swamp, Codex image_gen, 07.11.2026). Klyop moves with
// the same frames as the pet (public/brand/klyop/anim/anim.json); new actions from the mascot chat are picked up by name
// ("croak" or "type" for clicking, if they appear), and without the frames he stands still and squashes on a click.
(() => {
  const host = document.getElementById("swamp");
  const textEl = document.getElementById("swamp-text");
  if (!host || !textEl) return;
  const T = JSON.parse(textEl.textContent || "{}");
  const lang = document.documentElement.lang;
  const locale = { uk: "uk-UA", ru: "ru-RU" }[lang] || "en-GB";
  const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const tenth = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const big = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 2 });
  const fmt = (n) => (n >= 1e6 ? big.format(n) : whole.format(Math.floor(n)));
  const fmtRate = (n) => (n >= 1e6 ? big.format(n) : n < 10 ? tenth.format(n) : whole.format(n));
  const fill = (s, o) => String(s ?? "").replace(/\{(\w+)\}/g, (_, k) => o[k]);
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const VS = () => window.VibeSwamp || {};
  const now = () => performance.now();
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ---------- our own numbers, checked with a pacing simulation (4 clicks a second: all eight buildings in 11-14 min,
  // the top rank in 16-20; one click a second is a few minutes slower). Costs grow 15% per copy ----------
  const BASE = [[10, 0.4], [100, 3], [1100, 20], [12000, 130], [130000, 850], [1.4e6, 5500], [1.5e7, 36000], [1.6e8, 240000]];
  const GROW = 1.15;
  const BUILD = [[50, 5], [600, 10], [6000, 15], [60000, 20], [500000, 25], [4e6, 30], [3e7, 40], [2e8, 50]];
  const RANKS = [0, 500, 5000, 5e4, 5e5, 5e6, 5e7, 5e8, 5e9];   // each rank: +10% to the whole swamp
  const OUTFIT = ["", "rimworld", "miner", "night-shift", "welder", "chemist", "climber", "lantern", "streamer"];
  const PAIRS = { rimworld: ["tussock", "antenna"], kfsos: ["flytrap", "stump"], workshop: ["review", "beaver"], stream: ["peat", "radio"] };
  // where a building stands in the scene: centre x %, bottom %, height % of the scene, layer
  const SPOT = { tussock: [24, 2, 24, 6], antenna: [6, 22, 38, 3], flytrap: [77, 2, 24, 6], stump: [93, 13, 24, 4],
    review: [10, 1, 20, 7], beaver: [67, 34, 15, 2], peat: [31, 34, 16, 2], radio: [87, 40, 20, 1] };
  const buildings = (T.buildings || []).map((b, i) => ({ ...b, cost: BASE[i][0], rate: BASE[i][1] }));
  const builds = (T.builds || []).map((b, i) => ({ ...b, cost: BUILD[i][0], sec: BUILD[i][1] }));
  const rankOf = (total) => RANKS.filter((r) => total >= r).length - 1;

  // ---------- save ----------
  const KEY = "vibeswamp-swamp";
  const fresh = (pondSeen) => ({ v: 1, flies: 0, total: 0, clicks: 0, own: {}, done: {}, run: null, t: Date.now(), pondSeen, rank: 0 });
  let S;
  try { S = JSON.parse(store.get(KEY) || "null"); } catch (e) { S = null; }
  if (!S || S.v !== 1) S = fresh(null);
  if (S.rank == null) S.rank = rankOf(S.total);
  const save = () => { S.t = Date.now(); store.set(KEY, JSON.stringify(S)); };

  const pond = +(store.get("vibeswamp-flies") || 0);
  let note = "";
  const fromPond = Math.max(0, pond - (S.pondSeen ?? 0));
  if (fromPond > 0) { S.flies += fromPond; S.total += fromPond; note = fill(T.pond, { n: fmt(fromPond) }); }
  S.pondSeen = pond;

  // ---------- the economy ----------
  let vibe = 0, vibeUntil = 0, swarmUntil = 0, stormUntil = 0;
  const own = (id) => S.own[id] || 0;
  const priceOf = (b) => Math.ceil(b.cost * Math.pow(GROW, own(b.id)));
  const multOf = (id) => {
    let m = 1;
    for (const [k, ids] of Object.entries(PAIRS)) if (S.done[k] && ids.includes(id)) m *= 2;
    return m;
  };
  const rankMult = () => Math.pow(1.1, rankOf(S.total));
  const swampMult = () => (S.done.seams ? 1.5 : 1) * rankMult();
  const baseRate = () => buildings.reduce((sum, b) => sum + own(b.id) * b.rate * multOf(b.id), 0) * swampMult();
  const vibePct = () => (S.done.track ? 50 : 25);
  const radioOn = () => !!VS().playing;
  const rate = () => baseRate() * (radioOn() ? 1 + vibePct() / 100 : 1) * (now() < swarmUntil ? 5 : 1);
  const perClick = () => ((S.done.bug ? 2 : 1) + (S.done.friday ? baseRate() * 0.03 : 0)) * (now() < vibeUntil ? 3 : 1) * (now() < stormUntil ? 7 : 1);

  // away: half of the calm catch, two hours at most
  const away = Math.min(2 * 3600, Math.max(0, (Date.now() - (S.t || Date.now())) / 1000));
  if (away > 60 && baseRate() > 0) {
    const got = baseRate() * away * 0.5;
    S.flies += got; S.total += got;
    note = [note, fill(T.away, { n: fmt(got) })].filter(Boolean).join(" ");
  }

  // ---------- the page ----------
  const pic = (id) => `/brand/swamp/${id}.webp`;
  const outfitPic = (r) => (OUTFIT[r] ? `/brand/klyop/${OUTFIT[r]}.webp` : "/brand/klyop-full.webp");
  const FLY = '<svg viewBox="0 0 16 12" aria-hidden="true"><ellipse class="fly-wing" cx="5" cy="4" rx="3.4" ry="2.2"/><ellipse class="fly-wing" cx="11" cy="4" rx="3.4" ry="2.2"/><ellipse class="fly-body" cx="8" cy="7.5" rx="3.2" ry="2.6"/></svg>';
  host.innerHTML = `<div class="sw-grid">
<section class="sw-scene" aria-label="${T.click}">
<div class="sw-world">
<div class="sw-houses" aria-hidden="true"></div>
<div class="sw-flies" aria-hidden="true"></div>
<button type="button" class="sw-klyop" aria-label="${T.click}"><img class="sw-k" src="/brand/klyop-full.webp" alt="" decoding="async"></button>
<div class="sw-pops" aria-hidden="true"></div>
<p class="sw-say" aria-live="polite"></p>
</div>
<div class="sw-hud">
<div class="sw-gauge"><p class="sw-count"><span class="sw-num num">0</span> <span class="sw-unit">${T.flies}</span></p><p class="sw-rate"><span class="num sw-rate-n">0</span> ${T.perSec}</p></div>
<div class="sw-rank"><img class="sw-rank-img" src="${outfitPic(0)}" alt="" decoding="async"><div class="sw-rank-txt"><p class="sw-rank-t">${T.rank} <span class="num sw-rank-no">1</span></p><p class="sw-rank-name"></p><span class="sw-rank-bar" aria-hidden="true"><span></span></span><p class="sw-rank-next"></p></div></div>
</div>
<div class="sw-low">
<div class="sw-meter" title="${T.vibeHint}"><span class="sw-meter-l">${T.vibe}</span><span class="sw-meter-bar"><span></span></span></div>
<p class="sw-hint">${T.clickHint}: <span class="num sw-per">1</span> ${T.perClick}</p>
</div>
</section>
<section class="sw-shop">
<h2>${T.shop}</h2>
<ol class="sw-list">${buildings.map((b) => `<li><button type="button" class="sw-buy" data-id="${b.id}"><img class="sw-pic" src="${pic(b.id)}" alt="" loading="lazy" decoding="async"><span class="sw-what"><span class="sw-name">${b.name}</span><span class="sw-text">${b.text}</span></span><span class="sw-price"><span class="num sw-cost"></span><span class="sw-own"></span></span></button></li>`).join("")}</ol>
<h2>${T.projects}</h2>
<ol class="sw-list sw-builds">${builds.map((b) => `<li><button type="button" class="sw-build" data-id="${b.id}"><span class="sw-what"><span class="sw-name">${b.name}</span><span class="sw-text">${b.text}</span></span><span class="sw-price"><span class="num sw-cost">${fmt(b.cost)}</span><span class="sw-state"></span></span><span class="sw-bar" aria-hidden="true"><span></span></span></button></li>`).join("")}</ol>
</section>
</div>
<p class="sw-vibe"></p>
<p class="sw-foot"><span class="sw-stats"></span><button type="button" class="sw-reset">${T.reset}</button></p>`;

  const $ = (s) => host.querySelector(s);
  const scene = $(".sw-scene"), world = $(".sw-world"), houses = $(".sw-houses"), fliesEl = $(".sw-flies");
  const num = $(".sw-num"), rateN = $(".sw-rate-n"), per = $(".sw-per"), say = $(".sw-say"), vibeEl = $(".sw-vibe"), stats = $(".sw-stats");
  const btn = $(".sw-klyop"), kImg = $(".sw-k"), pops = $(".sw-pops");
  const meter = $(".sw-meter-bar span"), meterBox = $(".sw-meter");
  const rankImg = $(".sw-rank-img"), rankNo = $(".sw-rank-no"), rankName = $(".sw-rank-name"), rankBar = $(".sw-rank-bar span"), rankNext = $(".sw-rank-next"), rankBox = $(".sw-rank");
  const buyBtns = [...host.querySelectorAll(".sw-buy")], buildBtns = [...host.querySelectorAll(".sw-build")];

  let sayTimer = 0;
  const speak = (s) => { if (!s) return; say.textContent = s; say.classList.add("on"); clearTimeout(sayTimer); sayTimer = setTimeout(() => say.classList.remove("on"), 3400); };
  const sayRandom = () => speak(T.say[Math.floor(Math.random() * T.say.length)]);

  // ---------- Klyop's frames ----------
  const ANIM = "/brand/klyop/anim/";
  let A = null;
  const K = { seq: null, talkUntil: 0, talkI: 0, lastInput: now(), asleep: false };
  const has = (a) => !!(A && A[a]);
  const warmed = new Set();
  const warmAction = (name) => {
    if (!A || !A[name] || warmed.has(name)) return;
    warmed.add(name);
    for (const n of A[name].frames) { const i = new Image(); i.src = `${ANIM}${n}.webp`; }
  };
  const pickA = (names) => names.find(has);
  const frame = (name) => { const src = `${ANIM}${name}.webp`; if (kImg.getAttribute("src") !== src) kImg.src = src; };
  const playK = (action, { order, loop = false, base = false, then } = {}) => {
    const a = A && A[action];
    if (!a) return false;
    warmAction(action);
    const idx = (order || a.frames.map((_, i) => i)).filter((i) => i < a.frames.length);
    K.seq = { action, names: idx.map((i) => a.frames[i]), ms: idx.map((i) => a.ms[i] || 120), i: 0, at: now() + (a.ms[idx[0]] || 120), loop, base, then };
    frame(K.seq.names[0]);
    return true;
  };
  const baseWanted = () => (K.asleep ? "sleep" : radioOn() && now() - K.lastInput > 1500 && has("dance") ? "dance" : "idle");
  const startBase = (want) => {
    if (want === "sleep") playK("sleep", { order: A.sleep.loop || [2, 3], loop: true, base: true });
    else playK(want, { loop: true, base: true });
  };
  const kEvent = (names, opts = {}) => {
    if (!A || calm) return;
    const a = pickA(names);
    if (!a) return;
    K.lastInput = now(); K.asleep = false; K.talkUntil = 0;
    playK(a, opts);
  };
  const kTick = (t) => {
    requestAnimationFrame(kTick);
    if (!A || document.hidden) return;
    const s = K.seq;
    if (s && t >= s.at) {
      s.i++;
      if (s.i >= s.names.length) {
        if (s.loop) s.i = 0;
        else { K.seq = null; s.then?.(); }
      }
      if (K.seq === s) {
        // he blinks at uneven times
        s.at = t + (s.action === "idle" && s.i === 0 ? rnd(1200, 3800) : s.ms[s.i]);
        frame(s.names[s.i]);
      }
    }
    if (t < K.talkUntil) return;
    if (!K.asleep && t - K.lastInput > 45000 && (!K.seq || K.seq.base) && has("sleep")) {
      K.asleep = true;
      playK("sleep", { order: A.sleep.down || [0, 1], then: () => startBase("sleep") });
      return;
    }
    if (!K.seq) startBase(baseWanted());
    else if (K.seq.base && K.seq.action !== baseWanted()) startBase(baseWanted());
  };
  if (calm) {
    fetch(`${ANIM}anim.json`).then((r) => (r.ok ? r.json() : null)).then((m) => { if (m?.idle) frame(m.idle.frames[0]); }).catch(() => {});
  } else {
    fetch(`${ANIM}anim.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        if (!m || !m.idle) return;
        A = m;
        // frames load per action (about 3 MB in all): standing and croaking at once, the rest on the first click
        warmAction("idle"); warmAction(pickA(["croak", "type", "laugh"]));
        btn.addEventListener("pointerdown", () => Object.keys(A).forEach(warmAction), { once: true });
        scene.classList.add("framed");
        requestAnimationFrame(kTick);
      })
      .catch(() => {});
  }
  // a click: his mouth moves with every croak (frames "croak" or "type" from the mascot chat when they exist, laugh till then)
  const kClick = () => {
    const t = now();
    K.lastInput = t;
    if (!A || calm) { btn.classList.remove("croak"); void btn.offsetWidth; btn.classList.add("croak"); return; }
    if (K.asleep) { K.asleep = false; playK("sleep", { order: A.sleep.up || [1, 0] }); speak(T.woke); return; }
    if (K.seq && !K.seq.base) return;   // a reaction (wave, jump, fly, tea) plays to the end
    const talk = pickA(["croak", "type", "laugh"]);
    if (!talk) return;
    K.seq = null;
    K.talkI = (K.talkI + 1) % A[talk].frames.length;
    frame(A[talk].frames[K.talkI]);
    K.talkUntil = t + 280;
  };

  // ---------- the scene: buildings stand in the swamp, flies buzz around ----------
  const drawHouses = (fresh) => {
    houses.innerHTML = buildings
      .filter((b) => own(b.id) > 0)
      .map((b) => {
        const [cx, bottom, h, z] = SPOT[b.id] || [50, 0, 20, 1];
        const n = own(b.id), grow = 1 + Math.min(0.3, Math.log10(n) * 0.16);
        return `<div class="sw-house${b.id === fresh ? " new" : ""}" data-id="${b.id}" style="left:${cx}%;bottom:${bottom}%;height:${(h * grow).toFixed(1)}%;z-index:${z}"><img src="${pic(b.id)}" alt="" decoding="async">${n > 1 ? `<span class="sw-n num">×${n}</span>` : ""}</div>`;
      })
      .join("");
  };
  const drawFlies = () => {
    const want = Math.max(2, Math.min(22, 2 + Math.floor(Math.log2(rate() + 1) * 1.5)));
    while (fliesEl.childElementCount < want) {
      const f = document.createElement("span");
      f.className = "sw-fly";
      f.innerHTML = FLY;
      f.style.cssText = `left:${rnd(4, 92).toFixed(1)}%;top:${rnd(18, 70).toFixed(1)}%;--dx:${rnd(-90, 90).toFixed(0)}px;--dy:${rnd(-50, 50).toFixed(0)}px;--d:${rnd(2.6, 6).toFixed(2)}s;animation-delay:-${rnd(0, 5).toFixed(2)}s`;
      fliesEl.append(f);
    }
    while (fliesEl.childElementCount > want) fliesEl.lastChild.remove();
  };

  // ---------- render ----------
  const render = () => {
    num.textContent = fmt(S.flies);
    rateN.textContent = fmtRate(rate());
    per.textContent = fmtRate(perClick());
    vibeEl.textContent = fill(radioOn() ? T.vibeOn : T.vibeOff, { p: vibePct() });
    vibeEl.classList.toggle("on", radioOn());
    stats.textContent = fill(T.stats, { n: fmt(S.total), c: whole.format(S.clicks) });
    // the vibe meter: fills with quick clicks, then counts the vibe down
    const t = now();
    const vibing = t < vibeUntil;
    meter.style.width = `${(vibing ? (vibeUntil - t) / 8000 : vibe) * 100}%`;
    meterBox.classList.toggle("full", vibing);
    scene.classList.toggle("vibing", vibing);
    scene.classList.toggle("swarm", t < swarmUntil);
    scene.classList.toggle("storm", t < stormUntil);
    // rank
    const r = rankOf(S.total);
    rankNo.textContent = r + 1;
    rankName.textContent = (T.ranks || [])[r] || "";
    if (rankImg.getAttribute("src") !== outfitPic(r)) rankImg.src = outfitPic(r);
    if (r < RANKS.length - 1) {
      rankBar.style.width = `${Math.min(100, (100 * (S.total - RANKS[r])) / (RANKS[r + 1] - RANKS[r]))}%`;
      rankNext.textContent = fill(T.rankNext, { n: fmt(RANKS[r + 1] - S.total) });
    } else { rankBar.style.width = "100%"; rankNext.textContent = T.rankMax; }
    // the shop: what you have, plus one silhouette of what comes next
    let teaser = false;
    buildings.forEach((b, i) => {
      const el = buyBtns[i], price = priceOf(b);
      const seen = own(b.id) > 0 || S.total >= b.cost * 0.4 || i === 0;
      const show = seen || !teaser;
      if (!seen) teaser = true;
      el.parentElement.hidden = !show;
      el.classList.toggle("hidden-thing", !seen);
      el.classList.toggle("can", seen && S.flies >= price);
      el.querySelector(".sw-name").textContent = seen ? b.name : T.locked;
      el.querySelector(".sw-text").textContent = seen ? b.text : "";
      el.querySelector(".sw-cost").textContent = fmt(price);
      el.querySelector(".sw-own").textContent = own(b.id) ? `${T.owned}: ${own(b.id)}` : "";
      el.disabled = !seen || S.flies < price;
    });
    builds.forEach((b, i) => {
      const el = buildBtns[i];
      const prevDone = i === 0 || S.done[builds[i - 1].id];
      el.parentElement.hidden = !(S.done[b.id] || prevDone || S.total >= b.cost * 0.3);
      const running = S.run && S.run.id === b.id;
      el.classList.toggle("done", !!S.done[b.id]);
      el.classList.toggle("running", !!running);
      el.classList.toggle("can", !S.done[b.id] && !S.run && S.flies >= b.cost);
      el.querySelector(".sw-state").textContent = S.done[b.id] ? T.done : running ? T.running : "";
      el.querySelector(".sw-cost").hidden = !!(S.done[b.id] || running);
      el.querySelector(".sw-bar span").style.width = running ? `${Math.min(100, (100 * (Date.now() - S.run.start)) / (b.sec * 1000))}%` : S.done[b.id] ? "100%" : "0%";
      el.disabled = !!(S.done[b.id] || S.run || S.flies < b.cost);
    });
  };

  // ---------- pops and rings ----------
  const pop = (text, x, y, cls = "") => {
    if (calm || pops.childElementCount > 40) return;
    const p = document.createElement("span");
    p.className = `sw-pop num ${cls}`;
    p.textContent = text;
    p.style.left = `${x}px`; p.style.top = `${y}px`;
    pops.append(p);
    setTimeout(() => p.remove(), 1000);
  };
  const ring = (x, y) => {
    if (calm) return;
    const r = document.createElement("span");
    r.className = "sw-ring";
    r.style.left = `${x}px`; r.style.top = `${y}px`;
    pops.append(r);
    setTimeout(() => r.remove(), 600);
  };

  // ---------- croak ----------
  btn.addEventListener("click", (e) => {
    const t = now();
    if (t >= vibeUntil) {
      vibe = Math.min(1, vibe + 0.08);
      if (vibe >= 1) { vibe = 0; vibeUntil = t + 8000; speak(T.vibeGo); VS().sound?.("splash"); }
    }
    const v = perClick();
    S.flies += v; S.total += v; S.clicks++;
    const r = world.getBoundingClientRect();
    const x = e.clientX ? e.clientX - r.left : r.width / 2, y = e.clientY ? e.clientY - r.top : r.height / 2;
    pop(`+${fmtRate(v)}`, x, y, t < vibeUntil || t < stormUntil ? "hot" : "");
    ring(x, y);
    kClick();
    VS().sound?.("plop");
    if (S.clicks % 60 === 0) sayRandom();
    render();
  });

  host.addEventListener("click", (e) => {
    const buy = e.target.closest(".sw-buy");
    if (buy && !buy.disabled) {
      const b = buildings.find((x) => x.id === buy.dataset.id);
      const price = priceOf(b);
      if (S.flies >= price) {
        S.flies -= price; S.own[b.id] = own(b.id) + 1;
        VS().sound?.("land");
        K.lastInput = now();
        if (own(b.id) === 1) { sayRandom(); kEvent(["wave"], { order: A?.wave?.order || [0, 1, 2, 3, 2, 3, 1, 0] }); }
        drawHouses(own(b.id) === 1 ? b.id : null); render(); save();
      }
      return;
    }
    const bld = e.target.closest(".sw-build");
    if (bld && !bld.disabled) {
      const b = builds.find((x) => x.id === bld.dataset.id);
      if (S.flies >= b.cost && !S.run) {
        S.flies -= b.cost; S.run = { id: b.id, start: Date.now() };
        VS().sound?.("tick");
        K.lastInput = now();
        speak(T.say[3]);
        render(); save();
      }
    }
  });

  $(".sw-reset").addEventListener("click", () => {
    if (!confirm(T.resetAsk)) return;
    S = fresh(pond);
    drawHouses(); render(); save();
  });

  // ---------- the fat fly: every 25-55 s it crosses the swamp. Catch it: a pile of flies, a swarm or a croak storm ----------
  const fat = () => {
    if (document.hidden) return later();
    const f = document.createElement("button");
    f.type = "button"; f.className = "sw-fat"; f.setAttribute("aria-label", "+");
    f.innerHTML = FLY;
    const w = world.clientWidth, h = world.clientHeight;
    f.style.top = `${rnd(0.12, 0.55) * h}px`;
    world.append(f);
    const fly = f.animate([{ transform: "translate(-50px, 0)" }, { transform: `translate(${w * 0.35}px, -40px)` }, { transform: `translate(${w * 0.7}px, 30px)` }, { transform: `translate(${w + 50}px, -10px)` }],
      { duration: calm ? 13000 : 9000, easing: "linear" });
    fly.onfinish = () => { f.remove(); later(); };
    f.addEventListener("click", (e) => {
      e.stopPropagation();
      const roll = Math.random();
      if (roll < 0.5) {
        const got = Math.max(30, baseRate() * 30 + perClick() * 20);
        S.flies += got; S.total += got;
        speak(fill(T.fat, { n: fmt(got) }));
      } else if (roll < 0.75) { swarmUntil = now() + 15000; speak(T.swarm); }
      else { stormUntil = now() + 10000; speak(T.storm); }
      VS().sound?.("croak");
      kEvent(["fly"]);
      fly.cancel(); f.remove(); render(); save(); later();
    });
  };
  const later = () => setTimeout(fat, rnd(25, 55) * 1000);
  later();

  // ---------- buildings at work: now and then one of them bounces and brings its catch ----------
  setInterval(() => {
    if (document.hidden || calm) return;
    const mine = [...houses.children];
    if (!mine.length) return;
    const h = mine[Math.floor(Math.random() * mine.length)];
    const b = buildings.find((x) => x.id === h.dataset.id);
    h.classList.remove("work"); void h.offsetWidth; h.classList.add("work");
    const wr = world.getBoundingClientRect(), hr = h.getBoundingClientRect();
    pop(`+${fmtRate(own(b.id) * b.rate * multOf(b.id) * swampMult() * 1.6)}`, hr.left - wr.left + hr.width / 2, hr.top - wr.top + 6, "small");
  }, 1600);

  // ---------- the clock ----------
  let last = now();
  const tick = () => {
    const t = now(), dt = Math.min(5, (t - last) / 1000);
    last = t;
    const got = rate() * dt;
    S.flies += got; S.total += got;
    if (t >= vibeUntil) vibe = Math.max(0, vibe - 0.15 * dt);
    if (S.run) {
      const b = builds.find((x) => x.id === S.run.id);
      if (!b) S.run = null;
      else if (Date.now() - S.run.start >= b.sec * 1000) {
        S.done[b.id] = true; S.run = null;
        speak(`${T.done}: ${b.name}`); VS().sound?.("splash");
        kEvent(["tea"]);
        save();
      }
    }
    const r = rankOf(S.total);
    if (r > S.rank) {
      S.rank = r;
      speak(fill(T.rankUp, { r: (T.ranks || [])[r] || "" }));
      VS().sound?.("croak");
      kEvent(["jump"]);
      rankBox.classList.remove("up"); void rankBox.offsetWidth; rankBox.classList.add("up");
      save();
    }
    render();
  };
  setInterval(tick, 250);
  setInterval(drawFlies, 2000);
  setInterval(save, 5000);
  addEventListener("pagehide", save);
  document.addEventListener("vibeswamp:radio", render);
  if (note) speak(note);
  drawHouses(); drawFlies(); render(); save();
})();
