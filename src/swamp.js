import { RANKS, rankOf, priceOf as buildingPrice, producerMultiplier, swampMultiplier, baseRate as calculateBaseRate,
  incomeRate, clickValue, buyBuilding, buyStage, roomOpen, startProject, finishProject, achievementChecks } from "./swamp/engine.mjs";
import { freshSave, loadSave, persistSave } from "./swamp/save.mjs";
import { createScene } from "./swamp/scene.mjs";
import { expeditionContext, reserveExpedition, settleExpedition } from "./swamp/expedition-save.mjs";

// Klyop builds the swamp: a light clicker with the site toad. Texts come from content/swamp.json (built into the page),
// the save lives in localStorage ("vibeswamp-swamp"). Flies caught in the pond on the home page come in here too.
// Pictures: public/brand/swamp/ (the eight buildings and the dusk swamp, Codex image_gen, 07.11.2026). Klyop moves with
// the same frames as the pet (public/brand/klyop/anim/anim.json); new actions from the mascot chat are picked up by name
// ("croak" or "type" for clicking, if they appear), and without the frames he stands still and squashes on a click.
function startClicker(host, textEl, lockedStorage) {
  const T = JSON.parse(textEl.textContent || "{}");
  const D = JSON.parse(document.getElementById("swamp-v2-data").textContent);
  const V = T.v2, U = V.ui;
  const lang = document.documentElement.lang;
  const locale = { uk: "uk-UA", ru: "ru-RU" }[lang] || "en-GB";
  const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const tenth = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const precise = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const big = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 2 });
  const fmt = (n) => (n >= 1e6 ? big.format(n) : whole.format(Math.floor(n)));
  const fmtRate = (n) => (n >= 1e6 ? big.format(n) : n < 10 ? tenth.format(n) : whole.format(n));
  const fill = (s, o) => String(s ?? "").replace(/\{(\w+)\}/g, (_, k) => o[k]);
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  };
  const VS = () => window.VibeSwamp || {};
  const now = () => performance.now();
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ---------- economy data and translations share stable ids ----------
  const OUTFIT = ["", "rimworld", "miner", "night-shift", "welder", "chemist", "climber", "lantern", "streamer"];
  const buildings = D.buildings.map((building) => ({ ...building, ...T.buildings.find((item) => item.id === building.id) }));
  const builds = D.builds.map((project) => ({ ...project, ...T.builds.find((item) => item.id === project.id) }));

  // ---------- save ----------
  let S, storage;
  try { storage = window.localStorage; S = loadSave(storage, D); }
  catch (error) { host.textContent = V.saveProblem; return; }
  let saveWarning = false, hiddenAt = document.hidden ? Date.now() : 0;
  let writeOwner = true, survivorsActive = false;
  const save = () => {
    if (!writeOwner) return;
    if (hiddenAt) {
      const time = Date.now();
      const caught = calculateBaseRate(S, D) * Math.min(7200, Math.max(0, (time - hiddenAt) / 1000)) * 0.5;
      S.flies += caught; S.total += caught; hiddenAt = time;
    }
    try { persistSave(storage, S); saveWarning = false; }
    catch (error) { saveWarning = true; }
    const status = host.querySelector(".sw-save-status");
    if (status) { status.textContent = saveWarning ? V.saveWarning : ""; status.hidden = !saveWarning; }
  };

  const pondValue = +(store.get("vibeswamp-flies") || 0);
  const pond = Number.isFinite(pondValue) ? Math.max(0, pondValue) : 0;
  let note = "";
  const fromPond = Math.max(0, pond - (S.pondSeen ?? 0));
  if (fromPond > 0) { S.flies += fromPond; S.total += fromPond; note = fill(T.pond, { n: fmt(fromPond) }); }
  S.pondSeen = pond;

  // ---------- the economy ----------
  let vibe = 0, vibeUntil = 0, swarmUntil = 0, stormUntil = 0;
  const own = (id) => S.own[id] || 0;
  const priceOf = (b) => buildingPrice(S, b, D);
  const multOf = (id) => producerMultiplier(S, id, D);
  const swampMult = () => swampMultiplier(S);
  const baseRate = () => calculateBaseRate(S, D);
  const vibePct = () => (S.done.track ? 50 : 25);
  const radioOn = () => !!VS().playing;
  const boosts = () => ({ radio: radioOn(), swarm: now() < swarmUntil, tea: Date.now() < S.activities.teaUntil });
  const rate = () => incomeRate(S, D, boosts());
  const perClick = () => clickValue(S, D, { vibe: now() < vibeUntil, storm: now() < stormUntil });
  const gardenReward = () => Math.max(15, baseRate() * D.activities.garden.rewardSeconds);
  const compileReward = () => Math.max(30, baseRate() * D.activities.compile.rewardSeconds);
  const flyReward = (count) => Math.max(1, baseRate() * 2, perClick()) * count;

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
  host.classList.add("sw-shell");
  host.classList.toggle("sw-paused", document.hidden);
  host.innerHTML = `<div class="sw-grid">
<section class="sw-scene" aria-label="${T.click}">
<div class="sw-hud">
<div class="sw-gauge"><p class="sw-count"><span class="sw-num num">0</span> <span class="sw-unit">${T.flies}</span></p><p class="sw-rate"><span class="num sw-rate-n">0</span> ${T.perSec}</p><p class="sw-income-detail"></p></div>
<div class="sw-rank"><img class="sw-rank-img" src="${outfitPic(0)}" alt="" decoding="async"><div class="sw-rank-txt"><p class="sw-rank-t">${T.rank} <span class="num sw-rank-no">1</span></p><p class="sw-rank-name"></p><progress class="sw-rank-bar" max="100" value="0" aria-label="${T.rank}"></progress><p class="sw-rank-next"></p><p class="sw-rank-bonus">${U.rankBonus}</p></div></div>
</div>
<div class="sw-world">
<div class="sw-backdrop" aria-hidden="true"></div>
<div class="sw-sky" aria-hidden="true"><span class="sw-sun"></span><span class="sw-cloud sw-cloud-a"></span><span class="sw-cloud sw-cloud-b"></span></div>
<div class="sw-water" aria-hidden="true"></div><div class="sw-reflection" aria-hidden="true"></div>
<div class="sw-room-wall" aria-hidden="true"></div><div class="sw-room-floor" aria-hidden="true"></div>
<div class="sw-shelter" aria-hidden="true"></div><div class="sw-fireflies" aria-hidden="true">${Array.from({ length: 7 }, (_, i) => `<i style="--i:${i}"></i>`).join("")}</div>
<div class="sw-houses" aria-hidden="true"></div>
<div class="sw-flies"></div>
<button type="button" class="sw-klyop"><img class="sw-k" src="/brand/klyop-full.webp" alt="" draggable="false" decoding="async"><span class="sw-croak">${U.croak} <span class="num sw-per">+1</span></span></button>
<div class="sw-pops" aria-hidden="true"></div>
<p class="sw-say" aria-live="polite"></p>
</div>
<div class="sw-stage-brief"><span class="sw-stage-label"></span><button type="button" class="sw-stage-next"></button></div>
<nav class="sw-doors" aria-label="${U.locations}"></nav>
<div class="sw-low">
<div class="sw-meter"><span class="sw-meter-l">${T.vibe}</span><span class="sw-meter-bar" aria-hidden="true"><span></span></span></div>
<p class="sw-hint">${T.vibeHint}</p><p class="sw-hint">${U.catchHint}</p>
</div>
<div class="sw-activities">
<button type="button" data-activity="garden" title="${V.plant}"><span aria-hidden="true">❧</span><span class="sw-action-name">${V.garden}</span><small></small></button>
<button type="button" data-activity="compile"><span aria-hidden="true">⌘</span><span class="sw-action-name">${V.compile}</span><small></small><progress max="10" value="0" aria-label="${V.compile}" hidden></progress></button>
<button type="button" data-activity="tea"><span aria-hidden="true">♨</span><span class="sw-action-name">${V.tea}</span><small></small></button>
<button type="button" data-activity="tongue"><span aria-hidden="true">↝</span><span class="sw-action-name">${V.tongue}</span><small></small></button>
</div>
<div class="sw-radio-boost" hidden><button type="button" class="sw-radio-toggle"></button><span class="sw-radio-detail"></span></div>
</section>
<section class="sw-shop" aria-labelledby="sw-management">
<h2 id="sw-management">${U.management}</h2>
<div class="sw-tabs" role="tablist" aria-label="${U.management}">${Object.entries(V.tabs).map(([id, name], i) => `<button type="button" role="tab" id="sw-tab-${id}" aria-controls="sw-panel-${id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-tab="${id}">${name}</button>`).join("")}</div>
<div class="sw-panel" id="sw-panel-shop" role="tabpanel" aria-labelledby="sw-tab-shop" tabindex="0">
<ol class="sw-list">${buildings.map((b) => `<li><article class="sw-buy" data-id="${b.id}"><img class="sw-pic" src="${pic(b.id)}" alt="" draggable="false" loading="lazy" decoding="async"><div class="sw-what"><h3 class="sw-name">${b.name}</h3><p class="sw-text">${b.text}</p><p class="sw-gain"></p><p class="sw-room-tag">${V.rooms[b.room]}</p></div><div class="sw-price"><button type="button" class="sw-buy-action"></button><span class="sw-own"></span></div></article></li>`).join("")}</ol>
</div>
<div class="sw-panel" id="sw-panel-construction" role="tabpanel" aria-labelledby="sw-tab-construction" tabindex="0" hidden>
<p class="sw-stage-progress"></p><button type="button" class="sw-construct"><span class="sw-stage-preview" aria-hidden="true">⌂</span><span class="sw-what"><span class="sw-name">${V.nextStep}</span><span class="sw-text sw-stage-gate"></span></span><span class="sw-price"><span class="sw-stage-cost num"></span><span>${V.buildStage}</span></span></button>
<ol class="sw-stage-history"></ol><h2>${V.projects}</h2>
<ol class="sw-list sw-builds">${builds.map((b) => `<li><button type="button" class="sw-build" data-id="${b.id}"><span class="sw-what"><span class="sw-name">${b.name}</span><span class="sw-text">${b.text}</span></span><span class="sw-price"><span class="num sw-cost">${fmt(b.cost)}</span><span class="sw-state"></span></span><span class="sw-bar" aria-hidden="true"><span></span></span></button></li>`).join("")}</ol>
</div>
<div class="sw-panel" id="sw-panel-achievements" role="tabpanel" aria-labelledby="sw-tab-achievements" tabindex="0" hidden><p class="sw-ach-count"></p><ol class="sw-ach-list">${D.achievements.map((a) => `<li class="sw-ach locked" data-ach="${a.id}"><img src="${pic(a.icon)}" alt="" draggable="false"><span><strong>${V.achievements[a.id][0]}</strong><small>${V.achievements[a.id][1]}</small><small class="sw-ach-status">${V.lockedAchievement}</small></span></li>`).join("")}</ol></div>
<div class="sw-panel" id="sw-panel-records" role="tabpanel" aria-labelledby="sw-tab-records" tabindex="0" hidden><h2>${U.statsLocal}</h2><dl class="sw-records">${Object.entries(U.stats).map(([id, label]) => `<div><dt>${label}</dt><dd class="num" data-sw-stat="${id}"></dd></div>`).join("")}</dl></div>
</section>
</div>
<p class="sw-foot"><span class="sw-stats"></span><button type="button" class="sw-reset">${T.reset}</button></p>
<p class="sw-save-status" role="status" hidden></p><p class="sw-toast" role="status" hidden></p>`;

  const $ = (s) => host.querySelector(s);
  const scene = $(".sw-scene"), world = $(".sw-world"), houses = $(".sw-houses"), fliesEl = $(".sw-flies");
  const num = $(".sw-num"), rateN = $(".sw-rate-n"), per = $(".sw-per"), say = $(".sw-say"), stats = $(".sw-stats");
  const incomeDetail = $(".sw-income-detail");
  const radioControl = document.querySelector(".radio .r-play");
  const radioToggle = $(".sw-radio-toggle"), radioDetail = $(".sw-radio-detail");
  $(".sw-radio-boost").hidden = !radioControl;
  radioToggle.addEventListener("click", () => radioControl?.click());
  const records = [...host.querySelectorAll("[data-sw-stat]")];
  const btn = $(".sw-klyop"), kImg = $(".sw-k"), pops = $(".sw-pops");
  const meter = $(".sw-meter-bar span"), meterBox = $(".sw-meter");
  const rankImg = $(".sw-rank-img"), rankNo = $(".sw-rank-no"), rankName = $(".sw-rank-name"), rankBar = $(".sw-rank-bar"), rankNext = $(".sw-rank-next"), rankBox = $(".sw-rank"), rankBonus = $(".sw-rank-bonus");
  const buyCards = [...host.querySelectorAll(".sw-buy")], buildBtns = [...host.querySelectorAll(".sw-build")];
  host.addEventListener("dragstart", (event) => event.preventDefault());
  const producerLabels = Object.fromEntries(buildings.map(({ id, name }) => [id, name]));
  const drawScene = createScene({ world, houses, doors: $(".sw-doors"), stageStatus: $(".sw-stage-brief"), data: D, text: V, producerLabels, onRoom: (room) => {
    if (!roomOpen(S, D, room) || S.room === room) return;
    S.room = room;
    if (!S.visited.includes(room)) S.visited.push(room);
    kEvent(["walk", "wave"]);
    drawScene(S); render(); save();
  } });

  const tabs = [...host.querySelectorAll("[role=tab]")];
  const selectTab = (tab) => {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected)); item.tabIndex = selected ? 0 : -1;
      $(`#sw-panel-${item.dataset.tab}`).hidden = !selected;
    }
  };
  $(".sw-tabs").addEventListener("click", (event) => { const tab = event.target.closest("[role=tab]"); if (tab) selectTab(tab); });
  $(".sw-stage-next").addEventListener("click", () => {
    const tab = $("#sw-tab-construction");
    selectTab(tab); tab.focus();
  });
  $(".sw-tabs").addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.indexOf(document.activeElement);
    let next = event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : (index + 1) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    selectTab(tabs[next]); tabs[next].focus();
  });

  let sayTimer = 0;
  const speak = (s) => { if (!s) return; say.textContent = s; say.classList.add("on"); clearTimeout(sayTimer); sayTimer = setTimeout(() => say.classList.remove("on"), 3400); };
  const sayRandom = () => speak(T.say[Math.floor(Math.random() * T.say.length)]);

  // ---------- Klyop's frames ----------
  const ANIM = "/brand/klyop/anim/";
  let A = null;
  const K = { seq: null, events: [], raf: 0, talkUntil: 0, talkI: 0, lastInput: now(), asleep: false };
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
    if (!A) return;
    if (calm) { const action = pickA(names); if (action) frame(A[action].frames[0]); return; }
    const a = pickA(names);
    if (!a) return;
    K.lastInput = now(); K.asleep = false; K.talkUntil = 0;
    if (K.seq && !K.seq.base) { if (K.events.length < 4) K.events.push({ names, opts }); return; }
    playK(a, opts);
  };
  const kTick = (t) => {
    K.raf = 0;
    if (!A || document.hidden || survivorsActive) return;
    K.raf = requestAnimationFrame(kTick);
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
    if (!K.seq && K.events.length) { const event = K.events.shift(); kEvent(event.names, event.opts); }
    if (!K.seq) startBase(baseWanted());
    else if (K.seq.base && K.seq.action !== baseWanted()) startBase(baseWanted());
  };
  if (calm) {
    fetch(`${ANIM}anim.json`).then((r) => (r.ok ? r.json() : null)).then((m) => {
      if (m?.idle) { A = m; frame(m.idle.frames[0]); scene.classList.add("framed"); }
    }).catch(() => {});
  } else {
    fetch(`${ANIM}anim.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        if (!m || !m.idle) return;
        A = m;
        // frames load per action (about 3 MB in all): standing and croaking at once, the rest on the first click
        warmAction("idle"); warmAction(pickA(["croak", "type", "laugh"]));
        scene.classList.add("framed");
        K.raf = requestAnimationFrame(kTick);
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

  // ---------- scene and ordinary flies ----------
  const drawHouses = (fresh) => drawScene(S, fresh);
  let nextFlyAt = 0, fliesStarted = false;
  const drawFlies = () => {
    if (document.hidden || survivorsActive) return;
    const want = Math.max(2, Math.min(10, 2 + Math.floor(Math.log2(rate() + 1) * 0.7)));
    if (now() < nextFlyAt) return;
    const count = fliesStarted ? Math.min(want, fliesEl.childElementCount + 1) : want;
    while (fliesEl.childElementCount < count) {
      const f = document.createElement("button");
      f.type = "button"; f.className = "sw-fly"; f.setAttribute("aria-label", V.fly);
      f.innerHTML = FLY;
      const x = Math.random() < 0.5 ? rnd(6, 22) : rnd(68, 82);
      f.style.cssText = `left:${x.toFixed(1)}%;top:${rnd(22, 53).toFixed(1)}%;--dx:${rnd(-12, 12).toFixed(0)}px;--dy:${rnd(-20, 20).toFixed(0)}px;--d:${rnd(2.6, 6).toFixed(2)}s;animation-delay:-${rnd(0, 5).toFixed(2)}s`;
      f.addEventListener("click", (event) => { event.stopPropagation(); catchFlies([f]); render(); save(); });
      fliesEl.append(f);
    }
    while (fliesEl.childElementCount > want) fliesEl.lastChild.remove();
    fliesStarted = true; nextFlyAt = now() + 6000;
  };

  const toastQueue = [];
  let toastTimer = 0, initialAchievements = true, historyStage = -1;
  const showToast = () => {
    const message = toastQueue.shift();
    if (!message) { $(".sw-toast").hidden = true; toastTimer = 0; return; }
    $(".sw-toast").textContent = message; $(".sw-toast").hidden = false;
    toastTimer = setTimeout(showToast, 2200);
  };
  const checkAchievements = () => {
    let changed = false;
    const checks = achievementChecks(S, D);
    for (const achievement of D.achievements) {
      if (checks[achievement.id] && !S.ach[achievement.id]) {
        S.ach[achievement.id] = Date.now(); changed = true;
        if (!initialAchievements) toastQueue.push(fill(V.achieved, { name: V.achievements[achievement.id][0] }));
      }
      const element = $(`[data-ach="${achievement.id}"]`);
      element.classList.toggle("locked", !S.ach[achievement.id]);
      element.querySelector(".sw-ach-status").textContent = S.ach[achievement.id] ? T.done : V.lockedAchievement;
    }
    initialAchievements = false;
    if (toastQueue.length && !toastTimer) showToast();
    $(".sw-ach-count").textContent = fill(V.achievementCount, { n: D.achievements.filter((a) => S.ach[a.id]).length, max: D.achievements.length });
    if (changed) save();
  };

  const secondsLeft = (time) => Math.max(0, Math.ceil((time - Date.now()) / 1000));
  const renderActivities = () => {
    const activities = S.activities, time = Date.now();
    const garden = $('[data-activity="garden"]');
    garden.disabled = S.stage < 1 || time < activities.gardenReady;
    const gardenDetail = garden.querySelector("small");
    if (S.stage < 1) gardenDetail.textContent = U.gardenLock;
    else if (time < activities.gardenReady) gardenDetail.textContent = fill(V.growing, { n: secondsLeft(activities.gardenReady) });
    else if (activities.gardenReady) gardenDetail.textContent = fill(U.gardenHarvest, { n: fmt(gardenReward()) });
    else gardenDetail.textContent = fill(U.gardenPlant, { s: D.activities.garden.seconds, n: fmt(gardenReward()) });

    const compile = $('[data-activity="compile"]');
    const compiling = activities.compileEnd > 0;
    compile.disabled = S.room !== "workshop" || !own("stump") || compiling || time < activities.compileReady;
    const compileDetail = compile.querySelector("small");
    if (compiling) compileDetail.textContent = fill(V.compiling, { n: secondsLeft(activities.compileEnd) });
    else if (!own("stump")) compileDetail.textContent = U.compileStump;
    else if (S.room !== "workshop") compileDetail.textContent = U.compileRoom;
    else if (time < activities.compileReady) compileDetail.textContent = fill(V.cooldown, { n: secondsLeft(activities.compileReady) });
    else compileDetail.textContent = fill(U.compileReady, { n: fmt(compileReward()), s: D.activities.compile.seconds });
    const progress = compile.querySelector("progress");
    progress.hidden = !compiling; progress.max = D.activities.compile.seconds;
    progress.value = D.activities.compile.seconds - secondsLeft(activities.compileEnd);

    const tea = $('[data-activity="tea"]');
    tea.disabled = time < activities.teaReady;
    const teaPercent = Math.round((D.activities.tea.multiplier - 1) * 100);
    const teaDetail = tea.querySelector("small");
    if (time < activities.teaUntil) teaDetail.textContent = fill(U.teaBenefit, { n: teaPercent, s: secondsLeft(activities.teaUntil) });
    else if (time < activities.teaReady) teaDetail.textContent = fill(V.cooldown, { n: secondsLeft(activities.teaReady) });
    else teaDetail.textContent = fill(U.teaBenefit, { n: teaPercent, s: D.activities.tea.seconds });

    const tongue = $('[data-activity="tongue"]');
    const count = fliesEl.childElementCount;
    tongue.disabled = time < activities.tongueReady || !count;
    const tongueDetail = tongue.querySelector("small");
    if (time < activities.tongueReady) tongueDetail.textContent = fill(V.cooldown, { n: secondsLeft(activities.tongueReady) });
    else tongueDetail.textContent = count ? fill(U.swarmCatch, { c: count, n: fmt(flyReward(count)) }) : U.swarmEmpty;
  };

  // ---------- render ----------
  const render = () => {
    if (survivorsActive) return;
    checkAchievements(); renderActivities(); drawScene(S);
    const next = D.stages[S.stage];
    $(".sw-stage-progress").textContent = fill(V.stageProgress, { n: S.stage, max: D.stages.length });
    const construct = $(".sw-construct");
    construct.disabled = !next || S.total < next.total || S.flies < next.cost;
    construct.classList.toggle("can", !construct.disabled);
    construct.querySelector(".sw-name").textContent = next ? V.stages[next.id] : V.allBuilt;
    $(".sw-stage-cost").textContent = next ? fmt(next.cost) : "";
    $(".sw-stage-gate").textContent = next && S.total < next.total ? fill(V.stageGate, { n: fmt(next.total - S.total) }) : next ? V.soon : "";
    if (historyStage !== S.stage) {
      historyStage = S.stage;
      $(".sw-stage-history").innerHTML = D.stages.slice(0, S.stage).reverse().map((stage) => `<li><span aria-hidden="true">✓</span> ${V.stages[stage.id]}</li>`).join("");
    }
    for (const record of records) record.textContent = whole.format(Math.floor(S[record.dataset.swStat]));
    const modifiers = boosts();
    const passive = baseRate();
    num.textContent = fmt(S.flies);
    rateN.textContent = fmtRate(incomeRate(S, D, modifiers));
    per.textContent = `+${fmtRate(perClick())}`;
    const incomeLines = [fill(U.baseIncome, { n: fmtRate(passive) })];
    if (modifiers.radio) incomeLines.push(fill(U.radioIncome, { n: vibePct() }));
    if (modifiers.tea) incomeLines.push(fill(U.teaIncome, { n: Math.round((D.activities.tea.multiplier - 1) * 100) }));
    if (modifiers.swarm) incomeLines.push(U.swarmIncome);
    incomeDetail.textContent = incomeLines.join(" · ");
    radioToggle.textContent = modifiers.radio ? U.radioStop : U.radioStart;
    radioToggle.setAttribute("aria-pressed", String(modifiers.radio));
    radioDetail.textContent = fill(modifiers.radio ? U.radioIncome : U.radioBenefit, { n: vibePct() });
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
    rankBonus.hidden = r === RANKS.length - 1;
    if (!rankBonus.hidden) {
      rankBar.value = Math.min(100, (100 * (S.total - RANKS[r])) / (RANKS[r + 1] - RANKS[r]));
      rankNext.textContent = fill(T.rankNext, { n: fmt(RANKS[r + 1] - S.total) });
    } else { rankBar.value = 100; rankNext.textContent = T.rankMax; }
    // the shop: what you have, plus one silhouette of what comes next
    let teaser = false;
    buildings.forEach((b, i) => {
      const el = buyCards[i], price = priceOf(b);
      const action = el.querySelector(".sw-buy-action"), gainLabel = el.querySelector(".sw-gain");
      const seen = own(b.id) > 0 || S.total >= b.cost * 0.4 || i === 0;
      const show = seen || !teaser;
      if (!seen) teaser = true;
      el.parentElement.hidden = !show;
      el.classList.toggle("hidden-thing", !seen);
      el.classList.toggle("can", seen && S.flies >= price);
      el.querySelector(".sw-name").textContent = seen ? b.name : T.locked;
      el.querySelector(".sw-text").textContent = seen ? b.text : "";
      action.textContent = fill(U.buy, { n: whole.format(price) });
      gainLabel.hidden = !seen;
      if (seen) {
        const upgraded = { ...S, own: { ...S.own, [b.id]: own(b.id) + 1 } };
        gainLabel.textContent = fill(U.purchaseGain, { n: precise.format(calculateBaseRate(upgraded, D) - passive) });
      }
      el.querySelector(".sw-own").textContent = own(b.id) ? `${T.owned}: ${own(b.id)}` : "";
      action.disabled = !seen || S.flies < price;
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

  const reward = (value, message) => {
    S.flies += value; S.total += value;
    if (message) speak(message);
  };
  const catchFlies = (flies) => {
    const visible = flies.filter((fly) => fly.isConnected);
    if (!visible.length) return;
    const value = flyReward(visible.length);
    const bounds = world.getBoundingClientRect();
    const position = visible[0].getBoundingClientRect();
    visible.forEach((fly) => fly.remove());
    S.caught += visible.length;
    reward(value); pop(`+${fmt(value)}`, position.left - bounds.left + 22, position.top - bounds.top, "small");
    kEvent(["fly"]);
  };
  world.addEventListener("pointerdown", (event) => {
    const bounds = world.getBoundingClientRect();
    if (event.clientY - bounds.top > bounds.height * 0.55) ring(event.clientX - bounds.left, event.clientY - bounds.top);
  });

  $(".sw-activities").addEventListener("click", (event) => {
    const button = event.target.closest("[data-activity]");
    if (!button || button.disabled) return;
    const activity = button.dataset.activity, time = Date.now(), activities = S.activities;
    if (activity === "garden" && S.stage >= 1 && time >= activities.gardenReady) {
      if (activities.gardenReady) {
        reward(gardenReward(), V.gardenSay); activities.gardenReady = 0; kEvent(["wave"]);
      } else activities.gardenReady = time + D.activities.garden.seconds * 1000;
    }
    if (activity === "compile" && S.room === "workshop" && own("stump") && !activities.compileEnd && time >= activities.compileReady) {
      activities.compileEnd = time + D.activities.compile.seconds * 1000;
      activities.compileReady = activities.compileEnd + D.activities.compile.cooldown * 1000;
      kEvent(["type", "tea"]);
    }
    if (activity === "tea" && time >= activities.teaReady) {
      activities.teaUntil = time + D.activities.tea.seconds * 1000;
      activities.teaReady = time + D.activities.tea.cooldown * 1000;
      S.teas++; speak(V.teaSay); kEvent(["tea"]);
    }
    if (activity === "tongue" && time >= activities.tongueReady && fliesEl.childElementCount) {
      catchFlies([...fliesEl.children]); activities.tongueReady = time + D.activities.tongue.cooldown * 1000;
    }
    render(); save();
  });

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
    const buy = e.target.closest(".sw-buy-action");
    if (buy && !buy.disabled) {
      const b = buildings.find((x) => x.id === buy.closest(".sw-buy").dataset.id);
      if (buyBuilding(S, D, b.id)) {
        VS().sound?.("land");
        K.lastInput = now();
        if (own(b.id) === 1) {
          sayRandom(); kEvent(["wave"], { order: A?.wave?.order || [0, 1, 2, 3, 2, 3, 1, 0] });
        }
        drawHouses(own(b.id) === 1 ? b.id : null); render(); save();
      }
      return;
    }
    const bld = e.target.closest(".sw-build");
    if (bld && !bld.disabled) {
      const b = builds.find((x) => x.id === bld.dataset.id);
      if (startProject(S, D, b.id, Date.now())) {
        VS().sound?.("tick");
        K.lastInput = now();
        speak(T.say[3]);
        render(); save();
      }
    }
  });

  $(".sw-construct").addEventListener("click", () => {
    if (!buyStage(S, D)) return;
    speak(V.stages[D.stages[S.stage - 1].id]); kEvent(["wave", "jump"]);
    drawHouses(); render(); save();
  });

  $(".sw-reset").addEventListener("click", () => {
    if (!confirm(T.resetAsk)) return;
    S = freshSave(pond);
    vibe = 0; vibeUntil = 0; swarmUntil = 0; stormUntil = 0;
    toastQueue.length = 0; clearTimeout(toastTimer); toastTimer = 0; $(".sw-toast").hidden = true;
    historyStage = -1; initialAchievements = true;
    K.events.length = 0; K.seq = null; K.asleep = false; K.lastInput = now();
    fliesStarted = false; nextFlyAt = 0; fliesEl.replaceChildren();
    drawHouses(); drawFlies(); render(); save();
  });

  // ---------- the fat fly: every 25-55 s it crosses the swamp. Catch it: a pile of flies, a swarm or a croak storm ----------
  let activeFatMotion = null;
  const fat = () => {
    if (document.hidden || survivorsActive) return later();
    const f = document.createElement("button");
    f.type = "button"; f.className = "sw-fat"; f.setAttribute("aria-label", V.fatFly);
    f.innerHTML = FLY;
    const w = world.clientWidth, h = world.clientHeight;
    f.style.top = `${rnd(0.12, 0.55) * h}px`;
    world.append(f);
    const fly = calm ? null : f.animate([{ transform: "translate(-50px, 0)" }, { transform: `translate(${w * 0.35}px, -40px)` }, { transform: `translate(${w * 0.7}px, 30px)` }, { transform: `translate(${w + 50}px, -10px)` }],
      { duration: 9000, easing: "linear" });
    activeFatMotion = fly;
    let expiry;
    const dismiss = () => { activeFatMotion = null; f.remove(); later(); };
    if (fly) fly.onfinish = dismiss;
    else { f.style.left = "45%"; expiry = setTimeout(dismiss, 13000); }
    f.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!f.isConnected) return;
      S.fatCaught++; S.caught++;
      const roll = Math.random();
      if (roll < 0.5) {
        const got = Math.max(30, baseRate() * 30 + perClick() * 20);
        S.flies += got; S.total += got;
        speak(fill(T.fat, { n: fmt(got) }));
      } else if (roll < 0.75) { swarmUntil = now() + 15000; speak(T.swarm); }
      else { stormUntil = now() + 10000; speak(T.storm); }
      VS().sound?.("croak");
      kEvent(["fly"]);
      fly?.cancel(); clearTimeout(expiry); activeFatMotion = null; f.remove(); render(); save(); later();
    });
  };
  const later = () => setTimeout(fat, rnd(25, 55) * 1000);
  later();

  // ---------- buildings at work: now and then one of them bounces and brings its catch ----------
  setInterval(() => {
    if (document.hidden || calm || survivorsActive) return;
    const mine = [...houses.children];
    if (!mine.length) return;
    const h = mine[Math.floor(Math.random() * mine.length)];
    const b = buildings.find((x) => x.id === h.dataset.id);
    h.classList.remove("work"); void h.offsetWidth; h.classList.add("work");
    const wr = world.getBoundingClientRect(), hr = h.getBoundingClientRect();
    pop(`+${fmtRate(own(b.id) * b.rate * multOf(b.id) * swampMult() * 1.6)}`, hr.left - wr.left + hr.width / 2, hr.top - wr.top + 6, "small");
  }, 1600);

  // ---------- the clock ----------
  let last = now(), environmentTime = 0;
  const tick = () => {
    if (document.hidden) return;
    const t = now(), dt = Math.min(5, (t - last) / 1000);
    last = t;
    const got = rate() * dt;
    S.flies += got; S.total += got;
    if (t >= vibeUntil) vibe = Math.max(0, vibe - 0.15 * dt);
    const finished = finishProject(S, D, Date.now());
    if (finished) {
      speak(`${T.done} · ${builds.find((b) => b.id === finished).name}`); VS().sound?.("splash"); kEvent(["tea"]); save();
    }
    if (S.activities.compileEnd && Date.now() >= S.activities.compileEnd) {
      S.activities.compileEnd = 0;
      reward(compileReward(), V.compileSay); kEvent(["tea"]); save();
    }
    if (!calm && !survivorsActive) {
      environmentTime += dt;
      const phase = environmentTime / D.daySeconds * Math.PI * 2;
      world.style.setProperty("--night", (0.32 + 0.28 * Math.sin(phase)).toFixed(3));
      world.style.setProperty("--sun-shift", `${(Math.sin(phase) * 18).toFixed(2)}%`);
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
  addEventListener("pagehide", () => {
    save();
    if (lockedStorage) writeOwner = false;
  });
  const syncMotion = () => {
    const suspended = document.hidden || survivorsActive;
    host.classList.toggle("sw-paused", suspended);
    if (suspended) {
      activeFatMotion?.pause();
      cancelAnimationFrame(K.raf);
      K.raf = 0;
    } else {
      activeFatMotion?.play();
      if (!calm && A && !K.raf) K.raf = requestAnimationFrame(kTick);
    }
  };
  document.addEventListener("visibilitychange", () => {
    syncMotion();
    if (document.hidden) {
      hiddenAt = Date.now(); save();
    }
    else {
      if (hiddenAt) reward(baseRate() * Math.min(7200, Math.max(0, (Date.now() - hiddenAt) / 1000)) * 0.5);
      hiddenAt = 0; last = now();
      tick(); drawFlies(); save();
    }
  });
  const commit = (next) => {
    if (!writeOwner || !lockedStorage) throw new Error("expedition-storage");
    if (next === S) return;
    persistSave(storage, next);
    S = next;
    saveWarning = false;
    render();
  };
  window.VibeSwampClicker = {
    expedition: () => lockedStorage && writeOwner ? expeditionContext(S, baseRate()) : null,
    startExpedition(start) {
      const next = reserveExpedition(S, baseRate(), start);
      commit(next.state);
      return next.context;
    },
    settleExpedition(event) {
      const next = settleExpedition(S, event);
      commit(next.state);
      return next.flies;
    },
    setSurvivorsActive(active) {
      survivorsActive = active;
      syncMotion();
      if (!active) { drawFlies(); render(); }
    }
  };
  document.addEventListener("vibeswamp:radio", render);
  if (note) speak(note);
  drawHouses(); drawFlies(); render(); save();
  document.dispatchEvent(new Event("vibeswamp:clicker-ready"));
  return true;
}

(() => {
  const host = document.getElementById("swamp");
  const textEl = document.getElementById("swamp-text");
  if (!host || !textEl) return;
  if (!navigator.locks) { startClicker(host, textEl, false); return; }

  const showLocked = () => {
    const lang = document.documentElement.lang;
    const [message, retry] = {
      ru: ["Болото уже открыто в другой вкладке. Закройте её и обновите эту.", "Обновить"],
      uk: ["Болото вже відкрите в іншій вкладці. Закрийте її та оновіть цю.", "Оновити"],
      en: ["The swamp is open in another tab. Close that tab and reload here.", "Reload"]
    }[lang] || ["The swamp is open in another tab.", "Reload"];
    host.dataset.swampLocked = "";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button";
    button.textContent = retry;
    button.addEventListener("click", () => location.reload());
    host.replaceChildren(document.createTextNode(message + " "), button);
  };
  navigator.locks.request("vibeswamp-clicker-owner", { ifAvailable: true }, (lock) => {
    if (!lock) { showLocked(); return; }
    if (!startClicker(host, textEl, true)) return;
    // The save handler registered above runs before ownership is released.
    addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
    return new Promise((release) => addEventListener("pagehide", release, { once: true }));
  }).catch(() => {
    host.dataset.swampLocked = "";
    host.textContent = JSON.parse(textEl.textContent || "{}").v2?.saveProblem || "Storage unavailable.";
  });
})();
