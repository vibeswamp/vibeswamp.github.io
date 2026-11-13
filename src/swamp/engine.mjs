// Pure economy shared by the browser and the pacing simulation.
export const RANKS = [0, 500, 5000, 5e4, 5e5, 5e6, 5e7, 5e8, 5e9];
const PAIRS = { rimworld: ["tussock", "antenna"], kfsos: ["flytrap", "stump"], workshop: ["review", "beaver"], stream: ["peat", "radio"] };

export const rankOf = (total) => Math.max(0, RANKS.filter((value) => total >= value).length - 1);
export const owned = (state, id) => state.own[id] || 0;
export const priceOf = (state, building, data) => Math.ceil(building.cost * data.growth ** owned(state, building.id));
export const hasStage = (state, data, id) => data.stages.slice(0, state.stage).some((stage) => stage.id === id);

export function producerMultiplier(state, id, data) {
  let multiplier = data.milestoneMultiplier ** data.milestones.filter((count) => owned(state, id) >= count).length;
  for (const [project, ids] of Object.entries(PAIRS)) {
    if (state.done[project] && ids.includes(id)) multiplier *= 2;
  }
  return multiplier;
}

// Badges the save holds that the game still knows (data.achievements); each gives +1% to the whole swamp.
export const badgeCount = (state, data) => (data?.achievements || []).filter((a) => state.ach?.[a.id]).length;

// ---------- planks, resin and amber (docs/design/economy.md, approved 13.11.2026) ----------
// One warehouse for the clicker and the 3D swamp: block `expedition3d` of the save. Planks and resin are spent, amber
// stays on the shelf. Tolya sells planks and resin for flies, amber only up to what the next step asks for.
// The steps' materials, Tolya's stall and the gear are on only with data.homeMaterials === true: the owner's fly
// courier (13.11) reworks them, so they wait for the new economy.md. Amber on the shelf and the calm night work anyway.
export const materialsOn = (data) => data?.homeMaterials === true;
const LEDGER_VERSION = 1;
const whole = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
export const emptyLedger = () => ({ version: LEDGER_VERSION, amber: 0, extraDash: false, receipt: null, best: null });
export const ledgerOf = (state) => (state.expedition3d?.version === LEDGER_VERSION ? state.expedition3d : emptyLedger());
export const materialsOf = (state) => {
  const ledger = ledgerOf(state);
  return { wood: whole(ledger.warehouse?.wood), resin: whole(ledger.warehouse?.resin), amber: whole(ledger.amber) };
};
// every amber on the shelf adds to the whole swamp, up to a limit
export const shelfBonus = (state, data) => (data?.expedition?.shelf?.bonus ?? 0) * Math.min(materialsOf(state).amber, data?.expedition?.shelf?.max ?? 0);
// "Спокойная ночь": after a night won in 3D the swamp earns more for a while (until this time, ms)
export const calmUntil = (state) => (Number.isFinite(ledgerOf(state).calmUntil) ? ledgerOf(state).calmUntil : 0);
export const calmBoost = (data) => 1 + (data?.expedition?.calm?.bonus ?? 0);

export const swampMultiplier = (state, data) => (state.done.seams ? 1.5 : 1) * 1.1 ** rankOf(state.total) * (1 + 0.01 * badgeCount(state, data))
  * (1 + shelfBonus(state, data));
export const baseRate = (state, data) => data.buildings.reduce((sum, building) =>
  sum + owned(state, building.id) * building.rate * producerMultiplier(state, building.id, data), 0) * swampMultiplier(state, data);

export function incomeRate(state, data, { radio = false, swarm = false, tea = false, calm = false } = {}) {
  return baseRate(state, data) * (radio ? (state.done.track ? 1.5 : 1.25) : 1) * (swarm ? 5 : 1) * (tea ? data.activities.tea.multiplier : 1)
    * (calm ? calmBoost(data) : 1);
}

export function clickValue(state, data, { vibe = false, storm = false, calm = false } = {}) {
  const passive = baseRate(state, data);
  // a croak brings a share of the passive income (content/swamp-v2.json clickShare; 1/6 before 12.11.2026)
  const croak = (state.done.bug ? 2 : 1) + passive * (data.clickShare ?? 1 / 6);
  return (croak + (state.done.friday ? passive * 0.03 : 0)) * (vibe ? 3 : 1) * (storm ? 7 : 1) * (calm ? calmBoost(data) : 1);
}

// What the next step asks for besides flies, and what of it is still missing.
export function stageNeeds(state, data) {
  const next = data.stages[state.stage];
  if (!next) return null;
  const have = materialsOf(state), on = materialsOn(data);
  const need = { wood: on ? next.wood || 0 : 0, resin: on ? next.resin || 0 : 0, amber: on ? next.amber || 0 : 0 };
  return { next, need, miss: { wood: Math.max(0, need.wood - have.wood), resin: Math.max(0, need.resin - have.resin), amber: Math.max(0, need.amber - have.amber) } };
}

// Tolya's price: seconds of the swamp's income, never below a floor, so the stall neither ruins a young swamp nor
// gets cheap late in the game.
export function marketPrice(state, data, item) {
  const market = data.market;
  if (!materialsOn(data) || !market?.[item]) return Infinity;
  const floor = { wood: market.floorWood, resin: market.floorResin, amber: market.floorAmber }[item] ?? 0;
  return Math.max(floor, Math.ceil(market[item] * baseRate(state, data)));
}

// The price of everything the next step lacks (0 when nothing is missing).
export function missingPrice(state, data) {
  const needs = stageNeeds(state, data);
  if (!needs) return 0;
  return ["wood", "resin", "amber"].reduce((sum, item) => sum + (needs.miss[item] ? needs.miss[item] * marketPrice(state, data, item) : 0), 0);
}

const withLedger = (state, change) => {
  const ledger = ledgerOf(state);
  state.expedition3d = { ...ledger, ...change(materialsOf(state)) };
};

// Buy `count` of an item from Tolya. Amber only up to what the next step still lacks.
export function buyMaterial(state, data, item, count = 1) {
  if (!["wood", "resin", "amber"].includes(item) || !Number.isSafeInteger(count) || count < 1) return false;
  if (item === "amber" && count > (stageNeeds(state, data)?.miss.amber ?? 0)) return false;
  const price = marketPrice(state, data, item) * count;
  if (!Number.isFinite(price) || state.flies < price) return false;
  state.flies -= price;
  withLedger(state, (have) => (item === "amber" ? { amber: have.amber + count } : { warehouse: { wood: have.wood, resin: have.resin, [item]: have[item] + count } }));
  state.market = { wood: 0, resin: 0, amber: 0, ...state.market, [item]: (state.market?.[item] || 0) + count };
  return true;
}

// Everything the next step lacks, in one purchase.
export function buyMissing(state, data) {
  const needs = stageNeeds(state, data);
  const price = missingPrice(state, data);
  if (!needs || !price || state.flies < price) return false;
  for (const item of ["wood", "resin", "amber"]) if (needs.miss[item]) buyMaterial(state, data, item, needs.miss[item]);
  return true;
}

// ---------- gear for the 3D swamp, bought in the clicker: a stronger wrench, a bigger bag, a lantern ----------
export const gearOf = (state) => ({
  wrench: Math.min(3, whole(state.gear?.wrench)), bag: Math.min(2, whole(state.gear?.bag)), lantern: state.gear?.lantern === true
});
// "owned"; "open" when its step is built and the level before it is owned; otherwise "closed"
export function gearStatus(state, data, item) {
  const gear = gearOf(state);
  const level = data.gear.filter((other) => other.kind === item.kind).indexOf(item) + 1;
  const have = item.kind === "lantern" ? Number(gear.lantern) : gear[item.kind];
  if (have >= level) return "owned";
  return have === level - 1 && hasStage(state, data, item.after) ? "open" : "closed";
}
export const gearPrice = (state, data, item) => Math.max(1, Math.ceil(item.seconds * baseRate(state, data)));

export function buyGear(state, data, id) {
  if (!materialsOn(data)) return false;
  const item = data.gear.find((other) => other.id === id);
  if (!item || gearStatus(state, data, item) !== "open") return false;
  const have = materialsOf(state), price = gearPrice(state, data, item);
  if (state.flies < price || have.wood < item.wood || have.resin < item.resin) return false;
  state.flies -= price;
  withLedger(state, (stock) => ({ warehouse: { wood: stock.wood - item.wood, resin: stock.resin - item.resin } }));
  const gear = gearOf(state);
  state.gear = { ...gear, [item.kind]: item.kind === "lantern" ? true : gear[item.kind] + 1 };
  return true;
}

export function roomOpen(state, data, id) {
  switch (id) {
    case "shore": return true;
    case "workshop": return hasStage(state, data, "door") || owned(state, "stump") > 0 || owned(state, "review") > 0;
    case "radio": return owned(state, "radio") > 0 || !!state.done.track;
    case "server": return owned(state, "peat") > 0;
    case "office": return hasStage(state, data, "furniture") && rankOf(state.total) >= 3;
    default: return false;
  }
}

export function buyBuilding(state, data, id) {
  const building = data.buildings.find((item) => item.id === id);
  if (!building) return false;
  const price = priceOf(state, building, data);
  if (state.flies < price) return false;
  state.flies -= price;
  state.own[id] = owned(state, id) + 1;
  return true;
}

// A step takes its flies and its planks and resin from the warehouse; amber only has to be on the shelf.
export function canBuildStage(state, data) {
  const needs = stageNeeds(state, data);
  return Boolean(needs) && state.total >= needs.next.total && state.flies >= needs.next.cost
    && !needs.miss.wood && !needs.miss.resin && !needs.miss.amber;
}

export function buyStage(state, data) {
  if (!canBuildStage(state, data)) return false;
  const { next, need } = stageNeeds(state, data);
  state.flies -= next.cost;
  if (need.wood || need.resin) withLedger(state, (have) => ({ warehouse: { wood: have.wood - need.wood, resin: have.resin - need.resin } }));
  state.stage++;
  return true;
}

export function startProject(state, data, id, time) {
  const project = data.builds.find((item) => item.id === id);
  if (!project || state.done[id] || state.run || state.flies < project.cost) return false;
  state.flies -= project.cost;
  state.run = { id, start: time };
  return true;
}

export function finishProject(state, data, time) {
  if (!state.run) return null;
  const project = data.builds.find((item) => item.id === state.run.id);
  if (!project) { state.run = null; return null; }
  if (time - state.run.start < project.sec * 1000) return null;
  state.done[project.id] = true;
  state.run = null;
  return project.id;
}

// Progress of every badge that can be counted from the save: [value, goal]. Badges marked "event" in the data
// (night visit, Klyop asleep, a 3D trophy) are given by the page when they happen.
export function achievementProgress(state, data) {
  const step = (id) => data.stages.findIndex((stage) => stage.id === id) + 1;
  const counts = data.buildings.map((building) => owned(state, building.id));
  const all = counts.reduce((sum, n) => sum + n, 0);
  const n = (key) => state[key] || 0;
  return {
    first_step: [state.stage, 1], roof: [state.stage, step("awning")], window: [state.stage, step("window")],
    home: [state.stage, step("door")], light: [state.stage, step("lamp")], tea_home: [state.stage, step("tea_corner")],
    office: [state.stage, data.stages.length],
    first: [n("clicks"), 1], croaks: [n("clicks"), 1000], hundred: [n("total"), 100], million: [n("total"), 1e6],
    billion: [n("total"), 1e9], hunter: [n("caught"), 25], hunter2: [n("caught"), 250], courier: [n("delivered"), 10],
    fat: [n("fatCaught"), 1],
    crew: [all, 25], crew100: [all, 100], every: [counts.filter(Boolean).length, counts.length],
    ten_each: [Math.min(...counts), 10], rate: [baseRate(state, data), 1000],
    tea: [n("teas"), 1], tea10: [n("teas"), 10], garden: [n("harvests"), 1], compile: [n("compiles"), 1],
    swarm: [n("swarms"), 1], explorer: [(state.visited || []).length, 3], explorer5: [(state.visited || []).length, data.rooms.length],
    vibe10: [n("vibes"), 10], pond: [n("pondSeen") > 0 ? 1 : 0, 1], walker: [n("walks"), 1]
  };
}
