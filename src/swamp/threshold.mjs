// The door between the clicker and the 3D swamp (taken from the multiplayer candidate C, 12.11.2026). The page that
// is left marks the crossing in sessionStorage, the page that opens takes it: "out" = clicker -> 3D (path of the 3D
// page), "in" = 3D -> clicker (path of the clicker). THRESHOLD is where the door stands in the 3D world.
const KEY = "vibeswamp-threshold";
const MAX_AGE = 90_000;

export function markThreshold(direction, path) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ direction, path, time: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function takeThreshold(direction) {
  try {
    const cue = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (cue?.direction !== direction || cue.path !== location.pathname) return false;
    sessionStorage.removeItem(KEY);
    return Date.now() >= cue.time && Date.now() - cue.time < MAX_AGE;
  } catch {
    return false;
  }
}

export const THRESHOLD = {
  inside: { x: -3.20, z: 25.55, heading: Math.PI / 2 },
  outside: { x: -1.49, z: 25.55, heading: -Math.PI / 2 },
  center: { x: -2.42, z: 25.55 },
};
