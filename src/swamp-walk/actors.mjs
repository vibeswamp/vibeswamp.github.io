// Night raiders of the game day (candidate C, actors.mjs): Tinnik and Toplyak follow a route, wind up and strike.
// Toplyak's strike profile is the corrected one from lane combined-m34-toplyak: his right hand points 0.26 rad
// left of the body at contact, so the warning sector and the hit test follow the hand (reach 1.04 m, ±0.32 rad).
// The day worker Tolya of candidate C is not taken (no model on the site). Health and damage: combat-tuning.mjs.
import { createTelegraph, windupClock } from "./combat-fx.mjs";

export const P02_MODELS = Object.freeze({
  tinnik: "/swamp-walk/mvp/tinnik.glb",
  toplyak: "/swamp-walk/mvp/toplyak.glb",
});

const TINNIK = {
  name: "Tinnik", gait: "Run", speed: 2.9,
  windup: 0.82, reach: 1.04, angle: 0.70, contact: 0.36, recover: 0.36, tint: 0xf2b758,
};
const TOPLYAK = {
  name: "Toplyak", gait: "Walk", speed: 1.35,
  // The right hand points 0.26 rad left of the body axis at the contact frame.
  windup: 1.00, reach: 1.04, angle: 0.32, handYaw: -0.26,
  contact: 0.66, recover: 0.68, tint: 0xe08742,
};

const SAMPLE = 0.10;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const heading = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
const turnBy = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

function groundMotor({ floorAt, canReach, waterLevel }) {
  function allowed(x, z, y, previousY) {
    return Number.isFinite(y) && y > waterLevel && y - previousY <= 0.20 && previousY - y <= 0.28
      && canReach(x, z, y);
  }

  function follow(position, target, travel, stop = 0) {
    const gap = distance(position, target);
    const span = Math.min(travel, Math.max(0, gap - stop));
    if (!span) return 0;
    const count = Math.ceil(span / SAMPLE);
    const dx = (target.x - position.x) * span / (gap * count);
    const dz = (target.z - position.z) * span / (gap * count);
    let taken = 0;
    for (let step = 0; step < count; step++) {
      const x = position.x + dx, z = position.z + dz, y = floorAt(x, z);
      if (!allowed(x, z, y, position.y)) break;
      position.set(x, y, z);
      taken++;
    }
    return span * taken / count;
  }

  function clear(position, target, checkObstacles = true) {
    const count = Math.ceil(distance(position, target) / SAMPLE);
    let previous = position.y;
    for (let step = 1; step <= count; step++) {
      const t = step / count;
      const x = position.x + (target.x - position.x) * t, z = position.z + (target.z - position.z) * t;
      const y = floorAt(x, z);
      if (checkObstacles ? !allowed(x, z, y, previous) : !Number.isFinite(y) || y <= waterLevel) return false;
      previous = y;
    }
    return true;
  }
  return { follow, clear, allowed };
}

function animate(THREE, model, names) {
  const mixer = new THREE.AnimationMixer(model.scene);
  const actions = new Map(Object.entries(names).map(([key, name]) => {
    const clip = model.animations.find(clip => clip.name === name);
    if (!clip || !(clip.duration > 0)) throw new Error(`Missing actor clip ${name}`);
    const action = mixer.clipAction(clip).setEffectiveTimeScale(0).setEffectiveWeight(0).play();
    return [key, { clip, action, weight: 0 }];
  }));
  return {
    duration(key) { return actions.get(key).clip.duration; },
    pose(key, time, dt = 0) {
      const fade = dt ? 1 - Math.exp(-dt * 20) : 1;
      for (const [name, state] of actions) {
        const active = name === key;
        state.weight += ((active ? 1 : 0) - state.weight) * fade;
        state.action.setEffectiveWeight(state.weight);
        if (active) state.action.time = Math.min(time, state.clip.duration - 0.00001);
      }
      mixer.update(0);
    },
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(model.scene); },
  };
}

function createGroundActor({
  THREE, scene, model, x, z, floorAt, canReach, waterLevel = 0.08, hits, onHit = () => {}, tuning = {},
}, profile) {
  const rehit = tuning.rehit ?? 0.14;
  // The strike's windup is stretched to `tell` seconds (combat-tuning.mjs) so it can be read and dodged.
  const clock = windupClock(profile.contact, tuning.tell ?? profile.contact);
  const animation = animate(THREE, model, {
    idle: `${profile.name}_Idle`, move: `${profile.name}_${profile.gait}`,
    attack: `${profile.name}_Strike`, hit: `${profile.name}_Hit`, fall: `${profile.name}_Fall`,
  });
  const end = animation.duration("attack");
  if (end <= profile.contact) throw new Error(`${profile.name} strike ends before contact`);
  const motor = groundMotor({ floorAt, canReach, waterLevel });
  const warning = createTelegraph(THREE, floorAt, { reach: profile.reach, halfAngle: profile.angle, fill: profile.tint,
    edge: 0xffc070, segments: 16 });
  const root = new THREE.Group();
  root.name = `Pier${profile.name}`;
  root.add(model.scene);
  root.position.set(x, floorAt(x, z), z);
  scene.add(root, warning.group);
  const position = root.position;
  let health = hits ?? 1, mode = "ready", age = 0, cooldown = 0, idle = 0, stride = 0;
  let attackYaw = 0;
  animation.pose("idle", 0);

  // The host checks the strike ray. A structure can occupy its own center.
  function attackPath(target) {
    if (target.structure?.hp <= 0) return false;
    const structure = target.structure || target.kind === "wall" || target.kind === "base";
    return motor.clear(position, target, !structure);
  }

  function updateReady(dt, target, waypoint) {
    cooldown = Math.max(0, cooldown - dt);
    const gap = distance(position, target);
    const closeHeight = Math.abs(target.y - position.y) <= 0.62;
    if (!waypoint && gap <= profile.windup + 1e-6 && closeHeight && !cooldown && attackPath(target)) {
      const handYaw = profile.handYaw ?? 0;
      attackYaw = gap > 0.001 ? heading(position, target) : root.rotation.y + handYaw;
      root.rotation.y = attackYaw - handYaw;
      warning.aim(position.x, position.z, attackYaw);
      mode = "attack";
      age = 0;
      return 0;
    }
    const goal = waypoint ?? target;
    if (!waypoint && !closeHeight) return 0;
    if (distance(position, goal) > 0.001) {
      root.rotation.y += turnBy(heading(position, goal) - root.rotation.y) * (1 - Math.exp(-dt * 14));
    }
    return motor.follow(position, goal, profile.speed * dt, waypoint ? 0 : profile.windup);
  }

  function update(dt, target, waypoint) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    let moved = 0, contact = false;
    const before = age;
    age += dt;
    if (mode === "attack") {
      contact = before + 1e-9 < clock.tell && age + 1e-9 >= clock.tell
        && distance(position, target) <= profile.reach && Math.abs(target.y - position.y) <= 0.62
        && Math.abs(turnBy(heading(position, target) - attackYaw)) <= profile.angle
        && attackPath(target);
      if (clock.clip(age) >= end) { mode = "ready"; cooldown = profile.recover; }
    } else if (mode === "hit") {
      if (age >= animation.duration("hit")) { mode = "ready"; cooldown = 0.22; }
    } else if (mode === "ready") {
      moved = updateReady(dt, target, waypoint);
    }

    idle = (idle + dt) % animation.duration("idle");
    stride = (stride + moved / profile.speed) % animation.duration("move");
    if (mode === "ready") animation.pose(moved ? "move" : "idle", moved ? stride : idle, dt);
    else animation.pose(mode, mode === "attack" ? clock.clip(age) : age, dt);
    warning.show(mode === "attack" ? (age < clock.tell ? age / clock.tell : 1 + age - clock.tell) : null);
    if (mode === "fall" && age >= animation.duration("fall")) root.visible = false;
    if (contact) onHit(target);
  }

  return {
    position,
    get attacking() { return mode === "attack"; },
    // 0..1 while the strike winds up (the host lights the body with it), otherwise null.
    get telegraph() { return mode === "attack" && age < clock.tell ? age / clock.tell : null; },
    get defeated() { return health === 0; },
    get gone() { return mode === "fall" && age >= animation.duration("fall"); },
    update,
    harm(damage) {
      if (!health || (mode === "hit" && age < rehit) || !Number.isFinite(damage) || damage <= 0) return false;
      health = Math.max(0, health - damage);
      mode = health ? "hit" : "fall";
      age = 0;
      warning.show(null);
      return true;
    },
    // Knockback (expedition-combat.mjs moves the actor): only where the raider could walk.
    standAt(nx, nz) {
      const ny = floorAt(nx, nz);
      return motor.allowed(nx, nz, ny, position.y) ? ny : null;
    },
  };
}

export function createTinnik(options) { return createGroundActor(options, TINNIK); }
export function createToplyak(options) { return createGroundActor(options, TOPLYAK); }

