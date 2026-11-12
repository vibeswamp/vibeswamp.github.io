import { rankOf, roomOpen } from "./engine.mjs";

const LEGACY_SAVE_KEY = "vibeswamp-swamp";
export const SAVE_KEY = "vibeswamp-swamp:v2";
const V1_BACKUP = `${LEGACY_SAVE_KEY}:v1-backup`;
const number = (value, fallback = 0) => Number.isFinite(value) && value >= 0 ? value : fallback;
const dictionary = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

export function freshSave(pondSeen = 0, time = Date.now()) {
  return {
    v: 2, flies: 0, total: 0, clicks: 0, own: {}, done: {}, run: null, t: time, pondSeen, rank: 0,
    stage: 0, room: "shore", ach: {}, visited: ["shore"], caught: 0, fatCaught: 0, teas: 0, teaBags: 0, sinceBag: 0,
    delivered: 0, harvests: 0, compiles: 0, swarms: 0, vibes: 0, walks: 0,
    activities: { gardenReady: 0, compileEnd: 0, compileReady: 0, teaUntil: 0, teaReady: 0, tongueReady: 0 }
  };
}

export function migrateSave(raw, data, time = Date.now()) {
  if (raw == null) return freshSave(0, time);
  if (raw.v !== 1 && raw.v !== 2) throw new Error("unsupported-save");
  const state = { ...freshSave(0, time), ...raw, v: 2 };
  for (const key of ["flies", "total", "clicks", "pondSeen", "caught", "fatCaught", "teas", "delivered", "harvests", "compiles", "swarms", "vibes", "walks"]) state[key] = number(state[key]);
  state.teaBags = Math.floor(number(state.teaBags));
  state.sinceBag = Math.floor(number(state.sinceBag));
  state.total = Math.max(state.total, state.flies);
  state.t = number(state.t, time);
  state.rank = rankOf(state.total);
  state.own = Object.fromEntries(Object.entries(dictionary(state.own)).map(([id, count]) => [id, Math.floor(number(count))]));
  state.done = { ...dictionary(state.done) };
  state.ach = { ...dictionary(state.ach) };
  state.run = state.run && data.builds.some((item) => item.id === state.run.id) && Number.isFinite(state.run.start)
    ? { ...state.run } : null;
  // Existing players receive the construction their lifetime catch has already earned.
  state.stage = raw.v === 1
    ? data.stages.filter((stage) => state.total >= stage.total).length
    : Math.min(data.stages.length, Math.floor(number(state.stage)));
  state.room = roomOpen(state, data, state.room) ? state.room : "shore";
  const visited = Array.isArray(state.visited) ? state.visited : [];
  state.visited = [...new Set(["shore", ...visited.filter((id) => data.rooms.some((room) => room.id === id)), state.room])];
  state.activities = Object.fromEntries(Object.keys(freshSave().activities).map((key) => [key, number(dictionary(raw.activities)[key])]));
  return state;
}

export function readSaveText(storage) {
  return storage?.getItem(SAVE_KEY) ?? storage?.getItem(LEGACY_SAVE_KEY) ?? null;
}

export function loadSave(storage, data, time = Date.now()) {
  const encoded = readSaveText(storage);
  const raw = encoded ? JSON.parse(encoded) : null;
  const state = migrateSave(raw, data, time);
  // Write the original verbatim before the caller can persist v2. A failed backup aborts migration.
  if (raw?.v === 1 && storage.getItem(V1_BACKUP) == null) storage.setItem(V1_BACKUP, encoded);
  return state;
}

export function persistSave(storage, state, time = Date.now()) {
  const snapshot = { ...state, t: time };
  storage.setItem(SAVE_KEY, JSON.stringify(snapshot));
  state.t = time;
}

// Which steps are built, in the order of content/swamp-v2.json. Today the save keeps a count (state.stage) of steps
// built from the start of the list; a later save version may keep ids, so callers ask here instead of slicing.
export function builtStages(state, data) {
  return new Set(data.stages.slice(0, state.stage).map(({ id }) => id));
}

// What the hut holds, for the 3D swamp (src/swamp-walk) and anyone else outside the clicker. Read-only: no writes,
// no DOM. An unreadable or unknown save gives an empty hut. `decor` is reserved for hut decorations (badges, pots);
// it is empty until the clicker has them.
export function readShelter(storage, data) {
  let raw = null;
  try {
    raw = JSON.parse(readSaveText(storage) ?? "null");
  } catch {
    // a damaged record opens an empty hut
  }
  let state;
  try {
    state = migrateSave(raw, data);
  } catch (error) {
    if (error.message !== "unsupported-save") throw error;
    state = migrateSave(null, data);
  }
  return {
    stages: builtStages(state, data),
    owned: Object.fromEntries(data.buildings.filter(({ id }) => state.own[id] > 0).map(({ id }) => [id, state.own[id]])),
    projects: new Set(data.builds.filter(({ id }) => state.done[id]).map(({ id }) => id)),
    decor: new Set(),
  };
}
