import { migrateSave, readSaveText } from "../swamp/save.mjs";

export function readShelter(storage, economyData) {
  let raw = null;
  try {
    raw = JSON.parse(readSaveText(storage) ?? "null");
  } catch {
    // The walk can open with an empty shelter if the profile is unavailable.
  }

  let state;
  try {
    state = migrateSave(raw, economyData);
  } catch (error) {
    if (error.message !== "unsupported-save") throw error;
    state = migrateSave(null, economyData);
  }

  return {
    stages: new Set(economyData.stages.slice(0, state.stage).map(({ id }) => id)),
    owned: Object.fromEntries(economyData.buildings.filter(({ id }) => state.own[id] > 0).map(({ id }) => [id, state.own[id]])),
    projects: new Set(economyData.builds.filter(({ id }) => state.done[id]).map(({ id }) => id)),
  };
}
