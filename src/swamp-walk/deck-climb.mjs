import { BODY_HEIGHT, overlapsSolid } from "./collisions.mjs";
import { SWIM_FLOOR } from "./land.mjs";
import { BODY_RADIUS } from "./rail.mjs";

const DECK_SUPPORT = [[0, 0], [BODY_RADIUS, 0], [-BODY_RADIUS, 0], [0, BODY_RADIUS], [0, -BODY_RADIUS]];
const MIN_RISE = 0.16;
const mix = (a, b, alpha) => a + (b - a) * alpha;

export function prepareDeckClimb(exits, profiles, clipDuration) {
  if (!exits.length || !Array.isArray(profiles) || profiles.length !== 2) return null;
  if (profiles.some((profile, i) => {
    if (!profile || profile.action !== (i === 0 ? "mantleHead" : "mantleHigh")) return true;
    const { action, reach, from, to, rate, samples, fit } = profile;
    if (!fit || (!Number.isFinite(fit.minRise) || fit.minRise <= MIN_RISE || fit.minRise >= reach
        || !Number.isFinite(fit.sourceFrom) || fit.sourceFrom < 0
        || !Number.isFinite(fit.sourceRate) || fit.sourceRate <= 0
        || !Array.isArray(fit.anchor) || fit.anchor.length !== 4 || !fit.anchor.every(Number.isFinite)
        || fit.anchor[0] <= MIN_RISE || fit.anchor[1] < BODY_RADIUS || fit.anchor[1] > .82
        || fit.anchor[2] < from || fit.anchor[2] >= fit.anchor[3] || fit.anchor[3] >= to
        || !Array.isArray(fit.approach) || fit.approach.length !== 2 || !fit.approach.every(Number.isFinite)
        || fit.approach[0] < BODY_RADIUS || fit.approach[0] >= fit.approach[1] || fit.approach[1] > .82)) return true;
    const duration = clipDuration(action);
    if (![duration, reach, from, to, rate].every(Number.isFinite) || reach <= MIN_RISE || rate <= 0
        || from < 0 || from >= to || to > duration + 0.0001 || !Array.isArray(samples) || samples.length < 2) return true;
    if (samples.some((point, i) => !Array.isArray(point) || point.length !== 4 || !point.every(Number.isFinite)
        || (i > 0 && point[0] <= samples[i - 1][0]))) return true;
    return from < samples[0][0] || to > samples.at(-1)[0] + 0.0001;
  })) return null;
  if (profiles[0].reach >= profiles[1].reach) return null;
  return { exits, profiles };
}

// Sample both outside edges of each walkable span, using the same quads as the deck mesh.
export function createDeckExits({ bridge }) {
  const exits = [];
  for (const [a, b, c, d] of bridge.quads) {
    for (const [start, end, oppositeStart, oppositeEnd] of [[a, c, b, d], [b, d, a, c]]) {
      const length = Math.hypot(end[0] - start[0], end[2] - start[2]);
      const tx = (end[0] - start[0]) / length, tz = (end[2] - start[2]) / length;
      const sign = tz * (oppositeStart[0] - start[0]) - tx * (oppositeStart[2] - start[2]) > 0 ? 1 : -1;
      const sin = tz * sign, cos = -tx * sign;
      const count = Math.max(1, Math.ceil(length / .76));
      for (let i = 0; i < count; i++) {
        const t = (i + .5) / count;
        const [x, y, z] = start.map((value, axis) => mix(value, end[axis], t));
        const across = (distance, height) => ({ x: x + sin * distance, y: height, z: z + cos * distance });
        const top = across(.74, 0);
        top.y = bridge.heightAt(top.x, top.z);
        const hands = [.225, -.225].map(side => {
          const handX = x + .037 * sin + side * cos, handZ = z + .037 * cos - side * sin;
          return { x: handX, y: bridge.heightAt(handX, handZ), z: handZ };
        });
        if (![top, ...hands].every(point => Number.isFinite(point.y))) continue;
        exits.push({
          edge: { x, y, z }, sin, cos, yaw: Math.atan2(sin, cos), hands, top,
          prompt: across(-.72, SWIM_FLOOR), hang: across(-.40, SWIM_FLOOR),
          lip: across(-.40, Math.max(y, top.y) + .04),
        });
      }
    }
  }
  return exits;
}

function clearDeckPath(path, floorAt, obstacles) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / .06);
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
      if (floorAt(x, z) > y + .045) return false;
      if (obstacles.some(solid => overlapsSolid(solid, x, y, z, BODY_RADIUS, BODY_HEIGHT))) return false;
    }
  }
  return true;
}

function rootAt(samples, time) {
  let first = 0, last = samples.length - 1;
  while (last - first > 1) {
    const middle = (first + last) >> 1;
    if (samples[middle][0] <= time) first = middle;
    else last = middle;
  }
  const a = samples[first], b = samples[last];
  const alpha = Math.max(0, Math.min(1, (time - a[0]) / (b[0] - a[0])));
  return [mix(a[1], b[1], alpha), mix(a[2], b[2], alpha), mix(a[3], b[3], alpha)];
}

function positionAt(path, time) {
  const { program, start, end, entry, exit, sin, cos } = path;
  const clipTime = Math.min(program.to, program.from + time * program.rate);
  const root = rootAt(program.samples, clipTime);
  const lift = (root[1] - start[1]) / (end[1] - start[1]);
  const travel = (root[2] - start[2]) / (end[2] - start[2]);
  const side = root[0] - mix(start[0], end[0], travel);
  let y = mix(entry.y, exit.y, lift), along = 0;
  if (program.fit) {
    const [height, distance, from, to] = program.fit.anchor;
    const t = Math.max(0, Math.min(1, (clipTime - from) / (to - from)));
    const anchor = t * t * (3 - 2 * t);
    y = Math.max(entry.y, y + (exit.y - entry.y - height) * (1 - lift) * anchor);
    along = (path.approachDistance - distance) * (1 - travel) * anchor;
    const raw = program.fit.sourceFrom + clipTime * program.fit.sourceRate;
    const ease = (lo, hi) => {
      const a = Math.max(0, Math.min(1, (raw - lo) / (hi - lo)));
      return a * a * (3 - 2 * a);
    };
    along -= .095 * ease(3.90, 4.15) * (1 - ease(4.41, 4.68));
  }
  return { x: mix(entry.x, exit.x, travel) + cos * side + sin * along,
    z: mix(entry.z, exit.z, travel) - sin * side + cos * along, y, clipTime };
}

// The prompt and jump use the same validated trajectory.
export function planDeckClimb(player, setup, floorAt, obstacles) {
  if (!setup || !player.swimming || player.mantle || player.shoreClimb || player.dodge || player.swing !== null) return null;
  const nearby = [];
  for (const exit of setup.exits) {
    const { sin, cos, edge, yaw, prompt } = exit;
    const dx = player.x - edge.x, dz = player.z - edge.z;
    const forward = dx * sin + dz * cos, lateral = dx * cos - dz * sin;
    if (forward < -1.10 || forward > .025 || Math.abs(lateral) > .45 || Math.cos(yaw - player.heading) < .60) continue;
    nearby.push({ exit, distance: Math.hypot(player.x - prompt.x, player.z - prompt.z) });
  }
  nearby.sort((a, b) => a.distance - b.distance);
  for (const { exit: deckExit, distance } of nearby) {
    const { sin, cos, edge, yaw, prompt, hang, lip, top: exit, hands } = deckExit;
    const rise = exit.y - player.y;
    const program = setup.profiles.find(profile => rise >= profile.fit.minRise && rise <= profile.reach);
    if (!program) continue;
    if (DECK_SUPPORT.some(([x, z]) => Math.abs(floorAt(exit.x + x, exit.z + z) - exit.y) > .045)) continue;
    const entry = { ...prompt, y: player.y };
    if (!clearDeckPath([player, entry, hang, lip, exit], floorAt, obstacles)) continue;
    const start = rootAt(program.samples, program.from), end = rootAt(program.samples, program.to);
    if (end[1] - start[1] <= .02 || end[2] - start[2] <= .02) continue;
    const duration = (program.to - program.from) / program.rate;
    const path = {
      program, start, end, sin, cos, yaw, duration, time: 0, clipTime: program.from,
      deckExit, handTargets: hands, entry, exit, lip: edge,
      approachDistance: .72, approach: distance > .001,
    };
    const checks = Math.ceil((program.to - program.from) * 60);
    let clear = true;
    for (let step = 0; step <= checks; step++) {
      const { x, y, z } = positionAt(path, duration * step / checks);
      if (y < floorAt(x, z) - .001 || obstacles.some(solid => overlapsSolid(solid, x, y + .001, z, BODY_RADIUS, BODY_HEIGHT))) {
        clear = false;
        break;
      }
    }
    if (clear) return path;
  }
  return null;
}

export function advanceDeckClimb(player, dt, floorAt, obstacles) {
  const path = player.mantle;
  if (path.approach) {
    if (!clearDeckPath([{ x: player.x, y: player.y, z: player.z }, path.entry,
      path.deckExit.hang, path.deckExit.lip, path.exit], floorAt, obstacles)) {
      player.mantle = null;
      player.speed = 0;
      player.pose = "float";
      return 0;
    }
    const dx = path.entry.x - player.x, dz = path.entry.z - player.z;
    const distance = Math.hypot(dx, dz), travel = Math.min(distance, 2.75 * dt);
    if (distance > 1e-8) {
      player.x += dx * travel / distance;
      player.z += dz * travel / distance;
    }
    player.heading = path.yaw;
    player.grounded = true;
    player.swimming = true;
    player.speed = travel / dt;
    player.pose = "swim";
    if (distance <= travel + 1e-8) path.approach = false;
    return 0;
  }
  player.swimming = false;
  player.speed = 0;
  path.time = Math.min(path.duration, path.time + dt);
  const { x, y, z, clipTime } = positionAt(path, path.time);
  Object.assign(player, { x, y, z, heading: path.yaw });
  path.previousClipTime = path.clipTime;
  path.clipTime = clipTime;
  player.grounded = path.time >= path.duration;
  player.pose = player.grounded ? "idle" : "air";
  if (player.grounded) player.mantle = null;
  return 0;
}
