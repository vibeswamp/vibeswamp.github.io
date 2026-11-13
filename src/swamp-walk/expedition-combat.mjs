// Enemies of the game day (candidate C, expedition-combat.mjs) on our W6 combat: the combo from combo.mjs
// and hits only where the wrench head really passes (wrench-reach.mjs), checked against each enemy's hurt volume.
// Fly and Beggar use the light models from quality.mjs; their code and files load when a day starts. Tinnik and
// Toplyak (p02-raid-models.mjs, actors.mjs) load when night comes. Every number of the fight: combat-tuning.mjs.
// A hit (enhance 13.11): the struck foe and Klyop's strike pose hold still for the hitstop, then the foe is pushed
// back along the blow and slows down (only where it could walk), flashes and staggers; a ring opens at the contact.
import * as T from "./vendor/three.mjs";
import { RAID_LIMIT, WAVES as RAID_WAVES } from "./p01-waves.mjs";
import { WATER } from "./land.mjs";
import { advanceCombo } from "./combo.mjs";
import { MODELS } from "./quality.mjs";
import { firstSwingHeading, wrenchReaches } from "./wrench-reach.mjs";
import { BOSS, COMBO, FOCUS, FOES, HERO, KNOCK } from "./combat-tuning.mjs";

export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const COMBAT_PACK = "/swamp-walk/mvp/combat.json";
// Hurt volumes in metres above the actor's feet; `lift` is the eye height for the line-of-sight check.
// Fly: a ball around its hover point; Beggar: his chest (the W6 sizes, checked against the real swing).
const DAY_KINDS = {
  fly: { url: MODELS.fly, create: async options => (await import("./fly.mjs")).createFly(options),
    lift: 0, radius: 0.46, bottom: 0.04, top: 0.04 },
  beggar: { url: MODELS.beggar, create: async options => (await import("./beggar.mjs")).createBeggar(options),
    lift: 0.84, radius: 0.42, bottom: 0.75, top: 0.75 },
  // The angry Fly (combat-tuning.mjs BOSS): the Fly model, bigger and redder, until its own model arrives.
  boss: { url: MODELS.fly, create: async options => (await import("./fly.mjs")).createFly({ ...options, boss: BOSS }),
    lift: 0, radius: 0.46 * BOSS.scale, bottom: 0.06, top: 0.06 },
};
// ?boss=1: the angry Fly takes the place of the Fly at the dam path in the day; not in the normal game yet.
const BOSS_DAY = typeof location === "object" && new URLSearchParams(location.search).get("boss") === "1";
const FLASH_TIME = 0.12;
const pathPoints = route => route.map(([x, z]) => ({ x, z }));

function cloneRig(gltf) {
  const scene = gltf.scene.clone(true);
  const originals = [], clones = [];
  gltf.scene.traverse(node => originals.push(node));
  scene.traverse(node => clones.push(node));
  const counterpart = new Map(originals.map((node, index) => [node, clones[index]]));
  for (const [index, original] of originals.entries()) {
    if (!original.isSkinnedMesh) continue;
    const copy = clones[index];
    copy.skeleton = original.skeleton.clone();
    copy.skeleton.bones = original.skeleton.bones.map(bone => counterpart.get(bone));
    copy.bind(copy.skeleton, original.bindMatrix);
  }
  return { ...gltf, scene };
}

export function createExpeditionCombat({ scene, floorAt, day, character, canReach, clearAttack, feedback, onKill }) {
  const kinds = { ...DAY_KINDS };
  const models = new Map(), entries = new Map(), queue = [], hitActors = new Set();
  let currentRun = null;
  let runId = null, nextActorId = 0, health = HERO.health, hurt = 0, nutCooldown = 0, madeContact = false, lastContact = null;
  let fx = null, fxLoad = null, impacts = null, lastHit = null, evaded = 0, focusId = null, focusRing = null;
  const approaches = { deck: pathPoints(day.approaches.deck), shore: pathPoints(day.approaches.shore) };
  const loader = new T.GLTFLoader();

  // One download per file: the boss shares the Fly's.
  function getModel(kind) {
    const { url } = kinds[kind];
    if (!models.has(url)) models.set(url, loader.loadAsync(url).catch(error => {
      models.delete(url);
      throw error;
    }));
    return models.get(url);
  }
  // Hit effects are a nicety: if their module fails to load, the fight goes on without them.
  function loadFx() {
    fxLoad ??= import("./combat-fx.mjs").then(module => {
      fx = module;
      impacts = module.createImpacts(T, scene);
      focusRing = module.createFocusRing(T, scene, floorAt);
    }).catch(error => console.warn("Combat effects:", error));
    return fxLoad;
  }
  // The day needs the Fly and the Beggar and the combo; all of it loads when the sortie starts.
  const prepare = () => Promise.all([getModel("fly"), getModel("beggar"), character.loadCombat?.(COMBAT_PACK), loadFx()]);
  // The night kinds: their code and files are fetched when the first wave starts, 15 s before Tinnik comes.
  let night = null;
  function loadNight() {
    night ??= import("./p02-raid-models.mjs").then(({ P02_RAID_MODELS }) => {
      Object.assign(kinds, P02_RAID_MODELS);
      return Promise.all(Object.keys(P02_RAID_MODELS).map(getModel));
    }).catch(error => {
      night = null;
      throw error;
    });
    return night;
  }

  function remove(entry) {
    entry.tint?.dispose();
    entry.tint = null;
    if (entry.rig && !entry.rig.parent) entry.group.add(entry.rig);
    entry.group.traverse(node => {
      if (node.isSkinnedMesh) node.skeleton.dispose();
      // The cloned rig shares its source geometry and materials.
      if (node.isMesh && !node.userData.sharedRig) {
        node.geometry.dispose();
        for (const material of [].concat(node.material)) material.dispose();
      }
    });
    entry.group.removeFromParent();
    entry.group.clear();
  }

  function clearActors() {
    const old = [...entries.values()];
    entries.clear();
    queue.length = 0;
    for (const entry of old) if (entry.actor) remove(entry);
  }

  function clear() {
    runId = null;
    focusId = null;
    focusRing?.place(null);
    hitActors.clear();
    clearActors();
  }

  // A blow that meets Klyop inside the invulnerable part of his roll is dodged (a soft whoosh tells so).
  function hitPlayer(player) {
    if (hurt > 0 || !health) return false;
    if (player?.dodge?.guard > 0) {
      evaded++;
      feedback("evade");
      return false;
    }
    health--;
    hurt = HERO.hurt;
    feedback("hit");
    return true;
  }

  async function spawn({ run, kind, point, approach = null, hits }) {
    if (run.id !== runId) return;
    const group = new T.Group();
    const route = approaches[approach], actorId = ++nextActorId;
    const entry = { runId: run.id, actorId, kind, group, approach, route, index: 0, counted: false, lock: null,
      freeze: 0, flash: 0, push: null, tint: null };
    entries.set(actorId, entry);
    const current = () => entry.runId === runId && entries.get(actorId) === entry;
    try {
      if (!kinds[kind]) await loadNight();
      const source = await getModel(kind);
      if (!current()) return;
      const model = cloneRig(source);
      entry.rig = model.scene;
      model.scene.traverse(node => { if (node.isMesh) node.userData.sharedRig = true; });
      entry.tint = fx?.createTintable(T, model.scene, kind === "boss" ? new T.Color(...BOSS.tint) : null) ?? null;
      const { create, lift } = kinds[kind];
      const foe = FOES[kind];
      entry.actor = await create({
        THREE: T, GLTFLoader: T.GLTFLoader, scene: group, model, ...point, raid: Boolean(route),
        hits: hits ?? foe.hits, tuning: foe, canReach,
        runId: entry.runId, actorId,
        floorAt: kind === "fly" ? (x, z) => Math.max(WATER, floorAt(x, z)) : floorAt,
        onHit(target) {
          if (!current() || !entry.actor || entry.actor.defeated || !target) return;
          if (target.structure) {
            if (foe.ram && (target.structure.hp <= 0 || !clearAttack(entry.actor.position, target, lift))) return;
            target.structure.hp = Math.max(0, target.structure.hp - foe.structureDamage);
            feedback("contact", 0.52);
          } else if (clearAttack(entry.actor.position, target, lift)) hitPlayer(target);
        },
      });
      if (!current()) { remove(entry); return; }
      scene.add(group);
    } catch (error) {
      remove(entry);
      if (current()) {
        entries.delete(actorId);
        console.error("First Landing wave:", error);
        run.combatError = true;
      }
    }
  }

  function pumpSpawns() {
    while (queue.length && entries.size < RAID_LIMIT) void spawn(queue.shift());
  }

  function resetHealth() { health = HERO.health; hurt = nutCooldown = 0; madeContact = false; }

  function march(run, entry, player) {
    const { actor, route, approach, kind } = entry, p = actor.position;
    const end = route.at(-1);
    const structure = (point, target) => ({ ...point, y: floorAt(point.x, point.z), structure: target });
    const pad = run.pads.find(item => item.approach === approach && item.kind === "wall"
      && item.hp > 0 && distance(p, item) < 2.45);
    if (actor.attacking && entry.lock) {
      return entry.lock.structure ? entry.lock : player;
    }
    let waypoint = route[entry.index];
    if (waypoint && distance(p, waypoint) <= 0.28) waypoint = route[++entry.index];
    const { lift } = kinds[kind];
    const playerClose = !player.swimming && distance(p, player) < 2.3 &&
      Math.abs(p.y - player.y - (kind === "fly" ? 0.94 : 0)) < 0.65 &&
      (distance(p, player) > 2 || clearAttack(p, player, lift));
    const target = pad ? structure(pad, pad) : playerClose ? player : structure(end, run.base);
    entry.lock = target;
    return { target, waypoint: pad || playerClose ? undefined : waypoint };
  }

  function targetVolume({ actor, actorId, kind }) {
    const { x, y, z } = actor.position;
    const { radius, bottom, top } = kinds[kind];
    const volume = { x, z, radius, minY: y + bottom, maxY: y + top };
    return { actorId, kind, volume, x, y: (volume.minY + volume.maxY) / 2, z };
  }

  const living = () => [...entries.values()].filter(({ actor, group }) => actor && !actor.defeated && group.visible);
  const focusTargets = () => living().map(targetVolume);
  // A foe close by, or the boss aiming its charge from further away (so the phone shows «Рывок» in time).
  const nearFoe = player => living().some(({ actor }) => distance(actor.position, player) < (actor.charging ? 8 : 4.8));
  const turnTo = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

  // The foe to focus on: close, and the one in front of Klyop before one behind him.
  function pickFocus(player, range = FOCUS.range) {
    let best = null, score = Infinity;
    for (const target of focusTargets()) {
      const gap = distance(target, player);
      if (gap > range || Math.abs(target.y - player.y) > 2.2) continue;
      const off = Math.abs(turnTo(player.heading, Math.atan2(target.x - player.x, target.z - player.z)));
      const value = gap * (1 + 0.7 * off / Math.PI);
      if (value < score) { best = target; score = value; }
    }
    return best;
  }

  // Each step, before Klyop moves: toggles the focus on G / «Цель», keeps it while the target stands and is close,
  // moves it to the next foe when the target falls, and turns the intent into a strafe around the target.
  function aim(intent, player) {
    if (intent.focus) {
      focusId = focusId == null ? pickFocus(player)?.actorId ?? null : null;
      feedback("focus");
    }
    if (focusId == null) return intent;
    let target = focusTargets().find(item => item.actorId === focusId);
    if (!target) target = pickFocus(player, FOCUS.retarget);
    if (!target || distance(target, player) > FOCUS.keep || player.swimming) target = null;
    focusId = target?.actorId ?? null;
    if (!target) return intent;
    return { ...intent, sprint: false, strafeYaw: Math.atan2(target.x - player.x, target.z - player.z), focusId };
  }
  const heldTarget = () => focusId == null ? null : focusTargets().find(item => item.actorId === focusId) ?? null;

  // A chained blow steps after the foe the last one pushed away (the held target first, else the nearest one in
  // front within 2.4 m) and turns to it a little; returns how far Klyop lunges.
  function stepIn(player, blow) {
    if (!blow?.lunge) return 0;
    const ahead = target => Math.abs(turnTo(player.heading, Math.atan2(target.x - player.x, target.z - player.z))) < Math.PI / 3;
    const foe = heldTarget() ?? focusTargets().filter(target => distance(target, player) < 2.4 && ahead(target))
      .sort((a, b) => distance(a, player) - distance(b, player))[0];
    if (!foe) return blow.step ?? 0;
    // A foe still sliding from the last blow is followed to where it will stop.
    const push = entries.get(foe.actorId)?.push, slide = push ? push.speed ** 2 / (2 * KNOCK.decel) : 0;
    const to = { x: foe.x + (push?.x ?? 0) * slide, z: foe.z + (push?.z ?? 0) * slide };
    const turn = turnTo(player.heading, Math.atan2(to.x - player.x, to.z - player.z));
    player.heading += Math.max(-blow.turn, Math.min(blow.turn, turn));
    const gap = distance(to, player) - foe.volume.radius - blow.close;
    return Math.max(blow.step ?? 0, Math.min(blow.lunge, gap));
  }

  // The blow lands: hold the foe still, then push it away from Klyop along the blow; flash and a ring at contact.
  function react(entry, player, blow) {
    const p = entry.actor.position, { volume } = targetVolume(entry);
    let dx = p.x - player.x, dz = p.z - player.z;
    const gap = Math.hypot(dx, dz);
    if (gap < 0.05) { dx = Math.sin(player.heading); dz = Math.cos(player.heading); } else { dx /= gap; dz /= gap; }
    const knock = blow.knock / (FOES[entry.kind]?.weight ?? 1);
    entry.freeze = blow.hitstop;
    entry.flash = 1;
    entry.push = { x: dx, z: dz, speed: Math.sqrt(2 * KNOCK.decel * knock) };
    lastHit = entry.hit = { kind: entry.kind, stage: player.swingIndex ?? 0, power: blow.power, hitstop: blow.hitstop,
      knock: +knock.toFixed(2), from: { x: p.x, z: p.z }, moved: null };
    const reach = volume.radius * 0.7;
    impacts?.spawn(p.x - dx * reach, (volume.minY + volume.maxY) / 2, p.z - dz * reach, 0.24 + blow.knock * 0.12);
  }

  function strike(run, player, stage, enemies) {
    const at = { x: player.x, y: player.y, z: player.z };
    const blow = COMBO[player.swingIndex ?? 0] ?? COMBO[0];
    let connected = false;
    for (const entry of enemies) {
      if (entry.actor.defeated || hitActors.has(entry.actorId)) continue;
      const { volume } = targetVolume(entry);
      if (!wrenchReaches(stage, player, volume) || !clearAttack(entry.actor.position, at, kinds[entry.kind].lift)) continue;
      if (!entry.actor.harm(blow.power * (run?.forged ? 2 : 1) * (run?.damage ?? 1))) continue;
      hitActors.add(entry.actorId);
      connected = true;
      react(entry, player, blow);
    }
    if (connected) player.hitstop = blow.hitstop;
    return connected;
  }

  // Knockback slows down evenly; it moves the foe in short steps and stops at anything it could not walk onto.
  function shove(entry, dt) {
    const { push, actor } = entry, p = actor.position;
    const travel = push.speed * dt;
    push.speed = Math.max(0, push.speed - KNOCK.decel * dt);
    const count = Math.max(1, Math.ceil(travel / KNOCK.step));
    for (let i = 0; i < count; i++) {
      const x = p.x + push.x * travel / count, z = p.z + push.z * travel / count;
      const y = actor.standAt?.(x, z);
      if (y == null || !Number.isFinite(y)) { push.speed = 0; break; }
      p.set(x, y, z);
    }
    if (push.speed > 0) return;
    entry.push = null;
    if (entry.hit) entry.hit.moved = +distance(entry.hit.from, p).toFixed(2);
  }

  function passives(run, player, dt, enemies) {
    const near = enemies.filter(({ actor, kind }) => !actor.defeated && distance(actor.position, player) < 4.8
      && Math.abs(actor.position.y - player.y - (kind === "fly" ? 0.94 : 0)) < 0.9);
    if (run.build === "tongue" && madeContact) {
      const fly = near.find(({ kind, actor }) => kind === "fly" && distance(actor.position, player) > 1);
      if (fly) fly.actor.pullToward(player);
    }
    if (run.build === "slam" && player.landing?.age === 0 && player.landing.impact > 4.8 && !player.swimming) {
      for (const { actor, kind } of near) if (distance(actor.position, player) <= 1.95
          && clearAttack(actor.position, player, kind === "fly" ? 0 : 0.84)) {
        actor.harm(1);
        actor.pullToward?.({ x: 2 * actor.position.x - player.x, z: 2 * actor.position.z - player.z, y: player.y });
      }
      feedback("contact", 0.6);
    }
    nutCooldown = Math.max(0, nutCooldown - dt);
    if (run.build === "nut" && nutCooldown === 0 && player.speed > 1.6 && !player.swimming) {
      const foe = near.find(({ actor }) => distance(actor.position, player) <= 2 && clearAttack(actor.position, player, 0.48));
      if (foe?.actor.harm(1)) { nutCooldown = 1.8; feedback("contact", 0.36); }
    }
  }

  function traps(run, dt, enemies) {
    for (const pad of run.pads) {
      if (pad.kind !== "trap" || !pad.hp) continue;
      pad.cooldown = Math.max(0, pad.cooldown - dt);
      if (pad.cooldown) continue;
      const near = enemies.find(({ actor }) => !actor.defeated && distance(pad, actor.position) < 2.55);
      if (near?.actor.harm(run.support.flytrap >= 2 ? 3 : 2)) {
        pad.cooldown = 1.22 - run.support.flytrap * 0.17;
        feedback("contact", 0.55);
      }
    }
  }

  function canSwing(player) {
    return Boolean(health && !hurt && player.grounded && !player.swimming && !player.traversal
      && !player.mantle && !player.shoreClimb && !player.landing?.mode && !player.dodge);
  }

  return {
    prepare, clear, resetHealth, hitPlayer, focusTargets, canSwing, nearFoe, aim,
    // The held target ({ x, y, z } of its body centre, actorId, kind) or null; for the camera (main.mjs).
    get focus() { return heldTarget(); },
    canFocus: player => focusId != null || Boolean(pickFocus(player)),
    maxHealth: HERO.health,
    get health() { return health; },
    // ?debug (window.__walkCombat): what the checks read - the last blow and every live foe's state.
    debug: {
      get lastHit() { return lastHit; },
      get impacts() { return impacts?.active ?? 0; },
      get evaded() { return evaded; },
      get focus() { return heldTarget(); },
      get foes() {
        return [...entries.values()].filter(({ actor }) => actor).map(({ actorId, kind, freeze, flash, push, actor }) => ({
          actorId, kind, freeze: +freeze.toFixed(3), flash: +flash.toFixed(2), pushed: Boolean(push),
          attacking: actor.attacking, tell: actor.telegraph ?? null, defeated: actor.defeated,
          x: actor.position.x, y: actor.position.y, z: actor.position.z,
        }));
      },
      // The angry Fly placed last (spawnBoss), else the one at the dam path.
      get boss() {
        const entry = [...entries.values()].filter(item => item.kind === "boss" && item.actor).at(-1);
        return entry ? { actorId: entry.actorId, health: entry.actor.health, phase: entry.actor.phase,
          charging: entry.actor.charging, defeated: entry.actor.defeated, x: entry.actor.position.x, z: entry.actor.position.z } : null;
      },
      // ?debug&boss=1: put the angry Fly at (x, z) in the running day.
      spawnBoss(x, z) {
        if (!BOSS_DAY || !currentRun || currentRun.id !== runId) return false;
        queue.push({ run: currentRun, kind: "boss", point: { x, z } });
        pumpSpawns();
        return true;
      },
    },
    get hurt() { return hurt; },
    get lastContact() { return lastContact; },
    day(run, fly) {
      clear();
      runId = run.id;
      currentRun = run;
      const cache = day.stops.nearCache;
      queue.push({ run, kind: "fly", point: { x: cache.x - 0.92, z: cache.z + 1.19 }, hits: FOES.fly.cacheHits },
        { run, kind: BOSS_DAY ? "boss" : "fly", point: fly });
      pumpSpawns();
    },
    wave(run, index) {
      if (run.id !== runId) return;
      const wave = RAID_WAVES[index];
      if (!wave) return;
      if (index === 0) {
        clearActors();
        void loadNight().catch(() => {});
      }
      for (const { kind, approach } of wave.entrants) {
        queue.push({ run, kind, approach, point: approaches[approach][0] });
      }
      pumpSpawns();
    },
    step(run, player, intent, dt) {
      hurt = Math.max(0, hurt - dt);
      player.hurt = hurt > 0 ? Math.min(0.29, HERO.hurt - hurt) : null;
      // Hitstop holds Klyop's strike pose: the combo clock waits, the rest of the world does not.
      const held = player.hitstop > 0;
      player.hitstop = Math.max(0, (player.hitstop ?? 0) - dt);
      impacts?.update(dt);
      if (player.dodge && player.dodge.age <= dt + 1e-6) feedback("roll");
      if (run && run.id !== runId) return;
      madeContact = false;
      const enemies = [...entries.values()].filter(({ actor }) => actor);
      const ready = canSwing(player) && !intent.jump;
      const stages = character.attack?.stages ?? [];
      const armed = nearFoe(player);
      if (ready && armed && player.swing == null && intent.attack && stages[0]) {
        const focus = heldTarget() ?? focusTargets().sort((a, b) => distance(a, player) - distance(b, player))[0];
        player.heading = firstSwingHeading(player, focus,
          heading => wrenchReaches(stages[0], { ...player, heading }, focus.volume));
      }
      const event = advanceCombo(player, stages, intent.attack, ready && armed, ready, held ? 0 : dt);
      if (event?.started) {
        hitActors.clear();
        feedback("swing", 1 + (player.swingIndex ?? 0) * 0.2);
        player.lunge = player.swingIndex ? stepIn(player, COMBO[player.swingIndex]) : 0;
      }
      if (event?.contact) {
        const stage = stages[player.swingIndex ?? 0];
        madeContact = strike(run, player, stage, enemies);
        const nearest = focusTargets().sort((a, b) => distance(a, player) - distance(b, player))[0];
        lastContact = { stage: stage?.state, path: Boolean(stage?.tip), hit: madeContact,
          gap: nearest ? +distance(nearest, player).toFixed(2) : null, kind: nearest?.kind ?? null,
          hitstop: madeContact ? player.hitstop : 0 };
        if (madeContact) feedback("contact", 1 + (player.swingIndex ?? 0) * 0.25);
      }
      focusRing?.place(heldTarget(), dt);
      if (!run) return;
      const target = { ...player, yaw: player.heading };
      if (run.phase === "night") traps(run, dt, enemies);
      if (run.build) passives(run, player, dt, enemies);
      for (const entry of enemies) {
        const { actor, route, actorId, kind } = entry;
        entry.group.visible = Boolean(route) || distance(actor.position, player) < 23;
        if (!entry.group.visible) continue;
        entry.flash = Math.max(0, entry.flash - dt / FLASH_TIME);
        if (entry.freeze > 0) {
          entry.freeze -= dt;
          entry.tint?.set(entry.flash);
          continue;
        }
        if (entry.push) shove(entry, dt);
        let to = target, waypoint;
        if (route && !actor.defeated) {
          const order = march(run, entry, target);
          if (order.target) { to = order.target; waypoint = order.waypoint; }
          else to = order;
        }
        const slowed = route && distance(actor.position, approaches.deck.at(-1)) < 9 ? 1 - run.support.radio * 0.075 : 1;
        actor.update(dt * slowed, to, waypoint);
        // A strike winding up: the body warms with the windup, and a soft note sounds when Klyop is close.
        const tell = actor.telegraph ?? null;
        if (tell != null && entry.tell == null && distance(actor.position, player) < 3.2) feedback("tell");
        entry.tell = tell;
        entry.tint?.set(entry.flash, tell ?? 0, actor.phase === 2 ? 1 : 0);
        if (actor.phase === 2 && !entry.raged) { entry.raged = true; feedback("rage"); }
        if (actor.defeated && !entry.counted) {
          entry.counted = true;
          run.kills++;
          onKill({ runId: entry.runId, actorId, kind });
        }
        if (actor.gone) { entries.delete(actorId); remove(entry); }
      }
      pumpSpawns();
    },
  };
}
