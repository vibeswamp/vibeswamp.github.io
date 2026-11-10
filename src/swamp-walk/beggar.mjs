const SCALE = 1.72;
const ASSET_FLOOR = -0.435968;
const WALK_SPEED = 0.75;
const RUN_SPEED = 2.05;
const NOTICE_RADIUS = 4.4;
const LEASH_RADIUS = 5.4;
const WINDUP_RANGE = 0.95;
const REACH = 1.03;
const HALF_SWEEP = Math.PI * 0.24;
const IMPACT = 0.40;
const RECOVERY = 0.38;
const BLEND = 0.09;
const PLAYER_CHEST = 0.85;
const BEGGAR_CHEST = 0.75;
const STEP_UP = 0.20;
const STEP_DOWN = 0.28;
const SAMPLE_DISTANCE = 0.12;
const FALL_TIME = 0.82;

const unit = (n) => Math.max(0, Math.min(1, n));
const smooth = (n) => { n = unit(n); return n * n * (3 - 2 * n); };
const clipNames = ["Beggar_Idle", "Beggar_Walk", "Beggar_Run", "Attack_Sign_Jab", "Hit_React"];

function arc(dx, dz, yaw, range, halfAngle) {
  const distance = Math.hypot(dx, dz);
  return distance <= range && dx * Math.sin(yaw) + dz * Math.cos(yaw) >= distance * Math.cos(halfAngle);
}

function buildRoute(x, z, points) {
  const route = [{ x, z }];
  for (const point of points) {
    const [px, pz] = Array.isArray(point) ? point : [point.x, point.z];
    if (!Number.isFinite(px) || !Number.isFinite(pz)) throw new TypeError("Beggar needs finite patrol points");
    if (Math.hypot(px - route.at(-1).x, pz - route.at(-1).z) > 0.03) route.push({ x: px, z: pz });
  }
  return route;
}

function makeActions(THREE, model) {
  const mixer = new THREE.AnimationMixer(model.scene);
  const actions = clipNames.map((name) => {
    const source = THREE.AnimationClip.findByName(model.animations, name);
    if (!source?.tracks.length || !source.validate()) throw new Error(`Beggar GLB is missing valid ${name}`);
    const clip = source.clone();
    const first = Math.min(...clip.tracks.map(track => track.times[0]));
    for (const track of clip.tracks) track.shift(-first);
    return mixer.clipAction(clip.resetDuration()).setEffectiveTimeScale(0).play();
  });
  return { mixer, actions };
}

function makeWarning(THREE, floorAt) {
  const start = -Math.PI / 2 - HALF_SWEEP;
  const angle = HALF_SWEEP * 2;
  const group = new THREE.Group();
  group.name = "BeggarStrikeTelegraph";
  const layers = [
    [new THREE.CircleGeometry(REACH, 26, start, angle), 0xbf7534, 0.021],
    [new THREE.RingGeometry(REACH - 0.055, REACH, 26, 1, start, angle), 0xffbf61, 0.027],
  ].map(([geometry, color, lift], index) => {
    geometry.rotateX(-Math.PI / 2);
    const rest = geometry.attributes.position.array.slice();
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2 + index;
    group.add(mesh);
    return { geometry, material, rest, lift };
  });
  return {
    group,
    aim(x, z, yaw) {
      const cos = Math.cos(yaw), sin = Math.sin(yaw);
      for (const { geometry, rest, lift } of layers) {
        const p = geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const lx = rest[i * 3], lz = rest[i * 3 + 2];
          const px = x + lx * cos + lz * sin, pz = z - lx * sin + lz * cos;
          p.setXYZ(i, px, floorAt(px, pz) + lift, pz);
        }
        p.needsUpdate = true;
      }
    },
    show(age) {
      group.visible = age !== null && age < IMPACT + 0.1;
      if (!group.visible) return;
      const strength = age < IMPACT ? smooth(age / IMPACT) : 1 - smooth((age - IMPACT) / 0.1);
      layers[0].material.opacity = age < IMPACT ? 0.16 + strength * 0.30 : strength * 0.39;
      layers[1].material.opacity = age < IMPACT ? 0.61 + strength * 0.35 : strength * 0.88;
    },
  };
}

export async function createBeggar({ THREE, GLTFLoader, scene, url, x, z, floorAt, onHit,
  points = [], canReach = () => true }) {
  const patrol = buildRoute(x, z, points);
  const gltf = await new GLTFLoader().loadAsync(url);
  const { mixer, actions: [idle, walk, run, attack, hit] } = makeActions(THREE, gltf);
  const attackEnd = attack.getClip().duration, hitEnd = hit.getClip().duration;
  if (attackEnd < IMPACT + BLEND || hitEnd < BLEND) throw new Error("Beggar GLB has incomplete combat clips");

  const root = new THREE.Group();
  root.name = "PierBeggar";
  const body = new THREE.Group();
  gltf.scene.scale.setScalar(SCALE);
  gltf.scene.position.y = -ASSET_FLOOR * SCALE;
  gltf.scene.traverse((obj) => { if (obj.isSkinnedMesh) obj.frustumCulled = false; });
  body.add(gltf.scene);
  root.add(body);
  const position = root.position;
  const warning = makeWarning(THREE, floorAt);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), new THREE.MeshBasicMaterial({
    color: 0x111c15, transparent: true, opacity: 0.31, depthWrite: false,
  }));
  shadow.name = "BeggarGroundShadow";
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.y = 0.71;

  let health, mode, age, cooldown, phase, idleTime, weights, interrupted, waypoint, direction;

  function stepAllowed(px, pz, py, previousY) {
    return Number.isFinite(py) && py - previousY <= STEP_UP && previousY - py <= STEP_DOWN
      && canReach(px, pz, py);
  }

  function lineClear(toX, toZ) {
    const dx = toX - position.x, dz = toZ - position.z;
    const steps = Math.ceil(Math.hypot(dx, dz) / SAMPLE_DISTANCE);
    let y = position.y;
    for (let i = 1; i <= steps; i++) {
      const px = position.x + dx * i / steps, pz = position.z + dz * i / steps;
      const nextY = floorAt(px, pz);
      if (!stepAllowed(px, pz, nextY, y)) return false;
      y = nextY;
    }
    return true;
  }

  function face(dx, dz, factor) {
    if (Math.hypot(dx, dz) < 0.001) return;
    const angle = Math.atan2(dx, dz) - root.rotation.y;
    root.rotation.y += Math.atan2(Math.sin(angle), Math.cos(angle)) * factor;
  }

  function moveTo(target, budget, clearance) {
    const dx = target.x - position.x, dz = target.z - position.z;
    const distance = Math.hypot(dx, dz);
    const travel = Math.min(budget, Math.max(0, distance - clearance));
    if (!travel) return 0;
    const steps = Math.ceil(travel / SAMPLE_DISTANCE);
    const sx = dx * travel / (distance * steps), sz = dz * travel / (distance * steps);
    let taken = 0;
    for (let i = 0; i < steps; i++) {
      const px = position.x + sx, pz = position.z + sz, py = floorAt(px, pz);
      if (!stepAllowed(px, pz, py, position.y)) break;
      position.set(px, py, pz);
      taken++;
    }
    return travel * taken / steps;
  }

  function patrolTarget() {
    if (patrol.length === 1) return patrol[0];
    const point = patrol[waypoint];
    if (Math.hypot(point.x - position.x, point.z - position.z) <= 0.045) {
      if (waypoint === 0 || waypoint === patrol.length - 1) direction = waypoint === 0 ? 1 : -1;
      waypoint += direction;
    }
    return patrol[waypoint];
  }

  function attackWeight(at) {
    return smooth(at / BLEND) * smooth((attackEnd - at) / BLEND);
  }

  function renderPose(dt, gait, distance) {
    idleTime = (idleTime + dt) % idle.getClip().duration;
    const stride = gait === 2 ? 0.40 : 0.22;
    phase = (phase + distance / (SCALE * stride)) % 1;
    const gaitBlend = 1 - Math.exp(-dt * 16);
    for (let i = 0; i < weights.length; i++) weights[i] += ((gait === i ? 1 : 0) - weights[i]) * gaitBlend;

    const attacking = mode === "attack";
    const reacting = mode === "hit" || mode === "fall";
    const strikeWeight = attacking ? attackWeight(age)
      : reacting && interrupted ? interrupted.weight * (1 - smooth(age / BLEND)) : 0;
    const hitWeight = reacting ? smooth(age / BLEND) * (mode === "hit" ? smooth((hitEnd - age) / BLEND) : 1) : 0;
    const gaitWeight = 1 - strikeWeight - hitWeight;
    idle.time = idleTime;
    walk.time = phase * walk.getClip().duration;
    run.time = phase * run.getClip().duration;
    for (const [index, action] of [idle, walk, run].entries()) action.setEffectiveWeight(weights[index] * gaitWeight);
    attack.time = attacking ? Math.min(age, attackEnd) : interrupted?.time ?? 0;
    attack.setEffectiveWeight(strikeWeight);
    hit.time = reacting ? Math.min(age, hitEnd) : 0;
    hit.setEffectiveWeight(hitWeight);
    mixer.update(0);

    const fall = mode === "fall" ? unit(age / FALL_TIME) : 0;
    body.rotation.z = 1.38 * smooth(fall);
    body.scale.setScalar(1 - 0.94 * smooth((fall - 0.56) / 0.44));
    root.visible = shadow.visible = fall < 1;
    shadow.position.set(position.x, position.y + 0.014, position.z);
    warning.show(attacking ? age : null);
  }

  function reset() {
    health = 3;
    mode = "ready";
    age = cooldown = phase = idleTime = 0;
    weights = [1, 0, 0];
    interrupted = null;
    waypoint = patrol.length > 1 ? 1 : 0;
    direction = 1;
    position.set(x, floorAt(x, z), z);
    root.rotation.y = 0;
    renderPose(0, 0, 0);
  }

  function move(dt, player) {
    const dx = player.x - position.x, dz = player.z - position.z;
    const distance = Math.hypot(dx, dz);
    const playerInZone = Math.hypot(player.x - x, player.z - z) <= LEASH_RADIUS;
    const closeHeight = Math.abs(player.y - position.y) <= 0.63;
    const hunting = playerInZone && closeHeight && distance <= NOTICE_RADIUS;
    if (hunting && distance <= WINDUP_RANGE + 1e-6 && cooldown <= 0 && lineClear(player.x, player.z)) {
      face(dx, dz, 1);
      warning.aim(position.x, position.z, root.rotation.y);
      mode = "attack";
      age = 0;
      return [0, 0];
    }
    const target = hunting ? player : patrolTarget();
    face(target.x - position.x, target.z - position.z, 1 - Math.exp(-dt * 14));
    const moved = moveTo(target, dt * (hunting ? RUN_SPEED : WALK_SPEED), hunting ? WINDUP_RANGE : 0);
    return [moved ? (hunting ? 2 : 1) : 0, moved];
  }

  reset();
  scene.add(root, shadow, warning.group);
  return {
    position,
    get defeated() { return health === 0; },
    update(dt, player) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      let gait = 0, distance = 0, contact = false;
      const previous = age;
      age += dt;
      if (mode === "attack") {
        contact = previous < IMPACT && age >= IMPACT
          && Math.abs(player.y + PLAYER_CHEST - position.y - BEGGAR_CHEST) <= 0.62
          && arc(player.x - position.x, player.z - position.z, root.rotation.y, REACH, HALF_SWEEP)
          && lineClear(player.x, player.z);
        if (age >= attackEnd) { mode = "ready"; cooldown = RECOVERY; }
      } else if (mode === "hit") {
        if (age >= hitEnd) { mode = "ready"; cooldown = RECOVERY; }
      } else if (mode === "ready") {
        cooldown = Math.max(0, cooldown - dt);
        [gait, distance] = move(dt, player);
      }
      renderPose(dt, gait, distance);
      if (contact) onHit();
    },
    strike(player) {
      if (!health || mode === "hit") return false;
      if (Math.abs(player.y + PLAYER_CHEST - position.y - BEGGAR_CHEST) > 0.8
          || !arc(position.x - player.x, position.z - player.z, player.yaw, 1.85, Math.PI * 0.32)
          || !lineClear(player.x, player.z)) return false;
      interrupted = mode === "attack" ? { time: age, weight: attackWeight(age) } : null;
      health--;
      mode = health ? "hit" : "fall";
      age = 0;
      renderPose(0, 0, 0);
      return true;
    },
    reset,
  };
}
