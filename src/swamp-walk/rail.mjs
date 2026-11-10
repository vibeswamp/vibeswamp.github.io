import { WATER, clamp, mix, smooth } from "./land.mjs";
import { distanceToSolid } from "./collisions.mjs";

export const BODY_RADIUS = 0.28;
const ALIGN_SPEED = 3.7;
const FACING_LIMIT = Math.cos(25 * Math.PI / 180);

function axes(rail) {
  const yaw = rail.yaw ?? 0;
  return { yaw, sin: Math.sin(yaw), cos: Math.cos(yaw) };
}

function local(rail, x, z) {
  const { sin, cos } = axes(rail);
  const dx = x - rail.x, dz = z - rail.z;
  return { lateral: dx * cos - dz * sin, side: dx * sin + dz * cos };
}

function world(rail, lateral, side) {
  const { sin, cos } = axes(rail);
  return { x: rail.x + lateral * cos + side * sin, z: rail.z - lateral * sin + side * cos };
}

export function railFloor(rail, ground, x, z) {
  if (!rail) return ground;
  const { lateral, side } = local(rail, x, z);
  if (Math.abs(lateral) > rail.width / 2 || Math.abs(side) > rail.depth / 2) return ground;
  return Math.max(ground, rail.y + rail.height);
}

export function railBlocks(rail, x, y, z) {
  if (!rail || y >= rail.y + rail.height) return false;
  const { lateral, side } = local(rail, x, z);
  const dx = Math.max(0, Math.abs(lateral) - rail.width / 2);
  const dz = Math.max(0, Math.abs(side) - rail.depth / 2);
  return dx * dx + dz * dz < BODY_RADIUS ** 2;
}

export function validRailProfile(rail, vault) {
  if (!rail || !vault || !Array.isArray(vault.trajectory) || vault.trajectory.length < 2) return false;
  if (![rail.x, rail.z, rail.width, rail.depth, rail.height, vault.duration, vault.entry, vault.exit].every(Number.isFinite)) return false;
  if (rail.yaw !== undefined && !Number.isFinite(rail.yaw)) return false;
  if (rail.width <= 0 || rail.depth <= 0 || rail.height <= 0 || vault.entry <= 0 || vault.exit <= 0) return false;
  const points = vault.trajectory;
  if (Math.abs(vault.duration - 2.1) > 0.001) return false;
  if (points.some((point, i) => !Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite)
      || point[2] < 0 || (i > 0 && (point[0] <= points[i - 1][0] || point[1] < points[i - 1][1])))) return false;
  const [first, last] = [points[0], points.at(-1)];
  return first[0] === 0 && first[1] === -vault.entry && first[2] === 0
    && Math.abs(last[0] - vault.duration) < 1e-6 && Math.abs(last[1] - vault.exit) < 1e-6 && last[2] === 0;
}

function clearPath(player, parkour, direction, floorAt, obstacles) {
  const { rail, vault } = parkour;
  const { lateral, side } = local(rail, player.x, player.z);
  const entry = -direction * vault.entry, exit = direction * vault.exit;
  const low = Math.min(side, entry, exit), high = Math.max(side, entry, exit);
  // The dock must support the entire footprint, including the recovery stance.
  const dryDeck = (lateral, side) => {
    const point = world(rail, lateral, side);
    const floor = floorAt(point.x, point.z);
    return floor > WATER && Math.abs(floor - rail.y) <= 0.025;
  };
  const steps = Math.ceil((high - low + BODY_RADIUS * 2) / 0.035);
  for (let i = 0; i <= steps; i++) {
    const at = mix(low - BODY_RADIUS, high + BODY_RADIUS, i / steps);
    if (!dryDeck(lateral - BODY_RADIUS, at) || !dryDeck(lateral + BODY_RADIUS, at)) return false;
    if (at >= low && at <= high) {
      const point = world(rail, lateral, at);
      if (obstacles.some(solid => (solid.minY ?? -Infinity) <= rail.y + 2.55
          && (solid.maxY ?? solid.top ?? Infinity) > rail.y
          && distanceToSolid(solid, point.x, point.z) < BODY_RADIUS + 0.018)) return false;
    }
  }
  // Each segment is linear. Check its lowest point while the body overlaps the expanded rail.
  const margin = rail.depth / 2 + BODY_RADIUS;
  const points = vault.trajectory;
  for (let i = 1; i < points.length; i++) {
    const [, from, y0] = points[i - 1], [, to, y1] = points[i];
    if (to <= -margin || from >= margin) continue;
    const first = Math.max(from, -margin), last = Math.min(to, margin);
    const floor = to === from ? Math.min(y0, y1)
      : Math.min(mix(y0, y1, (first - from) / (to - from)), mix(y0, y1, (last - from) / (to - from)));
    if (floor < rail.height + 0.015) return false;
  }
  return [side, entry, exit].every(at => {
    const point = world(rail, lateral, at);
    return !railBlocks(rail, point.x, rail.y, point.z);
  });
}

export function railDirection(player, intent, parkour, floorAt, obstacles) {
  if (!parkour || !player.grounded || player.swimming || player.traversal) return 0;
  const { rail, vault } = parkour;
  const { lateral, side } = local(rail, player.x, player.z);
  if (Math.abs(side) > 0.70 || Math.abs(lateral) > 0.15 || Math.abs(player.y - rail.y) > 0.025) return 0;
  const direction = side < 0 ? 1 : -1;
  const strength = Math.hypot(intent.x, intent.z);
  const { yaw, sin, cos } = axes(rail);
  const facing = strength > 0.05 ? (intent.x * sin + intent.z * cos) / strength : Math.cos(player.heading - yaw);
  return direction * facing >= FACING_LIMIT && clearPath(player, parkour, direction, floorAt, obstacles) ? direction : 0;
}

export function tryRailVault(player, intent, parkour, floorAt, obstacles) {
  if (!intent.jump) return false;
  const direction = railDirection(player, intent, parkour, floorAt, obstacles);
  if (!direction) return false;
  const { rail, vault } = parkour;
  const { lateral, side } = local(rail, player.x, player.z);
  const entry = -direction * vault.entry;
  const aligning = (entry - side) * direction > 0;
  player.traversal = {
    direction, lateral, entry, time: 0, segment: 0, aligning,
    startOffset: aligning ? 0 : side - entry,
    rate: intent.sprint && player.speed > 4.25 ? 2.25 : 1,
  };
  return true;
}

export function advanceRailVault(player, parkour, dt) {
  const { rail, vault } = parkour;
  const traversal = player.traversal;
  player.heading = (rail.yaw ?? 0) + (traversal.direction > 0 ? 0 : Math.PI);
  player.dy = 0;
  if (traversal.aligning) {
    const { side } = local(rail, player.x, player.z);
    const gap = traversal.entry - side;
    const step = clamp(gap, -ALIGN_SPEED * dt, ALIGN_SPEED * dt);
    Object.assign(player, world(rail, traversal.lateral, side + step));
    traversal.aligning = Math.abs(gap - step) > 1e-8;
    if (Math.abs(step) > 1e-8) {
      player.pose = "run";
      return Math.abs(step);
    }
  }
  const time = Math.min(traversal.time + dt * traversal.rate, vault.duration);
  traversal.time = time;
  const points = vault.trajectory;
  while (traversal.segment < points.length - 2 && points[traversal.segment + 1][0] < time) traversal.segment++;
  const [fromT, fromS, fromY] = points[traversal.segment];
  const [toT, toS, toY] = points[traversal.segment + 1];
  const alpha = clamp((time - fromT) / (toT - fromT), 0, 1);
  const side = traversal.direction * mix(fromS, toS, alpha) + traversal.startOffset * (1 - smooth(0, 0.23, time));
  Object.assign(player, world(rail, traversal.lateral, side));
  player.y = rail.y + mix(fromY, toY, alpha);
  player.grounded = time === vault.duration;
  player.pose = player.grounded ? "idle" : "vault";
  if (player.grounded) player.traversal = null;
  return 0;
}
