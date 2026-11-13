import { RANKS, rankOf, priceOf as buildingPrice, producerMultiplier, swampMultiplier, baseRate as calculateBaseRate,
  incomeRate, clickValue, buyBuilding, buyStage, roomOpen, startProject, finishProject, achievementProgress, badgeCount,
  canBuildStage, stageNeeds, marketPrice, missingPrice, buyMissing, buyMaterial, gearStatus, gearPrice, buyGear, materialsOf, shelfBonus,
  calmUntil, calmBoost, hasStage, materialsOn } from "./swamp/engine.mjs";
import { freshSave, loadSave, persistSave } from "./swamp/save.mjs";
import { createScene, shoreArt } from "./swamp/scene.mjs";
import { expeditionContext, reserveExpedition, settleExpedition } from "./swamp/expedition-save.mjs";
import { markThreshold, takeThreshold } from "./swamp/threshold.mjs";
import { fishOf, stockOf } from "./swamp/expedition-3d-save.mjs";
import { createLivingBackdrop } from "./swamp/backdrop-gl.mjs";

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
      const caught = awayIncome(hiddenAt, time);
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
  const swampMult = () => swampMultiplier(S, D);
  const baseRate = () => calculateBaseRate(S, D);
  const vibePct = () => (S.done.track ? 50 : 25);
  const radioOn = () => !!VS().playing;
  const calmOn = () => Date.now() < calmUntil(S);
  const boosts = () => ({ radio: radioOn(), swarm: now() < swarmUntil, tea: Date.now() < S.activities.teaUntil, calm: calmOn() });
  const rate = () => incomeRate(S, D, boosts());
  const perClick = () => clickValue(S, D, { vibe: now() < vibeUntil, storm: now() < stormUntil, calm: calmOn() });
  const gardenReward = () => Math.max(15, baseRate() * D.activities.garden.rewardSeconds);
  const compileReward = () => Math.max(30, baseRate() * D.activities.compile.rewardSeconds);
  const flyReward = (count) => Math.max(1, baseRate() * 2, perClick()) * count;

  // away: half of the calm catch, two hours at most. Since 13.11.2026 (docs/design/economy.md) the time Klyop spent on
  // a 3D day (walkSeconds, written by the day's save) pays in full, and a calm night after a won one adds its +30%.
  function awayIncome(from, to, walk = 0) {
    const away = Math.min(2 * 3600, Math.max(0, (to - from) / 1000));
    const calmEnd = calmUntil(S), calmStart = calmEnd - (D.expedition?.calm?.seconds ?? 0) * 1000;
    const calmPart = Math.max(0, (Math.min(to, calmEnd, from + away * 1000) - Math.max(from, calmStart)) / 1000);
    const walked = Math.max(0, (D.expedition?.inTrip ?? 0.5) - 0.5) * Math.min(walk, away);
    return calculateBaseRate(S, D) * (0.5 * away + walked + 0.5 * (calmBoost(D) - 1) * calmPart);
  }
  const away = Math.min(2 * 3600, Math.max(0, (Date.now() - (S.t || Date.now())) / 1000));
  const walk = Number.isFinite(S.expedition3d?.walkSeconds) ? Math.max(0, S.expedition3d.walkSeconds) : 0;
  if ((away > 60 || walk > 0) && baseRate() > 0) {
    const got = awayIncome(S.t || Date.now(), Date.now(), walk);
    S.flies += got; S.total += got;
    note = [note, fill(walk > 0 ? U.walkAway : T.away, { n: fmt(got) })].filter(Boolean).join(" ");
  }
  if (walk > 0) S.expedition3d = { ...S.expedition3d, walkSeconds: 0 };

  // ---------- the page ----------
  const pic = (id) => `/brand/swamp/${id}.webp`;
  const outfitPic = (r) => (OUTFIT[r] ? `/brand/klyop/${OUTFIT[r]}.webp` : "/brand/klyop-full.webp");
  const FLY = '<svg viewBox="0 0 16 14" aria-hidden="true"><g transform="rotate(-32 5.1 7.4)"><ellipse class="fly-wing" cx="5.1" cy="7.4" rx="3.9" ry="1.6"/></g><g transform="rotate(32 10.9 7.4)"><ellipse class="fly-wing" cx="10.9" cy="7.4" rx="3.9" ry="1.6"/></g><ellipse class="fly-body" cx="8" cy="8.6" rx="1.9" ry="3.2"/><circle class="fly-body" cx="8" cy="4.6" r="1.6"/></svg>';
  // ---------- water: glints on the sun's path, ripples only where something touches the water ----------
  // The paintings share one composition: the sun stands at about x 70%, its path runs down the water below it.
  // Positions are in % of the painting. A glint over the hut of the furnished painting (v2-stage-3) is hidden there.
  const inHut = (x, y) => (y < 45 ? x > 20 && x < 80 : x > 24 && x < 74.5) && y < 89;
  // 30 along the path (denser near its middle line), 8 more where the path shows right of the furnished hut
  const glints = Array.from({ length: 38 }, (_, i) => {
    const t = Math.random() ** 0.8, side = i >= 30;
    const y = side ? 46 + Math.random() * 24 : 37 + t * 34;
    const x = side ? 75.5 + Math.random() * 4 : 70 + (Math.random() + Math.random() - 1) * (2 + t * 6);
    const w = 0.8 + Math.random() * (1.2 + t * 2.4);
    return `<i class="${inHut(x, y) ? "in-hut" : ""}" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;width:${w.toFixed(2)}%;--d:${(1.5 + Math.random() * 2.6).toFixed(2)}s;--o:${(0.5 + Math.random() * 0.5).toFixed(2)};--dx:${(Math.random() * 10 - 5).toFixed(1)}px;animation-delay:-${(Math.random() * 4).toFixed(2)}s"></i>`;
  }).join("");
  host.classList.add("sw-shell");
  host.classList.toggle("sw-paused", document.hidden);
  // Layout (12.11.2026, docs/redesign/clicker-plan.md): the scene with the gauges on top of the sky and the actions
  // under it, then the next building step, then the tabs. Everything the painting shows sits in .sw-art, a 3:2 box
  // that covers the scene like the painting itself, so cut-out parts stay on the picture at any scene size.
  host.innerHTML = `<div class="sw-game">
<section class="sw-scene" aria-label="${T.click}">
<div class="sw-world">
<div class="sw-art">
<div class="sw-backdrop" aria-hidden="true"></div>
<div class="sw-wave" aria-hidden="true">${glints}</div>
<div class="sw-houses sw-houses-back" aria-hidden="true"></div>
<div class="sw-shelter" aria-hidden="true"></div>
<div class="sw-houses" aria-hidden="true"></div>
<button type="button" class="sw-klyop"><img class="sw-k" src="/brand/klyop-full.webp" alt="" draggable="false" decoding="async"><span class="sw-croak">${U.croak} <span class="num sw-per">+1</span></span></button>
</div>
<div class="sw-sky" aria-hidden="true"><span class="sw-cloud sw-cloud-a"></span><span class="sw-cloud sw-cloud-b"></span></div>
<div class="sw-fireflies" aria-hidden="true">${Array.from({ length: 7 }, (_, i) => `<i style="--i:${i}"></i>`).join("")}</div>
<div class="sw-flies"></div>
<div class="sw-pops" aria-hidden="true"></div>
<p class="sw-say" aria-live="polite"></p>
<div class="sw-hud">
<div class="sw-gauge"><p class="sw-count"><span class="sw-num num">0</span> <span class="sw-unit">${T.flies}</span></p><p class="sw-rate"><span class="num sw-rate-n">0</span> ${T.perSec}<span class="sw-income-detail"></span></p></div>
<div class="sw-rank" title="${U.rankBonus}"><img class="sw-rank-img" src="${outfitPic(0)}" alt="" draggable="false" decoding="async"><div class="sw-rank-txt"><p class="sw-rank-t">${T.rank} <span class="num sw-rank-no">1</span><span class="sw-rank-name"></span></p><progress class="sw-rank-bar" max="100" value="0" aria-label="${T.rank}"></progress><p class="sw-rank-next"></p><p class="sw-rank-bonus">${U.rankBonus}</p></div></div>
</div>
<nav class="sw-rooms" aria-label="${U.locations}"></nav>
<div class="sw-meter" title="${T.vibeHint}"><span class="sw-meter-l">${T.vibe}</span><span class="sw-meter-bar" aria-hidden="true"><span></span></span></div>
</div>
<div class="sw-activities">
<button type="button" data-activity="garden" title="${V.plant}"><span class="sw-action-name"><span aria-hidden="true">❧</span> ${V.garden}</span><small></small></button>
<button type="button" data-activity="tea"><span class="sw-action-name"><span aria-hidden="true">♨</span> ${V.tea}</span><small></small></button>
<button type="button" data-activity="tongue"><span class="sw-action-name"><span aria-hidden="true">↝</span> ${U.dock.tongue}</span><small></small></button>
<button type="button" data-activity="compile"><span class="sw-action-name"><span aria-hidden="true">⌘</span> ${V.compile}</span><small></small><progress max="10" value="0" aria-label="${V.compile}" hidden></progress></button>
<button type="button" class="sw-radio-toggle" aria-pressed="false"><span class="sw-action-name"><span aria-hidden="true">♪</span> ${U.radio}</span><small class="sw-radio-detail"></small></button>
</div>
</section>
<section class="sw-side" aria-labelledby="sw-management">
<h2 id="sw-management" class="sw-hidden-title">${U.management}</h2>
<button type="button" class="sw-construct"><span class="sw-stage-preview" aria-hidden="true"></span><span class="sw-what"><span class="sw-next-l">${U.next}</span><span class="sw-name"></span><span class="sw-text sw-stage-gate"></span></span><span class="sw-price"><span class="sw-stage-cost num"></span><span class="sw-build-l">${V.buildStage}</span></span></button>
<div class="sw-needs" hidden><p class="sw-needs-l"></p><p class="sw-needs-actions"><button type="button" class="sw-buy-action sw-tolya"></button><button type="button" class="sw-go3d">${U.go3d}</button></p></div>
<div class="sw-tabs" role="tablist" aria-label="${U.management}">${Object.entries(V.tabs).map(([id, name], i) => `<button type="button" role="tab" id="sw-tab-${id}" aria-controls="sw-panel-${id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-tab="${id}">${name}</button>`).join("")}</div>
<div class="sw-panels">
<div class="sw-panel" id="sw-panel-shop" role="tabpanel" aria-labelledby="sw-tab-shop" tabindex="0">
<ol class="sw-list">${buildings.map((b) => `<li><article class="sw-buy" data-id="${b.id}" title="${b.text}"><span class="sw-pic-box"><img class="sw-pic" src="${pic(b.id)}" alt="" draggable="false" loading="lazy" decoding="async"><span class="sw-own num"></span></span><div class="sw-what"><h3 class="sw-name">${b.name}</h3><p class="sw-text">${b.text}</p><p class="sw-gain"></p></div><div class="sw-price"><button type="button" class="sw-buy-action"></button></div></article></li>`).join("")}</ol>
<div class="sw-howto"><h3 class="sw-panel-h">${U.howTo.title}</h3><ul>${U.howTo.lines.map((line) => `<li>${line}</li>`).join("")}</ul></div>
</div>
<div class="sw-panel" id="sw-panel-market" role="tabpanel" aria-labelledby="sw-tab-market" tabindex="0" hidden>
<h3 class="sw-panel-h">${U.market.title}</h3><p class="sw-market-lead">${U.market.lead}</p><p class="sw-calm-line" hidden></p>
<ol class="sw-list sw-goods">${["wood", "resin", "amber"].map((item) => `<li><article class="sw-buy sw-good" data-item="${item}"><span class="sw-pic-box"><img class="sw-pic" src="/brand/swamp/goods/${item}.webp" alt="" draggable="false" loading="lazy" decoding="async"></span><div class="sw-what"><h3 class="sw-name">${U.market[item]}</h3><p class="sw-text">${U.market[item + "Text"]}</p><p class="sw-gain sw-have"></p></div><div class="sw-price"><button type="button" class="sw-buy-action sw-good-buy"></button></div></article></li>`).join("")}</ol>
<p class="sw-market-lead sw-amber-none" hidden></p>
<h3 class="sw-panel-h">${U.market.gear}</h3><p class="sw-market-lead">${U.market.gearLead}</p>
<ol class="sw-list sw-gear">${D.gear.map((g) => `<li><button type="button" class="sw-build sw-gear-item" data-gear="${g.id}"><span class="sw-what"><span class="sw-name">${U.gear[g.id][0]}</span><span class="sw-text">${U.gear[g.id][1]}</span></span><span class="sw-price"><span class="num sw-cost"></span><span class="sw-state"></span></span></button></li>`).join("")}</ol>
</div>
<div class="sw-panel" id="sw-panel-construction" role="tabpanel" aria-labelledby="sw-tab-construction" tabindex="0" hidden>
<h3 class="sw-panel-h">${V.projects}</h3>
<ol class="sw-list sw-builds">${builds.map((b) => `<li><button type="button" class="sw-build" data-id="${b.id}"><span class="sw-what"><span class="sw-name">${b.name}</span><span class="sw-text">${b.text}</span></span><span class="sw-price"><span class="num sw-cost">${fmt(b.cost)}</span><span class="sw-state"></span></span><span class="sw-bar" aria-hidden="true"><span></span></span></button></li>`).join("")}</ol>
<h3 class="sw-panel-h sw-stage-progress"></h3><ol class="sw-stage-history"></ol>
</div>
<div class="sw-panel" id="sw-panel-achievements" role="tabpanel" aria-labelledby="sw-tab-achievements" tabindex="0" hidden><p class="sw-ach-count"></p>${Object.entries(U.achGroups).map(([group, title]) => `<h3 class="sw-panel-h">${title}</h3><ol class="sw-ach-grid">${D.achievements.filter((a) => a.group === group).map((a) => `<li class="sw-ach locked" data-ach="${a.id}"><button type="button" class="sw-ach-tile"><span class="sw-ach-icon"></span><span class="sw-ach-name"></span><span class="sw-ach-bar" aria-hidden="true"><span></span></span></button></li>`).join("")}</ol>`).join("")}</div>
<div class="sw-panel" id="sw-panel-records" role="tabpanel" aria-labelledby="sw-tab-records" tabindex="0" hidden><h2>${U.statsLocal}</h2><dl class="sw-records">${Object.entries(U.stats).map(([id, label]) => `<div><dt>${label}</dt><dd class="num" data-sw-stat="${id}"></dd></div>`).join("")}</dl><div class="sw-trips" hidden><h2>${U.trips.title}</h2><dl class="sw-records">${["wood", "resin", "amber", "fish", "best"].map((id) => `<div><dt>${U.trips[id]}</dt><dd class="num" data-sw-trip="${id}"></dd></div>`).join("")}</dl></div></div>
</div>
<p class="sw-foot"><span class="sw-stats"></span><button type="button" class="sw-reset">${T.reset}</button></p>
</section>
</div>
<div class="sw-mini" aria-hidden="true" inert>
<button type="button" class="sw-mini-croak" tabindex="-1"><img src="/brand/klyop-head.webp" alt="" draggable="false" decoding="async"><span>${U.croak}</span></button>
<span class="sw-mini-count"><span class="num sw-mini-num"></span> ${T.flies}</span>
<button type="button" class="sw-mini-next" tabindex="-1"></button>
</div>
<p class="sw-save-status" role="status" hidden></p><p class="sw-toast" role="status" hidden></p>`;

  const $ = (s) => host.querySelector(s);
  const scene = $(".sw-scene"), world = $(".sw-world"), houses = $(".sw-houses:not(.sw-houses-back)"), housesBack = $(".sw-houses-back"), fliesEl = $(".sw-flies");
  const num = $(".sw-num"), rateN = $(".sw-rate-n"), per = $(".sw-per"), say = $(".sw-say"), stats = $(".sw-stats");
  const incomeDetail = $(".sw-income-detail");
  const radioControl = document.querySelector(".radio .r-play");
  const radioToggle = $(".sw-radio-toggle");
  radioToggle.hidden = !radioControl;
  radioToggle.addEventListener("click", () => radioControl?.click());
  const records = [...host.querySelectorAll("[data-sw-stat]")];
  const tripsBox = $(".sw-trips"), tripCells = [...host.querySelectorAll("[data-sw-trip]")];
  const btn = $(".sw-klyop"), kImg = $(".sw-k"), pops = $(".sw-pops");
  const meter = $(".sw-meter-bar span"), meterBox = $(".sw-meter");
  const rankImg = $(".sw-rank-img"), rankNo = $(".sw-rank-no"), rankName = $(".sw-rank-name"), rankBar = $(".sw-rank-bar"), rankNext = $(".sw-rank-next"), rankBox = $(".sw-rank"), rankBonus = $(".sw-rank-bonus");
  const construct = $(".sw-construct"), mini = $(".sw-mini"), miniNum = $(".sw-mini-num"), miniNext = $(".sw-mini-next");
  const needsBox = $(".sw-needs"), needsLine = $(".sw-needs-l"), tolyaBuy = $(".sw-tolya"), go3d = $(".sw-go3d");
  const marketTab = $("#sw-tab-market"), marketPanel = $("#sw-panel-market"), calmLine = $(".sw-calm-line"), amberNone = $(".sw-amber-none");
  const goodCards = [...host.querySelectorAll(".sw-good")], gearItems = [...host.querySelectorAll(".sw-gear-item")];
  const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
  // The next building step in the card: a small crop of the scene as it will look once the step is built (the same
  // cut-out layers stacked on the painting), dimmed until there are flies enough. Steps without pictures show "?".
  const preview = $(".sw-stage-preview");
  const paintPreview = () => {
    const size = 52, next = D.stages[S.stage], step = next && D.art.steps?.[next.id];
    const box = !next ? [20, 14, 60, 76] : step?.box;
    preview.classList.toggle("unknown", !box);
    if (!box) { preview.style.removeProperty("--pv-src"); return; }
    const after = shoreArt(next ? S.stage + 1 : S.stage, D);
    const urls = [...after.layers].reverse().map((id) => `url("/brand/swamp/steps/${D.art.steps[id].layer}-960.webp")`);
    if (after.dark) urls.push(`url("/brand/swamp/steps/${after.dark}-960.webp")`);
    urls.push(`url("/brand/swamp/${after.base || "bg"}-960.webp")`);
    // a square around the part, at least a third of the painting high, kept inside the painting (1.5 x 1 units)
    const [x, y, w, h] = box, bw = w * 1.5 / 100, bh = h / 100, side = Math.min(1, Math.max(bw, bh, 0.34));
    const left = Math.min(1.5 - side, Math.max(0, x * 1.5 / 100 + bw / 2 - side / 2));
    const top = Math.min(1 - side, Math.max(0, y / 100 + bh / 2 - side / 2)), f = size / side;
    preview.style.setProperty("--pv-src", urls.join(", "));
    preview.style.setProperty("--pv-size", `${(1.5 * f).toFixed(1)}px ${f.toFixed(1)}px`);
    preview.style.setProperty("--pv-pos", `${(-left * f).toFixed(1)}px ${(-top * f).toFixed(1)}px`);
  };
  const howTo = $(".sw-howto");
  // buildings and projects only: the stall's goods and gear reuse their row styles
  const buyCards = [...host.querySelectorAll(".sw-buy:not(.sw-good)")], buildBtns = [...host.querySelectorAll(".sw-build:not(.sw-gear-item)")];
  host.addEventListener("dragstart", (event) => event.preventDefault());
  // A long press on a picture must not open the phone's image menu or start a text selection.
  host.addEventListener("contextmenu", (event) => { if (event.target.closest(".sw-world, .sw-pic, .sw-mini")) event.preventDefault(); });
  const producerLabels = Object.fromEntries(buildings.map(({ id, name }) => [id, name]));
  // clouds, leaves and water that move (WebGL); without it, or with reduced motion, the still picture stays
  let living = null;
  if (!calm) {
    try { living = createLivingBackdrop({ art: $(".sw-art"), world, phone: () => matchMedia("(max-width: 900px)").matches }); }
    catch { living = null; }
  }
  if (living) world.classList.add("gl-live");
  const drawScene = createScene({ world, houses, housesBack, rooms: $(".sw-rooms"), data: D, text: V, producerLabels,
    onBackdrop: (painting, mask, shore) => living?.set(painting, mask, shore), onRoom: (room) => {
    if (!roomOpen(S, D, room)) { speak(V.roomHints[room]); return; }
    if (S.room === room) return;
    S.room = room;
    if (!S.visited.includes(room)) S.visited.push(room);
    kEvent(["walk", "wave"]);
    drawScene(S); render(); save();
  } });

  // Computer: the game takes the window's height between the header and the radio bar, nothing to scroll.
  const game = $(".sw-game");
  const fit = () => {
    const top = game.getBoundingClientRect().top + scrollY;
    const radio = document.querySelector(".radio")?.offsetHeight || 0;
    host.style.setProperty("--sw-fit", `${Math.max(500, Math.round(innerHeight - top - radio - 14))}px`);
  };
  fit();
  addEventListener("resize", fit);
  // the radio bar under the game folds and unfolds (52-130 px): keep the game fitted to what is left
  const radioBar = document.querySelector(".radio");
  if (radioBar && "ResizeObserver" in window) new ResizeObserver(fit).observe(radioBar);

  // Phone: once the scene scrolls away, a slim bar keeps the catch, a croak and the next step in reach.
  $(".sw-mini-croak").addEventListener("click", () => btn.click());
  miniNext.addEventListener("click", () => {
    if (!construct.disabled) construct.click();
    else world.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => {
      const show = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      mini.classList.toggle("on", show);
      mini.toggleAttribute("inert", !show);
      mini.setAttribute("aria-hidden", String(!show));
    }, { threshold: 0, rootMargin: "-40% 0px 0px 0px" }).observe(world);
  }

  const tabs = [...host.querySelectorAll("[role=tab]")];
  const selectTab = (tab) => {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected)); item.tabIndex = selected ? 0 : -1;
      $(`#sw-panel-${item.dataset.tab}`).hidden = !selected;
    }
  };
  $(".sw-tabs").addEventListener("click", (event) => { const tab = event.target.closest("[role=tab]"); if (tab) selectTab(tab); });
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
      grantNow("sleeper");
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
  let nextFlyAt = 0, fliesStarted = false, flyDrag = null;
  const finishFlyDrag = () => {
    if (!flyDrag) return;
    const { fly, id, ghost, resume } = flyDrag;
    flyDrag = null;
    ghost.remove();
    fly.classList.remove("sw-fly-held");
    btn.classList.remove("sw-fly-target");
    if (fly.hasPointerCapture(id)) fly.releasePointerCapture(id);
    if (fly.isConnected && !document.hidden && !survivorsActive) resume?.();
  };
  const overKlyop = ({ clientX, clientY }) => {
    const { left, right, top, bottom, width, height } = kImg.getBoundingClientRect();
    return width > 0 && height > 0 &&
      clientX >= left - 10 && clientX <= right + 10 && clientY >= top - 8 && clientY <= bottom + 8;
  };
  const positionFly = (event) => {
    const bounds = world.getBoundingClientRect();
    flyDrag.ghost.style.left = `${event.clientX - bounds.left}px`;
    flyDrag.ghost.style.top = `${event.clientY - bounds.top}px`;
    flyDrag.moved ||= Math.hypot(event.clientX - flyDrag.x, event.clientY - flyDrag.y) >= 7;
    btn.classList.toggle("sw-fly-target", flyDrag.moved && overKlyop(event));
  };
  const bindFly = (fly, catchFly, pause, resume) => {
    fly.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      if (event.button !== 0 || flyDrag || !writeOwner) return;
      fly.setPointerCapture(event.pointerId);
      const ghost = document.createElement("span");
      ghost.className = `${fly.className} sw-fly-dragged`;
      ghost.setAttribute("aria-hidden", "true");
      ghost.innerHTML = FLY;
      flyDrag = { fly, ghost, id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, resume };
      pause?.();
      fly.classList.add("sw-fly-held");
      world.append(ghost);
      positionFly(event);
    });
    const ownsPointer = (event) => flyDrag?.fly === fly && flyDrag.id === event.pointerId;
    fly.addEventListener("pointermove", (event) => {
      if (ownsPointer(event)) positionFly(event);
    });
    fly.addEventListener("pointerup", (event) => {
      if (!ownsPointer(event)) return;
      positionFly(event);
      const { moved } = flyDrag;
      const delivered = moved && overKlyop(event);
      finishFlyDrag();
      if ((!moved || delivered) && fly.isConnected && writeOwner) catchFly(delivered);
    });
    const cancel = (event) => { if (ownsPointer(event)) finishFlyDrag(); };
    fly.addEventListener("pointercancel", cancel);
    fly.addEventListener("lostpointercapture", cancel);
    fly.addEventListener("click", (event) => {
      event.stopPropagation();
      if (event.detail === 0 && fly.isConnected && writeOwner) catchFly(false);
    });
  };
  const drawFlies = () => {
    if (document.hidden || survivorsActive) return;
    // A few flies at a time: ten of them covered the picture on a phone.
    const want = Math.max(2, Math.min(6, 2 + Math.floor(Math.log2(rate() + 1) * 0.4)));
    if (now() < nextFlyAt) return;
    const count = fliesStarted ? Math.min(want, fliesEl.childElementCount + 1) : want;
    while (fliesEl.childElementCount < count) {
      const f = document.createElement("button");
      // the first flies wear a ring so a new player sees they can be caught
      f.type = "button"; f.className = S.caught < 3 ? "sw-fly sw-fly-new" : "sw-fly"; f.setAttribute("aria-label", V.fly);
      f.innerHTML = FLY;
      const x = Math.random() < 0.5 ? rnd(6, 22) : rnd(68, 82);
      f.style.cssText = `left:${x.toFixed(1)}%;top:${rnd(22, 53).toFixed(1)}%;--dx:${rnd(-12, 12).toFixed(0)}px;--dy:${rnd(-20, 20).toFixed(0)}px;--d:${rnd(2.6, 6).toFixed(2)}s;animation-delay:-${rnd(0, 5).toFixed(2)}s`;
      bindFly(f, (delivered) => {
        catchFlies([f], delivered);
        render(); save();
      });
      fliesEl.append(f);
    }
    while (fliesEl.childElementCount > want) {
      const last = fliesEl.lastElementChild;
      (last === flyDrag?.fly ? last.previousElementSibling : last).remove();
    }
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
  // ---------- badges: 34 of them in five groups, each open one adds 1% to the income (engine.badgeCount) ----------
  // Icons are existing pictures: buildings (b:), Klyop's poses (k:), a crop of a building step (s:), the drawn fly.
  const badgeIcon = (a) => {
    const [kind, name] = a.icon.split(":");
    if (kind === "b") return `<img src="/brand/swamp/${name}.webp" alt="" draggable="false" loading="lazy">`;
    if (kind === "k") return `<img class="sw-ach-klyop" src="/brand/klyop/${name}.webp" alt="" draggable="false" loading="lazy">`;
    if (kind === "s") {
      const [x, y, w, h] = D.art.steps?.[name]?.box || [20, 14, 60, 76], size = 44, bw = w * 1.5 / 100, bh = h / 100, f = size / Math.max(bw, bh);
      return `<span class="sw-ach-crop" style="background-image:url('/brand/swamp/steps/${name}-960.webp');background-size:${(1.5 * f).toFixed(1)}px ${f.toFixed(1)}px;background-position:${(-(x / 100) * 1.5 * f + (size - bw * f) / 2).toFixed(1)}px ${(-(y / 100) * f + (size - bh * f) / 2).toFixed(1)}px"></span>`;
    }
    return `<span class="sw-ach-fly${kind === "fat" ? " fat" : ""}">${FLY}</span>`;
  };
  const badgeTiles = new Map(D.achievements.map((a) => [a.id, $(`[data-ach="${a.id}"]`)]));
  const drawTile = (a, open) => {
    const tile = badgeTiles.get(a.id), hidden = a.secret && !open;
    tile.classList.toggle("locked", !open);
    tile.classList.toggle("secret", hidden);
    tile.querySelector(".sw-ach-icon").innerHTML = hidden ? '<span class="sw-ach-unknown">?</span>' : badgeIcon(a);
    tile.querySelector(".sw-ach-name").textContent = hidden ? U.secretName : V.achievements[a.id][0];
  };
  let badgeProgress = {};
  const grant = (id, quiet = false) => {
    if (S.ach[id] || !badgeTiles.has(id)) return false;
    S.ach[id] = Date.now();
    if (!quiet) toastQueue.push(fill(V.achieved, { name: V.achievements[id][0] }));
    return true;
  };
  // event badges (night visit, Klyop asleep, a 3D trophy) are given where they happen
  const grantNow = (id) => { if (grant(id)) { checkAchievements(); save(); } };
  const checkAchievements = () => {
    let changed = false;
    badgeProgress = achievementProgress(S, D);
    for (const a of D.achievements) {
      const progress = badgeProgress[a.id];
      if (progress && progress[0] >= progress[1] && grant(a.id, initialAchievements)) changed = true;
      const open = !!S.ach[a.id], tile = badgeTiles.get(a.id);
      if (!tile.dataset.drawn || tile.classList.contains("locked") === open) { drawTile(a, open); tile.dataset.drawn = "1"; }
      const share = open ? 100 : progress && !a.secret ? Math.min(99, Math.floor(100 * progress[0] / progress[1])) : 0;
      const bar = tile.querySelector(".sw-ach-bar span"), width = `${share}%`;
      if (bar.style.width !== width) bar.style.width = width;
    }
    initialAchievements = false;
    if (toastQueue.length && !toastTimer) showToast();
    const count = badgeCount(S, D);
    const label = fill(V.achievementCount, { n: count, max: D.achievements.length, p: count });
    if ($(".sw-ach-count").textContent !== label) $(".sw-ach-count").textContent = label;
    if (changed) save();
  };
  // tapping a tile: Klyop reads what it is for and how far along you are
  $("#sw-panel-achievements").addEventListener("click", (event) => {
    const tile = event.target.closest("[data-ach]");
    if (!tile) return;
    const a = D.achievements.find((item) => item.id === tile.dataset.ach), open = !!S.ach[a.id];
    if (a.secret && !open) { speak(U.secretText); return; }
    const progress = badgeProgress[a.id];
    const tail = !open && progress ? ` · ${fill(U.achProgress, { v: fmt(Math.min(progress[0], progress[1])), g: fmt(progress[1]) })}` : "";
    speak(`${V.achievements[a.id][0]}: ${V.achievements[a.id][1]}${tail}`);
  });

  const secondsLeft = (time) => Math.max(0, Math.ceil((time - Date.now()) / 1000));
  // The action row shows short states; the full sentence goes to the button's title (hover on a computer).
  const Dk = U.dock;
  const status = (button, short, full = short) => {
    const small = button.querySelector("small");
    if (small.textContent !== short) small.textContent = short;
    if (button.title !== full) button.title = full;
  };
  const renderActivities = () => {
    const activities = S.activities, time = Date.now();
    const garden = $('[data-activity="garden"]');
    garden.disabled = S.stage < 1 || time < activities.gardenReady;
    if (S.stage < 1) status(garden, Dk.gardenLock, U.gardenLock);
    else if (time < activities.gardenReady) status(garden, fill(V.growing, { n: secondsLeft(activities.gardenReady) }));
    else if (activities.gardenReady) status(garden, fill(Dk.gardenHarvest, { n: fmt(gardenReward()) }), fill(U.gardenHarvest, { n: fmt(gardenReward()) }));
    else status(garden, fill(Dk.gardenPlant, { s: D.activities.garden.seconds, n: fmt(gardenReward()) }), fill(U.gardenPlant, { s: D.activities.garden.seconds, n: fmt(gardenReward()) }));

    const compile = $('[data-activity="compile"]');
    const compiling = activities.compileEnd > 0;
    compile.disabled = S.room !== "workshop" || !own("stump") || compiling || time < activities.compileReady;
    if (compiling) status(compile, fill(V.compiling, { n: secondsLeft(activities.compileEnd) }));
    else if (!own("stump")) status(compile, Dk.compileStump, U.compileStump);
    else if (S.room !== "workshop") status(compile, Dk.compileRoom, U.compileRoom);
    else if (time < activities.compileReady) status(compile, fill(V.cooldown, { n: secondsLeft(activities.compileReady) }));
    else status(compile, fill(Dk.compileReady, { n: fmt(compileReward()), s: D.activities.compile.seconds }), fill(U.compileReady, { n: fmt(compileReward()), s: D.activities.compile.seconds }));
    const progress = compile.querySelector("progress");
    progress.hidden = !compiling; progress.max = D.activities.compile.seconds;
    progress.value = D.activities.compile.seconds - secondsLeft(activities.compileEnd);

    const tea = $('[data-activity="tea"]');
    const teaActive = time < activities.teaUntil;
    const resting = time < activities.teaReady;
    tea.disabled = teaActive || (resting && !S.teaBags);
    const p = Math.round((D.activities.tea.multiplier - 1) * 100);
    const stock = S.teaBags ? ` · ${fill(U.teaBagStock, { n: fmt(S.teaBags) })}` : "";
    if (!teaActive && resting && S.teaBags) status(tea, fill(Dk.teaBag, { n: fmt(S.teaBags) }), fill(U.teaBagBrew, { n: fmt(S.teaBags) }));
    else if (teaActive) status(tea, fill(Dk.teaOn, { p, s: secondsLeft(activities.teaUntil) }), fill(U.teaBenefit, { n: p, s: secondsLeft(activities.teaUntil) }) + stock);
    else if (resting) status(tea, fill(V.cooldown, { n: secondsLeft(activities.teaReady) }));
    else status(tea, fill(Dk.teaIdle, { p, s: D.activities.tea.seconds }), fill(U.teaBenefit, { n: p, s: D.activities.tea.seconds }) + stock);

    const tongue = $('[data-activity="tongue"]');
    const count = fliesEl.childElementCount;
    tongue.disabled = time < activities.tongueReady || !count;
    if (time < activities.tongueReady) status(tongue, fill(V.cooldown, { n: secondsLeft(activities.tongueReady) }));
    else if (count) status(tongue, fill(Dk.swarmReady, { c: count, n: fmt(flyReward(count)) }), fill(U.swarmCatch, { c: count, n: fmt(flyReward(count)) }));
    else status(tongue, Dk.swarmEmpty, U.swarmEmpty);
  };

  // ---------- render ----------
  // Tolya's stall: planks and resin for flies, amber only for the next step, and gear for the 3D swamp
  const clock = (ms) => { const sec = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`; };
  const renderMarket = (needs, mats) => {
    const amberWanted = needs?.miss.amber ?? 0;
    const shelf = fill(U.market.shelf, { n: mats.amber, p: Math.round(shelfBonus(S, D) * 100) });
    for (const card of goodCards) {
      const item = card.dataset.item, price = marketPrice(S, D, item);
      const sold = item !== "amber" || amberWanted > 0;
      card.parentElement.hidden = !sold;
      setText(card.querySelector(".sw-have"), item === "amber" ? shelf : fill(U.market.have, { n: mats[item] }));
      const action = card.querySelector(".sw-good-buy");
      setText(action, fill(U.market.buy, { n: fmt(price) }));
      action.disabled = !sold || S.flies < price;
      card.classList.toggle("can", sold && S.flies >= price);
    }
    amberNone.hidden = amberWanted > 0;
    if (!amberNone.hidden) setText(amberNone, `${U.market.amberNone} ${U.market.amber}: ${shelf}.`);
    const calmLeft = calmUntil(S) - Date.now();
    calmLine.hidden = calmLeft <= 0;
    if (calmLeft > 0) setText(calmLine, fill(U.market.calm, { n: Math.round((calmBoost(D) - 1) * 100), t: clock(calmLeft) }));
    for (const el of gearItems) {
      const item = D.gear.find((g) => g.id === el.dataset.gear), status = gearStatus(S, D, item), price = gearPrice(S, D, item);
      const cost = [fill(U.market.gearBuy, { n: fmt(price) }), item.wood ? fill(U.market.gearMats, { w: item.wood }) : "", item.resin ? fill(U.market.gearResin, { r: item.resin }) : ""].filter(Boolean).join(" · ");
      const ready = status === "open" && S.flies >= price && mats.wood >= item.wood && mats.resin >= item.resin;
      el.disabled = !ready;
      el.classList.toggle("done", status === "owned");
      el.classList.toggle("can", ready);
      setText(el.querySelector(".sw-cost"), status === "owned" ? "" : cost);
      setText(el.querySelector(".sw-state"), status === "owned" ? U.market.gearOwned
        : status === "closed" && !hasStage(S, D, item.after) ? fill(U.market.gearAfter, { s: V.stages[item.after] }) : "");
    }
  };

  const render = () => {
    if (survivorsActive) return;
    checkAchievements(); renderActivities(); drawScene(S);
    const next = D.stages[S.stage];
    $(".sw-stage-progress").textContent = fill(V.stageProgress, { n: S.stage, max: D.stages.length });
    const needs = stageNeeds(S, D), mats = materialsOf(S);
    const lacking = Boolean(needs && (needs.miss.wood || needs.miss.resin || needs.miss.amber));
    construct.disabled = !canBuildStage(S, D);
    construct.classList.toggle("can", !construct.disabled);
    construct.classList.toggle("all", !next);
    construct.querySelector(".sw-name").textContent = next ? V.stages[next.id] : V.allBuilt;
    const previewKey = next ? next.id : "all";
    if (preview.dataset.step !== previewKey) { preview.dataset.step = previewKey; paintPreview(); }
    $(".sw-stage-cost").textContent = next ? fmt(next.cost) : "";
    // planks, resin and amber the step asks for: what is there of each
    const needList = needs ? [["wood", U.needWood], ["resin", U.needResin], ["amber", U.needAmber]].filter(([item]) => needs.need[item])
      .map(([item, line]) => fill(line, { h: Math.min(mats[item], needs.need[item]), n: needs.need[item] })).join(", ") : "";
    const gate = next && S.total < next.total ? fill(V.stageGate, { n: fmt(next.total - S.total) })
      : next && S.flies < next.cost ? fill(U.stageNeed, { n: fmt(next.cost - S.flies) }) : "";
    $(".sw-stage-gate").textContent = gate;
    needsBox.hidden = !lacking;
    if (lacking) {
      setText(needsLine, fill(U.needs, { list: needList }));
      const price = missingPrice(S, D);
      setText(tolyaBuy, fill(U.tolyaBuy, { n: fmt(price) }));
      tolyaBuy.disabled = S.flies < price;
      go3d.hidden = !document.querySelector(".sw-walk-link");
    }
    marketTab.hidden = !materialsOn(D) || S.stage < 2;
    if (marketTab.hidden && marketTab.getAttribute("aria-selected") === "true") selectTab(tabs[0]);
    if (!marketPanel.hidden) renderMarket(needs, mats);
    miniNum.textContent = fmt(S.flies);
    const miniText = next ? `${V.stages[next.id]} · ${lacking ? U.needsMini : fmt(next.cost)}` : "";
    if (miniNext.textContent !== miniText) miniNext.textContent = miniText;
    miniNext.classList.toggle("can", !construct.disabled);
    if (historyStage !== S.stage) {
      historyStage = S.stage;
      $(".sw-stage-history").innerHTML = D.stages.slice(0, S.stage).reverse().map((stage) => `<li><span aria-hidden="true">✓</span> ${V.stages[stage.id]}</li>`).join("");
    }
    for (const record of records) record.textContent = whole.format(Math.floor(S[record.dataset.swStat]));
    const trips = S.expedition3d;
    tripsBox.hidden = !trips;
    if (trips) {
      const stock = stockOf(S), best = trips.best;
      const values = { wood: whole.format(stock.wood), resin: whole.format(stock.resin), amber: whole.format(trips.amber || 0), fish: whole.format(fishOf(S)),
        best: best ? fill(U.trips.bestValue, { t: best.trophies || 0, k: best.kills || 0 }) : "—" };
      for (const cell of tripCells) if (cell.textContent !== values[cell.dataset.swTrip]) cell.textContent = values[cell.dataset.swTrip];
    }
    const modifiers = boosts();
    const passive = baseRate();
    num.textContent = fmt(S.flies);
    rateN.textContent = fmtRate(incomeRate(S, D, modifiers));
    per.textContent = `+${fmtRate(perClick())}`;
    const incomeLines = [fill(U.baseIncome, { n: fmtRate(passive) })];
    if (modifiers.radio) incomeLines.push(fill(U.radioIncome, { n: vibePct() }));
    if (modifiers.tea) incomeLines.push(fill(U.teaIncome, { n: Math.round((D.activities.tea.multiplier - 1) * 100) }));
    if (modifiers.swarm) incomeLines.push(U.swarmIncome);
    if (modifiers.calm) incomeLines.push(fill(U.calmIncome, { n: Math.round((calmBoost(D) - 1) * 100) }));
    const shelfPct = Math.round(shelfBonus(S, D) * 100);
    if (shelfPct) incomeLines.push(fill(U.shelfIncome, { n: shelfPct }));
    // the base income, then what raises it now; a phone shows only the raises (the box stays one line high)
    const [baseLine, ...raises] = incomeLines;
    const detail = `${baseLine}|${raises.join(" · ")}`;
    if (incomeDetail.dataset.text !== detail) {
      incomeDetail.dataset.text = detail;
      incomeDetail.innerHTML = '<span class="sw-income-base"></span><span class="sw-income-raises"></span>';
      incomeDetail.firstChild.textContent = baseLine;
      incomeDetail.lastChild.textContent = raises.join(" · ");
    }
    incomeDetail.toggleAttribute("data-boosted", incomeLines.length > 1);
    radioToggle.setAttribute("aria-pressed", String(modifiers.radio));
    status(radioToggle, fill(modifiers.radio ? Dk.radioOn : Dk.radioOff, { n: vibePct() }),
      `${modifiers.radio ? U.radioStop : U.radioStart} · ${fill(U.radioBenefit, { n: vibePct() })}`);
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
      el.title = seen ? b.text : "";
      // the full "Buy for N flies" on a computer, the price alone on a phone (the row is narrow)
      const full = fill(U.buy, { n: whole.format(price) });
      if (action.dataset.full !== full) {
        action.dataset.full = full;
        action.innerHTML = '<span class="sw-buy-full"></span><span class="sw-buy-short"></span>';
        action.firstChild.textContent = full;
        action.lastChild.textContent = fill(U.buyShort, { n: fmt(price) });
        action.setAttribute("aria-label", full);
      }
      gainLabel.hidden = !seen;
      if (seen) {
        const upgraded = { ...S, own: { ...S.own, [b.id]: own(b.id) + 1 } };
        gainLabel.textContent = fill(U.purchaseGain, { n: precise.format(calculateBaseRate(upgraded, D) - passive) });
      }
      // how many you have: a small count on the picture's corner, like on the scene
      const ownLabel = own(b.id) ? `×${own(b.id)}` : "";
      const ownEl = el.querySelector(".sw-own");
      if (ownEl.textContent !== ownLabel) { ownEl.textContent = ownLabel; ownEl.title = own(b.id) ? `${T.owned}: ${own(b.id)}` : ""; }
      action.disabled = !seen || S.flies < price;
    });
    const shownRows = buyCards.filter((card) => !card.parentElement.hidden).length;
    howTo.hidden = shownRows > 3;
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
  // a delivered fly brings a tea bag now and then: 8% each time, and surely by the 12th delivery without one
  const rollTeaBag = () => {
    S.sinceBag = (S.sinceBag || 0) + 1;
    if (Math.random() >= 0.08 && S.sinceBag < 12) return;
    S.sinceBag = 0;
    S.teaBags++;
    speak(U.teaBagDrop);
  };
  const catchFlies = (flies, delivered = false) => {
    const visible = flies.filter((fly) => fly.isConnected);
    if (!visible.length) return;
    const value = flyReward(visible.length) * (delivered ? 3 : 1);
    if (visible.includes(flyDrag?.fly)) finishFlyDrag();
    const bounds = world.getBoundingClientRect();
    const position = visible[0].getBoundingClientRect();
    visible.forEach((fly) => fly.remove());
    S.caught += visible.length;
    reward(value); pop(`+${fmt(value)}`, position.left - bounds.left + 22, position.top - bounds.top, "small");
    if (delivered) { S.delivered = (S.delivered || 0) + 1; rollTeaBag(); }
    kEvent(["fly"]);
  };
  // Water zones in % of the painting: the banks left and right, and the open middle while the painting has no hut.
  const art = $(".sw-art"), wave = $(".sw-wave");
  const zones = () => [[3, 54, 20, 84], [80, 50, 97, 82],
    ...(world.dataset.stageArt === "true" ? [[75, 48, 80, 82]] : [[27, 42, 73, 72]])];
  const onWater = (x, y) => zones().some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
  const dashes = () => Array.from({ length: 6 }, () => `${(8 + Math.random() * 26).toFixed(0)} ${(2 + Math.random() * 9).toFixed(0)}`).join(" ");
  const ripple = (x, y, strong = false) => {
    if (calm || document.hidden || world.dataset.room !== "shore" || wave.querySelectorAll(".sw-ripple").length > 5) return;
    const r = document.createElement("span");
    r.className = "sw-ripple";
    const width = (strong ? 9 : 5.5) * (0.8 + Math.random() * 0.45), dur = (strong ? 2.1 : 1.7) + Math.random() * 0.8;
    r.style.cssText = `left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;width:${width.toFixed(1)}%;--rot:${(Math.random() * 6 - 3).toFixed(1)}deg;--dur:${dur.toFixed(2)}s`;
    r.innerHTML = `<svg viewBox="-50 -13 100 26" preserveAspectRatio="none"><ellipse rx="47" ry="11" stroke-dasharray="${dashes()}"/><ellipse class="in" rx="30" ry="7" stroke-dasharray="${dashes()}"/></svg>`;
    wave.append(r);
    setTimeout(() => r.remove(), dur * 1000 + 300);
  };
  const artPoint = ({ clientX, clientY }) => {
    const box = art.getBoundingClientRect();
    return [(clientX - box.left) / box.width * 100, (clientY - box.top) / box.height * 100];
  };
  world.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".sw-klyop, .sw-fly, .sw-fat, .sw-rooms, .sw-hud, .sw-meter")) return;
    const [x, y] = artPoint(event);
    if (onWater(x, y)) ripple(x, y, true);
  });
  // ---------- now and then a bird crosses the far sky and a dragonfly darts over the water ----------
  // Small drawn shapes moved with transform and opacity only; never with reduced motion, never in the rooms.
  const BIRD = '<svg viewBox="0 0 20 8" aria-hidden="true"><path class="wing" d="M1 5 Q5.5 0.5 10 4.6 Q14.5 0.5 19 5" fill="none" stroke="#1c1914" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const DRAGONFLY = '<svg viewBox="0 0 26 12" aria-hidden="true"><g class="wings" fill="rgba(214,236,240,.5)" stroke="rgba(235,248,250,.6)" stroke-width=".3"><ellipse cx="10" cy="3.2" rx="5.4" ry="1.5"/><ellipse cx="10" cy="8.8" rx="5.4" ry="1.5"/><ellipse cx="15.2" cy="3.6" rx="4.3" ry="1.3"/><ellipse cx="15.2" cy="8.4" rx="4.3" ry="1.3"/></g><line x1="3" y1="6" x2="24" y2="6" stroke="#2c5c58" stroke-width="1.7" stroke-linecap="round"/><circle cx="24" cy="6" r="1.5" fill="#1f3f3c"/></svg>';
  const critter = (className, svg, keyframes, duration) => {
    if (calm || document.hidden || world.dataset.room !== "shore") return;
    const el = document.createElement("span");
    el.className = className;
    el.innerHTML = svg;
    wave.append(el);
    const motion = el.animate(keyframes, { duration, easing: "linear", fill: "forwards" });
    motion.onfinish = () => el.remove();
  };
  const bird = () => {
    // far away, right to left just above the tree line, fading before the moss on the left; when the furnished hut
    // is part of the painting (era 3) it flies higher, in the open sky above the roof, never in front of it
    const high = world.dataset.era === "3", y = high ? 9 + Math.random() * 3 : 19 + Math.random() * 6;
    const [x0, x1] = high ? [80, 56] : [97, 52], mid = (x0 + x1) / 2;
    critter("sw-bird", BIRD, [
      { left: `${x0}%`, top: `${y}%`, opacity: 0 }, { left: `${x0 - 4}%`, top: `${y - 1}%`, opacity: .85, offset: .12 },
      { left: `${mid}%`, top: `${y - 2.5}%`, opacity: .85, offset: .6 }, { left: `${x1}%`, top: `${y - 2}%`, opacity: 0 }
    ], (high ? 11000 : 15000) + Math.random() * 5000);
  };
  const dragonfly = () => {
    // darts and hovers over the water by a bank, never over the hut: quick moves with stops between them
    const left = Math.random() < .5, x = (v) => `${left ? v : 100 - v}%`, flip = left ? 1 : -1;
    critter("sw-dragonfly", DRAGONFLY, [
      { left: x(-3), top: "64%", transform: `scaleX(${flip})`, opacity: 0 },
      { left: x(8), top: "60%", transform: `scaleX(${flip})`, opacity: 1, offset: .12 },
      { left: x(9), top: "60.6%", transform: `scaleX(${flip})`, opacity: 1, offset: .32 },
      { left: x(14), top: "66%", transform: `scaleX(${flip})`, opacity: 1, offset: .42 },
      { left: x(14.6), top: "65.2%", transform: `scaleX(${flip})`, opacity: 1, offset: .62 },
      { left: x(19), top: "58%", transform: `scaleX(${flip})`, opacity: 1, offset: .76 },
      { left: x(21), top: "54%", transform: `scaleX(${flip})`, opacity: 0 }
    ], 7000);
  };
  // the first ones come soon after opening, later ones now and then
  const now_and_then = (fn, min, max, first = min) => setTimeout(() => { fn(); now_and_then(fn, min, max); }, (first + Math.random() * (max - min) * (first === min ? 1 : .2)) * 1000);
  now_and_then(bird, 35, 90, 8);
  now_and_then(dragonfly, 25, 70, 5);

  // now and then something touches the water: a midge, a drop from the reeds
  setInterval(() => {
    if (Math.random() > 0.55) return;
    const list = zones(), [x0, y0, x1, y1] = list[Math.floor(Math.random() * list.length)];
    ripple(x0 + Math.random() * (x1 - x0), y0 + Math.random() * (y1 - y0));
  }, 2600);

  $(".sw-activities").addEventListener("click", (event) => {
    const button = event.target.closest("[data-activity]");
    if (!button || button.disabled) return;
    const activity = button.dataset.activity, time = Date.now(), activities = S.activities;
    if (activity === "garden" && S.stage >= 1 && time >= activities.gardenReady) {
      if (activities.gardenReady) {
        reward(gardenReward(), V.gardenSay); activities.gardenReady = 0; S.harvests = (S.harvests || 0) + 1; kEvent(["wave"]);
      } else activities.gardenReady = time + D.activities.garden.seconds * 1000;
    }
    if (activity === "compile" && S.room === "workshop" && own("stump") && !activities.compileEnd && time >= activities.compileReady) {
      activities.compileEnd = time + D.activities.compile.seconds * 1000;
      activities.compileReady = activities.compileEnd + D.activities.compile.cooldown * 1000;
      kEvent(["type", "tea"]);
    }
    if (activity === "tea" && time >= activities.teaUntil && (time >= activities.teaReady || S.teaBags)) {
      if (time < activities.teaReady) S.teaBags--;
      activities.teaUntil = time + D.activities.tea.seconds * 1000;
      activities.teaReady = time + D.activities.tea.cooldown * 1000;
      S.teas++; speak(V.teaSay); kEvent(["tea"]);
    }
    if (activity === "tongue" && time >= activities.tongueReady && fliesEl.childElementCount) {
      catchFlies([...fliesEl.children]); activities.tongueReady = time + D.activities.tongue.cooldown * 1000; S.swarms = (S.swarms || 0) + 1;
    }
    render(); save();
  });

  // ---------- croak ----------
  btn.addEventListener("click", (e) => {
    const t = now();
    if (t >= vibeUntil) {
      vibe = Math.min(1, vibe + 0.08);
      if (vibe >= 1) { vibe = 0; vibeUntil = t + 8000; S.vibes = (S.vibes || 0) + 1; speak(T.vibeGo); VS().sound?.("splash"); }
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
    const buy = e.target.closest(".sw-buy:not(.sw-good) .sw-buy-action");
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
    const bld = e.target.closest(".sw-build:not(.sw-gear-item)");
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

  // the step card: buy what the step lacks from Tolya, or go out to 3D for it
  tolyaBuy.addEventListener("click", () => {
    if (!buyMissing(S, D)) return;
    VS().sound?.("tick"); K.lastInput = now();
    render(); save();
  });
  go3d.addEventListener("click", () => { if (exitLink) leave(new URL(exitLink.href, location.href)); });
  marketPanel.addEventListener("click", (event) => {
    const good = event.target.closest(".sw-good-buy"), gear = event.target.closest(".sw-gear-item");
    const done = good ? buyMaterial(S, D, good.closest(".sw-good").dataset.item, 1) : gear ? buyGear(S, D, gear.dataset.gear) : false;
    if (!done) return;
    VS().sound?.("tick"); K.lastInput = now();
    render(); save();
  });

  $(".sw-construct").addEventListener("click", () => {
    if (!buyStage(S, D)) return;
    speak(V.stages[D.stages[S.stage - 1].id]); kEvent(["wave", "jump"]);
    drawHouses(); render(); save();
  });

  $(".sw-reset").addEventListener("click", () => {
    if (!confirm(T.resetAsk)) return;
    finishFlyDrag();
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
    else { f.style.left = "24%"; expiry = setTimeout(dismiss, 13000); }
    bindFly(f, (delivered) => {
      S.fatCaught++; S.caught++;
      const roll = Math.random();
      if (roll < 0.5) {
        const got = Math.max(30, baseRate() * 30 + perClick() * 20);
        S.flies += got; S.total += got;
        speak(fill(T.fat, { n: fmt(got) }));
      } else if (roll < 0.75) { swarmUntil = now() + 15000; speak(T.swarm); }
      else { stormUntil = now() + 10000; speak(T.storm); }
      if (delivered) {
        S.delivered = (S.delivered || 0) + 1;
        const bonus = flyReward(2);
        const position = kImg.getBoundingClientRect(), bounds = world.getBoundingClientRect();
        reward(bonus);
        pop(`+${fmt(bonus)}`, position.left - bounds.left + position.width / 2, position.top - bounds.top, "small");
        rollTeaBag();
      }
      VS().sound?.("croak");
      kEvent(["fly"]);
      fly?.cancel(); clearTimeout(expiry); activeFatMotion = null; f.remove(); render(); save(); later();
    }, () => {
      fly?.pause();
      clearTimeout(expiry);
    }, () => {
      if (fly) fly.play();
      else expiry = setTimeout(dismiss, 13000);
    });
  };
  const later = () => setTimeout(fat, rnd(25, 55) * 1000);
  later();

  // ---------- buildings at work: now and then one of them bounces and brings its catch ----------
  setInterval(() => {
    if (document.hidden || calm || survivorsActive) return;
    const mine = [...houses.children, ...housesBack.children];
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
      S.activities.compileEnd = 0; S.compiles = (S.compiles || 0) + 1;
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
    finishFlyDrag();
    save();
    if (lockedStorage) writeOwner = false;
  });
  const syncMotion = () => {
    const suspended = document.hidden || survivorsActive;
    host.classList.toggle("sw-paused", suspended);
    if (suspended) {
      finishFlyDrag();
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
      if (hiddenAt) reward(awayIncome(hiddenAt, Date.now()));
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
  // ---------- through the door to the 3D swamp and back ----------
  // Klyop walks to the door, turns his back, gets smaller, the scene goes dark, then the 3D page opens. The 3D page
  // takes the "out" cue and starts at the threshold; coming back it leaves an "in" cue and Klyop walks in here.
  const exitLink = document.querySelector(".sw-walk-link");
  let leaving = false;
  const stopFrames = () => { cancelAnimationFrame(K.raf); K.raf = 0; K.seq = null; K.events.length = 0; };
  const leave = (target) => {
    if (leaving) return;
    leaving = true;
    markThreshold("out", target.pathname);
    S.walks = (S.walks || 0) + 1;
    finishFlyDrag(); save();
    if (calm || document.hidden) { location.href = target.href; return; }
    btn.disabled = true;
    world.dataset.threshold = "out";
    kEvent(["walk"]);
    setTimeout(() => { stopFrames(); kImg.src = "/brand/klyop/back.webp"; }, 450);
    setTimeout(() => { location.href = target.href; }, 1250);
  };
  if (exitLink) {
    exitLink.addEventListener("click", (event) => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      leave(new URL(exitLink.href, location.href));
    });
    // the 3D page's own HTML is light: fetch it as soon as the player reaches for the door
    const prefetch = () => {
      if (document.querySelector("link[data-sw-prefetch]")) return;
      const link = document.createElement("link");
      link.rel = "prefetch"; link.href = exitLink.href; link.dataset.swPrefetch = "";
      document.head.append(link);
    };
    exitLink.addEventListener("pointerenter", prefetch, { once: true });
    exitLink.addEventListener("touchstart", prefetch, { once: true, passive: true });
    exitLink.addEventListener("focus", prefetch, { once: true });
  }
  // back from the 3D swamp (or the page restored from history after leaving): Klyop comes in through the door
  addEventListener("pageshow", () => {
    if (!leaving) return;
    leaving = false; btn.disabled = false; delete world.dataset.threshold;
    if (A && !K.raf && !calm) K.raf = requestAnimationFrame(kTick);
  });
  if (takeThreshold("in") && !calm) {
    world.dataset.threshold = "in";
    requestAnimationFrame(() => requestAnimationFrame(() => {
      world.dataset.threshold = "back";
      kEvent(["walk"]);
      setTimeout(() => { if (world.dataset.threshold === "back") delete world.dataset.threshold; }, 1300);
    }));
  }

  document.addEventListener("vibeswamp:radio", render);
  // event badges that can be seen on opening: a night visit, a trophy brought back from the 3D swamp
  if (new Date().getHours() < 5) grantNow("night");
  try { if (JSON.parse(localStorage.getItem("vibeswamp-first-landing-v1") || "null")?.trophy === true) grantNow("trophy"); } catch {}
  if (note) speak(note);
  // a new player hears once how flies work (the hint list of the old layout is gone)
  else if (S.caught < 3) setTimeout(() => { if (S.caught < 3) speak(U.catchHint); }, 6000);
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
  }).catch((error) => {
    console.error(error);
    host.dataset.swampLocked = "";
    host.textContent = JSON.parse(textEl.textContent || "{}").v2?.saveProblem || "Storage unavailable.";
  });
})();
