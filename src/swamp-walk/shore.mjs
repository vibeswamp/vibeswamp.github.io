import { WATER, mix, smooth } from "./land.mjs";
import { BODY_HEIGHT, overlapsSolid } from "./collisions.mjs";
import { BODY_RADIUS } from "./rail.mjs";

const CLIMB_TIME = 0.43;

function heightAt(start, end, t) {
  return mix(start, end, t) + 0.14 * Math.sin(Math.PI * t);
}

export function findBankExit(player, intent, exits, floorAt, obstacles) {
  if (!player.swimming) return null;
  const input = Math.hypot(intent.x, intent.z) > 0.05;
  const heading = input ? Math.atan2(intent.x, intent.z) : player.heading;
  let best = null, closest = 1.02;
  for (const { points } of exits) {
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1], [bx, bz] = points[i];
      const count = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.1);
      for (let j = 0; j <= count; j++) {
        const x = mix(ax, bx, j / count), z = mix(az, bz, j / count);
        const dx = x - player.x, dz = z - player.z, length = Math.hypot(dx, dz);
        if (length < 0.30 || length >= closest || Math.cos(Math.atan2(dx, dz) - heading) < 0.54) continue;
        const y = floorAt(x, z);
        if (y < WATER - 0.05 || y - player.y > 0.64) continue;
        const footprint = BODY_RADIUS * 0.68;
        if ([[-footprint, 0], [footprint, 0], [0, -footprint], [0, footprint]]
            .some(([ox, oz]) => floorAt(x + ox, z + oz) < y - 0.22)) continue;
        let clear = true;
        for (let t = 0.1; t <= 1.001; t += 0.1) {
          const px = player.x + dx * t, pz = player.z + dz * t, py = heightAt(player.y, y, t);
          if (floorAt(px, pz) > py + 0.045 ||
              obstacles.some(solid => overlapsSolid(solid, px, py, pz, BODY_RADIUS, BODY_HEIGHT))) {
            clear = false;
            break;
          }
        }
        if (!clear) continue;
        closest = length;
        best = { x, y, z, heading: Math.atan2(dx, dz) };
      }
    }
  }
  return best;
}

export function advanceBankExit(player, dt) {
  const exit = player.shoreClimb;
  exit.time = Math.min(exit.time + dt, CLIMB_TIME);
  const t = smooth(0, CLIMB_TIME, exit.time);
  player.x = mix(exit.from.x, exit.to.x, t);
  player.z = mix(exit.from.z, exit.to.z, t);
  player.y = heightAt(exit.from.y, exit.to.y, t);
  player.heading = exit.to.heading;
  player.grounded = exit.time >= CLIMB_TIME;
  player.swimming = false;
  player.pose = player.grounded ? "idle" : "air";
  if (player.grounded) player.shoreClimb = null;
  return 0;
}
