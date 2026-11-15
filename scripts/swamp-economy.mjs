// Economy check: clicker <-> 3D trips <-> building the hut (docs/design/economy.md). No dependencies.
//   node scripts/swamp-economy.mjs            -> tables, curves 0-3 h, parcels, value of 10 minutes, phone, checks
//   node scripts/swamp-economy.mjs --quiet    -> only the checks; exit code 1 if one fails
//   node scripts/swamp-economy.mjs --json     -> everything as JSON (for parameter sweeps)
//   node scripts/swamp-economy.mjs --set key=value ...  -> override a PROPOSAL number, e.g. --set market.wood=40
//   node scripts/swamp-economy.mjs --seeds 10           -> fewer seeds per style (faster, noisier); default 40
//
// The clicker side is the real engine (src/swamp/engine.mjs + content/swamp-v2.json), played like scripts/swamp-pace.mjs:
// 4 croaks a second, a fly every 8 s, best-value building, every project, the next step as soon as it opens.
// The 3D day is a model of src/swamp-walk/expedition.mjs: 120 s day, 30 s dusk, 60 s night, plus a minute of loading,
// the board and the walk home. Chance decides the night and the amber; every style is played with 40 seeds and the
// median is reported.
//
// Where the numbers live: the approved economy (materials of the steps, Tolya's stall, the night's reward, "calm
// night", the shelf, gear) is read from content/swamp-v2.json, so there is one place to change it. The courier, fatigue
// and the gathering by the house (owner's addition of 13.11) are read from there too once the clicker chat adds
// `courier`, `fatigue` and `nodes`; until then the defaults below are used. The 3D side (caches, bag, walls) is a
// model of what economy.md asks the 3D chat to build.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const E = await import(pathToFileURL(join(root, "src/swamp/engine.mjs")).href);
const D = JSON.parse(readFileSync(join(root, "content/swamp-v2.json"), "utf8"));
const args = process.argv.slice(2);
const quiet = args.includes("--quiet"), asJson = args.includes("--json");
const SEEDS = Number(args[args.indexOf("--seeds") + 1]) || 40;   // --seeds 10 for quick parameter sweeps

// ---- Rules -----------------------------------------------------------------------------------------------------
// TODAY: the game before the economy (12.11.2026). Materials only sit in the warehouse, a won day with delivered amber
// pays 120 s of income, the clicker pays half the income for the time spent in 3D, defenses are rebuilt every day.
const TODAY = {
  name: "сейчас",
  materials: {}, amberNeed: {}, market: null,
  inTrip: 0.5,
  reward: { night: 0, amber: 0, needAmber: 120, floor: 15 },
  killCroaks: 0, shelf: null, calm: null,
  caches: { wood: 3, resin: 2 },       // near cache 3+1, resin cache 0+1
  bag: [8], keepDefenses: false, gear: [],
  courier: null, fatigue: null, nodes: null,
};

if (!D.market || !D.expedition || !D.gear) throw new Error("content/swamp-v2.json has no market, expedition or gear block");
const X = D.expedition;
const PROPOSAL = {
  name: "предложение",
  // planks and resin a step needs on top of its flies, amber on the shelf (kept, not spent) before it opens
  materials: Object.fromEntries(D.stages.filter((s) => s.wood || s.resin).map((s) => [s.id, [s.wood || 0, s.resin || 0]])),
  amberNeed: Object.fromEntries(D.stages.filter((s) => s.amber).map((s) => [s.id, s.amber])),
  market: structuredClone(D.market),   // Tolya's stall: seconds of income per plank, resin or amber, with a floor
  inTrip: X.inTrip,                    // share of the income paid for time spent in 3D
  reward: { ...X.reward, needAmber: 0 },   // seconds of income at dawn after a won night, + per amber, floor in flies
  killCroaks: X.killCroaks,            // every enemy beaten pays like this many croaks
  shelf: structuredClone(X.shelf),     // every amber on the shelf: +bonus to income, up to max
  calm: structuredClone(X.calm),       // "Спокойная ночь" after a won night
  caches: { wood: 6, resin: 3 },       // 3D: a third cache behind the ford (3 planks) and one more resin
  lateCaches: { after: "workshop", wood: 3, resin: 1 },   // 3D: the dam cache opens with the workshop step
  bag: [8, 10, 12], keepDefenses: true,
  gear: D.gear.map((g) => ({ ...g, cost: [g.wood || 0, g.resin || 0] })),
  // Fly courier (owner, 13.11). The parts of a big step (and of the first radio) are ordered in the clicker as soon as
  // that step is next. The courier lands at a meeting point in 3D, Klyop carries the parcel home, and the step is built
  // once the parts are home and the flies are there. Nothing expires; Tolya can bring the parcel to the door instead.
  courier: D.courier ?? {
    steps: { door: "post", lamp: "post", tea_corner: "post", workshop: "hill", studio: "hill", office: "hill" },
    buildings: { radio: "hill" },      // radio parts, ordered once the first peat stands
    price: 30, floor: 50,              // the parts: seconds of income, at least this many flies
    eta: { post: 45, hill: 90 },       // seconds from the order until the courier lands
    pickup: { post: 120, hill: 210 },  // a trip just for parcels: loading, there and back, in at the door
    detour: { post: 20, hill: 60 },    // extra seconds when a day passes by the meeting point
    tolya: { seconds: 180, fee: 45 },  // Tolya brings it to the door 3 min after the order, for 45 s of income
  },
  // Soft ceiling: Klyop tires from very fast croaking; a tired croak brings less until he rests. Never stops anything.
  fatigue: D.fatigue ?? { max: 600, regen: 2.5, tired: 0.6 },
  // By the house: two driftwood logs and a resin snag, gathered when Klyop walks past, back after 10 minutes
  nodes: D.nodes ?? { wood: 2, resin: 1, regrow: 600 },
};

// 3D day model, shared by both rule sets
const TRIP = { seconds: 270, short: 150, amberChance: 0.7, kills: 8, wall: [3, 1], repair: [1, 0] };

for (const pair of args.filter((a, i) => args[i - 1] === "--set")) {
  const [path, value] = pair.split("=");
  const keys = path.split(".");
  let target = PROPOSAL;
  for (const key of keys.slice(0, -1)) target = target[key];
  target[keys.at(-1)] = Number(value);
}

// ---- Helpers ---------------------------------------------------------------------------------------------------
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const stageIndex = (id) => D.stages.findIndex((s) => s.id === id);
const median = (xs) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const support = (S) => ["flytrap", "beaver", "stump", "radio"].reduce((sum, id) => {
  const n = E.owned(S, id); return sum + (n >= 7 ? 3 : n >= 3 ? 2 : n >= 1 ? 1 : 0);
}, 0);
const has = (S, id) => Boolean(S.gear[id]);

function fresh(R) {
  return {
    flies: 0, total: 0, clicks: 0, own: {}, done: {}, run: null, stage: 0, caught: 0, activities: {}, visited: ["shore"], ach: {},
    wood: 0, resin: 0, amber: 0, gear: {}, walls: 0, calmUntil: -1, tripSeconds: 0, days: 0, wins: 0, bought: { wood: 0, resin: 0, amber: 0 },
    parcels: [], home: new Set(), delivered: { self: 0, day: 0, tolya: 0 }, waits: [], pickups: 0,
    energy: R.fatigue?.max ?? 0, nodesAt: 0, croakFull: 0, croakAll: 0,
  };
}

function marketPrice(S, R, item) {
  if (!R.market) return Infinity;
  const floor = { wood: R.market.floorWood, resin: R.market.floorResin, amber: R.market.floorAmber }[item];
  return Math.max(floor, Math.ceil(R.market[item] * E.baseRate(S, D)));
}

function stageNeeds(S, R) {
  const next = D.stages[S.stage];
  if (!next) return null;
  const [wood, resin] = R.materials[next.id] || [0, 0];
  return { next, wood, resin, amber: R.amberNeed[next.id] || 0 };
}

// What the next step still lacks in planks, resin and amber, and what Tolya would charge for it.
// Tolya sells amber only up to what the next step asks for, so the shelf bonus is earned in 3D.
function shortfall(S, R) {
  const need = stageNeeds(S, R);
  if (!need) return null;
  const miss = { wood: Math.max(0, need.wood - S.wood), resin: Math.max(0, need.resin - S.resin), amber: Math.max(0, need.amber - S.amber) };
  const price = miss.wood * marketPrice(S, R, "wood") + miss.resin * marketPrice(S, R, "resin") + miss.amber * marketPrice(S, R, "amber");
  return { ...need, miss, price, missing: miss.wood + miss.resin + miss.amber };
}

const calmMult = (S, R, t) => (R.calm && t < S.calmUntil ? 1 + R.calm.bonus : 1)
  * (R.shelf ? 1 + R.shelf.bonus * Math.min(S.amber, R.shelf.max) : 1);

// ---- Courier ---------------------------------------------------------------------------------------------------
const spotOf = (R, kind, id) => R.courier?.[kind === "step" ? "steps" : "buildings"]?.[id];
const key = (kind, id) => `${kind}:${id}`;
const known = (S, kind, id) => S.home.has(key(kind, id)) || S.parcels.some((p) => p.kind === kind && p.id === id);
const partsHome = (S, R, kind, id) => !spotOf(R, kind, id) || S.home.has(key(kind, id));

// Parts that can be ordered now: the next step's, and the radio's once the first peat stands.
function wanted(S, R) {
  if (!R.courier) return [];
  const list = [];
  const next = D.stages[S.stage];
  if (next && spotOf(R, "step", next.id) && !known(S, "step", next.id)) list.push(["step", next.id]);
  for (const id of Object.keys(R.courier.buildings || {})) {
    const before = D.buildings[D.buildings.findIndex((b) => b.id === id) - 1];
    if (!E.owned(S, id) && (!before || E.owned(S, before.id)) && !known(S, "building", id)) list.push(["building", id]);
  }
  return list;
}

function preorder(S, R, t, courier) {
  for (const [kind, id] of wanted(S, R)) {
    const base = E.baseRate(S, D);
    const price = Math.max(R.courier.floor, Math.ceil(R.courier.price * base)) + (courier === "tolya" ? Math.ceil(R.courier.tolya.fee * base) : 0);
    if (S.flies < price) continue;
    S.flies -= price;
    const at = spotOf(R, kind, id);
    S.parcels.push({ kind, id, at, landsAt: t + R.courier.eta[at], arrivesAt: courier === "tolya" ? t + R.courier.tolya.seconds : Infinity });
  }
}

function deliver(S, parcel, t, how) {
  S.parcels = S.parcels.filter((p) => p !== parcel);
  S.home.add(key(parcel.kind, parcel.id));
  S.delivered[how]++;
}

// Tolya's parcels reach the door on their own.
function arrivals(S, t) {
  for (const parcel of [...S.parcels]) if (parcel.arrivesAt <= t) deliver(S, parcel, t, "tolya");
}
const landed = (S, t) => S.parcels.filter((p) => p.arrivesAt === Infinity && p.landsAt <= t);

// ---- Clicker ---------------------------------------------------------------------------------------------------
// market: true = buy whatever is missing from Tolya; a number = buy only if it costs at most that many seconds of income
function tryStage(S, R, t, log, { market }) {
  const need = shortfall(S, R);
  if (!need || S.total < need.next.total || !partsHome(S, R, "step", need.next.id)) return false;
  if (need.missing) {
    const allowed = market === true || (market > 0 && need.price <= market * E.baseRate(S, D));
    if (!allowed || S.flies < need.next.cost + need.price) return false;
    S.flies -= need.price;
    for (const k of ["wood", "resin", "amber"]) { S[k] += need.miss[k]; S.bought[k] += need.miss[k]; }
  }
  if (S.flies < need.next.cost) return false;
  S.flies -= need.next.cost; S.wood -= need.wood; S.resin -= need.resin; S.stage++;
  S.home.delete(key("step", need.next.id));
  log.push([t, S.stage]);
  return true;
}

function tryGear(S, R) {
  for (const g of R.gear) {
    if (S.gear[g.id] || S.stage <= stageIndex(g.after)) continue;
    const price = Math.ceil(g.seconds * E.baseRate(S, D));
    if (S.flies < price || S.wood < g.cost[0] || S.resin < g.cost[1]) continue;
    // keep materials for the next step first
    const need = stageNeeds(S, R);
    if (need && (S.wood - g.cost[0] < need.wood || S.resin - g.cost[1] < need.resin)) continue;
    S.flies -= price; S.wood -= g.cost[0]; S.resin -= g.cost[1]; S.gear[g.id] = true;
  }
}

// A player who can see the next step a few minutes away stops buying buildings and saves for it.
function saving(S, R, market) {
  const need = shortfall(S, R);
  if (!need || S.total < need.next.total) return false;
  const price = need.next.cost + (market && need.missing ? need.price : 0);
  return price - S.flies <= E.baseRate(S, D) * 300;
}

function buyBuildingsAndProjects(S, t, R, market) {
  if (S.run) E.finishProject(S, D, t * 1000);
  if (saving(S, R, market)) return;
  for (const p of D.builds) if (!S.done[p.id] && !S.run && S.flies >= p.cost) E.startProject(S, D, p.id, t * 1000);
  let best = null, score = Infinity;
  for (const b of D.buildings) {
    if (!E.owned(S, b.id) && !partsHome(S, R, "building", b.id)) continue;   // its parts are not home yet
    const s = E.priceOf(S, b, D) / (b.rate * E.producerMultiplier(S, b.id, D));
    if (s < score) { score = s; best = b; }
  }
  if (best && S.flies >= E.priceOf(S, best, D) && E.buyBuilding(S, D, best.id)) S.home.delete(key("building", best.id));
}

function spend(S, R, t, log, market, courier) {
  preorder(S, R, t, courier);
  while (tryStage(S, R, t, log, { market })) preorder(S, R, t, courier);
  tryGear(S, R);
  buyBuildingsAndProjects(S, t, R, market);
}

// One second-by-second stretch of play in the clicker.
function clickFor(S, R, t, seconds, log, { cps = 4, flyEvery = 8, market, courier = "self" }) {
  const dt = 0.5, end = t + seconds;
  for (; t < end && S.stage < D.stages.length; t += dt) {
    if (t % 5 < dt / 2) for (const [id, [v, g]] of Object.entries(E.achievementProgress(S, D))) if (v >= g) S.ach[id] ||= t;
    if (S.parcels.length) arrivals(S, t);
    const m = calmMult(S, R, t);
    S.clicks += cps * dt;
    // fatigue: croaks past what Klyop has in him bring less until he rests
    const croaks = cps * dt;
    let worth = croaks;
    if (R.fatigue) {
      const full = Math.min(croaks, Math.max(0, S.energy));
      worth = full + (croaks - full) * R.fatigue.tired;
      S.energy = Math.min(R.fatigue.max, Math.max(0, S.energy - croaks) + R.fatigue.regen * dt);
    }
    S.croakFull += croaks; S.croakAll += worth;
    let income = (E.incomeRate(S, D) * dt + E.clickValue(S, D) * worth) * m;
    if (flyEvery && t > 0 && t % flyEvery < dt / 2) { S.caught++; income += Math.max(1, E.baseRate(S, D) * 2, E.clickValue(S, D)); }
    S.flies += income; S.total += income;
    spend(S, R, t, log, market, courier);
  }
  return t;
}

// ---- 3D --------------------------------------------------------------------------------------------------------
const rest = (S, R, seconds) => { if (R.fatigue) S.energy = Math.min(R.fatigue.max, S.energy + R.fatigue.regen * seconds); };

function gatherNodes(S, R, t) {
  if (!R.nodes || t < S.nodesAt) return;
  S.wood += R.nodes.wood; S.resin += R.nodes.resin; S.nodesAt = t + R.nodes.regrow;
}

// Back home: spend everything the trip brought, as a player does in the shop.
function spendAll(S, R, t, log, market) {
  for (let i = 0; i < 1000; i++) {
    const before = S.flies;
    spend(S, R, t, log, market, "self");
    if (S.flies === before) break;
  }
}

// A short walk just for the parcels that have landed: out of the door, to the meeting point and back.
function pickupTrip(S, R, t, log, { market = false } = {}) {
  const ready = landed(S, t);
  if (!ready.length) return t;
  const seconds = ready.some((p) => p.at === "hill") ? R.courier.pickup.hill : R.courier.pickup.post;
  for (const parcel of ready) S.waits.push(t - parcel.landsAt);   // how long it sat at the meeting point before Klyop set out
  const income = E.baseRate(S, D) * seconds * R.inTrip * calmMult(S, R, t);
  S.flies += income; S.total += income; S.tripSeconds += seconds; S.pickups++;
  gatherNodes(S, R, t);
  rest(S, R, seconds);
  t += seconds;
  for (const parcel of ready) deliver(S, parcel, t, "self");
  spendAll(S, R, t, log, market);
  return t;
}

// One 3D day (or a short day-only trip). Income for the time away is paid on return, as the clicker does.
function trip(S, R, t, log, random, { short = false, market = false, spend: spendAfter = true } = {}) {
  let seconds = short ? TRIP.short : TRIP.seconds;
  // parcels that land before the middle of the day are picked up on the way
  const ready = R.courier ? S.parcels.filter((p) => p.arrivesAt === Infinity && p.landsAt <= t + seconds / 2) : [];
  if (ready.length) seconds += ready.some((p) => p.at === "hill") ? R.courier.detour.hill : R.courier.detour.post;
  if (spendAfter) gatherNodes(S, R, t);
  rest(S, R, seconds);
  const base = E.baseRate(S, D);
  const away = base * seconds * R.inTrip * calmMult(S, R, t);
  // gathering: the caches of the day, limited by the bag and a short second run
  const bag = R.bag[Math.min(R.bag.length - 1, (has(S, "bag1") ? 1 : 0) + (has(S, "bag2") ? 1 : 0))];
  const late = R.lateCaches && S.stage > stageIndex(R.lateCaches.after) ? R.lateCaches : { wood: 0, resin: 0 };
  const cw = R.caches.wood + late.wood, cr = R.caches.resin + late.resin;
  const take = Math.min(1, (bag + 1) / (cw + cr));
  let wood = Math.round(cw * take), resin = Math.round(cr * take);
  if (short) { wood = Math.round(wood * 0.75); resin = Math.round(resin * 0.75); }
  const amber = random() < TRIP.amberChance + (has(S, "lantern") ? 0.15 : 0) ? 1 : 0;
  S.wood += wood; S.resin += resin; S.amber += amber;
  let flies = away;
  if (!short) {
    // dusk: defenses. Before the economy a wall was rebuilt every day; now walls stay and only get repaired.
    const pads = R.keepDefenses ? Math.min(2, 1 + (S.stage >= stageIndex("door") ? 1 : 0)) : 1;
    if (!R.keepDefenses || S.walls < pads) {
      if (S.wood >= TRIP.wall[0] && S.resin >= TRIP.wall[1]) { S.wood -= TRIP.wall[0]; S.resin -= TRIP.wall[1]; S.walls = R.keepDefenses ? S.walls + 1 : 1; }
    } else if (S.wood >= TRIP.repair[0] && random() < 0.6) S.wood -= TRIP.repair[0];
    const wrench = ["wrench1", "wrench2", "wrench3"].filter((id) => has(S, id)).length;
    const p = Math.min(0.95, Math.max(0.35, 0.5 + 0.012 * S.stage + 0.02 * support(S) + 0.12 * Math.min(S.walls, 2) + 0.05 * wrench));
    const won = random() < p;
    if (!R.keepDefenses) S.walls = 0;
    S.days++;
    if (won) {
      S.wins++;
      const secs = R.reward.needAmber ? (amber ? R.reward.needAmber : 0) : R.reward.night + R.reward.amber * amber;
      flies += secs ? Math.max(R.reward.floor, base * secs * calmMult(S, R, t)) : 0;
      if (R.killCroaks) flies += TRIP.kills * R.killCroaks * E.clickValue(S, D);
      if (R.calm) S.calmUntil = t + seconds + R.calm.seconds;
    } else if (R.keepDefenses && S.walls) S.walls--;   // a lost night breaks one wall
  }
  S.flies += flies; S.total += flies; S.tripSeconds += seconds;
  t += seconds;
  if (!spendAfter) return t;
  for (const parcel of ready) deliver(S, parcel, t, "day");
  spendAll(S, R, t, log, market);
  return t;
}

// ---- Styles ----------------------------------------------------------------------------------------------------
const LIMIT = 180 * 60;
const STYLES = {
  clicker: { label: "только кликер" },
  trips: { label: "только вылазки" },
  mixed: { label: "смешанный" },
};

function play(R, style, seed, limit = LIMIT) {
  const S = fresh(R), log = [], random = rng(seed);
  const snaps = [];
  let t = 0, nextSnap = 0, sinceTrip = 0;
  const snap = () => { while (t >= nextSnap && nextSnap <= limit) { snaps.push({ t: nextSnap, stage: S.stage, total: S.total }); nextSnap += 600; } };
  while (t < limit && S.stage < D.stages.length) {
    // only the clicker: everything missing from Tolya, every parcel brought by Tolya
    if (style === "clicker") t = clickFor(S, R, t, 60, log, { market: true, courier: "tolya" });
    else if (style === "trips") {
      // two minutes of clicking to get the swamp going, then day after day; the clicker is opened only to spend
      t = t < 120 ? clickFor(S, R, t, 120, log, { market: false }) : trip(S, R, t, log, random);
    } else {
      // mixed: click; go out for a day when the next step waits for materials Tolya sells dear, or after 15 minutes;
      // a parcel that has landed is fetched at once (with a day, if one is due within 5 minutes anyway);
      // buy from Tolya when the missing part costs under a minute of income
      const need = shortfall(S, R);
      const blocked = need && need.missing && S.total >= need.next.total * 0.6 && need.price > E.baseRate(S, D) * 60;
      const waiting = landed(S, t).length > 0;
      if ((blocked || sinceTrip >= 900 || (waiting && sinceTrip >= 600)) && t > 120) { t = trip(S, R, t, log, random, { market: 60 }); sinceTrip = 0; }
      else if (waiting) t = pickupTrip(S, R, t, log, { market: 60 });
      else { t = clickFor(S, R, t, 30, log, { market: 60 }); sinceTrip += 30; }
    }
    snap();
  }
  snap();
  while (nextSnap <= limit) { snaps.push({ t: nextSnap, stage: S.stage, total: S.total }); nextSnap += 600; }   // finished early
  const at = Object.fromEntries(D.stages.map((s, i) => [s.id, log.find(([, n]) => n === i + 1)?.[0] ?? NaN]));
  const times = D.stages.map((s) => at[s.id]).filter(Number.isFinite);
  const longest = Math.max(...times.map((x, i) => x - (times[i - 1] ?? 0)));
  return {
    at, snaps, S, longest, tripShare: S.tripSeconds / Math.max(1, Math.min(t, limit)), bought: S.bought, days: S.days, wins: S.wins,
    delivered: S.delivered, wait: median(S.waits), pickups: S.pickups, croakLoss: 1 - S.croakAll / Math.max(1, S.croakFull),
  };
}

function summary(R, style, seeds = SEEDS) {
  const runs = Array.from({ length: seeds }, (_, i) => play(R, style, 1000 + i));
  const at = Object.fromEntries(D.stages.map((s) => [s.id, median(runs.map((r) => r.at[s.id]))]));
  const curve = Array.from({ length: LIMIT / 600 + 1 }, (_, i) => median(runs.map((r) => (r.snaps[i] ?? r.snaps.at(-1)).stage)));
  const med = (f) => median(runs.map(f));
  return {
    at, curve,
    longest: med((r) => r.longest), tripShare: med((r) => r.tripShare), days: med((r) => r.days), wins: med((r) => r.wins),
    bought: { wood: med((r) => r.bought.wood), resin: med((r) => r.bought.resin), amber: med((r) => r.bought.amber) },
    delivered: Object.fromEntries(["self", "day", "tolya"].map((k) => [k, med((r) => r.delivered[k])])),
    wait: med((r) => r.wait), pickups: med((r) => r.pickups), croakLoss: med((r) => r.croakLoss),
  };
}

// Value of ten minutes from the mixed player's state at a given minute: ten minutes of clicking against two 3D days.
function tenMinutes(R, minute) {
  const S = play(R, "mixed", 7, minute * 60).S;
  const base = E.baseRate(S, D);
  const clicked = structuredClone(S); clicked.flies = 0;
  const dt = 0.5; let flies = 0;
  const shelf = calmMult(clicked, R, Infinity);   // the shelf bonus only, no "calm night"
  let energy = R.fatigue?.max ?? Infinity;          // a rested Klyop
  for (let t = 0; t < 600; t += dt) {
    const croaks = 4 * dt, full = Math.min(croaks, Math.max(0, energy));
    const worth = R.fatigue ? full + (croaks - full) * R.fatigue.tired : croaks;
    if (R.fatigue) energy = Math.min(R.fatigue.max, Math.max(0, energy - croaks) + R.fatigue.regen * dt);
    flies += (E.incomeRate(clicked, D) * dt + E.clickValue(clicked, D) * worth) * shelf;
    if (t > 0 && t % 8 < dt / 2) flies += Math.max(1, base * 2, E.clickValue(clicked, D));
  }
  // two days from the same state: walls and gear as the player has them, nothing spent in the clicker afterwards
  const out = structuredClone(S); out.flies = 0; out.parcels = [];
  const random = rng(11); let t = 0; const log = [];
  for (let k = 0; k < 2; k++) t = trip(out, R, t, log, random, { spend: false });
  const wood = out.wood - S.wood, resin = out.resin - S.resin, amber = out.amber - S.amber;
  const goods = wood * marketPrice(S, R, "wood") + resin * marketPrice(S, R, "resin");
  return { minute, base, clickFlies: flies, tripFlies: out.flies, tripGoods: Number.isFinite(goods) ? goods : 0, wood, resin, amber };
}

// Phone: 5-minute sessions with 2 hours between them (the clicker pays half the income for up to 2 hours away).
// Without 3D, Tolya brings every parcel. With 3D, a parcel is fetched as soon as it has landed (order, courier, walk:
// 2-3 minutes) and every other session has a short day-only trip.
function phone(R, alternate, sessions = 16) {
  const S = fresh(R), log = [], random = rng(5);
  const courier = alternate ? "self" : "tolya", market = true;
  let t = 0; const at = [];
  for (let i = 0; i < sessions; i++) {
    const start = t;
    if (S.parcels.length) arrivals(S, t);
    if (alternate && i % 2 === 1) t = trip(S, R, t, log, random, { short: true, market });
    while (t - start < 300) {
      if (S.stage >= D.stages.length) { t = start + 300; break; }   // the hut is done, nothing left to wait for
      if (alternate && landed(S, t).length) t = pickupTrip(S, R, t, log, { market });
      else t = clickFor(S, R, t, Math.min(15, 300 - (t - start)), log, { market, courier });
    }
    rest(S, R, 7200);
    const away = E.baseRate(S, D) * 7200 * 0.5;
    S.flies += away; S.total += away; t += 7200;
    if (S.parcels.length) arrivals(S, t);
    spend(S, R, t, log, market, courier);
    while (tryStage(S, R, t, log, { market })) { /* spend on opening the app */ }
    at.push(S.stage);
  }
  return at;
}

// ---- Report ----------------------------------------------------------------------------------------------------
const fmt = (s) => (Number.isFinite(s) ? `${Math.round(s / 60)} мин` : "—");
const big = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} млрд` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} млн` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} тыс.` : `${Math.round(n)}`);
const result = {};
for (const R of [TODAY, PROPOSAL]) {
  result[R.name] = Object.fromEntries(Object.keys(STYLES).map((style) => [style, summary(R, style)]));
}
const P = result[PROPOSAL.name], T = result[TODAY.name];
const keySteps = ["awning", "door", "lamp", "tea_corner", "workshop", "studio", "office"];
const ten = [20, 60, 120].map((m) => tenMinutes(PROPOSAL, m));
const phones = { clicker: phone(PROPOSAL, false), mixed: phone(PROPOSAL, true) };

const office = (r) => r.at.office;
const C = PROPOSAL.courier;
const checks = [
  ["первые 15 минут кликер-only не замедлился против «сейчас» больше чем на 25%",
    P.clicker.at.wall_l <= T.clicker.at.wall_l * 1.25],
  ["смешанный доходит до студии за 60–110 мин", office(P.mixed) >= 3600 && office(P.mixed) <= 6600],
  ["смешанный быстрее «только кликера» хотя бы на 15%", office(P.mixed) <= office(P.clicker) / 1.15],
  ["«только кликер» не дольше 2 ч 30 мин", office(P.clicker) <= 9000],
  // since 13.11 the clicker alone is meant to run into a soft ceiling (owner): its longest step may reach 14 minutes,
  // the mixed player's must stay under 10
  ["самый долгий шаг: у смешанного до 10 мин, у «только кликера» до 14 мин", P.mixed.longest <= 600 && P.clicker.longest <= 840],
  ["«только вылазки» доходит до студии за 3 часа", office(P.trips) <= LIMIT],
  ["смешанный проводит в 3D от 20 до 60% времени", P.mixed.tripShare >= 0.2 && P.mixed.tripShare <= 0.6],
  ["10 мин в 3D стоят 0,9–1,8 от 10 мин кликанья, доски и смола по цене Толи, янтарь не в счёт (мин. 20, 60, 120)",
    ten.every((v) => { const r = (v.tripFlies + v.tripGoods) / v.clickFlies; return r >= 0.9 && r <= 1.8; })],
  ["10 мин в 3D дают меньше мух, чем 10 мин кликанья (мухи — дело кликера)", ten.every((v) => v.tripFlies < v.clickFlies)],
  ["телефон: с короткими вылазками через раз к 4-й и 8-й сессии шагов не меньше, чем без них",
    phones.mixed[3] >= phones.clicker[3] && phones.mixed[7] >= phones.clicker[7]],
  ["посылка, за которой смешанный ходит отдельно, ждёт у точки встречи не дольше 3 мин (медиана)", !C || !(P.mixed.wait > 180)],
  ["усталость срезает у кликера не больше 15% кваков", P.clicker.croakLoss <= 0.15],
  ["телефон: заказ, прилёт курьера и забор ближней посылки не дольше 3 мин", !C || C.eta.post + C.pickup.post <= 180],
];

if (asJson) {
  console.log(JSON.stringify({ result, ten, phones, checks: checks.map(([l, ok]) => ({ label: l, ok })) }, null, 1));
} else if (!quiet) {
  console.log(`\n== Когда построен шаг (медиана ${SEEDS} прогонов) ==`);
  console.log("шаг".padEnd(12) + Object.values(STYLES).flatMap(({ label }) => [`${label}, сейчас`.padStart(26), `${label}, предл.`.padStart(26)]).join(""));
  for (const id of keySteps) {
    console.log(id.padEnd(12) + Object.keys(STYLES).flatMap((s) => [fmt(T[s].at[id]).padStart(26), fmt(P[s].at[id]).padStart(26)]).join(""));
  }
  console.log("\n== Шагов построено к минуте (предложение) ==");
  console.log("минута".padEnd(16) + P.clicker.curve.map((_, i) => String(i * 10).padStart(5)).join(""));
  for (const [s, { label }] of Object.entries(STYLES)) console.log(label.padEnd(16) + P[s].curve.map((n) => String(n).padStart(5)).join(""));
  console.log("\n== То же сейчас ==");
  for (const [s, { label }] of Object.entries(STYLES)) console.log(label.padEnd(16) + T[s].curve.map((n) => String(n).padStart(5)).join(""));
  console.log("\n== Кто сколько ходил в 3D и сколько докупил у Толи (предложение) ==");
  for (const [s, { label }] of Object.entries(STYLES)) {
    const r = P[s];
    console.log(`${label.padEnd(16)} доля времени в 3D ${Math.round(r.tripShare * 100)}%, дней ${r.days}, побед ${r.wins}; куплено: доски ${r.bought.wood}, смола ${r.bought.resin}, янтарь ${r.bought.amber}; самый долгий шаг ${fmt(r.longest)} (сейчас ${fmt(T[s].longest)})`);
  }
  console.log("\n== Посылки и усталость (предложение) ==");
  for (const [s, { label }] of Object.entries(STYLES)) {
    const r = P[s];
    console.log(`${label.padEnd(16)} посылки: сам ${r.delivered.self}, по пути в 3D-дне ${r.delivered.day}, принёс Толя ${r.delivered.tolya}; ждала у точки ${Number.isFinite(r.wait) ? Math.round(r.wait) + " с" : "—"}; отдельных походов за посылкой ${r.pickups}; усталость срезала ${Math.round(r.croakLoss * 100)}% кваков`);
  }
  console.log("\n== 10 минут кликанья против двух дней в 3D (смешанный игрок, предложение) ==");
  for (const v of ten) {
    console.log(`мин. ${String(v.minute).padStart(3)}: доход ${big(v.base)}/с; кликер ${big(v.clickFlies)} мух; 3D ${big(v.tripFlies)} мух + доски ${v.wood}, смола ${v.resin} (у Толи ${big(v.tripGoods)}) + янтарь ${v.amber}; 3D/кликер = ${((v.tripFlies + v.tripGoods) / v.clickFlies).toFixed(2)}`);
  }
  console.log("\n== Телефон: 16 сессий по 5 минут через 2 часа, шагов после каждой ==");
  console.log(`только кликер        ${phones.clicker.join(" ")}`);
  console.log(`через раз вылазка    ${phones.mixed.join(" ")}`);
  console.log("\n== Цены снаряжения в мухах (секунды дохода в момент открытия у смешанного игрока) ==");
  const m = play(PROPOSAL, "mixed", 1000);
  for (const g of PROPOSAL.gear) {
    console.log(`${g.id.padEnd(8)} после «${g.after}» (≈ ${fmt(m.at[g.after])}): ${g.seconds} с дохода + доски ${g.cost[0]}, смола ${g.cost[1]}; шаг ${stageIndex(g.after) + 1}`);
  }
  console.log("");
}
if (!asJson) {
  for (const [label, ok] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  console.log(`студия: кликер ${fmt(office(P.clicker))}, вылазки ${fmt(office(P.trips))}, смешанный ${fmt(office(P.mixed))} (сейчас: ${fmt(office(T.clicker))}, ${fmt(office(T.trips))}, ${fmt(office(T.mixed))})`);
}
if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
