import { BEAVER, BEAVER_APPROACH, createBeaverSite } from "./beaver-site.mjs";
import { createDeck } from "./deck.mjs";
import { gradeLedgeApproaches } from "./klyop-mobile-terrain.mjs";
import { createDayWorld, DAY_FORD_BANK, DAY_FORD_EXIT, DAY_STOPS } from "./day-world.mjs";
import { createLakeSites, FISHING_PIER } from "./lake-layout.mjs";

export const RADIUS = 72;
export const CELLS = 216;
export const WATER = 0.08;
export const SWIM_FLOOR = WATER - 0.49;
export const SPAWN = { x: 0, z: 21.8 };
export const PIER = { x: 0, z: 25.4, radius: 2.65, y: 1.04 };
export const LANDMARKS = [
  { id: "stump", x: -26, z: 12.5, width: 3.0, radius: 0.95 },
  { id: "beaver", ...BEAVER_APPROACH, width: BEAVER.width, radius: BEAVER.entranceWidth * .5 },
  { id: "radio", x: 8, z: -31, width: 4.3, radius: 1.25 },
];

// Each waypoint is [x, z, height]. Carve the trails after stamping the cliffs.
const SHORE = [
  [0, 23, 0.98], [-7, 25, 0.96], [-14, 23, 0.88], [-20, 17, 1.01],
  [-24, 10, 1.08], [-27, 0, 0.96], [-24, -11, 1.00], [-17, -20, 1.12],
];
const RISE = [
  [17, 1, 1.02], [21, -3, 1.00], [24, -7, 1.16], [27, -11, 1.48],
  [28, -17, 2.58], [25, -24, 3.96], [19, -29, 5.38], [12, -31, 6.04], [8, -34, 6.16],
];
const DESCENT = [
  [8, -34, 6.16], [2, -39, 5.92], [-7, -42, 5.25], [-13, -38, 4.24],
  [-18, -33, 3.20], [-20, -26, 1.86], [-17, -20, 1.12],
];
export const BRIDGE = [
  [0, 23, 1.065], [0, 18, 0.872], [5, 13, 0.74],
  [10, 8, 0.77], [15, 5, 0.88], [18, 1, 1.118],
];
export const BRIDGE_WIDTH = 2.65;
export const WORLD_LIMIT = RADIUS - 2;
export const MAP_EXTENT = Math.ceil(Math.SQRT2 * RADIUS) + 8;
export const RETURN_PASSAGE = { width: 1.5, points: [[-12.2, 21.5], [-4, 21.5]] };
export const RADIO_TUNING = { ...DAY_STOPS.amber, radius: 1.12 };
export const FLYTRAP = { x: 3.45, z: 21.35, radius: 0.44, warningRadius: 1.04, hitRadius: 0.78 };
export const TUSSOCK = { x: -3.1, z: 20.7, radius: 0.44 };
export const WATER_EXITS = [
  { id: "east-bank", points: [[19, 7], [19, 4.5], [19, 2.5]] },
  { id: "west-bank", points: [[-14.5, 17.8], [-14.5, 19.1], [-14.5, 22]] },
  DAY_FORD_EXIT,
];

const TRAILS = [SHORE, RISE, DESCENT];
const CREEK = [[-70, -41], [-49, -32], [-32, -24], [-23, -17], [-14, -10], [-4, -4]];
const OUTLET = [[8, 15], [14, 23], [22, 29], [31, 39], [38, 60], [41, 74]];

// The sunset vista (13.11, owner: «красивые, приятные пейзажи»). From the pier and from the end of the fishing pier
// the sun goes down to the north-west over open water: the lagoon runs out into a wide sound that reaches the
// edge of the map, the west bank in that line is low reedy marsh, and the west bluff stands aside as a frame.
export const SUN_DIR = (() => { const x = -.66, z = -.73, n = Math.hypot(x, z); return [x / n, z / n]; })();
export const VISTAS = [[0, 24], [-5.16, 19.45]];
// Trees also keep out of the sun line from the lookout on the radio hill, on the way down to the west.
export const LOOKOUTS = [...VISTAS, [1, -39.5]];
// [x, z, half-width] along the sun line from the pier; the shore trail crosses its mouth as a low causeway.
const SOUND = [[-13, 6, 5.5], [-24, -4, 8], [-37, -16, 11], [-52, -30, 15], [-70, -46, 19]];
export function sunVista(x, z, half = .26, points = VISTAS) {
  let best = 0;
  for (const [vx, vz] of points) {
    const dx = x - vx, dz = z - vz, d = Math.hypot(dx, dz);
    if (d < 4 || d > 115) continue;
    const along = (dx * SUN_DIR[0] + dz * SUN_DIR[1]) / d;
    best = Math.max(best, smooth(Math.cos(half), Math.cos(half * .45), along));
  }
  return best;
}
// Close to a viewpoint the cone is too thin to clear a trunk beside the line: keep a few metres free either side,
// from just behind the camera to far out.
export function onSunLine(x, z, points = LOOKOUTS, margin = 2.6) {
  return points.some(([vx, vz]) => {
    const dx = x - vx, dz = z - vz;
    const along = dx * SUN_DIR[0] + dz * SUN_DIR[1];
    return along > -8 && along < 80 && Math.abs(dx * SUN_DIR[1] - dz * SUN_DIR[0]) < margin + Math.max(0, along) * .2;
  });
}
function soundWidth(x, z) {
  let best = { distance: Infinity, width: 1 };
  for (let i = 1; i < SOUND.length; i++) {
    const a = SOUND[i - 1], b = SOUND[i];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz), 0, 1);
    const d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
    if (d < best.distance) best = { distance: d, width: mix(a[2], b[2], t) };
  }
  return best;
}
const BLUFFS = [
  { x: -47, z: 21, rx: 9, rz: 11, high: 4.1, edge: 0.2 },
  { x: -17, z: -34, rx: 12, rz: 12, high: 4.8, edge: 0.24 },
  { x: 9, z: -31, rx: 21, rz: 15, high: 6.12, edge: 0.16 },
  { x: 40, z: -39, rx: 11, rz: 15, high: 3.8, edge: 0.25 },
  { x: 35, z: 14, rx: 9, rz: 10, high: 3.1, edge: 0.23 },
];
const STEP = 2 * RADIUS / CELLS;
const SIZE = CELLS + 1;

export const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
export const mix = (a, b, t) => a + (b - a) * t;
export function smooth(low, high, x) {
  const t = clamp((x - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
}

export function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Two independently shuffled gradient fields, sampled at different scales.
function perlin(seed) {
  const rng = random(seed);
  const table = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [table[i], table[j]] = [table[j], table[i]];
  }
  const directions = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071],
    [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071],
  ];
  const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
  const grad = (x, z, dx, dz) => {
    const g = directions[table[(table[x & 255] + z) & 255] & 7];
    return g[0] * dx + g[1] * dz;
  };
  return (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    return mix(
      mix(grad(ix, iz, fx, fz), grad(ix + 1, iz, fx - 1, fz), fade(fx)),
      mix(grad(ix, iz + 1, fx, fz - 1), grad(ix + 1, iz + 1, fx - 1, fz - 1), fade(fx)),
      fade(fz),
    );
  };
}

function nearest(x, z, points) {
  let distanceSq = Infinity, y = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz), 0, 1);
    const d = (x - a[0] - dx * t) ** 2 + (z - a[1] - dz * t) ** 2;
    if (d < distanceSq) {
      distanceSq = d;
      y = mix(a[2] ?? 0, b[2] ?? 0, t);
    }
  }
  return { distance: Math.sqrt(distanceSq), y };
}

function nearestTrail(x, z) {
  let closest = { distance: Infinity, y: 0 };
  for (const trail of TRAILS) {
    const point = nearest(x, z, trail);
    if (point.distance < closest.distance) closest = point;
  }
  return closest;
}

export const trailDistance = (x, z) => nearestTrail(x, z).distance;
export const bridgeDistance = (x, z) => nearest(x, z, BRIDGE).distance;

export function createLand() {
  const broad = perlin(17011);
  const detail = perlin(92041);
  const heights = new Float32Array(SIZE * SIZE);
  const paths = new Float32Array(heights.length);
  const grain = new Float32Array(heights.length);

  for (let iz = 0; iz < SIZE; iz++) {
    for (let ix = 0; ix < SIZE; ix++) {
      const x = ix * STEP - RADIUS, z = iz * STEP - RADIUS;
      const a = broad(x * 0.046 + 21.7, z * 0.046 - 14.4);
      const b = detail(x * 0.142 - 8.8, z * 0.142 + 3.4);
      let h = 0.76 + a * 2.05 + b * 0.78;
      const lagoon = Math.hypot((x + 4 + z * 0.15) / 24.5, (z - 5) / 15.7);
      const creek = nearest(x, z, CREEK).distance;
      const outlet = nearest(x, z, OUTLET).distance;
      const bank = b * 0.13 + a * 0.08;
      const sound = soundWidth(x, z);
      const wet = Math.max(
        1 - smooth(0.68, 1.13, lagoon + bank),
        1 - smooth(1.9, 5.2, creek + b * 2.6),
        1 - smooth(2.7, 7.4, outlet + b * 3.4),
        1 - smooth(.62, 1.08, sound.distance / sound.width + b * .22 + a * .12),
        smooth(62, 72, Math.hypot(x * 0.96, z * 0.94)),
      );
      h = mix(h, -1.65 + a * 0.85 + b * 0.72, wet);
      // Land left in the sun line stays low: reedy marsh with pools, nothing that rises over the far water.
      const vista = sunVista(x, z, .34) * smooth(9, 16, Math.hypot(x, z - 24));
      h = mix(h, Math.min(h, .16 + b * .42 + a * .22), vista);

      for (const bluff of BLUFFS) {
        const d = Math.hypot((x - bluff.x + (z - bluff.z) * 0.21) / bluff.rx, (z - bluff.z) / bluff.rz);
        const ledge = 1 - smooth(1 - bluff.edge, 1.03, d + b * 0.14 + a * 0.10);
        h = mix(h, bluff.high + a * 0.67 + b * 0.56, ledge);
      }
      const launchBank = Math.hypot(x / 7.7, (z - 24) / 5.5);
      h = mix(h, 0.94 + b * 0.18, 1 - smooth(0.58, 1, launchBank));
      const damBank = Math.hypot((x - 20) / 6, (z - 1) / 5.2);
      h = mix(h, 0.94 + b * 0.2, 1 - smooth(0.50, 1, damBank));

      const trail = nearestTrail(x, z);
      h = mix(h, trail.y + b * 0.09, 1 - smooth(1.32, 3.35, trail.distance + b * 0.29));
      if (x >= 3 && x <= 21.5 && z >= 0 && z <= 20.5) {
        const fordBank = nearest(x, z, DAY_FORD_BANK);
        const bankSpread = 1.10 + b * .44 + a * .24;
        const peatFinger = 1 - smooth(bankSpread * .55, bankSpread * 1.67, fordBank.distance);
        h = Math.max(h, mix(h, fordBank.y + b * .13, peatFinger));
      }
      const index = iz * SIZE + ix;
      heights[index] = h;
      paths[index] = 1 - smooth(0.85, 1.9, trail.distance + b * 0.6);
      grain[index] = a * 0.56 + b * 0.44;
    }
  }

  // Match the exact diagonal of each rendered cell, including the cliff faces.
  function heightAt(x, z) {
    const gx = clamp((x + RADIUS) / STEP, 0, CELLS);
    const gz = clamp((z + RADIUS) / STEP, 0, CELLS);
    const ix = Math.min(Math.floor(gx), CELLS - 1), iz = Math.min(Math.floor(gz), CELLS - 1);
    const tx = gx - ix, tz = gz - iz, i = iz * SIZE + ix;
    const a = heights[i], b = heights[i + 1], c = heights[i + SIZE], d = heights[i + SIZE + 1];
    return tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  }

  gradeLedgeApproaches(heights, CELLS, RADIUS, heightAt, createDayWorld(heightAt).ledges);
  const deck = createDeck(PIER, BRIDGE, BRIDGE_WIDTH, RETURN_PASSAGE, heightAt, FISHING_PIER);
  const lakes = createLakeSites(deck, SWIM_FLOOR);
  const beaver = createBeaverSite(heightAt);
  const woodAt = (x, z) => Math.max(deck.heightAt(x, z), beaver.rampAt(x, z));
  const day = createDayWorld((x, z) => Math.max(heightAt(x, z), woodAt(x, z)));
  const surfaceAt = (x, z) => {
    const ground = heightAt(x, z);
    return woodAt(x, z) >= ground - .025 ? "wood" : ground < WATER ? "water" : "mud";
  };
  return { heights, paths, grain, heightAt, floorAt: day.floorAt, surfaceAt, deck, beaver, day, lakes };
}
