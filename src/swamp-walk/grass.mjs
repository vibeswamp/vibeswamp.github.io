import * as T from "./vendor/three.mjs";
import { PIER, WATER, bridgeDistance, mix, random, trailDistance } from "./land.mjs";
import { groundMist } from "./surface.mjs";

// Counts captured from the previous scene at its original renderer settings.
const ANCHOR_LIMIT = 1494;
const CELL = 6;
const FAR = 20;
const PATCHES = [
  [0, 23, 10, 6], [-10, 24, 6, 3], [9, 17, 8, 6], [-15, 18, 8, 6],
  [-25, 10, 5, 8], [-27, 1, 5, 8], [-22, -13, 7, 8], [-17, -24, 8, 8],
  [19, 1, 7, 7], [27, -10, 7, 8], [29, -22, 9, 7], [20, -30, 8, 7],
  [9, -34, 10, 7], [-6, -41, 8, 6], [-16, -34, 7, 7], [17, 29, 8, 6],
];
const PALETTE = [0x7c8b4d, 0x72824c, 0xaea463, 0x536643, 0x859655, 0x8f8a55].map(c => new T.Color(c));

function tuft() {
  const positions = [], colors = [];
  const blades = [[0.12, .86, .050], [1.43, .61, .050], [2.71, 1.05, .040],
    [3.92, .81, .055], [5.2, .58, .058]];
  const root = new T.Color(0xa19d7b), crown = new T.Color(0xeeeabf);
  for (const [angle, height, width] of blades) {
    const x = Math.cos(angle), z = Math.sin(angle);
    const a = [x * .16 - z * width, 0, z * .16 + x * width];
    const b = [x * .16 + z * width, 0, z * .16 - x * width];
    const c = [x * .366 + z * (width * .58 - .051), height * .57, z * .366 - x * (width * .58 - .051)];
    const d = [x * .55 - z * .10, height, z * .55 + x * .10];
    for (const point of [a, b, c, a, c, d]) {
      positions.push(...point);
      colors.push(...root.clone().lerp(crown, point[1]).toArray());
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function addGrass(scene, land) {
  const time = { value: 0 };
  const material = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.91, side: T.DoubleSide });
  material.onBeforeCompile = shader => {
    shader.uniforms.grassTime = time;
    shader.vertexShader = "uniform float grassTime;\n" + shader.vertexShader.replace("#include <begin_vertex>", `
      #include <begin_vertex>
      vec2 root = instanceMatrix[3].xz;
      float falloff = 1. - smoothstep(14., 20., length(cameraPosition.xz - root));
      float gust = sin(grassTime * 1.37 + root.x * .31 + root.y * .24);
      transformed.x += gust * .10 * position.y * position.y;
      transformed *= falloff;
    `);
  };
  const mesh = new T.InstancedMesh(tuft(), groundMist(material), ANCHOR_LIMIT);
  mesh.name = "LandingGrass";
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
  mesh.count = 0;
  scene.add(mesh);

  const byCell = new Map();
  const key = (x, z) => `${x}/${z}`;
  const rng = random(99017), range = (a, b) => mix(a, b, rng());
  const dummy = new T.Object3D();
  let total = 0;
  for (let attempt = 0; total < ANCHOR_LIMIT && attempt < ANCHOR_LIMIT * 8; attempt++) {
    const patch = PATCHES[Math.floor(rng() * PATCHES.length)];
    const near = rng() < .93;
    const x = near ? patch[0] + range(-1, 1) * patch[2] : range(-52, 52);
    const z = near ? patch[1] + range(-1, 1) * patch[3] : range(-51, 46);
    const y = land.heightAt(x, z);
    if (land.noGroundCover?.(x, z)) continue;
    if (y < WATER - .045 || bridgeDistance(x, z) < 1.58 || trailDistance(x, z) < 1.18
        || Math.hypot(x - PIER.x, z - PIER.z) < PIER.radius + .24) continue;
    const slope = Math.hypot(land.heightAt(x + .6, z) - y, land.heightAt(x, z + .6) - y);
    if (slope > .48) continue;
    const clump = .60 + Math.sin(x * .84 + z * .69) * .24 + Math.sin(x * 1.31 - z * .92) * .16;
    if (rng() > clump && total + 120 < ANCHOR_LIMIT) continue;
    const wet = y < WATER + .46;
    const size = wet ? range(.43, .88) : range(.25, .60);
    dummy.position.set(x, y - .048, z);
    dummy.rotation.set(range(-.06, .06), range(0, Math.PI * 2), range(-.06, .06));
    dummy.scale.set(size * range(1.22, 1.65), size * range(.65, 1.11), size * range(1.16, 1.62));
    dummy.updateMatrix();
    const id = key(Math.floor(x / CELL), Math.floor(z / CELL));
    if (!byCell.has(id)) byCell.set(id, []);
    byCell.get(id).push([dummy.matrix.clone(), PALETTE[Math.floor(rng() * PALETTE.length)]]);
    total++;
  }
  mesh.userData.totalAnchors = total;
  mesh.setColorAt(0, PALETTE[0]);
  mesh.instanceColor.setUsage(T.DynamicDrawUsage);

  let cellX = Infinity, cellZ = Infinity;
  return (elapsed, eye) => {
    time.value = elapsed;
    const x = Math.floor(eye.x / CELL), z = Math.floor(eye.z / CELL);
    if (x === cellX && z === cellZ) return;
    cellX = x;
    cellZ = z;
    const span = Math.ceil(FAR / CELL);
    let count = 0;
    for (let j = z - span; j <= z + span; j++) {
      for (let i = x - span; i <= x + span; i++) {
        if (Math.hypot(Math.max(0, Math.abs(i - x) - 1), Math.max(0, Math.abs(j - z) - 1)) * CELL >= FAR) continue;
        const entries = byCell.get(key(i, j));
        if (!entries) continue;
        for (const [matrix, color] of entries) {
          mesh.setMatrixAt(count, matrix);
          mesh.setColorAt(count++, color);
        }
      }
    }
    mesh.count = count;
    for (const attribute of [mesh.instanceMatrix, mesh.instanceColor]) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, count * attribute.itemSize);
      attribute.needsUpdate = true;
    }
  };
}
