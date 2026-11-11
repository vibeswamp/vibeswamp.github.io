import * as T from "./vendor/three.mjs";
import { prepareDeckClimb } from "./deck-climb.mjs";
import { createMantlePlacement } from "./mantle-palms.mjs";
import { createFootPlacement, crossedFootContact } from "./gait-contacts.mjs";
import { createKlyopVaultStow } from "./klyop-vault-stow.mjs";
import { JUMP_IMPULSE, waterSupportHeight } from "./motion.mjs";
import { validRailProfile } from "./rail.mjs";
import { applyKlyopPresentation } from "./klyop-presentation.mjs";

const MODEL = "/swamp-walk/klyop-walk.glb";
const CLIPS = {
  idle: "Idle_Loop", walk: "Walk_Loop", run: "Jog_Fwd_Loop", sprint: "Sprint_Loop", air: "Jump_Loop",
  swim: "Swim_Fwd_Loop", float: "Swim_Idle_Loop",
};
const MODEL_SCALE = 1.26;
const BLEND_SECONDS = 0.15;
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

async function loadActions(url, loader, readJson) {
  if (!url) return null;
  try {
    const { data: { library, actions, profiles }, url: source } = await readJson(url);
    const gltf = await loader.loadAsync(new URL(library, source).href);
    const moves = Object.fromEntries(Object.entries(actions).map(([state, profile]) => {
      const clip = T.AnimationClip.findByName(gltf.animations, profile.name);
      if (!clip?.validate() || !clip.tracks.length) throw new Error(`Invalid action clip ${profile.name}`);
      return [state, { ...profile, clip }];
    }));
    return { moves, profiles };
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
  let clothWetness = 0;
  body.add(gltf.scene);
  scene.add(body);
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
    ? { duration: swing.clip.duration, contact: swing.contact } : null;
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
  let phase = 0, previousPhase = 0, phaseStep = 0;
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
    advanceGait(state, distance, suppressContact = false) {
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
      clothWetness = player.swimming || player.shoreClimb || player.mantle ? 1 : snap ? 0 : Math.max(0, clothWetness - dt / 4.5);
      setClothWetness(clothWetness);
      const mantle = player.mantle?.approach ? null : player.mantle;
      let state = player.pose;
      if (mantle) state = mantle.program.action;
      else if (state === "air") {
        if (pilot && player.runningJump) state = "runJump";
        else if (actions.jumpStart && player.airAge !== null && player.airAge < 0.19) state = "jumpStart";
      } else if (player.grounded && !player.swimming && !player.traversal) {
        if (actions.hurt && player.hurt !== null) state = "hurt";
        else if (actions.strike && player.swing !== null) state = "strike";
        else if (actions.land && player.landing?.age < 0.22 && player.landing.impact > 4.2
            && (player.speed < 1.2 || player.landing.impact > 7.5)) state = "land";
      }
      const strikeCut = active !== state && (active === "strike" || state === "strike");
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
        const blendRate = mantle ? 9 : state === "vault" ? player.traversal?.rate ?? 1 : 1;
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
      const times = { strike: player.swing, hurt: player.hurt, jumpStart: player.airAge, land: player.landing?.age };
      for (const profile of mantleSetup?.profiles ?? []) {
        times[profile.action] = mantle?.program === profile
          ? T.MathUtils.lerp(mantle.previousClipTime ?? mantle.clipTime, mantle.clipTime, alpha) : profile.to;
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
      localDown.copy(hanging).lerp(swimmingHanger, swimWeight).normalize().applyQuaternion(body.quaternion);
      localDown.applyQuaternion(belt.getWorldQuaternion(beltRotation).invert());
      lantern.quaternion.setFromUnitVectors(down, localDown);
      shadow.visible = floor > 0.10 && player.y - floor < 0.35;
      shadow.position.set(player.x, floor + 0.027, player.z);
    },
  };
}
