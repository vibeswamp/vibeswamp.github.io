// Visual deck built directly on the collision profile supplied by world/deck.mjs.
const woodTones = [0xe5c9a9, 0xd1ba97, 0xbab197, 0x9f9f8d, 0xc4ac8f, 0xe6d2b6];
const mix = (a, b, t) => a + (b - a) * t;
const between = (a, b, t) => a.map((v, axis) => mix(v, b[axis], t));
const noise = (i) => {
  const x = Math.sin(i * 53.379 + 25.71) * 43428.17;
  return x - Math.floor(x);
};

function staggeredRows(span) {
  const [a, b, c, d] = span;
  const length = Math.hypot((c[0] + d[0] - a[0] - b[0]) * .5, (c[2] + d[2] - a[2] - b[2]) * .5);
  const count = Math.ceil(length / .37);
  const at = (i) => i === 0 || i === count ? i / count : (i + (noise(i + length) - .5) * .32) / count;
  return Array.from({ length: count }, (_, i) => [
    between(a, c, at(i)), between(b, d, at(i)), between(a, c, at(i + 1)), between(b, d, at(i + 1)),
  ]);
}

function plankGeometry(T, panels, thickness, lightUV) {
  const positions = [], uv = [], uv1 = [], colors = [];
  const top = new T.Color(), edge = new T.Color(), bevel = new T.Color();
  const ab = new T.Vector3(), ac = new T.Vector3();
  function face(points, tile, shade, reverse, coords = [[0, 0], [0, 1], [1, 1], [1, 0]]) {
    const triangles = reverse ? [[0, 3, 1], [3, 2, 1]] : [[0, 1, 3], [3, 1, 2]];
    for (const [a, b, c] of triangles) {
      ab.set(...points[b]).sub(ac.set(...points[a]));
      ac.set(points[c][0] - points[a][0], points[c][1] - points[a][1], points[c][2] - points[a][2]);
      if (ab.cross(ac).lengthSq() < 1e-11) continue;
      for (const i of [a, b, c]) {
        const [u, v] = coords[i];
        positions.push(...points[i]);
        uv.push((tile * 256 + 10.5 + u * 235) / 768, (10.5 + v * 235) / 256);
        uv1.push(...lightUV(points[i][0], points[i][2]));
        colors.push(shade.r, shade.g, shade.b);
      }
    }
  }
  for (const [i, row] of panels.entries()) {
    const [a, b, c, d] = row;
    const seam = .011 + noise(i * 3) * .020;
    const outline = [between(a, c, seam), between(b, d, seam), between(b, d, 1 - seam), between(a, c, 1 - seam)];
    const middle = between(between(a, d, .5), between(b, c, .5), .5);
    const crown = outline.map(point => between(point, middle, .010));
    const lip = outline.map(([x, y, z]) => [x, y - .024, z]);
    const bottom = outline.map(([x, y, z]) => [x, y - thickness, z]);
    const reverse = ((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])) < 0;
    top.setHex(woodTones[Math.floor(noise(i * 5 + .2) * woodTones.length)]);
    edge.copy(top).multiplyScalar(.84);
    bevel.copy(top).lerp(new T.Color(0xdac19d), .20);
    const wet = noise(i * 6 + 1.3) < .30;
    const grainStart = noise(i * 7 + .8) * .44, grainEnd = grainStart + .54;
    const v0 = i % 2 ? .03 : .96, v1 = i % 2 ? .96 : .03;
    face(crown, wet ? 1 : 0, top, reverse, [[grainStart, v0], [grainStart, v1], [grainEnd, v1], [grainEnd, v0]]);
    for (let side = 0; side < 4; side++) {
      const n = (side + 1) % 4;
      const tile = side % 2 ? 2 : 1;
      face([crown[n], crown[side], lip[side], lip[n]], tile, bevel, reverse);
      face([lip[n], lip[side], bottom[side], bottom[n]], tile, edge, reverse);
    }
    face(bottom, 1, edge, !reverse);
  }
  const geometry = new T.BufferGeometry();
  for (const [name, data, size] of [["position", positions, 3], ["color", colors, 3], ["uv", uv, 2], ["uv1", uv1, 2]]) {
    geometry.setAttribute(name, new T.Float32BufferAttribute(data, size));
  }
  geometry.computeVertexNormals();
  return geometry;
}

function instances(T, parent, name, geometry, material, parts) {
  if (!parts.length) return;
  const mesh = new T.InstancedMesh(geometry, material, parts.length);
  const shape = new T.Object3D();
  const up = new T.Vector3(0, 1, 0), offset = new T.Vector3();
  for (const [index, { a, b, size, color }] of parts.entries()) {
    shape.position.set(...a);
    shape.scale.set(...size);
    if (b) {
      offset.set(...b).sub(shape.position);
      shape.scale.y = offset.length();
      shape.position.addScaledVector(offset, .5);
      shape.quaternion.setFromUnitVectors(up, offset.normalize());
    } else shape.quaternion.identity();
    shape.updateMatrix();
    mesh.setMatrixAt(index, shape.matrix);
    mesh.setColorAt(index, new T.Color(color));
  }
  mesh.name = name;
  parent.add(mesh);
}

function planLamps(deck, pier) {
  const sites = [[.095, -1, .79], [.24, 1, 1.24], [.41, -1, .97], [.54, 1, .72],
    [.69, 1, 1.27], [.86, -1, 1.03], [.965, 1, .83]];
  const lamps = sites.map(([station, sign, height]) => {
    const [a, b, c, d] = deck.bridge.panels[Math.floor(station * deck.bridge.panels.length)];
    const [x, y, z] = between(between(a, c, .5), between(b, d, .5), sign < 0 ? -0.035 : 1.035);
    return { x, y, z, height };
  });
  lamps.push({ x: pier.x + 2.16, y: pier.y, z: pier.z - .85, height: 1.36 });
  return lamps;
}

function lampMap(T, bounds, lamps) {
  const size = 256;
  const { min, max } = bounds;
  const data = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row++) {
    const z = mix(min.z, max.z, (row + .5) / size);
    for (let col = 0; col < size; col++) {
      const x = mix(min.x, max.x, (col + .5) / size);
      let energy = 0;
      for (const lamp of lamps) {
        const distance = Math.hypot(x - lamp.x, z - lamp.z) / (lamp.height * 1.02 + .33);
        energy += Math.max(0, 1 - distance * distance) ** 2 * (.78 / (lamp.height + .38));
      }
      const index = (row * size + col) * 4;
      data[index] = data[index + 1] = data[index + 2] = Math.round(Math.min(1, energy) * 255);
      data[index + 3] = 255;
    }
  }
  const map = new T.DataTexture(data, size, size);
  map.channel = 1;
  map.minFilter = map.magFilter = T.LinearFilter;
  map.needsUpdate = true;
  return map;
}

function addLanterns(T, parent, land, lamps, wood) {
  const posts = [], cage = [], glass = [], hoods = [];
  for (const [i, { x, y, z, height }] of lamps.entries()) {
    const bulb = y + height, radius = i % 3 === 1 ? .110 : .091;
    posts.push({ a: [x, Math.min(y - .30, land.heightAt(x, z) - .12), z], b: [x + .03, bulb - .08, z],
      size: [.091, 1, .091], color: 0x6c513b });
    glass.push({ a: [x + .03, bulb, z], size: [radius, .20, radius], color: 0xffc879 });
    hoods.push({ a: [x + .03, bulb + .141, z], size: [radius * 1.42, .099, radius * 1.42], color: 0x6c5940 });
    hoods.push({ a: [x + .03, bulb - .115, z], size: [radius * 1.25, .055, radius * 1.25], color: 0x9e7747 });
    for (let j = 0; j < 4; j++) {
      const a = Math.PI * (.25 + .5 * j);
      cage.push({ a: [x + .03 + Math.cos(a) * radius, bulb, z + Math.sin(a) * radius],
        size: [.024, .243, .024], color: 0x53452f });
    }
  }
  const iron = new T.MeshStandardMaterial({ roughness: .64, metalness: .22 });
  instances(T, parent, "Lantern posts", new T.CylinderGeometry(.72, 1, 1, 7), wood, posts);
  instances(T, parent, "Lantern caps and bowls", new T.CylinderGeometry(.57, 1, 1, 8), iron, hoods);
  instances(T, parent, "Lantern guards", new T.BoxGeometry(1, 1, 1), iron, cage);
  instances(T, parent, "Lantern glass", new T.CylinderGeometry(.83, 1, 1, 8), new T.MeshBasicMaterial(), glass);
}

function deckSupports(T, parent, land, spans, pier, water, material, solids) {
  const timber = [], wet = [];
  for (const span of spans) {
    const [a, b, c, d] = span;
    for (const at of [.26, .77]) {
      const right = between(a, c, at), left = between(b, d, at);
      const top = [.07, .93].map(t => between(right, left, t));
      const ground = top.map(([x, y, z]) => [x, Math.min(land.heightAt(x, z) - .18, y - .41), z]);
      const [p, q] = top.map(([x, y, z]) => [x, y - .19, z]);
      timber.push({ a: p, b: q, size: [.125, 1, .125], color: 0x73513b });
      for (let side = 0; side < 2; side++) {
        const a = ground[side], [x, y, z] = side ? q : p;
        const wetLine = Math.min(y - .045, Math.max(water + .13, land.heightAt(x, z) + .19));
        solids.push({ id: "pile", x, z, radius: 0.144, minY: a[1], top: y + .046 });
        wet.push({ a, b: [x, wetLine, z], size: [.144, 1, .144], color: 0x464537 });
        timber.push({ a: [x, wetLine - .03, z], b: [x, y + .046, z], size: [.14, 1, .14], color: 0x75553d });
        const [ox, oy, oz] = side ? p : q;
        const brace = Math.max(a[1] + .15, wetLine - .38);
        timber.push({ a: [x, brace, z], b: [ox, oy - .045, oz], size: [.067, 1, .067], color: 0x826747 });
      }
    }
  }
  // Footings at the tall gate uprights, kept clear of the opening.
  for (const sign of [-1, 1]) {
    const x = sign * 1.37, z = pier.z + 2.09;
    const ground = land.heightAt(x, z);
    wet.push({ a: [x, ground - .17, z], b: [x, Math.max(ground + .18, pier.y + .17), z],
      size: [.253, 1, .253], color: 0x494437 });
    timber.push({ a: [x + sign * .56, ground + .025, z - .17], b: [x, pier.y + .61, z],
      size: [.094, 1, .094], color: 0x785e44 });
  }
  const beam = new T.CylinderGeometry(.84, 1, 1, 7);
  instances(T, parent, "Crossed braces and bearing beams", beam, material, timber);
  instances(T, parent, "Wet pile and gate footings", beam, material, wet);
}

export function addDeckArt(T, scene, land, { atlas, pier, water, reflection }) {
  const deck = land.deck;
  const group = new T.Group();
  group.name = "First Landing deck art";
  const lamps = planLamps(deck, pier);
  const bridge = deck.bridge.quads.flatMap(staggeredRows);
  const spans = [deck.pier.panels, bridge, deck.shortcut.quads.flatMap(staggeredRows)];
  const bounds = new T.Box3().setFromPoints(spans.flat(2).map(p => new T.Vector3(...p)));
  const lightUV = (x, z) => [(x - bounds.min.x) / (bounds.max.x - bounds.min.x),
    (z - bounds.min.z) / (bounds.max.z - bounds.min.z)];
  atlas.colorSpace = T.SRGBColorSpace;
  const material = new T.MeshStandardMaterial({
    map: atlas, vertexColors: true, roughness: .72, emissive: 0xffb265,
    emissiveMap: lampMap(T, bounds, lamps), emissiveIntensity: .25,
  });
  const mesh = (panels, name) => {
    const node = new T.Mesh(plankGeometry(T, panels, deck.thickness, lightUV), material);
    node.name = name;
    group.add(node);
    return node;
  };
  const main = mesh(bridge, "Mitred boardwalk");
  const pad = mesh(spans[0], "Round landing");
  const shortcut = mesh(spans[2], "Shortcut boards");
  const reflectionMaterial = new T.MeshBasicMaterial({ color: 0x68503c, vertexColors: true });
  let shortcutProxy;
  if (reflection) {
    for (const part of [main, pad, shortcut]) {
      const proxy = new T.Mesh(part.geometry, reflectionMaterial);
      reflection.add(proxy);
      if (part === shortcut) shortcutProxy = proxy;
    }
  }
  const timber = new T.MeshStandardMaterial({ roughness: .87 });
  const solids = lamps.map(({ x, y, z, height }) =>
    ({ id: "lantern", x, z, radius: 0.10, minY: Math.min(land.heightAt(x, z), y), top: y + height + 0.24 }));
  deckSupports(T, group, land, deck.bridge.quads, pier, water, timber, solids);
  addLanterns(T, group, land, lamps, timber);
  scene.add(group);
  const update = () => {
    shortcut.visible = deck.isShortcutOpen();
    if (shortcutProxy) shortcutProxy.visible = shortcut.visible;
  };
  update();
  return { group, main, pad, shortcut, lamps, solids, update };
}
