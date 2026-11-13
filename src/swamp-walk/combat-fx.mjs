// Small fight effects, loaded with the first sortie (not at startup): the impact ring at the contact point,
// per-enemy materials that can flash on a hit, and the ground telegraph of an enemy strike.
const IMPACT_LIFE = 0.2;
const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

function ringTexture(THREE) {
  const size = 64, canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const glow = ctx.createRadialGradient(size / 2, size / 2, size * 0.18, size / 2, size / 2, size / 2);
  glow.addColorStop(0, "rgba(255,236,190,0)");
  glow.addColorStop(0.62, "rgba(255,226,170,.95)");
  glow.addColorStop(0.78, "rgba(255,190,110,.55)");
  glow.addColorStop(1, "rgba(255,170,90,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// A ring that opens at the contact point and fades in 0.2 s; drawn over the body so it is never hidden by it.
export function createImpacts(THREE, scene, count = 4) {
  const map = ringTexture(THREE);
  const pool = Array.from({ length: count }, () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    sprite.name = "WrenchImpact";
    sprite.visible = false;
    sprite.renderOrder = 6;
    scene.add(sprite);
    return { sprite, age: Infinity, size: 1 };
  });
  let next = 0;
  return {
    spawn(x, y, z, size = 1) {
      const item = pool[next++ % pool.length];
      item.age = 0;
      item.size = size;
      item.sprite.position.set(x, y, z);
      item.sprite.scale.set(size * 0.32, size * 0.32, 1);
      item.sprite.material.opacity = 0.85;
      item.sprite.visible = true;
    },
    update(dt) {
      for (const item of pool) {
        if (!item.sprite.visible) continue;
        item.age += dt;
        const t = item.age / IMPACT_LIFE;
        if (t >= 1) { item.sprite.visible = false; continue; }
        const scale = item.size * (0.32 + 0.68 * (1 - (1 - t) ** 3));
        item.sprite.scale.set(scale, scale, 1);
        item.sprite.material.opacity = 0.85 * (1 - t * t);
      }
    },
    get active() { return pool.filter(item => item.sprite.visible).length; },
    dispose() {
      for (const { sprite } of pool) { sprite.removeFromParent(); sprite.material.dispose(); }
      map.dispose();
    },
  };
}

// The cloned rigs share materials; each enemy gets its own copies so a hit flash lights only the one struck.
// `set(flash, glow)`: flash 0..1 is a warm white, glow 0..1 a lamp-orange windup glow; `tint` multiplies the colour.
export function createTintable(THREE, root, tint = null) {
  const swaps = new Map(), owned = [];
  root.traverse(node => {
    if (!node.isMesh) return;
    node.material = [].concat(node.material).map(material => {
      if (!swaps.has(material)) {
        const copy = material.clone();
        if (tint && copy.color) copy.color.multiply(tint);
        swaps.set(material, copy);
        owned.push(copy);
      }
      return swaps.get(material);
    });
    if (node.material.length === 1) node.material = node.material[0];
  });
  const lit = owned.filter(material => material.emissive);
  const base = lit.map(material => material.emissive.clone());
  const white = new THREE.Color(1, 0.86, 0.62), lamp = new THREE.Color(1, 0.42, 0.08);
  let last = -1;
  return {
    set(flash, glow = 0, heat = 0) {
      const key = Math.round(flash * 64) * 4096 + Math.round(glow * 64) * 64 + Math.round(heat * 63);
      if (key === last) return;
      last = key;
      const w = flash * 0.12, l = glow * 0.16 + heat * 0.14;
      lit.forEach((material, index) => {
        const b = base[index];
        material.emissive.setRGB(b.r + white.r * w + lamp.r * l, b.g + white.g * w + lamp.g * l, b.b + white.b * w + lamp.b * l);
      });
    },
    dispose() { for (const material of owned) material.dispose(); },
  };
}

// The telegraph of a strike on the ground (enhance 13.11): the thin outline shows where the blow will land from the
// first frame of the windup; the fill grows from the enemy to the outline as the windup runs and is full at contact,
// then fades in 0.1 s. `aim(x, z, yaw)` at the windup start, `show(progress)` every frame (null hides it),
// `show(1 + t)` for the fade after contact. Each vertex follows the ground (deck, slope or water).
export function createTelegraph(THREE, floorAt, { reach, halfAngle, fill = 0xc66d32, edge = 0xffbb61, segments = 20 }) {
  const group = new THREE.Group();
  group.name = "StrikeTelegraph";
  group.visible = false;
  const fan = new THREE.BufferGeometry(), rim = new THREE.BufferGeometry();
  const fanPoints = new THREE.BufferAttribute(new Float32Array((segments + 2) * 3), 3);
  const rimPoints = new THREE.BufferAttribute(new Float32Array((segments + 1) * 2 * 3), 3);
  fan.setAttribute("position", fanPoints);
  rim.setAttribute("position", rimPoints);
  const fanIndex = [], rimIndex = [];
  for (let i = 1; i <= segments; i++) fanIndex.push(0, i, i + 1);
  for (let i = 0; i < segments; i++) rimIndex.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  fan.setIndex(fanIndex);
  rim.setIndex(rimIndex);
  const layer = (geometry, color, order) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    group.add(mesh);
    return mesh;
  };
  const fillMesh = layer(fan, fill, 2), rimMesh = layer(rim, edge, 3);
  let cx = 0, cz = 0, heading = 0, drawn = -1;
  const point = (attribute, index, radius, angle, lift) => {
    const px = cx + Math.sin(angle) * radius, pz = cz + Math.cos(angle) * radius;
    attribute.setXYZ(index, px, floorAt(px, pz) + lift, pz);
  };
  function spread(radius) {
    point(fanPoints, 0, 0, heading, 0.024);
    for (let i = 0; i <= segments; i++) point(fanPoints, i + 1, radius, heading + halfAngle * (i / segments * 2 - 1), 0.024);
    fanPoints.needsUpdate = true;
    drawn = radius;
  }
  return {
    group,
    aim(x, z, yaw) {
      cx = x; cz = z; heading = yaw;
      for (let i = 0; i <= segments; i++) {
        const angle = heading + halfAngle * (i / segments * 2 - 1);
        point(rimPoints, i * 2, reach - 0.07, angle, 0.03);
        point(rimPoints, i * 2 + 1, reach, angle, 0.03);
      }
      rimPoints.needsUpdate = true;
      drawn = -1;
    },
    show(progress) {
      group.visible = progress != null && progress < 1.1;
      if (!group.visible) return;
      const windup = progress < 1;
      const grow = windup ? smooth(progress) : 1;
      const radius = reach * (0.18 + 0.82 * grow);
      if (Math.abs(radius - drawn) > 0.02) spread(radius);
      const fade = windup ? 1 : 1 - (progress - 1) / 0.1;
      fillMesh.material.opacity = (windup ? 0.14 + 0.24 * grow : 0.46) * fade;
      rimMesh.material.opacity = (windup ? 0.5 + 0.4 * grow : 0.95) * fade;
    },
    dispose() { fan.dispose(); rim.dispose(); fillMesh.material.dispose(); rimMesh.material.dispose(); },
  };
}

// The real time of an attack mapped to its clip: the windup up to `contact` in the clip is stretched over `tell`
// seconds (never shorter than the clip's own), the rest plays at its normal speed.
export function windupClock(contact, tell) {
  const hold = Math.max(tell, contact);
  return {
    tell: hold,
    clip: age => age < hold ? age * contact / hold : age - hold + contact,
    real: clipTime => clipTime <= contact ? clipTime * hold / contact : clipTime - contact + hold,
  };
}

// The held target (focus): a thin lamp-coloured ring on the ground around its feet, breathing slowly.
export function createFocusRing(THREE, scene, floorAt) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), new THREE.MeshBasicMaterial({
    color: 0xffc675, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  ring.geometry.rotateX(-Math.PI / 2);
  ring.name = "FocusRing";
  ring.visible = false;
  ring.renderOrder = 3;
  scene.add(ring);
  let time = 0;
  return {
    place(target, dt = 0) {
      ring.visible = Boolean(target);
      if (!target) return;
      time += dt;
      const size = target.volume.radius + 0.2;
      ring.scale.set(size, 1, size);
      ring.position.set(target.x, floorAt(target.x, target.z) + 0.035, target.z);
      ring.material.opacity = 0.5 + 0.18 * Math.sin(time * 3.2);
    },
  };
}

// The boss charge lane: a strip `width` wide from the boss along its aim. The outline (both sides and the far end)
// shows from the start; the fill runs from the boss to the far end as the aim runs out.
export function createLane(THREE, floorAt, { length, width, fill = 0xc0502e, edge = 0xffb35c, segments = 12 }) {
  const group = new THREE.Group();
  group.name = "ChargeLane";
  group.visible = false;
  const strip = (count) => {
    const geometry = new THREE.BufferGeometry();
    const points = new THREE.BufferAttribute(new Float32Array((count + 1) * 2 * 3), 3);
    geometry.setAttribute("position", points);
    const index = [];
    for (let i = 0; i < count; i++) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    geometry.setIndex(index);
    return { geometry, points };
  };
  const mesh = (geometry, color, order) => {
    const item = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false,
      side: THREE.DoubleSide }));
    item.frustumCulled = false;
    item.renderOrder = order;
    group.add(item);
    return item;
  };
  const body = strip(segments), sides = [strip(segments), strip(segments), strip(2)];
  const fillMesh = mesh(body.geometry, fill, 2), edgeMeshes = sides.map(side => mesh(side.geometry, edge, 3));
  let cx = 0, cz = 0, fx = 0, fz = 1, drawn = -1;
  const put = (points, i, along, across, lift) => {
    const px = cx + fx * along - fz * across, pz = cz + fz * along + fx * across;
    points.setXYZ(i, px, floorAt(px, pz) + lift, pz);
  };
  function spread(reach) {
    for (let i = 0; i <= segments; i++) {
      const along = reach * i / segments;
      put(body.points, i * 2, along, -width / 2, 0.026);
      put(body.points, i * 2 + 1, along, width / 2, 0.026);
    }
    body.points.needsUpdate = true;
    drawn = reach;
  }
  return {
    group,
    aim(x, z, yaw) {
      cx = x; cz = z; fx = Math.sin(yaw); fz = Math.cos(yaw);
      for (const [side, across] of [[0, -width / 2], [1, width / 2]]) {
        for (let i = 0; i <= segments; i++) {
          const along = length * i / segments;
          put(sides[side].points, i * 2, along, across - 0.04, 0.03);
          put(sides[side].points, i * 2 + 1, along, across + 0.04, 0.03);
        }
        sides[side].points.needsUpdate = true;
      }
      for (let i = 0; i <= 2; i++) {
        const across = -width / 2 + width * i / 2;
        put(sides[2].points, i * 2, length - 0.08, across, 0.03);
        put(sides[2].points, i * 2 + 1, length, across, 0.03);
      }
      sides[2].points.needsUpdate = true;
      drawn = -1;
    },
    show(progress) {
      group.visible = progress != null && progress < 1.1;
      if (!group.visible) return;
      const grow = progress < 1 ? smooth(progress) : 1;
      const reach = Math.max(0.05, length * grow);
      if (Math.abs(reach - drawn) > 0.04) spread(reach);
      const fade = progress < 1 ? 1 : 1 - (progress - 1) / 0.1;
      fillMesh.material.opacity = (0.2 + 0.32 * grow) * fade;
      for (const item of edgeMeshes) item.material.opacity = (0.55 + 0.4 * grow) * fade;
    },
  };
}
