// The wrench hits only where its head really passes (W6): the measured tip path of the swing clip, turned with
// Klyop, against an enemy's hurt volume - a vertical capsule { x, z, radius, minY, maxY } (a sphere when minY = maxY).
// The shaft counts too: a point 45% of the way from Klyop to the head, so a foe pressed close is still hit.

// Until the combat clips arrive (they load with the first fight) the single startup swing uses a modest arc
// in front of Klyop instead of a measured path: about the same reach, nothing behind him.
const FALLBACK_TIP = [[0, -.42, .62, .58], [0, -.18, .62, .78], [0, .12, .62, .80], [0, .38, .62, .62]];
const SUBSTEP = .06;

function gap(px, py, pz, volume) {
  const dy = Math.max(0, volume.minY - py, py - volume.maxY);
  return Math.hypot(px - volume.x, dy, pz - volume.z);
}

export function wrenchReaches(stage, player, volume) {
  const tip = stage?.tip?.length ? stage.tip : FALLBACK_TIP;
  const sin = Math.sin(player.heading), cos = Math.cos(player.heading);
  let previous = null;
  for (const [, x, y, z] of tip) {
    const point = [player.x + x * cos + z * sin, player.y + y, player.z - x * sin + z * cos];
    if (gap(point[0], point[1], point[2], volume) <= volume.radius) return true;
    const sx = player.x + (x * cos + z * sin) * .45, sz = player.z + (z * cos - x * sin) * .45;
    if (gap(sx, point[1], sz, volume) <= volume.radius) return true;
    if (previous) {
      // Between two recorded samples the head moves in a straight line; check it in short steps.
      const steps = Math.ceil(Math.hypot(point[0] - previous[0], point[1] - previous[1], point[2] - previous[2]) / SUBSTEP);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (gap(previous[0] + (point[0] - previous[0]) * t, previous[1] + (point[1] - previous[1]) * t,
          previous[2] + (point[2] - previous[2]) * t, volume) <= volume.radius) return true;
      }
    }
    previous = point;
  }
  return false;
}

// A gentle aim assist for the first swing (candidate C, mobile-view.mjs): if the nearest foe stands within 2 m
// and within 60 degrees but the swing as aimed would miss, turn Klyop by at most 12 degrees - and only if the
// turned swing really reaches.
const AIM_LIMIT = Math.PI / 15;
const turn = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

export function firstSwingHeading(player, target, reaches) {
  if (!target || Math.hypot(target.x - player.x, target.z - player.z) > 2) return player.heading;
  const difference = turn(player.heading, Math.atan2(target.x - player.x, target.z - player.z));
  if (Math.abs(difference) > Math.PI / 3 || reaches(player.heading)) return player.heading;
  const adjusted = player.heading + Math.max(-AIM_LIMIT, Math.min(AIM_LIMIT, difference));
  return reaches(adjusted) ? adjusted : player.heading;
}
