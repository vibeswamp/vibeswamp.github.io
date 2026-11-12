import { LANDMARKS } from "./land.mjs";

export const WALK_SAVE_KEY = "vibeswamp-first-landing-v1";
const landmarkIds = new Set(LANDMARKS.map(({ id }) => id));

export function openWorldSave(storage) {
  const state = {
    seen: new Set(), trophy: false, radio: false, shortcut: false,
    // save(true) stores the trophy and marks it in memory only after the write succeeded.
    save(trophy = state.trophy) {
      try {
        storage().setItem(WALK_SAVE_KEY, JSON.stringify({
          v: 1, seen: [...state.seen], trophy, radio: state.radio, shortcut: state.shortcut,
        }));
        state.trophy = trophy;
        return true;
      } catch { return false; }
    },
    reset() {
      try { storage().removeItem(WALK_SAVE_KEY); }
      catch { return false; }
      state.seen.clear();
      state.trophy = state.radio = state.shortcut = false;
      return true;
    },
  };
  try {
    const data = JSON.parse(storage().getItem(WALK_SAVE_KEY));
    if (data && (data.v === 1 || data.v === undefined)) {
      if (Array.isArray(data.seen)) for (const id of data.seen) if (landmarkIds.has(id)) state.seen.add(id);
      state.trophy = data.trophy === true;
      state.radio = data.radio === true;
      state.shortcut = data.shortcut === true;
    }
  } catch {
    // A missing or damaged local record must not prevent loading the scene.
  }
  return state;
}
