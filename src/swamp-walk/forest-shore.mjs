import * as T from "./vendor/three.mjs";
import { mix, random } from "./land.mjs";
import { HOME_TREES } from "./world-places.mjs";

// The middle layer of the swamp (13.11): mangroves standing in the water on arched stilt roots and weeping willows
// on the banks, between the reeds and lilies in front and the misty far shores behind. Built here at load time in the
// style of forest.mjs (bark tubes and leaf cards on the forest atlas, three LODs), so they cost no download.
// Sites are kept off the boardwalk, the day's stops and routes, the deck exits, the fishing cast and the sun lines
// from the porch, the fishing pier and the radio lookout (land.mjs onSunLine), and the beaver dam.
export const MANGROVE = 3, WILLOW = 4;

// [x, z, height in metres, collider radius, kind]
export const SHORE_TREES = [
  // the north shore of the lagoon, at the foot of the radio hill: they soften the cliff seen from the porch
  [11.56, -6.65, 5.4, .9, MANGROVE], [4.81, -6.31, 6.0, .9, MANGROVE], [-2, -9.46, 5.6, .9, MANGROVE],
  [-7.44, -10.2, 6.2, .9, MANGROVE], [-11.63, -13.21, 5.2, .9, MANGROVE], [-16.7, -16.03, 5.8, .9, MANGROVE],
  [6.39, -9.01, 7.2, .5, WILLOW], [-4.05, -11.51, 6.6, .5, WILLOW], [-12.08, -14.89, 7.4, .5, WILLOW],
  // the outlet by the ford and the dam
  [14.2, -2.85, 5.4, .9, MANGROVE], [16.22, 12.67, 5.0, .9, MANGROVE], [18.13, 20.95, 5.8, .9, MANGROVE],
  [19.62, 19.74, 6.8, .5, WILLOW], [20.8, 8.47, 6.4, .5, WILLOW],
  // the west bank by the stump glade and the far edge of the sound, beside the sunset
  [-31.52, 18.96, 7.0, .5, WILLOW], [-36.46, 13.28, 6.4, .5, WILLOW], [-46.03, -.66, 6.8, .5, WILLOW],
  [-47.83, 3.43, 5.6, .9, MANGROVE], [-50.85, 7.8, 6.2, .9, MANGROVE], [-54.86, -6.83, 5.4, .9, MANGROVE],
  [-29.82, -42.66, 5.8, .9, MANGROVE],
  // the trees around the house (world-places.mjs HOME_TREES)
  ...HOME_TREES.map(({ x, z }, i) => [x, z, 6.4 + i * .5, .5, WILLOW]),
];

const BORDER = .013;

// Geometry in metres (y up), atlas tiles as in forest.mjs: 0 bark, 1 and 3 leaves, 2 hanging strands; v = 0 at a
// tile's top. Returned at unit height, like forest.mjs prototypes, so the instance scale is the tree's height.
function builder(seed) {
  const positions = [], uvs = [], colors = [], sway = [], indices = [];
  const rng = random(seed);
  const vertex = (p, u, v, tile, shade, wind) => {
    positions.push(p.x, p.y, p.z);
    uvs.push((tile % 2 + mix(BORDER, 1 - BORDER, u)) * .5, 1 - (Math.floor(tile / 2) + mix(BORDER, 1 - BORDER, v)) * .5);
    colors.push(shade, shade * (wind ? 1.04 : .99), shade * (wind ? .92 : .87));
    sway.push(wind);
    return positions.length / 3 - 1;
  };
  const up = new T.Vector3(0, 1, 0), side = new T.Vector3(1, 0, 0);
  function tube(path, radii, sides, { wobble = .08, rough = 0, dark = .6 } = {}) {
    const a = new T.Vector3(), b = new T.Vector3(), t = new T.Vector3(), p = new T.Vector3();
    let length = 0;
    const along = [0];
    for (let i = 1; i < path.length; i++) along.push(length += path[i].distanceTo(path[i - 1]));
    const start = positions.length / 3;
    for (let row = 0; row < path.length; row++) {
      t.copy(path[Math.min(row + 1, path.length - 1)]).sub(path[Math.max(row - 1, 0)]).normalize();
      a.crossVectors(t, Math.abs(t.y) > .9 ? side : up).normalize();
      b.crossVectors(t, a).normalize();
      const height = path[row].y;
      for (let s = 0; s <= sides; s++) {
        const angle = s / sides * Math.PI * 2;
        const r = radii[Math.min(row, radii.length - 1)] * (1 + wobble * Math.sin(angle * 3 + row * .7) + rough * (rng() - .5));
        p.copy(path[row]).addScaledVector(a, Math.cos(angle) * r).addScaledVector(b, Math.sin(angle) * r);
        vertex(p, s / sides, 1 - along[row] / length, 0, dark + .5 * Math.min(1, Math.max(0, height) / 4), 0);
        if (s && row) {
          const i = start + row * (sides + 1) + s, below = i - sides - 1;
          indices.push(below - 1, below, i - 1, below, i, i - 1);
        }
      }
    }
  }
  // tilt 0 = upright, 1 = flat; `hang`: the card's top edge sits at `centre` (strands hang from it).
  function card(centre, width, height, yaw, tilt, tile, { hang = false, shade = 1, wind = 1 } = {}) {
    const right = new T.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const forward = new T.Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
    const lift = new T.Vector3(0, Math.sqrt(Math.max(0, 1 - tilt * tilt)), 0).addScaledVector(forward, tilt).normalize();
    const top = hang ? centre.clone() : centre.clone().addScaledVector(lift, height / 2);
    const start = positions.length / 3;
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const p = top.clone().addScaledVector(right, (u - .5) * width).addScaledVector(lift, -v * height);
      vertex(p, u, v, tile, shade * (hang ? 1 - v * .25 : 1), wind * (hang ? .4 + v * .6 : 1));
    }
    indices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3);
  }
  function finish() {
    let top = 0;
    for (let i = 1; i < positions.length; i += 3) top = Math.max(top, positions[i]);
    const geometry = new T.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute("position", new T.Float32BufferAttribute(positions.map(v => v / top), 3));
    geometry.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
    geometry.setAttribute("sway", new T.Float32BufferAttribute(sway, 1));
    geometry.computeVertexNormals();
    return geometry;
  }
  return { rng, tube, card, finish };
}

// Catmull-Rom through points -> `steps` samples.
function curve(points, steps) {
  const p = points.map(([x, y, z]) => new T.Vector3(x, y, z));
  return Array.from({ length: steps }, (_, i) => {
    const t = i / (steps - 1) * (p.length - 1), k = Math.min(Math.floor(t), p.length - 2), f = t - k;
    const p0 = p[Math.max(k - 1, 0)], p1 = p[k], p2 = p[k + 1], p3 = p[Math.min(k + 2, p.length - 1)];
    return new T.Vector3().addScaledVector(p1, 2).addScaledVector(p2.clone().sub(p0), f)
      .addScaledVector(p0.clone().multiplyScalar(2).addScaledVector(p1, -5).addScaledVector(p2, 4).sub(p3), f * f)
      .addScaledVector(p1.clone().multiplyScalar(3).sub(p0).addScaledVector(p2, -3).add(p3), f * f * f).multiplyScalar(.5);
  });
}
const V = (x, y, z) => new T.Vector3(x, y, z);

// Red mangrove, ~5.6 m from the mud: a short trunk lifted on a cage of arched stilt roots, spreading boughs, a broad
// crown of leaf cards, a few aerial roots hanging toward the water.
function mangrove(level) {
  const b = builder(4711 + level), { rng } = b;
  const sides = [7, 5, 4][level];
  const base = 1.25;
  b.tube(curve([[0, base - .2, 0], [.08, 2.2, .05], [.02, 3.4, .12], [-.05, 4.2, .1]], [6, 4, 3][level]),
    [.21, .19, .16, .13, .11, .09], sides, { rough: .08, dark: .55 });
  // The root cage: many short, thick arches packed round the trunk, starting at different heights and curving
  // straight down into the water (long thin ones read as spider legs). Far away it is one dark cone of roots.
  if (level === 2) {
    b.tube([V(0, -.2, 0), V(0, .5, 0), V(0, 1.15, 0)], [1.05, .55, .16], 6, { wobble: .12, dark: .45 });
  }
  const roots = [16, 9, 0][level];
  for (let i = 0; i < roots; i++) {
    const a = (i + rng() * .6) / roots * Math.PI * 2, high = i % 2 === 0;
    const reach = (high ? 1.05 : .75) + rng() * .45;
    const startY = high ? base + rng() * .35 : base * .55 + rng() * .3;
    const start = [Math.cos(a) * .14, startY, Math.sin(a) * .14];
    const knee = [Math.cos(a) * reach * .6, startY + .12 + rng() * .1, Math.sin(a) * reach * .6];
    const drop = [Math.cos(a) * reach * .95, startY * .55, Math.sin(a) * reach * .95];
    const foot = [Math.cos(a) * reach, -.58, Math.sin(a) * reach];
    b.tube(curve([start, knee, drop, foot], [6, 4][level]), [.1, .085, .07, .062, .058, .055],
      Math.max(3, sides - 2), { wobble: .06, dark: .45 });
  }
  const boughs = [7, 5, 4][level];
  for (let i = 0; i < boughs; i++) {
    const a = i * 2.39 + (rng() - .5) * .6, h = 2.9 + rng() * 1.2, reach = 1.4 + rng();
    const tip = V(Math.cos(a) * reach, h + .4 + rng() * .5, Math.sin(a) * reach);
    if (level < 2 || i % 2 === 0) {
      b.tube(curve([[Math.cos(a) * .05, h, Math.sin(a) * .05], [tip.x * .5, (h + tip.y) / 2 + .25, tip.z * .5], tip.toArray()],
        [4, 3, 2][level]), [.075, .05, .03, .02], 4, { dark: .6 });
    }
    const size = 1.6 + rng() * .6;
    for (let c = 0; c < [3, 2, 1][level]; c++) {
      b.card(tip.clone().add(V((rng() - .5) * .6, .15 + c * .12, (rng() - .5) * .6)), size, size * .85,
        a + c * 1.1 + (rng() - .5) * .6, [.85, .55, .25][c % 3], (i + c) % 2 ? 1 : 3, { shade: .8 + rng() * .35 });
    }
  }
  for (let c = 0; c < [4, 2, 1][level]; c++) {
    b.card(V((rng() - .5) * .8 - .05, 4.6 + c * .1, (rng() - .5) * .8 + .1), 2.3, 2.0, c * 1.3, .8, c % 2 ? 3 : 1,
      { shade: 1.02 });
  }
  if (level === 0) {
    for (let i = 0; i < 5; i++) {
      const a = i * 1.7 + .4, r = 1 + rng() * .8, y = 3 + rng() * .6;
      b.tube([V(Math.cos(a) * r, y, Math.sin(a) * r), V(Math.cos(a) * r + .05, y - 1.6, Math.sin(a) * r),
        V(Math.cos(a) * r + .08, y - 3.3, Math.sin(a) * r + .02)], [.022, .02, .018], 3, { wobble: 0, dark: .5 });
    }
  }
  return b.finish();
}

// Weeping willow, ~7 m: a thick leaning trunk on a flared foot that forks into limbs, a dome of leaf cards and a
// curtain of hanging strands down to about 1.3 m above the ground.
function willow(level) {
  const b = builder(9137 + level), { rng } = b;
  const sides = [8, 6, 4][level];
  b.tube(curve([[0, -.15, 0], [.15, 1, .05], [.35, 2.1, .1], [.45, 2.8, .12]], [6, 4, 3][level]),
    [.42, .36, .32, .3, .29, .28], sides, { rough: .12, dark: .5 });
  if (level < 2) {
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + .4;
      b.tube([V(Math.cos(a) * .2, .8, Math.sin(a) * .2), V(Math.cos(a) * .55, .05, Math.sin(a) * .55),
        V(Math.cos(a) * .75, -.42, Math.sin(a) * .75)], [.16, .12, .06], 4, { dark: .45 });
    }
  }
  const centre = V(.5, 5, .15);
  for (let i = 0, limbs = [5, 4, 3][level]; i < limbs; i++) {
    const a = i / limbs * Math.PI * 2 + .3;
    const tip = centre.clone().add(V(Math.cos(a) * 2, .2 + rng(), Math.sin(a) * 2));
    b.tube(curve([[.45, 2.7, .12], [(.45 + tip.x) / 2, (2.7 + tip.y) / 2 + .6, (.12 + tip.z) / 2], tip.toArray()], [5, 3, 2][level]),
      [.2, .15, .1, .07, .05], Math.max(4, sides - 2), { dark: .55 });
  }
  for (let i = 0, dome = [16, 8, 4][level]; i < dome; i++) {
    const a = i * 2.39, r = Math.sqrt((i + .5) / dome) * 2.6;
    const size = 2 + rng() * .6;
    b.card(centre.clone().add(V(Math.cos(a) * r, 1.3 - r * .35 + (rng() - .5) * .4, Math.sin(a) * r)), size, size * .8,
      a + (rng() - .5), .6 + rng() * .3, i % 2 ? 1 : 3, { shade: .85 + rng() * .3 });
  }
  for (const [ring, [radius, count, length, drop]] of [[3.1, 18, 4, .2], [2.2, 12, 3.4, .8]].entries()) {
    if (level === 2 && ring === 1) continue;
    const n = Math.round(count * [1, .66, .45][level]);
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + ring * .26 + (rng() - .5) * .16;
      const top = centre.clone().add(V(Math.cos(a) * radius, .55 - drop + (rng() - .5) * .4, Math.sin(a) * radius));
      b.card(top, (1.4 + rng() * .5) * (level ? 1.25 : 1), length * (.85 + rng() * .25), a + Math.PI / 2, .06, 2,
        { hang: true, shade: .82 + rng() * .25 });
    }
  }
  return b.finish();
}

// Prototypes for forest.mjs: kind -> [LOD0, LOD1, LOD2].
export function shorePrototypes() {
  return { [MANGROVE]: [0, 1, 2].map(mangrove), [WILLOW]: [0, 1, 2].map(willow) };
}
