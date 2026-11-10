const durations = { wood: .49, mud: 1.10, water: .63 };
const marks = { wood: 0x483929, mud: 0x392e20, water: 0xe5dec0 };
const impacts = { step: 1, land: 1.32, waterEnter: 1.40 };
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function markMap(T, water) {
  const width = 32, height = 48, data = new Uint8Array(width * height * 4);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const x = (i + .5) / width * 2 - 1, y = (j + .5) / height * 2 - 1;
      const fore = Math.hypot((x + .07) / .73, (y - .29) / .62);
      const heel = Math.hypot((x - .07) / .54, (y + .46) / .40);
      const ring = Math.hypot(x, y) - .72 + .034 * Math.cos(x * 22 + y * 18);
      const tread = .68 + .32 * Math.cos(y * 36 + Math.abs(x) * 2.5) ** 2;
      const opacity = water ? clamp(1 - Math.abs(ring) * 14, 0, 1) :
        clamp((1 - Math.min(fore, heel)) * 2.5, 0, 1) * tread;
      const k = (i + width * j) * 4;
      data[k] = data[k + 1] = data[k + 2] = 255;
      data[k + 3] = Math.round(255 * opacity);
    }
  }
  const map = new T.DataTexture(data, width, height);
  map.minFilter = map.magFilter = T.LinearFilter;
  map.needsUpdate = true;
  return map;
}

export function surfaceContactKind(player, previous, foot) {
  if (player.swimming && !previous.swimming) return "waterEnter";
  if (player.landing?.age === 0) return "land";
  return foot ? "step" : null;
}

export function createSurfaceFX(T, scene, land, { water, play }) {
  const footprint = markMap(T, false), ripple = markMap(T, true);
  const shape = new T.PlaneGeometry(1, 1);
  const group = new T.Group();
  group.name = "Ground contact marks";
  const slots = Array.from({ length: 16 }, () => {
    const node = new T.Mesh(shape, new T.MeshBasicMaterial({
      map: footprint, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    }));
    node.visible = false;
    node.renderOrder = 3;
    group.add(node);
    return { node, age: 0, duration: 0, strength: 0, isWater: false };
  });
  scene.add(group);
  let slot = 0;
  const normal = new T.Vector3(), up = new T.Vector3(0, 0, 1), twist = new T.Quaternion();
  function emit({ kind, x, z, displacement, yaw = 0, impact = 1 }) {
    if (!Object.hasOwn(impacts, kind) || !Number.isFinite(x) || !Number.isFinite(z)) return false;
    if (kind === "step" && !(displacement > .0001)) return false;
    const material = kind === "waterEnter" ? "water" : land.surfaceAt(x, z);
    if (!Object.hasOwn(durations, material)) return false;
    const record = slots[slot++ % slots.length], node = record.node;
    const isWater = material === "water";
    const strength = impacts[kind] * (Number.isFinite(impact) ? clamp(impact, .6, 1.35) : 1);
    record.age = 0;
    record.duration = durations[material];
    record.strength = strength;
    record.isWater = isWater;
    node.material.map = isWater ? ripple : footprint;
    node.material.color.setHex(marks[material]);
    node.material.opacity = (isWater ? .36 : .32) * strength;
    if (isWater) {
      normal.set(0, 1, 0);
      node.position.set(x, water + .012, z);
      node.scale.set(.19 * strength, .19 * strength, 1);
    } else {
      const e = .042;
      normal.set(land.floorAt(x - e, z) - land.floorAt(x + e, z), e * 2,
        land.floorAt(x, z - e) - land.floorAt(x, z + e)).normalize();
      node.position.set(x, land.floorAt(x, z) + .012, z);
      node.scale.set(.115 * Math.sqrt(strength), .21 * Math.sqrt(strength), 1);
    }
    node.quaternion.setFromUnitVectors(up, normal).premultiply(
      twist.setFromAxisAngle(normal, Number.isFinite(yaw) ? yaw : 0),
    );
    node.visible = true;
    play(material, strength);
    return true;
  }
  function update(dt) {
    for (const record of slots) {
      const { node, duration, strength, isWater } = record;
      if (!node.visible) continue;
      record.age += Math.max(0, dt);
      const age = record.age / duration;
      node.visible = age < 1;
      if (!node.visible) continue;
      node.material.opacity = (isWater ? .36 : .32) * strength * (1 - age) ** 1.6;
      if (isWater) {
        const radius = (.19 + age * .68) * strength;
        node.scale.set(radius, radius, 1);
      }
    }
  }
  function dispose() {
    group.removeFromParent();
    shape.dispose();
    footprint.dispose();
    ripple.dispose();
    for (const { node } of slots) node.material.dispose();
  }
  return { emit, update, dispose };
}
