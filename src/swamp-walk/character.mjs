import * as T from "./vendor/three.mjs";
import { prepareDeckClimb } from "./deck-climb.mjs";
import { createMantlePlacement } from "./mantle-palms.mjs";
import { createFootPlacement, crossedFootContact } from "./gait-contacts.mjs";
import { createKlyopVaultStow } from "./klyop-vault-stow.mjs";
import { JUMP_IMPULSE, waterSupportHeight } from "./motion.mjs";
import { DODGE } from "./combat-tuning.mjs";
import { validRailProfile } from "./rail.mjs";
import { applyKlyopPresentation } from "./klyop-presentation.mjs";
import { MODELS } from "./quality.mjs";
import { reflectTreeInWater } from "./water-reflection.mjs";

const MODEL = MODELS.klyop;
const CLIPS = {
  idle: "Idle_Loop", walk: "Walk_Loop", run: "Jog_Fwd_Loop", sprint: "Sprint_Loop", air: "Jump_Loop",
  swim: "Swim_Fwd_Loop", float: "Swim_Idle_Loop",
};
const MODEL_SCALE = 1.26;
const BLEND_SECONDS = 0.15;
const STRIKES = new Set(["strike", "strike2", "strike3"]);
// Strafe clips of the combat pack, counter-clockwise from ahead (positive angles are to Klyop's left); one cycle
// covers about STRAFE_STRIDE metres at the focus strafe speed.
const STRAFES = ["strafeF", "strafeFL", "strafeL", "strafeBL", "strafeB", "strafeBR", "strafeR", "strafeFR"];
const STRAFE_STRIDE = 2.3;
// Backward speed of the toe during support, at MODEL_SCALE and normal clip playback.
const SUPPORT_SPEED = { walk: 0.61, run: 3.35, sprint: 4.32 };

async function fetchProfile(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Motion data HTTP ${response.status}`);
  return { data: await response.json(), url: response.url };
}

async function loadPilot(url, loader, readJson) {
  if (!url) return null;
  try {
    const { data: profile, url: source } = await readJson(url);
    if (profile.modelScale !== MODEL_SCALE || !validRailProfile(profile.rail, profile.vault)) {
      throw new Error("Invalid Klyop motion profile");
    }
    const library = await loader.loadAsync(new URL("klyop-kfsos-motion.glb", source).href);
    const clips = {
      runJump: T.AnimationClip.findByName(library.animations, profile.clipNames.jump),
      vault: T.AnimationClip.findByName(library.animations, profile.clipNames.vault),
    };
    const { takeoff, apex, contact } = profile.jump;
    if (!clips.runJump?.validate() || !clips.vault?.validate() || ![takeoff, apex, contact].every(Number.isFinite)
        || !(0 <= takeoff && takeoff < apex && apex < contact && contact <= clips.runJump.duration)
        || Math.abs(clips.vault.duration - profile.vault.duration) > 0.001) {
      throw new Error("Invalid Klyop pilot clips");
    }
    return { profile, clips };
  } catch (error) {
    console.warn("Klyop motion pilot:", error);
    return null;
  }
}

// An action may name its own `library` (a new clip delivered as its own GLB); the others share the pack's one.
async function loadActions(url, loader, readJson) {
  if (!url) return null;
  try {
    const { data: { library, actions, profiles, combo }, url: source } = await readJson(url);
    const files = new Map();
    const open = name => {
      if (!files.has(name)) files.set(name, loader.loadAsync(new URL(name, source).href));
      return files.get(name);
    };
    const moves = Object.fromEntries(await Promise.all(Object.entries(actions).map(async ([state, profile]) => {
      const gltf = await open(profile.library ?? library);
      const clip = T.AnimationClip.findByName(gltf.animations, profile.name);
      if (!clip?.validate() || !clip.tracks.length) throw new Error(`Invalid action clip ${profile.name}`);
      return [state, { ...profile, clip }];
    })));
    return { moves, profiles, combo };
  } catch (error) {
    console.warn("Klyop action library:", error);
    return null;
  }
}

export async function addCharacter(scene, pilotUrl, actionUrl, {
  manager, readJson = fetchProfile, deckUrl, deckExits = [],
} = {}) {
  const loader = new T.GLTFLoader(manager);
  const [gltf, candidate, combat, deck] = await Promise.all([
    loader.loadAsync(MODEL), loadPilot(pilotUrl, loader, readJson),
    loadActions(actionUrl, loader, readJson), loadActions(deckUrl, loader, readJson),
  ]);
  const binds = clip => clip.tracks.every(track =>
    gltf.scene.getObjectByName(T.PropertyBinding.parseTrackName(track.name).nodeName));
  const pilot = candidate && Object.values(candidate.clips).every(binds) ? candidate : null;
  const mantleSetup = deck && Object.values(deck.moves).every(move => binds(move.clip))
    ? prepareDeckClimb(deckExits, deck.profiles, name => deck.moves[name]?.clip.duration) : null;
  const moves = { ...combat?.moves, ...(mantleSetup ? deck.moves : {}) };
  const body = new T.Group();
  gltf.scene.scale.setScalar(MODEL_SCALE);
  const setClothWetness = applyKlyopPresentation(T, gltf.scene);
  let clothWetness = 0, rain = 0, pouch = null;
  body.add(gltf.scene);
  scene.add(reflectTreeInWater(body));
  const wrench = gltf.scene.getObjectByName("Swamp_Wrench");
  const bodyMesh = gltf.scene.getObjectByName("Klyop_Body");
  const footPlacement = createFootPlacement(T, gltf.scene, bodyMesh);
  const mantlePlacement = mantleSetup ? createMantlePlacement(T, gltf.scene, bodyMesh) : null;
  const openGrip = bodyMesh.morphTargetDictionary.OpenGrip;
  const belt = gltf.scene.getObjectByName("Electrician_Rig_T2");
  const lantern = gltf.scene.getObjectByName("Darkwater_Lantern_T2");
  const vaultStow = pilot || mantleSetup ? createKlyopVaultStow(T, wrench, belt) : null;
  const down = new T.Vector3(0, -1, 0);
  const hanging = new T.Vector3(-0.32, -1, 0);
  const swimmingHanger = new T.Vector3(-3.08, -1, 0);
  const localDown = new T.Vector3();
  const beltRotation = new T.Quaternion();
  // The belt lamp is a pendulum: it lags when Klyop starts, swings on when he stops or turns, bobs with the run.
  const lampDir = new T.Vector3(), lampSpin = new T.Vector3(), lampAim = new T.Vector3(), lampPull = new T.Vector3();
  const lampGap = new T.Vector3();
  const beltAt = new T.Vector3(), beltWas = new T.Vector3(), beltSpeed = new T.Vector3(), beltSpeedWas = new T.Vector3();
  let lampSettled = false;
  const LAMP = { stiffness: 70, damping: 5.5, inertia: 0.75, reach: 0.55, jolt: 28 };
  // `aim` is where the lamp hangs at rest (world space). The hip's acceleration tilts the line it hangs along, and the
  // lamp follows that line as a damped spring, never further than LAMP.reach radians from rest.
  function swingLamp(aim, swimWeight, dt, snap) {
    belt.getWorldPosition(beltAt);
    if (!lampSettled || snap || !(dt > 0)) {
      beltWas.copy(beltAt);
      beltSpeed.set(0, 0, 0);
      beltSpeedWas.set(0, 0, 0);
      lampSpin.set(0, 0, 0);
      lampDir.copy(aim);
      lampSettled = true;
      return;
    }
    beltSpeed.subVectors(beltAt, beltWas).divideScalar(dt);
    lampPull.subVectors(beltSpeed, beltSpeedWas).divideScalar(dt).clampLength(0, LAMP.jolt);
    beltWas.copy(beltAt);
    beltSpeedWas.copy(beltSpeed);
    // in water the lamp floats on its hanger and does not swing
    lampPull.multiplyScalar(-LAMP.inertia * (1 - swimWeight) / 9.8).add(aim).normalize();
    // small steps, so a long frame (a phone hitch) cannot throw the spring out
    const steps = Math.min(8, Math.ceil(dt * 60)), step = dt / steps;
    for (let i = 0; i < steps; i++) {
      lampSpin.addScaledVector(lampGap.subVectors(lampPull, lampDir), LAMP.stiffness * step).multiplyScalar(Math.exp(-LAMP.damping * step));
      lampDir.addScaledVector(lampSpin, step).normalize();
    }
    const off = lampDir.angleTo(aim);
    if (off > LAMP.reach) lampDir.lerp(aim, 1 - LAMP.reach / off).normalize();
  }
  const mixer = new T.AnimationMixer(gltf.scene);
  const actions = Object.fromEntries(Object.entries(CLIPS).map(([state, name]) => {
    const clip = T.AnimationClip.findByName(gltf.animations, name);
    if (!clip) throw new Error(`Missing Klyop animation: ${name}`);
    return [state, mixer.clipAction(clip)];
  }));
  if (pilot) {
    for (const [name, clip] of Object.entries(pilot.clips)) {
      actions[name] = mixer.clipAction(clip).setEffectiveTimeScale(0);
    }
  }
  const swing = moves.strike;
  const attack = swing && binds(swing.clip) && swing.contact > 0 && swing.contact < swing.clip.duration
    ? { duration: swing.clip.duration, contact: swing.contact,
      stages: [{ state: "strike", duration: swing.clip.duration, contact: swing.contact, chain: null, tip: null }] } : null;
  let combatLoad = null;
  if (!attack) delete moves.strike;
  for (const [state, move] of Object.entries(moves)) {
    if (binds(move.clip)) actions[state] = mixer.clipAction(move.clip).setEffectiveTimeScale(0);
  }
  const freeHandActions = [actions.swim, actions.float, actions.vault, actions.runJump,
    actions.jumpStart, actions.land, actions.hurt, actions.mantleHead, actions.mantleHigh,
    swing?.stow ? actions.strike : null].filter(Boolean);
  const cycleLength = {};
  for (const [state, speed] of Object.entries(SUPPORT_SPEED)) {
    cycleLength[state] = speed * actions[state].getClip().duration;
    actions[state].setEffectiveTimeScale(0);
  }
  let phase = 0, previousPhase = 0, phaseStep = 0, strafePhase = 0;
  let active = "idle", blendTime = BLEND_SECONDS, blendFrom;
  actions.idle.play();

  const shadow = new T.Mesh(new T.PlaneGeometry(1.4, 1.12), new T.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: `
      varying vec2 coords;
      void main() {
        coords = uv * 2. - 1.;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }
    `,
    fragmentShader: `
      varying vec2 coords;
      void main() {
        float alpha = (1. - smoothstep(.12, 1., length(coords))) * .36;
        gl_FragColor = vec4(.03, .045, .033, alpha);
      }
    `,
  }));
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);

  return {
    parkour: pilot || mantleSetup ? { rail: pilot?.profile.rail, vault: pilot?.profile.vault, mantle: mantleSetup } : null,
    attack,
    // The combo (clips v005 with the wrench in the fist and the measured wrench-tip path) loads at the first fight,
    // so the startup download stays small. Until then the single swing from the startup pack works. The stages
    // come from the pack's `combo` list; each one's times are clip seconds, played at its `rate` (a slower rate
    // makes the heavy third blow out of the first swing until the Strike_3 clip arrives - then only combat.json
    // changes). `chain` opens the window for the next press, `cancel` cuts the follow-through when it is pressed.
    loadCombat(url) {
      if (!attack) return Promise.resolve(false);
      combatLoad ??= loadActions(url, loader, fetchProfile).then(combat => {
        const order = combat?.combo ?? ["strike", "strike2"];
        const moves = order.map(state => combat?.moves[state]);
        if (order.length < 2 || moves.some(move => !move || !binds(move.clip)) || order.some(state => !STRIKES.has(state))) {
          return false;
        }
        const used = new Set();
        order.forEach((state, index) => {
          // The same clip twice (the third blow is the first swing, slower) needs its own action.
          const clip = used.has(moves[index].clip) ? moves[index].clip.clone() : moves[index].clip;
          used.add(moves[index].clip);
          actions[state]?.stop();
          actions[state] = mixer.clipAction(clip).setEffectiveTimeScale(0);
        });
        attack.stages = moves.map((move, index) => {
          const rate = move.rate ?? 1;
          return {
            state: order[index], rate, duration: move.clip.duration / rate, contact: move.contact / rate,
            chain: move.chain ? move.chain.map(time => time / rate) : null,
            cancel: move.cancel != null ? move.cancel / rate : null, tip: move.tipSamples ?? null,
          };
        });
        attack.duration = attack.stages[0].duration;
        attack.contact = attack.stages[0].contact;
        // The dodge roll (MVP_Land_Roll, in place) plays over the roll's length; without it Klyop just dashes.
        const { roll } = combat.moves;
        if (roll && binds(roll.clip)) actions.roll = mixer.clipAction(roll.clip).setEffectiveTimeScale(0);
        // Strafing around a held target: all eight directions or none.
        if (STRAFES.every(name => combat.moves[name] && binds(combat.moves[name].clip))) {
          for (const name of STRAFES) actions[name] = mixer.clipAction(combat.moves[name].clip).setEffectiveTimeScale(0);
        }
        return true;
      }).catch(error => {
        console.warn("Klyop combat clips:", error);
        return false;
      });
      return combatLoad;
    },
    // 0..1 from the weather: how hard it rains on Klyop.
    setRain(value) { rain = Math.max(0, Math.min(1, value)); },
    // The pouch on the belt in the player's colour (a room shows each Klyop's own); the material is this Klyop's copy.
    setPouchColor(hex) {
      pouch ??= [];
      if (!pouch.length) belt.traverse(object => {
        if (object.isMesh && object.material?.name === "MAT-GearPilot-Pouch") {
          object.material = object.material.clone();
          pouch.push(object.material);
        }
      });
      for (const material of pouch) material.color.set(hex);
    },
    // A neighbour who left: take the model, its shadow and its GPU buffers away.
    dispose() {
      mixer.stopAllAction();
      scene.remove(body, shadow);
      const seen = new Set();
      for (const root of [body, shadow]) root.traverse(object => {
        for (const item of [object.geometry, ...[object.material].flat()]) {
          if (!item || seen.has(item)) continue;
          seen.add(item);
          for (const value of Object.values(item)) if (value?.isTexture) value.dispose();
          item.dispose?.();
        }
      });
    },
    advanceGait(state, distance, suppressContact = false) {
      if (state === "strafe") {
        strafePhase = (strafePhase + distance / STRAFE_STRIDE) % 1;
        return false;
      }
      const stride = cycleLength[state];
      previousPhase = phase;
      phaseStep = stride ? distance / stride : 0;
      phase = (phase + phaseStep) % 1;
      return !suppressContact && crossedFootContact(state, previousPhase, phaseStep);
    },
    update(player, floor, dt, snap, alpha = 1, floorAt) {
      footPlacement.restore();
      mantlePlacement?.restore();
      body.position.set(player.x, player.y + 0.015, player.z);
      body.rotation.y = player.heading;
      // In the water or the rain Klyop gets wet; on land he dries in about 20 seconds.
      const soaked = player.swimming || player.shoreClimb || player.mantle ? 1 : rain * .85;
      clothWetness = snap ? soaked : Math.max(soaked, clothWetness - dt / 20);
      setClothWetness(clothWetness);
      const mantle = player.mantle?.approach ? null : player.mantle;
      let state = player.pose;
      if (state === "strafe") {
        state = actions.strafeF && player.strafe != null
          ? STRAFES[((Math.round(player.strafe / (Math.PI / 4)) % 8) + 8) % 8] : "run";
      }
      if (mantle) state = mantle.program.action;
      else if (state === "air") {
        if (pilot && player.runningJump) state = "runJump";
        else if (actions.jumpStart && player.airAge !== null && player.airAge < 0.19) state = "jumpStart";
      } else if (player.grounded && !player.swimming && !player.traversal) {
        if (actions.roll && player.dodge) state = "roll";
        else if (actions.hurt && player.hurt !== null) state = "hurt";
        else if (actions.strike && player.swing !== null) state = attack.stages[player.swingIndex ?? 0]?.state ?? "strike";
        else if (actions.land && player.landing?.age < 0.22 && player.landing.impact > 4.2
            && (player.speed < 1.2 || player.landing.impact > 7.5)) state = "land";
      }
      // Into and out of a strike the pose cuts (the wrench stays crisp); from one stage to the next it fades in 0.05 s.
      const chained = STRIKES.has(active) && STRIKES.has(state) && active !== state;
      const strikeCut = !chained && active !== state && (STRIKES.has(active) || STRIKES.has(state));
      if (snap || strikeCut) {
        if (snap) phase = previousPhase = phaseStep = 0;
        for (const action of Object.values(actions)) action.stop();
        actions[state].setEffectiveWeight(1).play();
        active = state;
        blendTime = BLEND_SECONDS;
      } else if (active !== state) {
        blendFrom = Object.fromEntries(Object.entries(actions).map(([name, action]) => [
          name, action.isScheduled() ? action.weight : 0,
        ]));
        if (!actions[state].isScheduled()) actions[state].reset().setEffectiveWeight(0).play();
        active = state;
        blendTime = 0;
      }
      if (blendTime < BLEND_SECONDS) {
        const blendRate = mantle ? 9 : state === "vault" ? player.traversal?.rate ?? 1 : state === "roll" ? 3
          : STRIKES.has(state) ? 3 : 1;
        blendTime = Math.min(blendTime + dt * blendRate, BLEND_SECONDS);
        for (const [name, action] of Object.entries(actions)) {
          if (!action.isScheduled()) continue;
          const weight = T.MathUtils.lerp(blendFrom[name], name === active ? 1 : 0, blendTime / BLEND_SECONDS);
          if (weight === 0 && name !== active) action.stop();
          else action.setEffectiveWeight(weight);
        }
      }
      for (const name of Object.keys(cycleLength)) {
        const action = actions[name];
        if (action.isScheduled()) action.time = ((previousPhase + phaseStep * alpha) % 1) * action.getClip().duration;
      }
      for (const name of STRAFES) {
        const action = actions[name];
        if (action?.isScheduled()) action.time = strafePhase * action.getClip().duration;
      }
      if (pilot && actions.runJump.isScheduled()) {
        const { takeoff, apex, contact } = pilot.profile.jump;
        const rise = T.MathUtils.clamp(1 - player.dy / JUMP_IMPULSE, 0, 1);
        const height = Math.max(0, player.y - waterSupportHeight(floor));
        const remaining = (player.dy + Math.sqrt(player.dy ** 2 + 30.4 * height)) / 15.2;
        const fall = T.MathUtils.clamp(1 - remaining / 0.38, 0, 1);
        actions.runJump.time = state !== "runJump" ? contact : player.dy >= 0
          ? T.MathUtils.lerp(takeoff, apex, rise) : T.MathUtils.lerp(apex, contact, fall);
      }
      if (pilot && actions.vault.isScheduled()) {
        actions.vault.time = state === "vault" ? player.traversal.time : pilot.profile.vault.duration;
      }
      // Only the running stage follows the swing clock; a stage fading out keeps its last pose.
      const stage = player.swing !== null ? attack?.stages[player.swingIndex ?? 0] : null;
      const times = { hurt: player.hurt, jumpStart: player.airAge,
        land: player.landing?.age,
        roll: player.dodge && actions.roll ? player.dodge.age * actions.roll.getClip().duration / DODGE.time : null };
      for (const profile of mantleSetup?.profiles ?? []) {
        times[profile.action] = mantle?.program === profile
          ? T.MathUtils.lerp(mantle.previousClipTime ?? mantle.clipTime, mantle.clipTime, alpha) : profile.to;
      }
      if (stage && actions[stage.state]?.isScheduled()) {
        actions[stage.state].time = Math.min(player.swing * (stage.rate ?? 1), actions[stage.state].getClip().duration - 0.0001);
      }
      for (const [name, time] of Object.entries(times)) {
        const action = actions[name];
        if (!action?.isScheduled()) continue;
        const end = action.getClip().duration - 0.0001;
        action.time = time != null ? Math.min(time, end) : end;
      }
      mixer.update(dt);
      if (mantle) mantlePlacement?.update(mantle, actions[state].time, actions[state].getEffectiveWeight());
      if (snap) footPlacement.reset();
      if (floorAt && player.grounded && !player.swimming && !player.traversal && !player.shoreClimb
          && !actions.vault?.isScheduled() && (state === "idle" || state === "walk" || state === "run" || state === "sprint")) {
        footPlacement.update(state, (previousPhase + phaseStep * alpha) % 1, floorAt, dt, floor);
      } else {
        footPlacement.reset();
      }
      const returnsToCarry = state === "idle" || !!cycleLength[state];
      if (state === "vault" || mantle) vaultStow?.set(true);
      else if (snap || !returnsToCarry || blendTime === BLEND_SECONDS) vaultStow?.set(false);
      const handsFree = vaultStow?.stowed || freeHandActions.some(action => action.isScheduled() && action.getEffectiveWeight() > 0);
      wrench.visible = vaultStow?.stowed || !handsFree;
      bodyMesh.morphTargetInfluences[openGrip] = handsFree ? 1 : 0;
      // The ring stays on its clasp while the lamp hangs clear of the hip.
      const swimWeight = actions.swim.isScheduled() ? actions.swim.getEffectiveWeight() : 0;
      const beltSpread = 1 + 0.10 * swimWeight;
      belt.scale.set(beltSpread, 1, beltSpread);
      lantern.scale.set(1 / beltSpread, 1, 1 / beltSpread);
      lampAim.copy(hanging).lerp(swimmingHanger, swimWeight).normalize().applyQuaternion(body.quaternion);
      swingLamp(lampAim, swimWeight, dt, snap);
      localDown.copy(lampDir).applyQuaternion(belt.getWorldQuaternion(beltRotation).invert());
      lantern.quaternion.setFromUnitVectors(down, localDown);
      shadow.visible = floor > 0.10 && player.y - floor < 0.35;
      shadow.position.set(player.x, floor + 0.027, player.z);
    },
  };
}
