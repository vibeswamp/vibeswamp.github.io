import * as T from "./vendor/three.mjs";
import { TREE_ANCHORS } from "./forest-layout.mjs";
import { WATER, mix, random } from "./land.mjs";

export const FOREST_ATLAS = "/swamp-walk/models/forest-atlas.webp";
const CELL = 6;
const DAM_TREE_SITES = [
  { from: [24, 4.7], to: [24, 8.2] },
  { from: [30.23557, -.57711], to: [34.75, 1.5] },
];
const STYLES = [
  { lean: .11, crown: .94, root: .19, bark: .062, tile: 3, boughs: 6, spread: .28 },
  { lean: -.24, crown: .84, root: .25, bark: .073, tile: 1, boughs: 6, spread: .35 },
  { lean: .13, crown: .73, root: .15, bark: .053, tile: 3, boughs: 3, spread: .21 },
];
const Y = new T.Vector3(0, 1, 0);
const X = new T.Vector3(1, 0, 0);

function prototype(kind, level) {
  const style = STYLES[kind], rng = random(1324 + kind * 258);
  const vertices = [], indices = [], uv = [], colors = [], sway = [];
  function vertex(point, u, v, tile, tint, wind) {
    const index = vertices.length / 3;
    vertices.push(...point);
    const border = .013;
    uv.push((tile % 2 + mix(border, 1 - border, u)) * .5, 1 - (Math.floor(tile / 2) + mix(border, 1 - border, v)) * .5);
    colors.push(tint, tint * (wind ? 1.04 : .99), tint * (wind ? .93 : .87));
    sway.push(wind);
    return index;
  }
  function tube(path, sizes, sides, shade = 1) {
    const positions = path.map(point => new T.Vector3(...point));
    const normal = new T.Vector3(), a = new T.Vector3(), b = new T.Vector3(), ring = new T.Vector3();
    const origin = vertices.length / 3;
    for (let row = 0; row < positions.length; row++) {
      normal.copy(positions[Math.min(row + 1, positions.length - 1)])
        .sub(positions[Math.max(0, row - 1)]).normalize();
      a.crossVectors(normal, Math.abs(normal.y) > .85 ? X : Y).normalize();
      b.crossVectors(normal, a);
      for (let side = 0; side <= sides; side++) {
        const angle = side * Math.PI * 2 / sides;
        const radius = sizes[row] * (1 + .09 * Math.sin(angle * 3. + row * .65));
        ring.copy(positions[row]).addScaledVector(a, Math.cos(angle) * radius)
          .addScaledVector(b, Math.sin(angle) * radius);
        vertex(ring.toArray(), side / sides, 1 - row / (positions.length - 1), 0, shade * mix(.61, 1.16, row / (positions.length - 1)), 0);
        if (side && row) {
          const i = origin + row * (sides + 1) + side;
          const below = i - sides - 1;
          indices.push(below - 1, below, i - 1, below, i, i - 1);
        }
      }
    }
  }
  function card(center, width, height, angle, tilt, tile, tint, wind = 1) {
    const [x, y, z] = center;
    const sx = Math.cos(angle), sz = Math.sin(angle);
    const up = Math.sqrt(1 - tilt ** 2);
    const origin = vertices.length / 3;
    for (const [u, v] of [[0, 1], [1, 1], [0, 0], [1, 0]]) {
      const a = (u - .5) * width, b = (.5 - v) * height;
      vertex([x + sx * a - sz * b * tilt, y + b * up, z + sz * a + sx * b * tilt], u, v, tile, tint, wind);
    }
    indices.push(origin, origin + 1, origin + 2, origin + 2, origin + 1, origin + 3);
  }
  const stem = height => [style.lean * Math.max(0, height) ** 1.7 + .041 * Math.sin(height * 7), height, .065 * Math.sin(height * 3.9)];
  const y = [-.025, .06, .28, .51, .73, style.crown];
  const width = [1.59, 1.00, .74, .54, .35, .052];
  const sides = level === 0 ? 6 : level === 1 ? 5 : 4;
  const rings = level === 2 ? [0, 2, 4, 5] : y.map((_, i) => i);
  tube(rings.map(i => stem(y[i])), rings.map(i => style.bark * width[i]), sides);
  const branches = Array.from({ length: style.boughs }, (_, i) => {
    const a = i * 2.4 + rng() * .8;
    const start = style.crown * (.42 + .40 * i / style.boughs);
    const base = stem(start);
    const reach = style.spread * mix(.67, 1.34, rng()) * (1 - .28 * i / style.boughs);
    const tip = [base[0] + Math.cos(a) * reach, start + .14 + rng() * .12, base[2] + Math.sin(a) * reach];
    const elbow = [mix(base[0], tip[0], .59), start + .125, mix(base[2], tip[2], .63)];
    return { base, elbow, tip, a, reach, shade: .79 + rng() * .40 };
  });
  for (const [i, { base, elbow, tip, a, reach, shade }] of branches.entries()) {
    if (level < 2 || i % 2 === 0) tube(level === 0 ? [base, elbow, tip] : [base, tip],
      level === 0 ? [style.bark * .44, style.bark * .24, .005] : [style.bark * .38, .007],
      4, .96);
    if (kind === 2) {
      if (level < 2 && i % 2 === 0) card([elbow[0], elbow[1] - .095, elbow[2]], .15, .24, a, .06, 2, .70);
      continue;
    }
    if (level === 2 && i % 2) continue;
    const size = .38 + reach * .48;
    card(tip, size, size * .82, a, .84, style.tile, shade);
    card([tip[0] * .86, tip[1] + .03, tip[2] * .86], size * .89, size * .73, a + 1.28, .55, style.tile, shade * .96);
    if (level === 0) {
      const crown = [mix(elbow[0], tip[0], .63), tip[1] + .105, mix(elbow[2], tip[2], .65)];
      if (i % 2 === 0) tube([elbow, crown], [style.bark * .19, .004], 4, .93);
      card(crown, size * .74, size * .64, a - .62, .71, 1, shade * 1.14);
      const droop = i % 3 === 0 ? .38 : .27;
      card([tip[0], tip[1] - droop * .36, tip[2]], .19 + reach * .24, droop, a + .7, .09, 2, shade * .73, .58);
    }
  }
  const roots = level === 0 ? 5 : level === 1 ? 3 : 2;
  for (let i = 0; i < roots; i++) {
    const angle = i * 2.39 + kind * .87, r = style.root * (.83 + .24 * Math.sin(i * 3 + kind));
    const dx = Math.cos(angle) * r, dz = Math.sin(angle) * r;
    tube([[0, .13, 0], [dx * .47, .050, dz * .42], [dx, -.075, dz]],
      [style.bark * .70, style.bark * .40, .006], level === 0 ? 4 : 3, .75);
    if (level === 0 && kind === 0 && i % 2 === 0) {
      tube([[dx * 1.22, -.025, dz * 1.23], [dx * 1.21, .046, dz * 1.15], [dx * 1.15, .068, dz * 1.07]],
        [style.bark * .21, style.bark * .17, .009], 3, .76);
    }
  }
  if (kind !== 2) {
    const top = stem(style.crown - .01);
    card(top, .35, .28, .47 + kind, .73, style.tile, 1.03);
    if (level < 2) card(top, .36, .31, 2.12 + kind, .60, style.tile, .94);
  }
  const geometry = new T.BufferGeometry();
  geometry.setIndex(indices);
  for (const [name, values, size] of [["position", vertices, 3], ["uv", uv, 2], ["color", colors, 3], ["sway", sway, 1]]) {
    geometry.setAttribute(name, new T.Float32BufferAttribute(values, size));
  }
  geometry.computeVertexNormals();
  return geometry;
}

function forestMaterial(map, time, level) {
  const material = new T.MeshLambertMaterial({
    map, color: 0xffffff, vertexColors: true, alphaTest: .40, alphaToCoverage: true, side: T.DoubleSide,
  });
  material.customProgramCacheKey = () => "forest-atlas-cell-lod-v1";
  material.onBeforeCompile = shader => {
    shader.uniforms.forestTime = time;
    shader.uniforms.forestLevel = { value: level };
    shader.vertexShader = "attribute float sway;\nuniform float forestTime, forestLevel;\nvarying vec2 forestBand;\n"
      + shader.vertexShader.replace("#include <begin_vertex>", "" +
        "#include <begin_vertex>\n" +
        "vec2 root = instanceMatrix[3].xz;\n" +
        "float d = length(cameraPosition.xz - root);\n" +
        "float a = 1. - smoothstep(23., 30., d);\n" +
        "float b = 1. - smoothstep(49., 58., d);\n" +
        "forestBand = forestLevel < .5 ? vec2(0., a) : forestLevel < 1.5 ? vec2(a, b) : vec2(b, 1.);\n" +
        "float gust = sin(forestTime * 1.25 + root.x * .18 + root.y * .19 + position.y * 4.5);\n" +
        "transformed.x += gust * sway * .013;\n" +
        "transformed.z += gust * sway * .007;");
    shader.fragmentShader = "varying vec2 forestBand;\n" + shader.fragmentShader.replace("#include <alphatest_fragment>",
      "#include <alphatest_fragment>\n" +
      "if (forestBand.x > 0. || forestBand.y < 1.) {\n" +
      "  float pattern = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));\n" +
      "  if (pattern < forestBand.x || pattern >= forestBand.y) discard;\n" +
      "}");
  };
  return material;
}

export function addForest(scene, land, atlas) {
  atlas.colorSpace = T.SRGBColorSpace;
  atlas.anisotropy = 2;
  const time = { value: 0 }, seed = random(69173);
  const transform = new T.Object3D();
  const tint = new T.Color();
  const anchors = TREE_ANCHORS.map(([sourceX, sourceZ, h, radius]) => {
    const moved = land.beaver?.occupied(sourceX, sourceZ, radius + .24)
      ? DAM_TREE_SITES.find(site => site.from[0] === sourceX && site.from[1] === sourceZ)
      : null;
    const [x, z] = moved?.to ?? [sourceX, sourceZ];
    const y = Math.max(WATER - .60, land.heightAt(x, z));
    const pick = seed(), kind = pick < .105 ? 2 : y < WATER + .46 || pick < .38 ? 0 : 1;
    const yaw = seed() * 6.283, shape = mix(.90, 1.11, seed());
    const size = h * mix(.94, 1.10, seed());
    transform.position.set(x, y, z);
    transform.rotation.set(.018 * Math.sin(x), yaw, .035 * Math.sin(z));
    transform.scale.set(size * shape, size, size / shape);
    transform.updateMatrix();
    tint.setRGB(.78 + .22 * seed(), .82 + .19 * seed(), .77 + .23 * seed());
    return { sourceX, sourceZ, x, y, z, h: size, radius, kind, yaw, matrix: transform.matrix.clone(), color: tint.clone() };
  }).filter(({ x, z, radius }) => !land.beaver?.occupied(x, z, radius + .24));
  const ranges = [[0, 0, 35], [1, 18, 63], [2, 44, 158]];
  const meshes = STYLES.map((_, kind) => {
    const capacity = anchors.filter(anchor => anchor.kind === kind).length;
    return [0, 1, 2].map(level => {
      const mesh = new T.InstancedMesh(prototype(kind, level), forestMaterial(atlas, time, level), capacity);
      mesh.name = "SwampTree-" + kind + "-" + level;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      if (capacity) mesh.setColorAt(0, tint);
      mesh.instanceColor?.setUsage(T.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
      return mesh;
    });
  });
  const batches = meshes.flat();
  let cx = Infinity, cz = Infinity, repacks = 0;
  return {
    anchors,
    stats() {
      const rows = batches.map(mesh => ({ name: mesh.name, instances: mesh.count, triangles: mesh.geometry.index.count / 3 }));
      return { anchors: anchors.length, repacks, batches: rows, submitted: rows.reduce((sum, row) => sum + row.instances * row.triangles, 0) };
    },
    update(elapsed, eye) {
      time.value = elapsed;
      const x = Math.floor(eye.x / CELL), z = Math.floor(eye.z / CELL);
      if (x === cx && z === cz) return;
      cx = x;
      cz = z;
      repacks++;
      const px = (x + .5) * CELL, pz = (z + .5) * CELL;
      for (const mesh of batches) mesh.count = 0;
      for (const anchor of anchors) {
        const d = Math.hypot(anchor.x - px, anchor.z - pz);
        const kinds = meshes[anchor.kind];
        for (const [level, minimum, maximum] of ranges) {
          if (d < minimum || d > maximum) continue;
          const mesh = kinds[level];
          mesh.setMatrixAt(mesh.count, anchor.matrix);
          mesh.setColorAt(mesh.count++, anchor.color);
        }
      }
      for (const mesh of batches) {
        if (!mesh.count) continue;
        for (const attribute of [mesh.instanceMatrix, mesh.instanceColor]) {
          attribute.clearUpdateRanges();
          attribute.addUpdateRange(0, mesh.count * attribute.itemSize);
          attribute.needsUpdate = true;
        }
      }
    },
  };
}
