// The game day of «Первый причал» as plain logic (candidate C, 12.11): phases, bag, caches, amber, stock, defenses.
// Economy of 13.11 (docs/design/economy.md): the clicker's gear widens the bag, strengthens the wrench and shortens the
// amber hold; walls stand between days (the clicker keeps them, "defense"); after unloading at dusk Klyop may go home
// before dark (no night, no reward, no wall broken).
import { DAY_STOPS } from "./day-world.mjs";
import { WAVE_TIMES } from "./p01-waves.mjs";

export { WAVE_TIMES };
export const EXPEDITION_HZ = 90;
export const DURATION = { day: 120, dusk: 30, night: 60 };
const DUSK_TICK = DURATION.day * EXPEDITION_HZ;
const NIGHT_TICK = DUSK_TICK + DURATION.dusk * EXPEDITION_HZ;
const DAWN_TICK = NIGHT_TICK + DURATION.night * EXPEDITION_HZ;
const WAVE_TICKS = WAVE_TIMES.map(seconds => NIGHT_TICK + seconds * EXPEDITION_HZ);
export const BAG_SIZE = 8;
// Walls stand between days, at most two of them; a broken one (hp 0) stays on its pad until repaired.
export const MOST_WALLS = 2;
// The amber hold in seconds, without and with the lantern from the clicker.
export const AMBER_HOLD = { plain: 6, lantern: 4 };
export const PADS = [
  { x: -7.5, z: 23.8, approach: "shore" },
  { x: 0, z: 22.7, approach: "deck" },
  { x: -8.5, z: 24.7, approach: "shore" },
  { x: -0.9, z: 24.6, approach: "deck" },
];
export const COST = {
  wall: { wood: 3, resin: 1 },
  trap: { wood: 2, resin: 2 },
  forge: { wood: 2, resin: 2 },
  repair: { wood: 1, resin: 0 },
};
export const BUILDS = ["tongue", "slam", "nut"];
const materials = ["wood", "resin"];
const empty = () => ({ wood: 0, resin: 0 });
export const load = (bag) => bag.wood + bag.resin;
export const active = (run) => Boolean(DURATION[run?.phase]);
export const supportTier = (count) => (count >= 7 ? 3 : count >= 3 ? 2 : count >= 1 ? 1 : 0);

function install(run, pad, kind) {
  pad.kind = kind;
  pad.maxHp = kind === "wall" ? 102 + 12 * run.support.beaver : 80;
  pad.hp = pad.maxHp;
}

// The day's caches: the bank, the resin stump and beyond the ford; the dam cache once the hut has its workshop.
export function dayCaches(stops = DAY_STOPS, workshop = false) {
  return [
    { ...stops.nearCache, wood: 3, resin: 1 },
    { ...stops.resinCache, wood: 0, resin: 2 },
    { ...stops.fordCache, wood: 3, resin: 0 },
    ...(workshop ? [{ ...stops.damCache, wood: 3, resin: 1 }] : []),
  ];
}

const whole = (value, most) => Math.max(0, Math.min(most, Number.isSafeInteger(value) ? value : 0));

export function startDay({ id, stage, owned, extraDash, stock = empty(), gear = {}, pads = [], workshop = false }, stops = DAY_STOPS) {
  const hp = 235 + (stage >= 10 ? 60 : stage >= 4 ? 30 : 0);
  const kit = { wrench: whole(gear.wrench, 3), bag: whole(gear.bag, 2), lantern: gear.lantern === true };
  const run = {
    id, phase: "day", tick: 0, elapsed: 0, nextWave: 0, extraDash, gear: kit,
    bagSize: BAG_SIZE + 2 * kit.bag, damage: 1 + 0.2 * kit.wrench,
    amberHold: kit.lantern ? AMBER_HOLD.lantern : AMBER_HOLD.plain,
    bag: { ...empty(), amber: false }, stock: { ...stock }, deliveredMaterials: empty(),
    caches: dayCaches(stops, workshop),
    amberProgress: 0, amberTaken: false, delivered: false, discarded: false,
    base: { hp, maxHp: hp }, pads: PADS.map(pad => ({ ...pad, kind: null, hp: 0, maxHp: 0, cooldown: 0 })),
    support: Object.fromEntries(["flytrap", "beaver", "stump", "radio"].map(key => [key, supportTier(owned[key])])),
    build: null, forged: false, kills: 0,
  };
  // Walls from earlier days, in pad order; the clicker breaks the last standing one after a lost night.
  pads.slice(0, PADS.length).forEach((saved, index) => {
    if (saved?.kind !== "wall" || walls(run) >= MOST_WALLS) return;
    const pad = run.pads[index];
    install(run, pad, "wall");
    pad.hp = Math.max(0, Math.min(pad.maxHp, Number.isFinite(saved.hp) ? Math.round(saved.hp) : pad.maxHp));
  });
  // The free trap of the day goes on the first empty pad.
  const free = run.pads.find(pad => !pad.kind);
  if (free) install(run, free, "trap");
  return run;
}

export const walls = (run) => run.pads.filter(pad => pad.kind === "wall").length;

// The whole list for the clicker's save ("defense"), in pad order. Only walls stay between days: traps and empty pads
// go as "none" with no hp, so a lost night can only break a wall.
export function defenseList(run) {
  return run.pads.map(pad => (pad.kind === "wall" ? { kind: "wall", hp: Math.max(0, Math.round(pad.hp)) } : { kind: "none", hp: 0 }));
}

// "Домой до темноты": after unloading at dusk, with nothing left in the bag.
export function canGoHome(run) {
  return run?.phase === "dusk" && !load(run.bag) && !run.bag.amber;
}

export function goHome(run) {
  if (!canGoHome(run)) return false;
  run.phase = "home";
  return true;
}

export function timeLeft(run) {
  return Math.max(0, (DURATION[run?.phase] ?? 0) - (run?.elapsed ?? 0));
}

export function advanceExpedition(run, spawn) {
  if (!active(run)) return;
  run.tick++;
  if (run.tick < DUSK_TICK) {
    run.elapsed = run.tick / EXPEDITION_HZ;
  } else if (run.tick < NIGHT_TICK) {
    run.phase = "dusk";
    run.elapsed = (run.tick - DUSK_TICK) / EXPEDITION_HZ;
  } else if (run.tick < DAWN_TICK) {
    run.phase = "night";
    run.elapsed = (run.tick - NIGHT_TICK) / EXPEDITION_HZ;
    if (run.tick === NIGHT_TICK) run.amberProgress = 0;
    if (run.tick === WAVE_TICKS[run.nextWave]) spawn(run.nextWave++);
  } else {
    run.phase = "dawn";
    run.elapsed = DURATION.night;
  }
}

export function gather(run, cache) {
  if (run.phase !== "day") return false;
  let taken = 0;
  for (const key of materials) {
    const amount = Math.min(cache[key], (run.bagSize ?? BAG_SIZE) - load(run.bag));
    run.bag[key] += amount;
    cache[key] -= amount;
    taken += amount;
  }
  return taken > 0;
}

export function holdAmber(run, dt, present) {
  if (!["day", "dusk"].includes(run.phase) || run.amberTaken) return false;
  const hold = run.amberHold ?? AMBER_HOLD.plain;
  run.amberProgress = present ? Math.min(hold, run.amberProgress + dt) : 0;
  if (run.amberProgress < hold) return false;
  run.amberTaken = run.bag.amber = true;
  return true;
}

export function unload(run) {
  if (run.bag.amber) {
    run.bag.amber = false;
    run.delivered = true;
  }
  for (const key of materials) {
    run.stock[key] += run.bag[key];
    run.deliveredMaterials[key] += run.bag[key];
    run.bag[key] = 0;
  }
}

export function dropMaterials(run) {
  Object.assign(run.bag, empty());
  run.discarded = true;
}

export function fordAllowsMovement({ entry, exit, width }, x, z) {
  const dx = exit[0] - entry[0], dz = exit[1] - entry[1];
  const length = Math.hypot(dx, dz);
  const px = x - entry[0], pz = z - entry[1];
  const along = (px * dx + pz * dz) / length;
  const side = Math.abs(pz * dx - px * dz) / length;
  return along <= .2 || along >= length + .3 || side >= width / 2 + .22;
}

export function fail(run, reason) {
  if (!active(run)) return;
  dropMaterials(run);
  run.bag.amber = false;
  run.phase = "lost";
  run.reason = reason;
}

export function canSpend(run, kind, target) {
  const cost = COST[kind];
  if (!cost || !materials.every(key => run.stock[key] >= cost[key])) return false;
  if (kind === "repair") return ["dusk", "dawn"].includes(run.phase) && target?.hp < target?.maxHp;
  if (run.phase !== "dusk") return false;
  if (kind === "forge") return !run.forged;
  if (kind === "wall" && walls(run) >= MOST_WALLS) return false;
  return target && !target.kind;
}

export function spend(run, kind, target) {
  if (!canSpend(run, kind, target)) return false;
  for (const key of materials) run.stock[key] -= COST[kind][key];
  // A wall broken on a lost night comes back whole for its plank; a damaged one gets a patch.
  if (kind === "repair") target.hp = target.hp <= 0 && target.kind === "wall" ? target.maxHp
    : Math.min(target.maxHp, target.hp + 31 + 6 * run.support.stump);
  else if (kind === "forge") run.forged = true;
  else install(run, target, kind);
  return true;
}
