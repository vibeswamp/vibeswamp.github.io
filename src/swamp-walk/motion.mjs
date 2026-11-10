import { RADIUS, SPAWN, SWIM_FLOOR, WATER, clamp } from "./land.mjs";
import { BODY_RADIUS, advanceRailVault, railBlocks, railFloor, tryRailVault } from "./rail.mjs";
import { BODY_HEIGHT, distanceToSolid, overlapsSolid, solidNormal } from "./collisions.mjs";
import { advanceBankExit, findBankExit } from "./shore.mjs";

const MAP_LIMIT = RADIUS - 2;
const RUN_SPEED = 3.7;
const SPRINT_SPEED = 6.55;
const STEP_HEIGHT = 0.16;
const COYOTE = 0.10;
const JUMP_BUFFER = 0.12;
export const JUMP_IMPULSE = 5.9;

export function spawnPlayer(floorAt, point = SPAWN) {
  const { x, z } = point;
  return {
    x, z, y: floorAt(x, z), dy: 0, speed: 0, grounded: true,
    swimming: false, pose: "idle", heading: Math.PI, runningJump: false, traversal: null,
    coyote: 0, jumpBuffer: 0, swing: null, hurt: null, landing: null, airLimit: RUN_SPEED, airAge: null,
    dodge: null, dodgeCooldown: 0, shoreClimb: null,
  };
}

export function advancePlayer(player, intent, floorAt, obstacles, dt, parkour, exits = []) {
  if (intent.jump) player.swing = null;
  player.jumpBuffer = intent.jump ? JUMP_BUFFER : Math.max(0, player.jumpBuffer - dt);
  if (player.traversal || tryRailVault(player, intent, parkour, floorAt, obstacles)) {
    player.speed = player.jumpBuffer = player.coyote = 0;
    player.dodge = null;
    return advanceRailVault(player, parkour, dt);
  }
  if (intent.jump && player.swimming) {
    const exit = findBankExit(player, intent, exits, floorAt, obstacles);
    if (exit) {
      player.shoreClimb = { from: { x: player.x, y: player.y, z: player.z }, to: exit, time: 0 };
      player.dy = player.speed = player.jumpBuffer = player.coyote = 0;
      player.runningJump = false;
      player.airAge = null;
    }
  }
  if (player.shoreClimb) return advanceBankExit(player, dt);

  const x0 = player.x, z0 = player.z;
  const rail = parkour?.rail;
  const groundAt = (x, z) => railFloor(rail, floorAt(x, z), x, z);
  const restingFloor = (x, z) => Math.max(groundAt(x, z), SWIM_FLOOR);
  const fromFloor = restingFloor(x0, z0);
  if (player.landing !== null) player.landing.age += dt;
  const magnitude = clamp(Math.hypot(intent.x, intent.z), 0, 1);
  const wading = player.grounded && player.y < WATER;
  player.dodgeCooldown = Math.max(0, player.dodgeCooldown - dt);
  if (intent.dodge && !intent.jump && player.grounded && !wading && player.dodgeCooldown === 0) {
    player.dodge = {
      angle: magnitude > 0 ? Math.atan2(intent.x, intent.z) : player.heading + Math.PI,
      time: 0.25,
    };
    player.dodgeCooldown = 0.75;
    player.swing = null;
  }
  if (player.dodge) {
    player.dodge.time -= dt;
    if (player.dodge.time <= 0 || !player.grounded || intent.jump) player.dodge = null;
  }
  const strength = player.dodge ? 1 : magnitude;
  const sprinting = intent.sprint && !player.swimming && !wading;
  const topSpeed = player.dodge ? SPRINT_SPEED : !player.grounded ? player.airLimit
    : player.swimming ? 2.75 : wading ? 2.6 : sprinting ? SPRINT_SPEED : RUN_SPEED;
  if (player.grounded) player.coyote = player.swimming ? 0 : COYOTE;
  else player.coyote = Math.max(0, player.coyote - dt);

  const takeoff = player.jumpBuffer > 0 && player.coyote > 0;
  const takeoffSpeed = player.speed;
  if (takeoff) {
    player.dy = JUMP_IMPULSE;
    player.airLimit = Math.max(RUN_SPEED, player.speed);
    player.airAge = 0;
    player.grounded = false;
    player.jumpBuffer = player.coyote = 0;
    player.landing = null;
  }
  if (!takeoff && player.airAge !== null && player.airAge < 0.22 && intent.jumpHeld === false && player.dy > 3.15) {
    player.dy = 3.15;
  }

  let alignment = 1;
  if (strength > 0) {
    const angle = (player.dodge?.angle ?? Math.atan2(intent.x, intent.z)) - player.heading;
    const delta = Math.atan2(Math.sin(angle), Math.cos(angle));
    const turnRate = player.dodge ? 24 : player.grounded ? 16 : 8;
    const turn = clamp(delta, -turnRate * dt, turnRate * dt);
    player.heading += turn;
    alignment = clamp(Math.cos(delta - turn) * 1.35, 0, 1);
  }
  const desiredSpeed = strength * Math.min(topSpeed, player.grounded ? Infinity : player.airLimit)
    * alignment * (player.swing === null ? 1 : 0.35);
  const acceleration = player.dodge ? 42 : player.grounded ? (desiredSpeed > player.speed ? 23 : 31) : 9;
  player.speed += clamp(desiredSpeed - player.speed, -acceleration * dt, acceleration * dt);
  const dx = Math.sin(player.heading) * player.speed * dt;
  const dz = Math.cos(player.heading) * player.speed * dt;
  const stepHeight = player.grounded ? STEP_HEIGHT : 0.025;
  const solidAt = (x, z) => obstacles.find(solid =>
    overlapsSolid(solid, x, player.y, z, BODY_RADIUS, BODY_HEIGHT)
      && distanceToSolid(solid, x, z) < distanceToSolid(solid, x0, z0) - 1e-8);
  function canStep(x, z) {
    const base = player.grounded ? Math.max(fromFloor, player.y) : player.y;
    const floor = restingFloor(x, z);
    if (floor > base + stepHeight || railBlocks(rail, x, player.y, z) || solidAt(x, z)) return false;
    const travel = Math.hypot(x - x0, z - z0);
    if (!player.grounded || travel < 1e-7 || floor - base <= 1.15 * travel) return true;
    const further = restingFloor(x + 0.14 * (x - x0) / travel, z + 0.14 * (z - z0) / travel);
    return further - floor <= 0.16;
  }

  const x1 = clamp(x0 + dx, -MAP_LIMIT, MAP_LIMIT);
  const z1 = clamp(z0 + dz, -MAP_LIMIT, MAP_LIMIT);
  if (canStep(x1, z1)) {
    player.x = x1;
    player.z = z1;
  } else if (dx || dz) {
    const solid = solidAt(x1, z1);
    let slid = false;
    if (solid) {
      const [nx, nz] = solidNormal(solid, x0, z0);
      const inward = Math.min(0, dx * nx + dz * nz);
      const x = clamp(x0 + dx - inward * nx, -MAP_LIMIT, MAP_LIMIT);
      const z = clamp(z0 + dz - inward * nz, -MAP_LIMIT, MAP_LIMIT);
      if (canStep(x, z)) {
        player.x = x;
        player.z = z;
        slid = true;
      }
    }
    if (!slid) {
      const xTravel = x1 !== x0 && canStep(x1, z0) ? Math.abs(x1 - x0) : 0;
      const zTravel = z1 !== z0 && canStep(x0, z1) ? Math.abs(z1 - z0) : 0;
      if (xTravel > zTravel + 1e-8) player.x = x1;
      else if (zTravel > xTravel + 1e-8) player.z = z1;
    }
  }
  const step = Math.hypot(player.x - x0, player.z - z0);
  if (takeoff) player.runningJump = step > 1e-7 && (takeoffSpeed >= 1.2 || strength >= 0.65);
  if (player.grounded && step + 1e-8 < Math.hypot(dx, dz)) player.speed = step / dt;

  const ground = groundAt(player.x, player.z);
  const floor = Math.max(ground, SWIM_FLOOR);
  if (player.grounded && player.y - floor <= 0.125) {
    player.y = floor;
  } else {
    if (player.grounded) player.airLimit = Math.max(RUN_SPEED, player.speed);
    player.grounded = false;
    player.dy -= 15.2 * dt;
    if (player.dy > 0) {
      const head = player.y + BODY_HEIGHT;
      for (const solid of obstacles) {
        if (solid.minY >= head && solid.minY < head + player.dy * dt
            && distanceToSolid(solid, player.x, player.z) < BODY_RADIUS) {
          player.y = solid.minY - BODY_HEIGHT;
          player.dy = 0;
          break;
        }
      }
    }
    player.y += player.dy * dt;
    if (player.y <= floor && player.dy <= 0) {
      player.landing = { age: 0, impact: -player.dy };
      player.y = floor;
      player.dy = 0;
      player.grounded = true;
    }
  }
  if (player.grounded) player.runningJump = false;
  if (player.grounded) player.airAge = null;
  else if (player.airAge !== null) player.airAge += dt;
  if (player.landing?.age > 0.30) player.landing = null;
  player.swimming = player.grounded && ground < SWIM_FLOOR + (player.swimming ? 0.06 : -0.03);
  const moving = step > 1e-7;
  if (player.swimming) player.pose = moving ? "swim" : "float";
  else if (!player.grounded) player.pose = "air";
  else if (!moving) player.pose = "idle";
  else player.pose = player.y >= WATER && step / dt > 4.25 ? "sprint" : "run";
  return step;
}
