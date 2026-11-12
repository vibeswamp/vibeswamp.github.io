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
export const swampMultiplier = (state, data) => (state.done.seams ? 1.5 : 1) * 1.1 ** rankOf(state.total) * (1 + 0.01 * badgeCount(state, data));
export const baseRate = (state, data) => data.buildings.reduce((sum, building) =>
  sum + owned(state, building.id) * building.rate * producerMultiplier(state, building.id, data), 0) * swampMultiplier(state, data);

export function incomeRate(state, data, { radio = false, swarm = false, tea = false } = {}) {
  return baseRate(state, data) * (radio ? (state.done.track ? 1.5 : 1.25) : 1) * (swarm ? 5 : 1) * (tea ? data.activities.tea.multiplier : 1);
}

export function clickValue(state, data, { vibe = false, storm = false } = {}) {
  const passive = baseRate(state, data);
  // a croak brings a share of the passive income (content/swamp-v2.json clickShare; 1/6 before 12.11.2026)
  const croak = (state.done.bug ? 2 : 1) + passive * (data.clickShare ?? 1 / 6);
  return (croak + (state.done.friday ? passive * 0.03 : 0)) * (vibe ? 3 : 1) * (storm ? 7 : 1);
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

export function buyStage(state, data) {
  const next = data.stages[state.stage];
  if (!next || state.total < next.total || state.flies < next.cost) return false;
  state.flies -= next.cost;
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
