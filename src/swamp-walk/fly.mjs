import { createLane, createTelegraph, windupClock } from "./combat-fx.mjs";

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

// `boss` (combat-tuning.mjs BOSS) makes the angry Fly: bigger, a charge along a lane, a second phase at half health.
export async function createFly({ THREE, GLTFLoader, scene, url, x, z, floorAt, onHit, canReach, model, raid = false, hits = 3,
  tuning = {}, boss = null }) {
  const big = boss?.scale ?? 1;
  // The boss hovers as low as a Fly, so the wrench still reaches its body.
  const hover = HOVER_HEIGHT;
  const reach = ATTACK_REACH * big, windupRange = WINDUP_RANGE * big;
  const aggro = boss?.aggro ?? AGGRO_RADIUS, leashRadius = boss?.leash ?? LEASH_RADIUS;
  const charge = boss?.charge ?? null, rage = boss?.rage ?? null;
  const rehit = tuning.rehit ?? 0.14;
  // The placard smash: its windup is stretched to `tell` seconds (combat-tuning.mjs) so it can be read and dodged.
  const clock = windupClock(IMPACT, tuning.tell ?? IMPACT);
  const gltf = model ?? await new GLTFLoader().loadAsync(url);
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
  gltf.scene.scale.setScalar(SCALE * big);
  // The placard leaves the bind-pose bounds at contact.
  gltf.scene.traverse((object) => { if (object.isSkinnedMesh) object.frustumCulled = false; });
  root.add(body);
  const shadow = groundShadow(THREE);
  shadow.scale.setScalar(big);
  const warning = createTelegraph(THREE, floorAt, { reach, halfAngle: ATTACK_HALF_ANGLE });
  const lane = charge ? createLane(THREE, floorAt, { length: charge.length, width: charge.width }) : null;
  const position = root.position;

  let health, mode, age, cooldown, phase, flightBlend, interrupted;
  // The boss charge: its own cooldown, the aim, metres left to fly, whether it already hit, the second charge.
  let chargeCooldown = 0, chargeYaw = 0, chargeLeft = 0, chargeHit = false, streak = 0, shrugged = 0;
  const enraged = () => Boolean(rage) && health > 0 && health <= hits / 2;
  const chargeTell = () => enraged() ? rage.tell : charge.tell;

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
    const strikeAt = attacking ? clock.clip(age) : 0;
    const strikeWeight = attacking ? attackWeight(strikeAt)
      : oldAttack ? oldAttack.weight * (1 - smooth(age / BLEND)) : 0;
    const hitWeight = reacting ? smooth(age / BLEND) *
      (mode === "hit" ? smooth((hitEnd - age) / BLEND) : 1) : 0;
    const airWeight = 1 - strikeWeight - hitWeight;
    const blendIndex = flightBlend * (flight.length - 1);
    for (const [index, clip] of flight.entries()) {
      clip.time = phase * clip.getClip().duration;
      clip.setEffectiveWeight(airWeight * Math.max(0, 1 - Math.abs(blendIndex - index)));
    }
    attack.time = attacking ? Math.min(strikeAt, attackEnd) : oldAttack?.time ?? 0;
    attack.setEffectiveWeight(strikeWeight);
    hit.time = reacting ? Math.min(age, hitEnd) : 0;
    hit.setEffectiveWeight(hitWeight);
    mixer.update(0);

    const lunge = attacking ? SWING_LUNGE * smooth((strikeAt - 0.26) / 0.24) * smooth((0.81 - strikeAt) / 0.31) : 0;
    const fall = mode === "fall" ? unit(age / FALL_TIME) : 0;
    // The boss rears back while it aims, leans into the charge and hangs low while it recovers.
    const rear = mode === "charge" ? (age < chargeTell() ? -0.42 * smooth(age / chargeTell()) : 0.32) : 0;
    const tired = mode === "recover" ? -0.24 * smooth(age / 0.2) * smooth((charge.recover - age) / 0.25) : 0;
    body.position.set(0, -0.58 * smooth(fall) + tired, lunge);
    body.rotation.x = rear;
    body.rotation.z = -1.14 * smooth(fall);
    body.scale.setScalar(1 - 0.94 * smooth((fall - 0.52) / 0.48));
    root.visible = shadow.visible = fall < 1;
    lane?.show(mode === "charge" ? (age < chargeTell() ? age / chargeTell() : 1 + Math.min(0.11, age - chargeTell())) : null);
    const sx = position.x + Math.sin(root.rotation.y) * lunge;
    const sz = position.z + Math.cos(root.rotation.y) * lunge;
    shadow.position.set(sx, floorAt(sx, sz) + 0.016, sz);
    warning.show(attacking ? (age < clock.tell ? age / clock.tell : 1 + age - clock.tell) : null);
  }

  function reset() {
    health = hits;
    mode = "ready";
    age = cooldown = phase = flightBlend = 0;
    interrupted = null;
    position.set(x, floorAt(x, z) + hover, z);
    chargeCooldown = 0;
    streak = 0;
    root.rotation.y = 0;
    renderPose(0, 0);
  }

  function pursue(dt, player, waypoint) {
    const dx = player.x - position.x, dz = player.z - position.z;
    const distance = Math.hypot(dx, dz);
    const fromHome = Math.hypot(player.x - x, player.z - z);
    const tracking = !waypoint && (raid || fromHome <= aggro)
      && Math.abs(player.y + PLAYER_CHEST - position.y) <= 1.55 + (big - 1);
    if (charge && tracking && chargeCooldown <= 0) {
      if (distance >= charge.min && distance <= charge.max && clearTo(player.x, player.z, player.y)) {
        aimCharge(dx, dz);
        return 0;
      }
      // Too close for a charge: back off facing Klyop to make room for it; blocked - try again a second later.
      if (distance < charge.min) {
        const back = (boss.chase ?? CHASE_SPEED) * dt, gap = distance || 1;
        const nx = position.x - dx / gap * back, nz = position.z - dz / gap * back;
        root.rotation.y = facing(dx, dz);
        if (clearTo(nx, nz, floorAt(nx, nz) + hover - OBSTACLE_BASE_OFFSET)) {
          position.x = nx;
          position.z = nz;
          return 1;
        }
        chargeCooldown = 1;
      }
    }
    if (tracking && distance <= windupRange + 1e-6 && cooldown <= 0 && clearTo(player.x, player.z, player.y)) {
      if (distance > 0.001) root.rotation.y = facing(dx, dz);
      warning.aim(position.x, position.z, root.rotation.y);
      mode = "attack";
      age = 0;
      return 0;
    }
    const leash = raid ? 1 : Math.min(1, leashRadius / (fromHome || 1));
    const targetX = waypoint?.x ?? (tracking ? x + (player.x - x) * leash : x);
    const targetZ = waypoint?.z ?? (tracking ? z + (player.z - z) * leash : z);
    const tx = targetX - position.x, tz = targetZ - position.z;
    const remaining = Math.hypot(tx, tz);
    const speed = (boss?.chase ?? CHASE_SPEED) * (enraged() ? rage.chase : 1);
    const clearance = tracking ? Math.max(0, distance - windupRange) : remaining;
    const step = Math.min(remaining, clearance, speed * dt);
    if (remaining > 0.001) {
      const angle = facing(tx, tz) - root.rotation.y;
      root.rotation.y += Math.atan2(Math.sin(angle), Math.cos(angle)) * (1 - Math.exp(-dt * 13));
    }
    if (!step) return 0;
    const nextX = position.x + tx * (step / remaining);
    const nextZ = position.z + tz * (step / remaining);
    if (canReach && !clearTo(nextX, nextZ, floorAt(nextX, nextZ) + hover - OBSTACLE_BASE_OFFSET)) return 0;
    position.x = nextX;
    position.z = nextZ;
    return unit(step / (speed * dt));
  }

  function aimCharge(dx, dz) {
    chargeYaw = Math.hypot(dx, dz) > 0.001 ? facing(dx, dz) : root.rotation.y;
    root.rotation.y = chargeYaw;
    lane.aim(position.x, position.z, chargeYaw);
    mode = "charge";
    age = 0;
    chargeLeft = charge.length;
    chargeHit = false;
  }

  // The charge itself: straight along the lane until its end or anything solid; one hit on Klyop per charge.
  function dash(dt, player) {
    let contact = false;
    const step = Math.min(chargeLeft, charge.speed * dt);
    const nx = position.x + Math.sin(chargeYaw) * step, nz = position.z + Math.cos(chargeYaw) * step;
    if (!clearTo(nx, nz, floorAt(nx, nz) + hover - OBSTACLE_BASE_OFFSET)) chargeLeft = 0;
    else {
      position.x = nx;
      position.z = nz;
      chargeLeft -= step;
      if (!chargeHit && Math.hypot(player.x - nx, player.z - nz) <= charge.width / 2 + 0.3
          && Math.abs(player.y + PLAYER_CHEST - position.y) <= 1.3) chargeHit = contact = true;
    }
    if (chargeLeft > 0) return contact;
    if (enraged() && rage.twice && !streak) {
      streak = 1;
      aimCharge(player.x - position.x, player.z - position.z);
    } else {
      streak = 0;
      mode = "recover";
      age = 0;
    }
    return contact;
  }

  reset();
  scene.add(root, shadow, warning.group);
  if (lane) scene.add(lane.group);
  function harm(amount) {
    if (!health || (mode === "hit" && age < rehit)) return false;
    // A charging boss does not flinch: the blow counts, the charge goes on. Otherwise it shrugs off every other
    // blow (except while winding up a smash), so single swings cannot keep it reeling.
    const shrug = boss && mode !== "attack" && mode !== "charge" && shrugged++ % 2 === 0;
    if ((mode === "charge" && age >= chargeTell()) || shrug) {
      health = Math.max(0, health - amount);
      if (!health) { mode = "fall"; age = 0; renderPose(0, 0); }
      return true;
    }
    interrupted = mode === "attack" ? { time: clock.clip(age), weight: attackWeight(clock.clip(age)) } : null;
    health = Math.max(0, health - amount);
    mode = health ? "hit" : "fall";
    age = 0;
    renderPose(0, 0);
    return true;
  }
  return {
    position,
    get attacking() { return mode === "attack"; },
    // 0..1 while the strike winds up (the host lights the body with it), otherwise null.
    get telegraph() {
      if (mode === "charge" && age < chargeTell()) return age / chargeTell();
      return mode === "attack" && age < clock.tell ? age / clock.tell : null;
    },
    // The boss: which part of the fight (1, or 2 below half health) and whether it is charging now.
    get phase() { return enraged() ? 2 : 1; },
    get charging() { return mode === "charge"; },
    get health() { return health; },
    get defeated() { return health === 0; },
    get gone() { return mode === "fall" && age >= FALL_TIME; },
    update(dt, player, waypoint) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      let moving = 0, contact = false;
      const before = age;
      age += dt;
      if (mode === "attack") {
        contact = before < clock.tell && age >= clock.tell
          && Math.abs(player.y + PLAYER_CHEST - position.y) <= ATTACK_HEIGHT * big
          && withinArc(player.x - position.x, player.z - position.z, root.rotation.y, reach, ATTACK_HALF_ANGLE)
          && clearTo(player.x, player.z, player.y);
        if (clock.clip(age) >= attackEnd) {
          mode = "ready";
          cooldown = RECOVERY;
        }
      } else if (mode === "hit") {
        if (age >= hitEnd) {
          mode = "ready";
          cooldown = RECOVERY;
        }
      } else if (mode === "charge") {
        if (age >= chargeTell()) {
          contact = dash(dt, player);
          moving = 1;
        }
      } else if (mode === "recover") {
        if (age >= charge.recover) {
          mode = "ready";
          chargeCooldown = enraged() ? rage.cooldown : charge.cooldown;
        }
      } else if (mode === "ready") {
        cooldown = Math.max(0, cooldown - dt);
        chargeCooldown = Math.max(0, chargeCooldown - dt);
        moving = pursue(dt, player, waypoint);
      }
      const height = floorAt(position.x, position.z) + hover;
      position.y += (height - position.y) * (1 - Math.exp(-dt * 12));
      renderPose(dt, moving);
      if (contact) onHit(player);
    },
    strike(player, amount = 1) {
      if (health === 0 || mode === "hit") return false;
      if (Math.abs(player.y + PLAYER_CHEST - position.y) > PLAYER_HIT_HEIGHT ||
          !withinArc(position.x - player.x, position.z - player.z, player.yaw, PLAYER_REACH, PLAYER_HALF_ANGLE)
          || !clearTo(player.x, player.z, player.y)) return false;
      return harm(amount);
    },
    harm,
    // Knockback (expedition-combat.mjs moves the actor): where the Fly may be pushed - the same clear line as flight.
    standAt(nx, nz) {
      return clearTo(nx, nz, floorAt(nx, nz) + hover - OBSTACLE_BASE_OFFSET) ? position.y : null;
    },
    pullToward(player) {
      const dx = player.x - position.x, dz = player.z - position.z;
      const ratio = Math.min(0.72 / (Math.hypot(dx, dz) || 1), 0.42);
      const px = position.x + dx * ratio, pz = position.z + dz * ratio;
      if (clearTo(px, pz, player.y)) { position.x = px; position.z = pz; }
    },
    reset,
  };
}
