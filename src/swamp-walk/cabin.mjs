import { reflectTreeInWater } from "./water-reflection.mjs";
import { addCabinLedger } from "./cabin-ledger.mjs";

const X = -4.45, Z = 25.55, FLOOR = 1.04;
const HX = 2.05, HZ = 1.65;
// Where the shack stands and how big its plot is (local x runs from the back wall at -HX to the door at +HX,
// local z from the north wall at -HZ to the south wall at +HZ). clicker-world.mjs furnishes it from the save.
export const CABIN = { x: X, z: Z, floor: FLOOR, hx: HX, hz: HZ };
const WALL = 0.15, EAVE = 2.18, DOOR_HALF = 0.69;
const PLANKS = "/swamp-walk/models/landing-planks.webp";
export const onCabinPlot = (x, z) => x >= X - HX && x <= X + HX && z >= Z - HZ && z <= Z + HZ;

export async function addCabin({ THREE, scene, stages = new Set(), owned = {}, projects = new Set(), labels, manager }) {
  const root = new THREE.Group();
  root.name = "MVP Cabin";
  root.position.set(X, FLOOR, Z);
  const solids = [];
  const has = (id) => stages.has(id);
  const bought = (id) => Number(owned?.[id]) > 0;
  const hasDeck = has("deck") || has("floor");
  let texture = null;
  if (hasDeck || has("awning") || has("wall_l") || has("wall_r") || has("window_hole") || has("door")) {
    try {
      texture = await new THREE.TextureLoader(manager).loadAsync(PLANKS);
      texture.colorSpace = THREE.SRGBColorSpace;
    } catch {
      // The solid timber palette is also the loading fallback.
    }
  }

  const mat = (color, roughness = 0.88, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, ...extra });
  const colors = {
    peat: mat(0x423a28), moss: mat(0x4f5929), leaf: mat(0x768442),
    timber: mat(0x79502f), frame: mat(0x925f36), end: mat(0xb17a46),
    boards: mat(0xffffff, 0.9, { map: texture }),
    olive: mat(0x535a34), cloth: mat(0x9c9555), paper: mat(0xd9bf92),
    brass: mat(0xb48642, 0.62), iron: mat(0x414347, 0.72),
    amber: mat(0xffbb65, 0.32, { emissive: 0xff8029, emissiveIntensity: 1.12 }),
    green: mat(0x99b86a, 0.57, { emissive: 0x729746, emissiveIntensity: 0.42 }),
  };
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 10);
  const rounded = new THREE.IcosahedronGeometry(1, 1);
  const ring = new THREE.TorusGeometry(1, 0.16, 5, 12);

  function layer(name) {
    const group = new THREE.Group();
    group.name = name;
    root.add(group);
    return group;
  }

  function piece(group, geometry, material, x, y, z, sx, sy, sz) {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(x, y, z);
    object.scale.set(sx, sy, sz);
    object.receiveShadow = true;
    group.add(object);
    return object;
  }
  const box = (g, m, ...values) => piece(g, cube, m, ...values);
  const round = (g, m, ...values) => piece(g, cylinder, m, ...values);

  function timberStrip(g, rows) {
    const batch = new THREE.InstancedMesh(cube, colors.boards, rows.length);
    const transform = new THREE.Object3D();
    rows.forEach(([x, y, z, width, height, depth, tint], i) => {
      transform.position.set(x, y, z);
      transform.scale.set(width, height, depth);
      transform.updateMatrix();
      batch.setMatrixAt(i, transform.matrix);
      batch.setColorAt(i, new THREE.Color(tint));
    });
    batch.receiveShadow = true;
    g.add(batch);
  }

  function block(x, y, z, sx, sy, sz) {
    solids.push({
      minX: X + x - sx / 2, maxX: X + x + sx / 2,
      minY: FLOOR + y - sy / 2, maxY: FLOOR + y + sy / 2,
      minZ: Z + z - sz / 2, maxZ: Z + z + sz / 2,
    });
  }

  function plankWall(g, x, z, sx, sz, bottom, top) {
    const count = Math.ceil((top - bottom) / 0.27);
    const height = (top - bottom) / count;
    timberStrip(g, Array.from({ length: count }, (_, i) => [
      x, bottom + (i + 0.5) * height, z, sx, height - 0.004, sz,
      [0xb18a65, 0x9d7250, 0xc0956c][i % 3],
    ]));
  }

  function table(g, x, z, width, depth, top, wood = colors.timber) {
    box(g, colors.end, x, top - 0.057, z, width, 0.114, depth);
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
      box(g, wood, x + dx * (width / 2 - 0.09), (top - 0.09) / 2,
        z + dz * (depth / 2 - 0.085), 0.105, top - 0.09, 0.105);
    }
    block(x, top / 2, z, width, top, depth);
  }

  function diagonal(g, material, x, aY, aZ, bY, bZ, width) {
    const part = box(g, material, x, (aY + bY) / 2, (aZ + bZ) / 2,
      width, Math.hypot(bY - aY, bZ - aZ), width);
    part.rotation.x = Math.atan2(bZ - aZ, bY - aY);
  }

  // The visual deck sits a few millimetres below the shared collision height
  // where it overlaps the circular pier.
  const base = layer("Cabin/underlay");
  box(base, colors.peat, 0, hasDeck ? -0.20 : -0.14, 0,
    2 * HX, 0.228, 2 * HZ);
  if (!hasDeck) box(base, colors.moss, 0, -0.027, 0, 2 * HX - 0.035, 0.04, 2 * HZ - 0.035);

  if (has("pads")) {
    const g = layer("Cabin/pads");
    for (const [x, z, radius] of [[-1.68, -1.47, .25], [-1.39, -1.52, .18], [1.61, 1.45, .23]]) {
      round(g, colors.leaf, x, 0.007, z, radius, 0.026, radius * 0.8);
    }
  }
  if (hasDeck) {
    const g = layer("Cabin/deck");
    const span = 2 * HZ / 12;
    const tints = has("floor") ? [0xc9a17b, 0xe0b98f, 0xbe9268] : [0xad8055, 0xbd956e, 0x946a48];
    box(g, colors.timber, 0, -0.048, 0, 2 * HX, 0.077, 2 * HZ);
    timberStrip(g, Array.from({ length: 12 }, (_, i) => [
      0, -0.061, -HZ + (i + 0.5) * span, 2 * HX, 0.11, span - 0.006, tints[i % 3],
    ]));
    for (const x of [-1.76, 1.72]) for (const z of [-1.38, 1.38]) {
      round(g, colors.timber, x, -0.61, z, 0.14, 1.09, 0.14);
    }
  }
  if (has("floor")) {
    const g = layer("Cabin/floor");
    for (const z of [-HZ + 0.045, HZ - 0.045]) {
      box(g, colors.end, 0, -0.054, z, 2 * HX, 0.095, 0.09);
      box(g, colors.frame, 0, -0.205, z, 2 * HX, 0.15, 0.095);
    }
  }
  const posts = has("poles") || has("awning");
  if (has("plank")) {
    const g = layer("Cabin/plank");
    box(g, colors.end, HX - 0.19, EAVE, 0, 0.20, 0.17, 2 * HZ + 0.14);
    if (!posts) for (const z of [-HZ + 0.10, HZ - 0.10]) {
      box(g, colors.timber, HX - 0.19, EAVE / 2, z, 0.14, EAVE, 0.14);
    }
  }
  if (posts) {
    const g = layer("Cabin/poles");
    for (const x of [-HX + 0.10, HX - 0.19]) for (const z of [-HZ + 0.09, HZ - 0.09]) {
      box(g, colors.frame, x, EAVE / 2, z, 0.20, EAVE, 0.20);
      box(g, colors.timber, x, 0.11, z, 0.235, 0.22, 0.235);
      box(g, colors.brass, x, 1.90, z, 0.214, 0.036, 0.214);
    }
    for (const z of [-HZ + 0.09, HZ - 0.09]) box(g, colors.timber, 0, EAVE, z, 4.18, 0.16, 0.20);
  }
  if (has("awning")) {
    const g = layer("Cabin/awning");
    const roofRun = HZ + 0.22, roofRise = 0.57;
    const slope = Math.atan2(roofRise, roofRun);
    const roofSpan = Math.hypot(roofRun, roofRise);
    for (const sign of [-1, 1]) {
      const z = sign * roofRun / 2, y = EAVE + roofRise / 2;
      box(g, colors.timber, 0, y, z, 4.49, 0.125, roofSpan).rotation.x = sign * slope;
      box(g, colors.moss, 0, y + 0.084, z, 4.53, 0.086, roofSpan + 0.035).rotation.x = sign * slope;
      diagonal(g, colors.frame, HX + 0.14, EAVE, sign * roofRun, EAVE + roofRise, 0, 0.14);
    }
    box(g, colors.leaf, 0, EAVE + roofRise + 0.073, 0, 4.52, 0.105, 0.17);
  }
  // The window looks out over the lagoon to the sunset (owner, 13.11: the sunset right from the house), so it is cut
  // into the north wall above the desk; when the window is cut, the back wall closes. North is "wall_l".
  const back = -HX + WALL / 2, north = -(HZ - WALL / 2);
  const sill = 0.86, lintel = 1.79, windowHalf = 0.75, windowX = -0.95;
  const cut = has("window_hole") || has("window");
  for (const [id, sign] of [["wall_l", -1], ["wall_r", 1]]) {
    if (!has(id) && !(sign < 0 && cut)) continue;
    const g = layer("Cabin/" + id), z = sign * (HZ - WALL / 2);
    if (sign < 0 && cut) {
      plankWall(g, 0, z, 2 * HX - 0.03, WALL, 0, sill);
      plankWall(g, 0, z, 2 * HX - 0.03, WALL, lintel, EAVE);
      for (const [a, b] of [[-HX + 0.015, windowX - windowHalf], [windowX + windowHalf, HX - 0.015]]) {
        plankWall(g, (a + b) / 2, z, b - a, WALL, sill, lintel);
      }
    } else {
      plankWall(g, 0, z, 2 * HX - 0.03, WALL, 0, EAVE);
    }
    // A walkable route always uses the door. The window is clear to the eye only.
    block(0, EAVE / 2, z, 2 * HX, EAVE, WALL);
  }
  if (cut) {
    const g = layer("Cabin/window_hole");
    plankWall(g, back, 0, WALL, 2 * HZ, 0, EAVE);
    block(back, EAVE / 2, 0, WALL, EAVE, 2 * HZ);
  }
  if (has("window")) {
    const g = layer("Cabin/window");
    for (const y of [sill, lintel]) box(g, colors.end, windowX, y, north, 1.66, 0.09, 0.24);
    for (const dx of [-windowHalf, 0, windowHalf]) {
      box(g, colors.frame, windowX + dx, (sill + lintel) / 2, north + 0.018, 0.069, lintel - sill, 0.19);
    }
    box(g, colors.end, windowX, 1.23, north + 0.018, 1.45, 0.049, 0.20);
  }
  if (has("door")) {
    const g = layer("Cabin/door"), front = HX - WALL / 2;
    const wing = HZ - DOOR_HALF;
    for (const sign of [-1, 1]) {
      const z = sign * (DOOR_HALF + wing / 2);
      plankWall(g, front, z, WALL, wing, 0, EAVE);
      box(g, colors.end, front + 0.012, 0.99, sign * (DOOR_HALF + 0.045), 0.23, 1.98, 0.09);
      block(front, EAVE / 2, z, WALL, EAVE, wing);
    }
    plankWall(g, front, 0, WALL, 2 * DOOR_HALF, 1.96, EAVE);
    box(g, colors.end, front, 1.965, 0, 0.27, 0.12, 1.58);
    // The door leaf is folded against the right wall of the opening.
    box(g, colors.frame, HX + 0.036, 0.89, 1.17, 0.078, 1.76, 0.91);
    for (const y of [0.42, 1.31]) box(g, colors.iron, HX + 0.082, y, 1.17, 0.025, 0.06, 0.72);
    box(g, colors.brass, HX + 0.105, 0.90, 1.48, 0.045, 0.083, 0.06);
  }

  if (has("lamp")) {
    const g = layer("Cabin/lamp"), x = -1.31, z = 0.94;
    box(g, colors.timber, x, 2.10, 1.22, 0.09, 0.10, 0.74);
    if (!has("wall_r")) box(g, colors.timber, x, 1.05, 1.54, 0.13, 2.10, 0.13);
    box(g, colors.brass, x, 1.85, z, 0.10, 0.48, 0.10);
    round(g, colors.amber, x, 1.49, z, 0.12, 0.24, 0.12);
    for (const y of [1.34, 1.64]) round(g, colors.brass, x, y, z, 0.16, 0.055, 0.16);
    for (const dx of [-0.09, 0.09]) for (const dz of [-0.09, 0.09]) {
      box(g, colors.timber, x + dx, 1.49, z + dz, 0.021, 0.25, 0.021);
    }
    const light = new THREE.PointLight(0xffad59, 7.2, 4.6, 2);
    light.position.set(x + 0.08, 1.48, z - 0.06);
    g.add(light);
  }

  const desk = has("furniture") || has("tea_corner");
  if (desk) {
    const g = layer("Cabin/furniture");
    table(g, -0.75, -1.19, 1.11, 0.60, 0.77);
    box(g, colors.paper, -0.89, 0.787, -1.17, 0.24, 0.025, 0.17).rotation.y = 0.13;
  }
  if (has("chair")) {
    const g = layer("Cabin/chair");
    box(g, colors.timber, -0.72, 0.20, 1.19, 0.67, 0.38, 0.63);
    box(g, colors.cloth, -0.72, 0.42, 1.15, 0.64, 0.13, 0.58);
    box(g, colors.olive, -0.72, 0.66, 1.48, 0.67, 0.57, 0.13);
    for (const x of [-1.025, -0.415]) box(g, colors.timber, x, 0.54, 1.17, 0.09, 0.11, 0.56);
    block(-0.72, 0.45, 1.22, 0.71, 0.90, 0.70);
  }
  if (has("tea_corner")) {
    const g = layer("Cabin/tea_corner"), x = -0.57, z = -1.19;
    piece(g, rounded, colors.paper, x, 0.89, z, 0.136, 0.112, 0.12);
    round(g, colors.olive, x, 0.989, z, 0.065, 0.035, 0.065);
    box(g, colors.paper, x + 0.145, 0.924, z, 0.126, 0.053, 0.054).rotation.z = 0.48;
    piece(g, ring, colors.timber, x - 0.115, 0.904, z, 0.081, 0.081, 0.079);
    round(g, colors.cloth, x + 0.252, 0.81, z + 0.095, 0.049, 0.080, 0.049);
  }
  if (has("workshop")) {
    const g = layer("Cabin/workshop");
    table(g, 0.73, -1.19, 1.08, 0.65, 0.86, colors.iron);
    box(g, colors.timber, 0.75, 1.07, -1.47, 1.00, 0.42, 0.08);
    box(g, colors.iron, 0.99, 0.93, -1.16, 0.24, 0.13, 0.19);
    box(g, colors.brass, 0.98, 1.02, -1.16, 0.28, 0.05, 0.14);
    box(g, colors.iron, 0.37, 0.889, -1.12, 0.31, 0.032, 0.048).rotation.y = -0.2;
  }
  if (has("extension")) {
    const g = layer("Cabin/extension");
    box(g, colors.timber, -1.65, 0.33, -1.19, 0.49, 0.66, 0.64);
    box(g, colors.end, -1.65, 0.69, -1.19, 0.55, 0.073, 0.68);
    box(g, colors.iron, -1.65, 0.49, -0.855, 0.11, 0.04, 0.033);
    block(-1.65, 0.34, -1.19, 0.52, 0.71, 0.66);
  }
  if (has("server_room")) {
    const g = layer("Cabin/server_room");
    box(g, colors.iron, -1.64, 0.52, 1.22, 0.51, 1.04, 0.59);
    for (const y of [0.33, 0.54, 0.75]) {
      box(g, colors.timber, -1.64, y, 0.915, 0.38, 0.13, 0.05);
      box(g, colors.green, -1.51, y, 0.877, 0.055, 0.027, 0.025);
    }
    block(-1.64, 0.52, 1.22, 0.53, 1.04, 0.62);
  }
  if (has("studio")) {
    const g = layer("Cabin/studio");
    box(g, colors.iron, 1.39, 0.70, 1.36, 0.09, 1.4, 0.09);
    box(g, colors.iron, 1.39, 1.41, 1.34, 0.43, 0.32, 0.19);
    box(g, colors.paper, 1.39, 1.41, 1.23, 0.35, 0.25, 0.04);
  }
  if (has("radio_room")) {
    const g = layer("Cabin/radio_room");
    const baseY = has("awning") ? 2.60 : 0;
    box(g, colors.iron, -1.40, baseY + 0.46, 0.61, 0.058, 0.92, 0.058);
    box(g, colors.brass, -1.40, baseY + 0.85, 0.61, 0.57, 0.048, 0.050);
    if (bought("antenna")) box(g, colors.iron, -1.40, baseY + 0.71, 0.61, 0.36, 0.043, 0.044);
  }
  if (has("office")) {
    const g = layer("Cabin/office");
    box(g, colors.olive, 0.81, 1.28, 1.52, 0.79, 0.44, 0.10);
    if (!has("wall_r")) for (const x of [0.49, 1.13]) {
      box(g, colors.timber, x, 0.56, 1.56, 0.085, 1.12, 0.082);
    }
    for (const x of [0.58, 0.82, 1.04]) box(g, colors.paper, x, 1.27, 1.46, 0.145, 0.21, 0.023);
  }

  // What the player bought in the clicker stands in and around the shack: clicker-world.mjs (it needs the landing models).

  if (labels) addCabinLedger(THREE, root, owned, projects, labels, has("wall_l"));
  scene.add(reflectTreeInWater(root));
  return {
    root, block, has, desk,
    spawn: { x: X - 0.22, z: Z, heading: Math.PI / 2 },
    floorAt: (x, z) => onCabinPlot(x, z) ? FLOOR : -Infinity,
    solids,
    contains: onCabinPlot,
  };
}
