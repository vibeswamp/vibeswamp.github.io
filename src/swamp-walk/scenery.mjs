import * as T from "./vendor/three.mjs";
import { addGrass } from "./grass.mjs";
import { addFlytrap } from "./flytrap.mjs";
import { addForest, FOREST_ATLAS } from "./forest.mjs";
import { addForestCurios } from "./forest-curios.mjs";
import { addDeckArt } from "./deck-art.mjs";
import { addDamRunoff, addTeaSteam, makeShoreStoneGeometry, RADIO_YAW } from "./landing-fx.mjs";
import { BRIDGE, FLYTRAP, LANDMARKS, PIER, RETURN_PASSAGE, TUSSOCK, WATER, WATER_EXITS, WORLD_LIMIT,
  bridgeDistance, mix, random, trailDistance } from "./land.mjs";
import { FOG, HAZE, groundMist } from "./surface.mjs";

const ART = "/swamp-walk/models/";
const FACING = { stump: 2.28, beaver: -1.05, radio: RADIO_YAW, flytrap: -.50, tussock: .36 };
const UP = new T.Vector3(0, 1, 0);

function batch(scene, geometry, material) {
  const transforms = [], colors = [];
  const shape = new T.Object3D(), delta = new T.Vector3();
  function store(color) {
    shape.updateMatrix();
    transforms.push(shape.matrix.clone());
    colors.push(new T.Color(color));
  }
  return {
    put(x, y, z, sx, sy, sz, color, yaw = 0, pitch = 0) {
      shape.position.set(x, y, z);
      shape.scale.set(sx, sy, sz);
      shape.rotation.set(pitch, yaw, 0, "YXZ");
      store(color);
    },
    link(a, b, radius, color) {
      delta.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      shape.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      shape.scale.set(radius, delta.length(), radius);
      shape.quaternion.setFromUnitVectors(UP, delta.normalize());
      store(color);
    },
    finish() {
      if (!transforms.length) return;
      const mesh = new T.InstancedMesh(geometry, material, transforms.length);
      for (let i = 0; i < transforms.length; i++) {
        mesh.setMatrixAt(i, transforms[i]);
        mesh.setColorAt(i, colors[i]);
      }
      scene.add(mesh);
    },
  };
}

function glowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const halo = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  halo.addColorStop(0, "#ffffffff");
  halo.addColorStop(0.16, "#ffffffb0");
  halo.addColorStop(0.38, "#ffffff31");
  halo.addColorStop(1, "#ffffff00");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, 64, 64);
  return new T.CanvasTexture(canvas);
}

function lilyGeometry() {
  const vertices = [], colors = [];
  for (let i = 0; i < 15; i++) {
    const a = .25 + i * .383, b = a + .383;
    const edgeA = .93 + .063 * Math.sin(a * 5), edgeB = .93 + .063 * Math.sin(b * 5);
    vertices.push(0, .012, 0, Math.cos(b) * edgeB, .037 + .035 * Math.sin(b * 3), Math.sin(b) * edgeB,
      Math.cos(a) * edgeA, .037 + .035 * Math.sin(a * 3), Math.sin(a) * edgeA);
    const edge = .72 + .14 * Math.sin(i * 2.8);
    colors.push(.58, .71, .43, edge * .86, edge * 1.07, edge * .53, edge, edge * .96, edge * .51);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function hangingMoss() {
  const points = [], colors = [];
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * .29, z = Math.sin(i * 2.6) * .25, tip = -(1 - i * .12);
    const curl = Math.sin(i * 2.4 + .9) * .22;
    const a = [x - .092, 0, z], b = [x + .065, 0, z];
    const c = [x + curl - .040, tip * .45, z + .10], d = [x + curl + .04, tip * .45, z + .12];
    const e = [x + curl * .57 + .021, tip, z + .18], f = [x + curl * 1.11, tip * .74, z + .06];
    for (const point of [a, b, c, b, d, c, c, d, e, d, f, e]) {
      points.push(...point);
      const value = .55 - point[1] * .44;
      colors.push(value * .94, value, value * .75);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(points, 3));
  geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function organicCanopy(detail) {
  const geometry = new T.IcosahedronGeometry(1, detail);
  const p = geometry.attributes.position, n = geometry.attributes.normal, colors = [];
  const direction = new T.Vector3();
  for (let i = 0; i < p.count; i++) {
    direction.fromBufferAttribute(p, i).normalize();
    const lobes = 1 + .16 * Math.sin(direction.x * 9 + direction.z * 6) * Math.sin(direction.y * 5 + direction.z * 7);
    p.setXYZ(i, direction.x * lobes, direction.y * lobes + .12 * direction.z, direction.z * lobes);
    n.setXYZ(i, direction.x, direction.y, direction.z);
    const tint = .75 + .25 * Math.sin(direction.x * 6 - direction.z * 5 + direction.y * 2) ** 2 + direction.y * .10;
    colors.push(tint, tint, tint * .94);
  }
  geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  return geometry;
}

export async function addScenery(scene, land) {
  const props = [
    ...LANDMARKS,
    { id: "flytrap", ...FLYTRAP },
    { id: "tussock", ...TUSSOCK },
  ];
  const texture = new T.TextureLoader();
  const [wood, atlas, forestAtlas, pack] = await Promise.all([
    texture.loadAsync(`${ART}landing-planks.webp`),
    texture.loadAsync(`${ART}landing-deck.webp`),
    texture.loadAsync(FOREST_ATLAS),
    new T.GLTFLoader().loadAsync(`${ART}landing.glb`),
  ]);
  wood.colorSpace = T.SRGBColorSpace;
  wood.wrapS = T.RepeatWrapping;
  const updateGrass = addGrass(scene, land);
  const solid = groundMist(new T.MeshStandardMaterial({ roughness: 0.92, flatShading: true }));
  const beamGeometry = new T.CylinderGeometry(0.66, 1, 1, 7);
  const boardGeometry = new T.BoxGeometry(1, 1, 1);
  const beams = batch(scene, beamGeometry, solid);
  const timberMaterial = groundMist(new T.MeshStandardMaterial({ map: wood, roughness: 0.85 }));
  const boards = batch(scene, boardGeometry, timberMaterial);
  const gateMaterials = [groundMist(solid.clone()), groundMist(timberMaterial.clone())];
  const gatePosts = batch(scene, beamGeometry, gateMaterials[0]);
  const gateBoards = batch(scene, boardGeometry, gateMaterials[1]);
  const foliage = groundMist(new T.MeshStandardMaterial({ roughness: .91, vertexColors: true }));
  const lowCrowns = batch(scene, organicCanopy(0), foliage);
  const rockBatches = [0, 1, 2].map(variant => batch(scene, makeShoreStoneGeometry(T, variant), solid));
  let rockIndex = 0;
  const stones = {
    put(...args) { rockBatches[rockIndex++ % rockBatches.length].put(...args); },
    finish() { for (const part of rockBatches) part.finish(); },
  };
  const leaves = batch(scene, lilyGeometry(), groundMist(new T.MeshStandardMaterial({ roughness: .71, side: T.DoubleSide, vertexColors: true })));
  const lights = batch(scene, new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial());
  const reflection = new T.Group();
  reflection.userData.wetRoots = [];
  const proxyMat = new T.MeshBasicMaterial({ color: 0xffffff });
  const proxyTrunks = batch(reflection, new T.CylinderGeometry(.64, 1, 1, 5), proxyMat);
  const proxyCrowns = batch(reflection, new T.IcosahedronGeometry(1, 0), proxyMat);
  const proxyBoards = batch(reflection, new T.BoxGeometry(1, 1, 1), proxyMat);
  const halo = glowTexture();
  const obstacles = [];
  const hardEdges = [];
  const cameraSolids = [];
  const sight = new T.Ray(), hit = new T.Vector3();
  let gateOpacity = 1;
  const rng = random(34628), range = (a, b) => mix(a, b, rng());
  const pick = (items) => items[Math.floor(rng() * items.length)];
  const leafColors = [0x4c6746, 0x2d4935, 0x676a44, 0x758455, 0x465840];
  const rockColors = [0x5e5848, 0x626051, 0x82745b, 0x494b3e];
  const deck = addDeckArt(T, scene, land, { atlas, pier: PIER, water: WATER, reflection });
  const deckMaterials = new Set();
  deck.group.traverse(object => { if (object.material?.isMeshStandardMaterial) deckMaterials.add(object.material); });
  deckMaterials.forEach(groundMist);
  hardEdges.push(...deck.solids);
  const fxTime = { value: 0 };
  addDamRunoff(T, scene, land, { water: WATER, time: fxTime, haze: HAZE, fog: FOG });

  function setRadio(open) {
    land.deck.setShortcutOpen(open);
    deck.update();
  }

  function glow(x, y, z, tint, size) {
    const bulb = new T.Sprite(new T.SpriteMaterial({
      map: halo, color: tint, transparent: true, blending: T.AdditiveBlending, depthWrite: false, opacity: 0.79,
    }));
    bulb.position.set(x, y, z);
    bulb.scale.set(size, size, 1);
    scene.add(bulb);
    return bulb;
  }

  function lantern(x, y, z, postHeight = 0.91) {
    const top = y + postHeight;
    hardEdges.push({ id: "lantern", x, z, radius: .10, minY: land.heightAt(x, z) - .10, top: top + .24 });
    beams.link([x, Math.min(land.heightAt(x, z), y - 0.10), z], [x, top + 0.12, z], 0.10, 0x564232);
    boards.put(x, top - 0.10, z, 0.26, 0.08, 0.23, 0x9a714f);
    boards.put(x, top + 0.13, z, 0.28, 0.08, 0.26, 0xae875b);
    lights.put(x, top + 0.015, z, 0.16, 0.20, 0.15, 0xffc45f);
    glow(x, top, z, 0xff9f50, 1.05);
    proxyTrunks.link([x, Math.max(WATER, y - .03), z], [x, top, z], .09, 0x453929);
    proxyBoards.put(x, top, z, .20, .24, .20, 0xe7a757);
  }

  // Round landing and lashed gate from the clicker's first building stage.
  for (let offset = -2.4; offset <= 2.4; offset += 0.31) {
    // Keep the established seed for forest placement when changing carpentry.
    rng();
  }
  const gate = 27.49;
  for (const x of [-1.37, 1.37]) {
    gatePosts.link([x, PIER.y - 0.25, gate], [x * 0.97, PIER.y + 2.34, gate], 0.20, 0x72513b);
    obstacles.push({ id: "gate-post", x, z: gate, radius: 0.21, minY: PIER.y - .25, top: PIER.y + 2.34 });
    cameraSolids.push(new T.Box3(
      new T.Vector3(Math.min(x, x * 0.97) - .24, PIER.y - .25, gate - .24),
      new T.Vector3(Math.max(x, x * .97) + .24, PIER.y + 2.38, gate + .24),
    ));
    for (let i = 0; i < 3; i++) {
      gatePosts.link([x - 0.20, PIER.y + 2.16 + i * 0.06, gate - 0.19],
        [x + 0.20, PIER.y + 2.25 + i * 0.06, gate - 0.19], 0.034, 0x9f8556);
    }
  }
  gateBoards.put(0, PIER.y + 2.27, gate, 3.48, 0.25, 0.36, 0xdbad77);
  hardEdges.push({ id: "gate-crossbar", minX: -1.78, maxX: 1.78, minZ: gate - .22, maxZ: gate + .22,
    minY: PIER.y + 2.1, maxY: PIER.y + 2.44 });
  cameraSolids.push(new T.Box3(new T.Vector3(-1.78, PIER.y + 2.10, gate - .22),
    new T.Vector3(1.78, PIER.y + 2.44, gate + .22)));
  lantern(-1.81, land.heightAt(-1.81, 22.55), 22.55, 1.15);

  for (let segment = 1; segment < BRIDGE.length; segment++) {
    const [ax, az, ay] = BRIDGE[segment - 1], [bx, bz, by] = BRIDGE[segment];
    const distance = Math.hypot(bx - ax, bz - az);
    const count = Math.ceil(distance / 0.37);
    for (let i = 0; i < count; i++) {
      rng();
      rng();
    }
  }

  let hazard, steam;
  for (const { id, x: markX, z: markZ, radius } of props) {
    const dam = id === "beaver" ? land.beaver : null;
    const x = dam?.x ?? markX, z = dam?.z ?? markZ;
    const near = pack.scene.getObjectByName(id);
    const far = pack.scene.getObjectByName(`${id}_lod1`);
    if (!near?.isMesh || !far?.isMesh) throw new Error(`Missing landing mesh or LOD: ${id}`);
    const yaw = dam?.yaw ?? FACING[id];
    const y = dam?.y ?? land.heightAt(x, z) - .07;
    const model = new T.LOD();
    model.name = `Landing-${id}`;
    model.position.set(x, y, z);
    model.rotation.y = yaw;
    model.addLevel(near, 0);
    model.addLevel(far, 22, .12);
    scene.add(model);
    if (id === "flytrap") hazard = addFlytrap(scene, land, [near, far]);
    if (id === "tussock") steam = addTeaSteam(T, model);
    if (dam) obstacles.push(...dam.obstacles);
    else obstacles.push({ id, x, z, radius, minY: y, top: y + (id === "flytrap" ? 1.55 : id === "tussock" ? .8 : 3.10) });
    const silhouette = far.clone(false);
    silhouette.material = new T.MeshBasicMaterial({ color: id === "flytrap" ? 0x7d6640 : 0x6c5140 });
    const root = new T.Group();
    root.position.copy(model.position);
    root.rotation.copy(model.rotation);
    root.add(silhouette);
    reflection.add(root);
  }
  for (const point of LANDMARKS) {
    if (point.id === "beaver") continue;
    const y = land.heightAt(point.x, point.z);
    for (let i = 0; i < 6; i++) {
      const angle = i / 6 * Math.PI * 2;
      const x = point.x + Math.cos(angle) * point.radius, z = point.z + Math.sin(angle) * point.radius;
      stones.put(x, land.heightAt(x, z) + 0.02, z, 0.51, 0.25, 0.47, pick(rockColors), angle);
    }
    lantern(point.x + point.width * 0.52, y, point.z + 0.65, 1.44);
  }
  for (const [x, z] of [[-9, 24.5], [-20, 15.5], [-28, 1], [-23, -12], [20.4, -4.2], [29.6, -15], [25.7, -25], [17.1, -30.4], [-8, -42.6], [-18, -31]]) {
    lantern(x, land.heightAt(x, z), z, 0.72);
  }

  const mastX = 4.6, mastZ = -33, mastY = land.heightAt(mastX, mastZ);
  for (const sign of [-1, 1]) {
    beams.link([mastX + sign, mastY, mastZ], [mastX + 0.19 * sign, mastY + 6.1, mastZ], 0.10, 0x574c3b);
    beams.link([mastX + sign * 0.7, mastY + 1.0, mastZ], [mastX - sign * 0.38, mastY + 3.6, mastZ], 0.065, 0x72624a);
    beams.link([mastX + sign * 0.45, mastY + 3.1, mastZ], [mastX - sign * 0.21, mastY + 6.0, mastZ], 0.058, 0x72624a);
    beams.link([mastX, mastY + 5.9, mastZ], [mastX + sign * 2.35, mastY + 6.18, mastZ], 0.078, 0x66513e);
    beams.link([mastX + sign * 2.14, mastY + 5.75, mastZ], [mastX + sign * 2.14, mastY + 6.73, mastZ], 0.054, 0x76634d);
  }
  beams.link([mastX, mastY + 5.6, mastZ], [mastX, mastY + 7.30, mastZ], 0.072, 0x66513e);
  lights.put(mastX, mastY + 7.37, mastZ, 0.19, 0.18, 0.19, 0xffad69);
  const beacon = glow(mastX, mastY + 7.38, mastZ, 0xff8354, 1.9);
  obstacles.push({ id: "mast", x: mastX, z: mastZ, radius: .82, minY: mastY, top: mastY + 7.38 });

  const forest = addForest(scene, land, forestAtlas);
  const curios = addForestCurios(scene, land, forest.anchors);
  for (const { x, y, z, h, radius, kind, yaw } of forest.anchors) {
    const bendX = Math.cos(yaw) * h * .095, bendZ = Math.sin(yaw) * h * .095;
    proxyTrunks.link([x, Math.max(WATER - .03, y), z], [x + bendX, y + h * .84, z + bendZ], radius * .91, 0x4a4435);
    if (kind !== 2) {
      proxyCrowns.put(x + bendX, y + h * .73, z + bendZ, h * .38, h * .13, h * .30, 0x41543a, yaw);
      proxyCrowns.put(x - bendZ * .55, y + h * .90, z + bendX * .63, h * .24, h * .095, h * .25, 0x445740, yaw + .89);
    }
    if (y < WATER + .26) reflection.userData.wetRoots.push([x, z]);
    obstacles.push({ id: "tree", x, z, radius, minY: y - .23, top: y + h });
  }

  for (const { points } of WATER_EXITS) {
    const [x, z] = points[1];
    for (const side of [-1, 1]) {
      const sx = x + side * .83, y = land.heightAt(sx, z);
      stones.put(sx, y - .06, z, .41, .24, .58, 0x625641, side * 1.29);
      beams.link([sx, y - .10, z], [sx + .06 * side, y + .63, z + .08], .065, 0x4c3925);
      lights.put(sx + .058 * side, y + .61, z + .075, .11, .087, .12, 0xefac66);
    }
  }
  const reeds = batch(scene, hangingMoss(), groundMist(new T.MeshStandardMaterial({
    roughness: .90, side: T.DoubleSide, vertexColors: true,
  })));
  const reedsRng = random(45891);
  function cattail(x, z, y, scale) {
    const lean = .08 + reedsRng() * .14, top = y + scale * 1.18;
    beams.link([x, y - .15, z], [x - lean, top, z + .09], .021, 0x586849);
    beams.link([x - lean, top - .17, z + .09], [x - lean - .023, top + .09, z + .11], .045, 0x7b502e);
    reeds.put(x, y + .026, z, .54 * scale, .61 * scale, .45 * scale, 0x7d925c, reedsRng() * 6.28, Math.PI - .19);
  }
  const shoreReeds = [[-4.4, 20.55], [3.30, 19.30], [-6.1, 21.65], [-8.8, 22.10], [20, 4.0], [17.5, 3.65], [-22, 14.3]];
  for (const [cx, cz] of shoreReeds) {
    for (let i = 0; i < 12; i++) {
      const x = cx + (reedsRng() - .5) * 1.85, z = cz + (reedsRng() - .5) * 1.45;
      const y = land.heightAt(x, z);
      if (y < WATER - .47 || y > WATER + .39 || bridgeDistance(x, z) < 1.65 || trailDistance(x, z) < 1.34) continue;
      if (WATER_EXITS.some(({ points }) => points.some(([px, pz]) => Math.hypot(x - px, z - pz) < 1.05))) continue;
      cattail(x, z, y, .72 + reedsRng() * .96);
    }
  }
  for (const [x, z] of RETURN_PASSAGE.points) {
    const top = land.heightAt(x, z);
    beams.link([x, top - .18, z + .80], [x, top + .46, z + .80], .088, 0x52432d);
  }
  // Bogfall marks the same outer edge that the motor uses to bound the map.
  for (const sign of [-1, 1]) {
    const b = sign * WORLD_LIMIT;
    const edge = { id: "bogfall", minY: -2.1, maxY: 1.22 };
    hardEdges.push({ ...edge, minX: -WORLD_LIMIT, maxX: WORLD_LIMIT, minZ: b - .40, maxZ: b + .40 });
    hardEdges.push({ ...edge, minX: b - .40, maxX: b + .40, minZ: -WORLD_LIMIT, maxZ: WORLD_LIMIT });
    for (let n = -WORLD_LIMIT; n < WORLD_LIMIT; n += 6.4) {
      const offset = Math.sin(n * 1.12 + sign) * .24;
      beams.link([n, .19 + offset, b], [n + 6.65, .27 - offset, b], .31 + Math.abs(offset), 0x4a4231);
      beams.link([b, .27 - offset, n], [b, .19 + offset, n + 6.65], .33 + Math.abs(offset), 0x3d4430);
    }
  }

  const lilySeeds = [];
  for (let i = 0; i < 1900; i++) {
    const x = range(-61, 61), z = range(-58, 52), y = land.heightAt(x, z);
    if (bridgeDistance(x, z) < 1.60 || Math.hypot(x, z - PIER.z) < 3 || trailDistance(x, z) < 1.23) continue;
    if (y > WATER - 0.29) {
      const tall = y < WATER + 0.22;
      if (tall && rng() < 0.67) {
        const scale = range(.63, 1.36);
        cattail(x, z, y, scale);
      }
      if (rng() < 0.095) {
        const s = range(0.17, 0.67);
        const tint = pick(rockColors), yaw = range(0, 6.28);
        const slope = Math.hypot(land.heightAt(x + .49, z) - y, land.heightAt(x, z + .49) - y);
        if (slope < .44) stones.put(x, y - s * .16, z, s * 1.35, s * .68, s, tint, yaw);
      }
    } else if (y > WATER - 1.61 && rng() < 0.37) {
      lilySeeds.push([x, z, range(.19, .54), pick(leafColors), rng() < .12, range(0, 6.28)]);
    }
  }
  const coves = [[-4.4, 17.8], [-10, 12], [11.1, 15], [20, 5], [-18.3, 7], [-4, 12]];
  for (const [i, [px, pz, scale, tint, flower, angle]] of lilySeeds.entries()) {
    let x = px, z = pz;
    if (i < 30) {
      const [cx, cz] = coves[i % coves.length];
      const dx = cx + range(-1.45, 1.45), dz = cz + range(-1.1, 1.1);
      if (land.heightAt(dx, dz) < WATER - .16 && bridgeDistance(dx, dz) > 1.55) { x = dx; z = dz; }
    }
    const height = WATER + .004 + (i % 4) * .005;
    leaves.put(x, height, z, scale, .48, scale * (.73 + (i % 4) * .06), tint, angle);
    if (flower) {
      const size = .63 + scale * 1.45;
      for (let j = 0; j < 5; j++) {
        const petal = j * Math.PI * .4 + angle;
        lowCrowns.put(x + Math.cos(petal) * .077 * size, height + .064, z + Math.sin(petal) * .077 * size,
          .092 * size, .054 * size, .048 * size, j % 2 ? 0xcaa4a9 : 0xd1a882, petal, .16);
      }
      lowCrowns.put(x, height + .085, z, .045, .052, .045, 0xd9ad61);
    }
  }
  for (const part of [beams, boards, gatePosts, gateBoards, lowCrowns, reeds, stones, leaves, lights,
    proxyTrunks, proxyCrowns, proxyBoards]) part.finish();

  const seeds = Array.from({ length: 68 }, () => {
    const x = range(-32, 33), z = range(-39, 33);
    return [x, Math.max(WATER, land.heightAt(x, z)) + range(0.38, 1.9), z, range(0, 7)];
  });
  const flies = new T.BufferGeometry();
  const points = new T.BufferAttribute(new Float32Array(seeds.length * 3), 3);
  flies.setAttribute("position", points);
  const swarm = new T.Points(flies, new T.PointsMaterial({
    map: halo, color: 0xe5b756, size: 0.19, transparent: true,
    blending: T.AdditiveBlending, depthWrite: false, opacity: 0.70,
  }));
  swarm.frustumCulled = false;
  scene.add(swarm);
  return {
    obstacles: [...obstacles, ...hardEdges],
    hazard,
    forest,
    curios,
    reflection,
    setRadio,
    updateGate(eye, player, dt, snap) {
      sight.origin.copy(eye);
      const blocked = [.24, .70, 1.22].some(height => {
        sight.direction.set(player.x, player.y + height, player.z).sub(eye);
        const distance = sight.direction.length();
        sight.direction.normalize();
        return cameraSolids.some(solid => sight.intersectBox(solid, hit) && hit.distanceTo(eye) < distance);
      });
      const opacity = blocked ? .11 : 1;
      gateOpacity = snap ? opacity : T.MathUtils.damp(gateOpacity, opacity, 24, dt);
      for (const material of gateMaterials) {
        material.opacity = gateOpacity;
        const translucent = gateOpacity < .99;
        if (material.transparent !== translucent) {
          material.transparent = translucent;
          material.depthWrite = !translucent;
          material.needsUpdate = true;
        }
      }
    },
    addRail(rail) {
      const mesh = new T.Mesh(new T.BoxGeometry(rail.width, rail.height, rail.depth), timberMaterial);
      mesh.position.set(rail.x, rail.y + rail.height / 2, rail.z);
      mesh.rotation.y = rail.yaw ?? 0;
      scene.add(mesh);
    },
    update(time, eye, radioFound) {
      fxTime.value = time;
      steam?.update(time, eye);
      forest.update(time, eye);
      curios.update(time, eye);
      updateGrass(time, eye);
      if (land.deck.isShortcutOpen() !== Boolean(radioFound)) setRadio(radioFound);
      beacon.material.opacity = radioFound ? .87 + .12 * Math.sin(time * 3) : .09;
      for (let i = 0; i < seeds.length; i++) {
        const [x, y, z, phase] = seeds[i];
        const t = time * 0.94 + phase;
        points.setXYZ(i, x + Math.sin(t) * 0.75, y + Math.sin(t * 1.44) * 0.33, z + Math.cos(t * 0.72) * 0.6);
      }
      points.needsUpdate = true;
    },
  };
}
