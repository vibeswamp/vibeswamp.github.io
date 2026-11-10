const SCALE = 1.68;
const HOVER_HEIGHT = 0.94;
const CHASE_SPEED = 2.65;
const AGGRO_RADIUS = 6.8;
const LEASH_RADIUS = 5.6;
const WINDUP_RANGE = 1.19;
const IMPACT = 0.50;
const ATTACK_REACH = 1.32;
const ATTACK_HALF_ANGLE = Math.PI / 4;
const SWING_LUNGE = 0.24;
const PLAYER_REACH = 1.85;
const PLAYER_HALF_ANGLE = Math.PI * 0.32;
const PLAYER_CHEST = 0.85;
const ATTACK_HEIGHT = 0.65;
const PLAYER_HIT_HEIGHT = 0.82;
const OBSTACLE_SAMPLE = 0.12;
const OBSTACLE_BASE_OFFSET = 0.51;
const BLEND = 0.09;
const RECOVERY = 0.32;
const FALL_TIME = 0.78;
const FLIGHT = ["Fly_Hover", "Fly_Coast_In", "Fly_Coast", "Fly_Coast_Out", "Fly_Forward"];

const unit = (t) => Math.max(0, Math.min(1, t));
const smooth = (t) => { t = unit(t); return t * t * (3 - 2 * t); };
const facing = (dx, dz) => Math.atan2(dx, dz);

function withinArc(dx, dz, yaw, reach, halfAngle) {
  const distance = Math.hypot(dx, dz);
  return distance <= reach && dx * Math.sin(yaw) + dz * Math.cos(yaw) >= distance * Math.cos(halfAngle);
}

function readClip(THREE, gltf, name) {
  const source = THREE.AnimationClip.findByName(gltf.animations, name);
  if (!source?.tracks.length || !source.validate()) throw new Error(`Fly GLB is missing valid ${name}`);
  const clip = source.clone();
  // Blender's first exported key is at 1/30 s. Frame 16 is 0.50 s into the action.
  const first = Math.min(...clip.tracks.map(track => track.times[0]));
  for (const track of clip.tracks) track.shift(-first);
  return clip.resetDuration();
}

function warningSector(THREE, floorAt) {
  const start = -Math.PI / 2 - ATTACK_HALF_ANGLE;
  const sweep = ATTACK_HALF_ANGLE * 2;
  const parts = [
    [new THREE.CircleGeometry(ATTACK_REACH, 32, start, sweep), 0xc66d32, 0.021],
    [new THREE.RingGeometry(ATTACK_REACH - 0.065, ATTACK_REACH, 32, 1, start, sweep), 0xffbb61, 0.030],
  ];
  const group = new THREE.Group();
  group.name = "FlyStrikeTelegraph";
  group.visible = false;
  const strips = parts.map(([geometry, color, lift], index) => {
    geometry.rotateX(-Math.PI / 2);
    const local = geometry.attributes.position.array.slice();
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false,
      side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2 + index;
    group.add(mesh);
    return { geometry, local, material, lift };
  });
  return {
    group,
    aim(x, z, yaw) {
      const cos = Math.cos(yaw), sin = Math.sin(yaw);
      for (const { geometry, local, lift } of strips) {
        const positions = geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
          const lx = local[i * 3], lz = local[i * 3 + 2];
          const px = x + lx * cos + lz * sin, pz = z - lx * sin + lz * cos;
          positions.setXYZ(i, px, floorAt(px, pz) + lift, pz);
        }
        positions.needsUpdate = true;
      }
    },
    show(age) {
      group.visible = age !== null && age < IMPACT + 0.11;
      if (!group.visible) return;
      const windup = age < IMPACT;
      const charge = windup ? smooth(age / IMPACT) : 1 - smooth((age - IMPACT) / 0.11);
      strips[0].material.opacity = windup ? 0.17 + charge * 0.24 : charge * 0.36;
      strips[1].material.opacity = windup ? 0.62 + charge * 0.35 : charge * 0.88;
    },
  };
}

function groundShadow(THREE) {
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.46), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: `varying vec2 xy;
      void main() {
        xy = uv * 2. - 1.;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: `varying vec2 xy;
      void main() {
        gl_FragColor = vec4(.028, .037, .024, (1. - smoothstep(.15, 1., length(xy))) * .39);
      }`,
  }));
  shadow.name = "FlyGroundShadow";
  shadow.rotation.x = -Math.PI / 2;
  return shadow;
}

export async function createFly({ THREE, GLTFLoader, scene, url, x, z, floorAt, onHit, canReach }) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const action = (name) => mixer.clipAction(readClip(THREE, gltf, name)).setEffectiveTimeScale(0).play();
  const flight = FLIGHT.map(action);
  const attack = action("Attack_Placard_Smash");
  const hit = action("Hit_React");
  const attackEnd = attack.getClip().duration;
  const hitEnd = hit.getClip().duration;
  if (attackEnd < IMPACT + BLEND || hitEnd < BLEND) throw new Error("Fly GLB has incomplete combat clips");

  const root = new THREE.Group();
  root.name = "PierFly";
  const body = new THREE.Group();
  body.add(gltf.scene);
  gltf.scene.scale.setScalar(SCALE);
  // The placard leaves the bind-pose bounds at contact.
  gltf.scene.traverse((object) => { if (object.isSkinnedMesh) object.frustumCulled = false; });
  root.add(body);
  const shadow = groundShadow(THREE);
  const warning = warningSector(THREE, floorAt);
  const position = root.position;

  let health, mode, age, cooldown, phase, flightBlend, interrupted;

  function clearTo(tx, tz, ty) {
    if (!canReach) return true;
    const dx = tx - position.x, dz = tz - position.z;
    const steps = Math.ceil(Math.hypot(dx, dz) / OBSTACLE_SAMPLE);
    const base = position.y - OBSTACLE_BASE_OFFSET;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!canReach(position.x + dx * t, position.z + dz * t, base + (ty - base) * t)) return false;
    }
    return true;
  }

  function attackWeight(at) {
    return smooth(at / BLEND) * smooth((attackEnd - at) / BLEND);
  }

  function renderPose(dt, moving) {
    phase = (phase + dt) % 1;
    flightBlend += (moving - flightBlend) * (1 - Math.exp(-dt * 9));
    const attacking = mode === "attack";
    const reacting = mode === "hit" || mode === "fall";
    const oldAttack = reacting ? interrupted : null;
    const strikeWeight = attacking ? attackWeight(age)
      : oldAttack ? oldAttack.weight * (1 - smooth(age / BLEND)) : 0;
    const hitWeight = reacting ? smooth(age / BLEND) *
      (mode === "hit" ? smooth((hitEnd - age) / BLEND) : 1) : 0;
    const airWeight = 1 - strikeWeight - hitWeight;
    const blendIndex = flightBlend * (flight.length - 1);
    for (const [index, clip] of flight.entries()) {
      clip.time = phase * clip.getClip().duration;
      clip.setEffectiveWeight(airWeight * Math.max(0, 1 - Math.abs(blendIndex - index)));
    }
    attack.time = attacking ? Math.min(age, attackEnd) : oldAttack?.time ?? 0;
    attack.setEffectiveWeight(strikeWeight);
    hit.time = reacting ? Math.min(age, hitEnd) : 0;
    hit.setEffectiveWeight(hitWeight);
    mixer.update(0);

    const lunge = attacking ? SWING_LUNGE * smooth((age - 0.26) / 0.24) * smooth((0.81 - age) / 0.31) : 0;
    const fall = mode === "fall" ? unit(age / FALL_TIME) : 0;
    body.position.set(0, -0.58 * smooth(fall), lunge);
    body.rotation.z = -1.14 * smooth(fall);
    body.scale.setScalar(1 - 0.94 * smooth((fall - 0.52) / 0.48));
    root.visible = shadow.visible = fall < 1;
    const sx = position.x + Math.sin(root.rotation.y) * lunge;
    const sz = position.z + Math.cos(root.rotation.y) * lunge;
    shadow.position.set(sx, floorAt(sx, sz) + 0.016, sz);
    warning.show(attacking ? age : null);
  }

  function reset() {
    health = 3;
    mode = "ready";
    age = cooldown = phase = flightBlend = 0;
    interrupted = null;
    position.set(x, floorAt(x, z) + HOVER_HEIGHT, z);
    root.rotation.y = 0;
    renderPose(0, 0);
  }

  function pursue(dt, player) {
    const dx = player.x - position.x, dz = player.z - position.z;
    const distance = Math.hypot(dx, dz);
    const fromHome = Math.hypot(player.x - x, player.z - z);
    const tracking = fromHome <= AGGRO_RADIUS && Math.abs(player.y + PLAYER_CHEST - position.y) <= 1.55;
    if (tracking && distance <= WINDUP_RANGE + 1e-6 && cooldown <= 0 && clearTo(player.x, player.z, player.y)) {
      if (distance > 0.001) root.rotation.y = facing(dx, dz);
      warning.aim(position.x, position.z, root.rotation.y);
      mode = "attack";
      age = 0;
      return 0;
    }
    const leash = Math.min(1, LEASH_RADIUS / (fromHome || 1));
    const targetX = tracking ? x + (player.x - x) * leash : x;
    const targetZ = tracking ? z + (player.z - z) * leash : z;
    const tx = targetX - position.x, tz = targetZ - position.z;
    const remaining = Math.hypot(tx, tz);
    const clearance = tracking ? Math.max(0, distance - WINDUP_RANGE) : remaining;
    const step = Math.min(remaining, clearance, CHASE_SPEED * dt);
    if (remaining > 0.001) {
      const angle = facing(tx, tz) - root.rotation.y;
      root.rotation.y += Math.atan2(Math.sin(angle), Math.cos(angle)) * (1 - Math.exp(-dt * 13));
    }
    if (!step) return 0;
    const nextX = position.x + tx * (step / remaining);
    const nextZ = position.z + tz * (step / remaining);
    if (canReach && !clearTo(nextX, nextZ, floorAt(nextX, nextZ) + HOVER_HEIGHT - OBSTACLE_BASE_OFFSET)) return 0;
    position.x = nextX;
    position.z = nextZ;
    return unit(step / (CHASE_SPEED * dt));
  }

  reset();
  scene.add(root, shadow, warning.group);
  return {
    position,
    get defeated() { return health === 0; },
    update(dt, player) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      let moving = 0, contact = false;
      const before = age;
      age += dt;
      if (mode === "attack") {
        contact = before < IMPACT && age >= IMPACT
          && Math.abs(player.y + PLAYER_CHEST - position.y) <= ATTACK_HEIGHT
          && withinArc(player.x - position.x, player.z - position.z, root.rotation.y, ATTACK_REACH, ATTACK_HALF_ANGLE)
          && clearTo(player.x, player.z, player.y);
        if (age >= attackEnd) {
          mode = "ready";
          cooldown = RECOVERY;
        }
      } else if (mode === "hit") {
        if (age >= hitEnd) {
          mode = "ready";
          cooldown = RECOVERY;
        }
      } else if (mode === "ready") {
        cooldown = Math.max(0, cooldown - dt);
        moving = pursue(dt, player);
      }
      const height = floorAt(position.x, position.z) + HOVER_HEIGHT;
      position.y += (height - position.y) * (1 - Math.exp(-dt * 12));
      renderPose(dt, moving);
      if (contact) onHit();
    },
    strike(player) {
      if (health === 0 || mode === "hit") return false;
      if (Math.abs(player.y + PLAYER_CHEST - position.y) > PLAYER_HIT_HEIGHT ||
          !withinArc(position.x - player.x, position.z - player.z, player.yaw, PLAYER_REACH, PLAYER_HALF_ANGLE)
          || !clearTo(player.x, player.z, player.y)) return false;
      interrupted = mode === "attack" ? { time: age, weight: attackWeight(age) } : null;
      health--;
      mode = health ? "hit" : "fall";
      age = 0;
      renderPose(0, 0);
      return true;
    },
    reset,
  };
}
