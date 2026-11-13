import * as T from "./vendor/three.mjs";
import { addCabin, onCabinPlot } from "./cabin.mjs";
import { addClickerWorld } from "./clicker-world.mjs";
import { addCharacter } from "./character.mjs";
import { createChart } from "./chart.mjs";
import { overlapsSolid } from "./collisions.mjs";
import { createControls } from "./controls.mjs";
import { createDeckExits, planDeckClimb } from "./deck-climb.mjs";
import { addExpedition } from "./expedition-scene.mjs";
import { createFeedback } from "./feedback.mjs";
import { createLand, LANDMARKS, PIER, smooth, WATER } from "./land.mjs";
import * as worldRules from "./land.mjs";
import { advancePlayer, spawnPlayer } from "./motion.mjs";
import { railDirection, railFloor } from "./rail.mjs";
import { addScenery } from "./scenery.mjs";
import { readShelter } from "./shelter-save.mjs";
import { findBankExit } from "./shore.mjs";
import { addTerrain, createSky } from "./surface.mjs";
import { createSurfaceFX, surfaceContactKind } from "./surface-fx.mjs";
import { preloadWalkAssets } from "./walk-assets.mjs";
import { openWorldSave } from "./walk-world-state.mjs";
import { createWalkRoom } from "./walk-room.mjs";
import { addWater } from "./water.mjs";
import { createPerfOverlay } from "./perf.mjs";
import { createWeather, darknessAt, LAP_SECONDS, rainAt, startLap } from "./weather.mjs";
import { PROFILE } from "./quality.mjs";
import { PORCH } from "./world-places.mjs";
import { markThreshold, takeThreshold, THRESHOLD } from "../swamp/threshold.mjs";
import { SAVE_KEY } from "../swamp/save.mjs";

const $ = (id) => document.getElementById(`swalk-${id}`);
const STEP = 1 / 90;
// Klyop starts on the porch of the shack facing the sunset over the lagoon and the sound (owner, 13.11: no forced
// walk; the player steps off when they want). The porch spot keeps the corner of the shack out of the line to the
// sun. Coming from the clicker he stands on the doorstep, turned to the sunset the same way.
// A quarter metre past the threshold, so the door's own prompt («К рабочему столу», 1.04 m) does not light up at once.
const DOORSTEP = { x: THRESHOLD.outside.x + .25, z: THRESHOLD.outside.z - .15, heading: PORCH.heading };
const STILL = { x: 0, z: 0, sprint: false, jumpHeld: false, jump: false, interact: false, attack: false, dodge: false,
  inventory: false };
// While a sortie runs, the sky follows the day instead of the free clock (candidate C, expedition-weather.mjs):
// light by day, dusk darkens to 0.76 over 30 s, full night, light again at dawn; a short shower mid-day.
function dayDarkness(run) {
  if (run.phase === "night") return 1;
  return run.phase === "dusk" ? 0.76 * smooth(0, 30, run.elapsed) : 0;
}
const dayRain = run => run.phase === "day" ? smooth(66, 72, run.elapsed) * (1 - smooth(89, 96, run.elapsed)) : 0;
const forcedRain = new URLSearchParams(location.search).has("rain");
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
// The clicker marks the door when Klyop leaves it; taken at once, because the cue lives for 90 s only.
const arrivedThroughDoor = takeThreshold("out");

export async function start(world, text, hud, setResetFacts) {
  hud.phase(1);
  const assets = await preloadWalkAssets(text.loadingAssets, new T.LoadingManager(), hud.download);
  try {
    hud.phase(2);
    await assemble(world, text, hud, setResetFacts, assets);
  } finally {
    assets.dispose();
  }
}

async function assemble(world, text, hud, setResetFacts, assets) {
  const canvas = $("view");
  const touchLayout = matchMedia("(pointer: coarse)");
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  const perf = createPerfOverlay(renderer, world);

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(52, 1, 0.12, 230);
  const sky = createSky(scene);
  const terrain = createLand();
  const deckExits = createDeckExits(terrain.deck);
  terrain.noGroundCover = (x, z) => onCabinPlot(x, z) || terrain.beaver.occupied(x, z, .10);
  addTerrain(scene, terrain);
  let storage;
  try { storage = window.localStorage; } catch {}
  const shelter = readShelter(storage, text.economyData);
  const [cabin, scenery, character, layout] = await Promise.all([
    addCabin({ THREE: T, scene, ...shelter, labels: text.shelterLabels, manager: assets.manager }),
    addScenery(scene, terrain, assets.manager, { sky, shows: id => Number(shelter.owned?.[id]) > 0 }),
    addCharacter(scene, text.motionPack, text.actionPack, {
      manager: assets.manager, readJson: assets.json, deckUrl: text.deckPack, deckExits,
    }),
    assets.json("/swamp-walk/mvp/world.json").then(result => result.data),
  ]);
  // What the clicker save bought stands in and around the shack (antenna, stump computer, radio, frogs, peat server).
  const home = addClickerWorld({ scene, pack: scenery.landing, shelter, cabin, land: terrain });
  scene.updateMatrixWorld(true);
  hud.phase(3);
  if (shelter.stages.has("tea_corner") && !cabin.tea) cabin.tea = { x: cabin.spawn.x - 0.35, z: cabin.spawn.z - 0.75 };
  const land = {
    ...terrain,
    floorAt: (x, z) => Math.max(terrain.floorAt(x, z), cabin.floorAt(x, z)),
    surfaceAt: (x, z) => cabin.contains(x, z) ? "wood" : terrain.surfaceAt(x, z),
  };
  const exits = worldRules.WATER_EXITS ?? [];
  const neutral = { x: 0, z: 0 };
  const roof = scene.getObjectByName("Cabin/awning");
  if (roof) {
    const box = new T.Box3().setFromObject(roof);
    cabin.solids.push({ minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y,
      minZ: box.min.z, maxZ: box.max.z });
  }
  const obstacles = [...scenery.obstacles, ...home.obstacles, ...cabin.solids];
  // Gate pieces fade when they obscure the player. They remain solid for movement.
  const outdoorCameraSolids = scenery.obstacles.filter(solid => solid.id !== "gate-post" && solid.id !== "gate-crossbar");
  const cameraSolids = [...outdoorCameraSolids, ...cabin.solids];
  const cutaway = ["awning", "window_hole", "window", "wall_l", "wall_r", "door"].flatMap(name => {
    const group = scene.getObjectByName(`Cabin/${name}`);
    return group ? [{ group, bounds: new T.Box3().setFromObject(group).expandByScalar(0.03) }] : [];
  });
  const parkour = character.parkour;
  if (parkour?.rail) {
    parkour.rail.y = land.floorAt(parkour.rail.x, parkour.rail.z);
    scenery.addRail(parkour.rail);
    for (const hint of $("help").children) hint.append(` · ${text.vaultHint}`);
  }
  // The water reflects the real scene (candidate C): a small camera under the waterline, 192 px every 0.2 s
  // on phones, 384 px every 0.1 s on computers, only after the view has moved.
  const water = addWater(scene, land, { wetRoots: scenery.reflection?.wetRoots ?? [], sky });
  scenery.setEconomy?.(PROFILE === "phone");
  water.setReflectionProfile(PROFILE === "phone" ? "economy" : "normal");
  const weather = createWeather(scene, sky, water);
  const lap = startLap();
  weather.step({ dt: 0, time: 0, player: { x: 0, y: 0, z: 0 }, economy: PROFILE === "phone", targetDark: darknessAt(lap), targetWet: rainAt(lap) });
  const drawChart = createChart($("chart"), land, text, land.day.routes.near);
  const places = LANDMARKS.map((point) => ({ ...point, y: land.heightAt(point.x, point.z) }));
  const saved = openWorldSave(() => window.localStorage);
  scenery.setRadio?.(saved.radio);
  const discovered = saved.seen;
  const debugging = new URLSearchParams(location.search).has("debug");
  const feedbackLog = [];
  const playFeedback = createFeedback();
  // With ?debug every feedback event (swing, contact, hit...) is also logged for automated checks.
  const feedback = debugging ? (kind, ...rest) => { feedbackLog.push(kind); return playFeedback(kind, ...rest); } : playFeedback;
  const surfaceFX = createSurfaceFX(T, scene, land, { water: WATER, play: feedback });
  const buttons = { stick: $("stick"), jump: $("jump"), interact: $("interact"), attack: $("attack"), dodge: $("dodge"),
    inventory: $("inventory") };
  function clearAttack(actor, target, lift) {
    const span = Math.hypot(actor.x - target.x, actor.z - target.z);
    if (span > 2.0) return false;
    for (let travel = 0.22; travel < span - 0.1; travel += 0.14) {
      const t = travel / span;
      const x = T.MathUtils.lerp(actor.x, target.x, t), z = T.MathUtils.lerp(actor.z, target.z, t);
      const y = T.MathUtils.lerp(actor.y + lift, target.y + 0.63, t);
      if (obstacles.some(solid => overlapsSolid(solid, x, y - 0.10, z, 0.10, 0.20))) return false;
    }
    return true;
  }
  // Another tab (the clicker) changed the shack: the board offers to refresh before the next sortie.
  const profileKey = ({ stages, owned, projects }) => JSON.stringify([[...stages], owned, [...projects]]);
  const originalProfile = profileKey(shelter);
  let shelterChanged = false;
  addEventListener("storage", event => {
    if (event.key !== SAVE_KEY && event.key !== null) return;
    const next = readShelter(storage, text.economyData);
    shelterChanged = profileKey(next) !== originalProfile;
    Object.assign(shelter, { amber: next.amber, fish: next.fish, stock: next.stock });
  });
  const expedition = addExpedition({
    scene, layout: { ...layout, radio: worldRules.RADIO_TUNING }, floorAt: land.floorAt, day: land.day,
    character, cabin, saved, shelter, storage, text, feedback, clearAttack,
    curios: scenery.curios, handheld: touchLayout.matches, homeDoor: THRESHOLD.center,
    fishingSite: land.lakes.fishing,
    wake: (point, time) => water.wake(point.x, point.z, time),
    tuneRadio: () => scenery.setRadio?.(true),
    returnHome: () => goHome(),
    refreshNeeded: () => shelterChanged,
    refreshShelter: () => location.reload(),
    ui: { panel: $("sortie"), ...buttons, ...Object.fromEntries(
      ["objective", "health", "prompt", "phase", "bag", "stock", "result", "dialog", "dialogTitle", "dialogBody",
        "supply", "options"].map(key => [key, $(key)])) },
    canReach: (x, z, y) => !obstacles.some(solid => overlapsSolid(solid, x, y, z, 0.25, 0.78)),
  });
  // Neighbours in a room (stage 2 of docs/design/multiplayer.md): «Позвать соседа» on the map panel or a #room= link.
  const room = createWalkRoom({ world, scene, camera, character, floorAt: land.floorAt, storage, text, shelter,
    button: $("room") });
  const target = new T.Vector3(), offset = new T.Vector3(), goal = new T.Vector3(), focusLook = new T.Vector3();
  const sight = new T.Ray(), sightHit = new T.Vector3();
  const pier = { x: PIER.x, z: PIER.z, heading: Math.PI };
  let player, previous;
  let swimDistance = 0;
  let deckReady = false, nextDeckCheck = 0;
  let boom = 0, elapsed = 0, lastFrame = 0, budget = 0, chartAt = 0, noteUntil = 0;
  let leaving = null, moved = false, lapShift = 0, dayClock = false;
  const start = arrivedThroughDoor ? DOORSTEP : PORCH;

  function resize() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function placeCamera(pose, dt, snap) {
    const { yaw, pitch } = controls.camera;
    const inside = cabin.contains(pose.x, pose.z);
    const nearCabin = Math.hypot(pose.x - cabin.spawn.x, pose.z - cabin.spawn.z) < 5.7;
    const mobile = touchLayout.matches;
    const reach = inside ? 3.72 : mobile ? 7.6 : camera.aspect < 0.8 ? 6.48 : 6.08;
    const close = snap ? 0 : T.MathUtils.clamp((3.10 - boom) / 2.45, 0, 1);
    // Phones aim above Klyop's head so he sits in the lower third and the far shore stays in view.
    const centerY = inside ? 0.96 - 0.22 * close : mobile ? 1.85 - 0.75 * close : 1.10 - 0.22 * close;
    target.set(pose.x - Math.sin(yaw) * 0.43, Math.max(WATER, pose.y) + centerY,
      pose.z - Math.cos(yaw) * 0.43);
    // Focus on a target (the combat agent's G): the eye leans toward the enemy, so Klyop and it share the frame.
    const lock = expedition.focus;
    if (lock) target.lerp(focusLook.set(lock.x, Math.max(WATER, lock.y), lock.z), 0.3);
    offset.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    let available = reach;
    for (let i = 0.42; i <= reach; i += 0.24) {
      goal.copy(target).addScaledVector(offset, i);
      if (goal.y < land.floorAt(goal.x, goal.z) + 0.29
          || (nearCabin ? outdoorCameraSolids : cameraSolids).some(solid =>
            overlapsSolid(solid, goal.x, goal.y - 0.15, goal.z, 0.19, 0.30))) {
        available = Math.max(0.44, i - 0.23);
        break;
      }
    }
    boom = snap || available < boom ? available : T.MathUtils.damp(boom, available, 12, dt);
    const fov = (camera.aspect < 0.8 ? 57 : 52) + Math.max(0, 3.0 - boom) * 9;
    if (Math.abs(camera.fov - fov) > 0.2) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camera.position.copy(target).addScaledVector(offset, boom);
    sight.origin.copy(target);
    sight.direction.copy(offset);
    for (const { group, bounds } of cutaway) {
      group.visible = !nearCabin || !sight.intersectBox(bounds, sightHit) || sightHit.distanceTo(target) > boom + 0.12;
    }
    // Outdoors the eye looks a little over Klyop's head: the horizon drops toward the upper third, so the sunset
    // and the far shores fit in the frame (the orbit itself stays where the controls put it).
    if (!inside) target.y += boom * .06;
    camera.lookAt(target);
    scenery.updateGate(camera.position, pose, dt, snap);
    sky.position.copy(camera.position);
  }

  function showProgress(place) {
    const status = $("status");
    const title = document.createElement("strong");
    title.textContent = place ? text.places[place.id][0] : `${text.progress} ${discovered.size} / ${places.length}`;
    status.replaceChildren(title);
    const detail = place ? text.places[place.id][1] : discovered.size === places.length ? text.complete : "";
    if (detail) {
      const description = document.createElement("p");
      description.textContent = detail;
      status.append(description);
    }
  }

  function reset(point) {
    player = spawnPlayer(land.floorAt, point);
    deckReady = false;
    nextDeckCheck = 0;
    player.heading = point.heading ?? Math.PI;
    previous = { ...player };
    swimDistance = 0;
    world.toggleAttribute("data-exploring", point !== cabin.spawn && point !== start);
    controls.resetCamera(player.heading);
    expedition.resetHealth();
    noteUntil = 0;
    showProgress();
    drawChart(player, discovered, expedition.target());
    placeCamera(player, 0, true);
    character.update(player, player.y, 0, true, 1, land.floorAt);
  }

  function drawWorld() {
    water.update(renderer, camera, elapsed);
    renderer.render(scene, camera);
  }

  const center = () => controls.center(player.heading);
  // «На причал» and R: during a sortie the board first asks whether to abandon it.
  const resetWalk = () => { if (!expedition.modal && !leaving) expedition.leave(() => reset(pier)); };
  const controls = createControls(canvas, buttons, resetWalk, center, touchLayout);
  $("reset").addEventListener("click", event => {
    resetWalk();
    if (event.detail > 0) canvas.focus({ preventScroll: true });
  });
  $("camera").addEventListener("click", center);
  $("camera-center").addEventListener("click", center);
  document.addEventListener("visibilitychange", () => { lastFrame = 0; budget = 0; });
  setResetFacts(() => {
    if (expedition.running || !saved.reset()) return false;
    scenery.setRadio?.(false);
    reset(cabin.spawn);
    return true;
  });
  resize();
  new ResizeObserver(resize).observe(canvas);
  reset(start);
  // «← В кликер»: Klyop steps back into the door, the clicker shows him coming out of it.
  const back = world.querySelector(".walk-link");
  // The door of the shack does the same («К рабочему столу»); a running sortie asks first.
  function goHome() {
    if (leaving || !back) return;
    markThreshold("in", new URL(back.href).pathname);
    if (calm) { location.assign(back.href); return; }
    reset({ ...THRESHOLD.outside });
    leaving = { age: 0, href: back.href };
  }
  back?.addEventListener("click", event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || leaving) return;
    event.preventDefault();
    if (!expedition.modal) expedition.leave(goHome);
  });
  addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
  // `?debug` exposes the player for automated checks (teleport into water next to each deck edge and so on).
  if (new URLSearchParams(location.search).has("debug")) {
    window.__walk = {
      get player() { return player; },
      get deckReady() { return deckReady; },
      get cameraYaw() { return controls.camera.yaw; },
      exits: parkour?.mantle?.exits ?? [],
      setup: parkour?.mantle ?? null,
      scene, camera, renderer, feedbackLog,
      // The game day: phase, run (bag, stock, pads, kills...), live enemies with hurt volumes, last wrench contact.
      day: {
        get phase() { return expedition.phase; },
        get run() { return expedition.run; },
        get health() { return expedition.health; },
        get modal() { return expedition.modal; },
        get pending() { return expedition.pending; },
        get kitReady() { return expedition.kitReady; },
        get lastContact() { return expedition.lastContact; },
        get fishing() { return expedition.fishing; },
        get fish() { return shelter.fish; },
        get dark() { return weather.state.dark; },
        targets: () => expedition.focusTargets(),
        skipTo: phase => expedition.skipTo(phase),
      },
      obstacles,
      floorAt: land.floorAt,
      teleport(x, z, heading) { reset({ x, z, heading }); },
      // the room client (null until a room is opened) and the neighbours' state, for checks
      get room() { return room.room; },
    };
  }
  // The task board brightens when its text changes and goes quiet after a few seconds.
  const sortiePanel = $("sortie");
  let sortieText = "", quietAt = 0;
  new MutationObserver(() => {
    const text = $("objective").textContent + "|" + ($("prompt").hidden ? "" : $("prompt").textContent);
    if (text === sortieText) return;
    sortieText = text;
    sortiePanel.dataset.fresh = "";
    clearTimeout(quietAt);
    quietAt = setTimeout(() => delete sortiePanel.dataset.fresh, 6500);
  }).observe(sortiePanel, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden"] });
  scenery.update(0, camera.position, saved.radio);
  expedition.draw(player, 0, false, false);
  drawWorld();
  // Build every shader now, while the loading card is still up, instead of stalling the first frames
  // (the water reflection meets objects the main camera has not drawn yet).
  try { await renderer.compileAsync?.(scene, camera); } catch (error) { console.warn("3D shader warm-up:", error); }
  // Look around once behind the loading card, so models and textures reach the GPU now and not
  // in the first seconds of the walk (a 0.2 s stall on a slow phone otherwise).
  const startYaw = controls.camera.yaw;
  const viewPose = { ...player, x: 0, z: 18, y: land.floorAt(0, 18) };
  let warmStep = 0;
  for (const pose of [viewPose, player]) {
    for (const turn of [Math.PI / 2, Math.PI, Math.PI * 1.5, 0]) {
      controls.camera.yaw = (pose === player ? startYaw : start.heading + Math.PI) + turn;
      placeCamera(pose, 0, true);
      scenery.update(0, camera.position, saved.radio);
      water.update(renderer, camera, ++warmStep);
      renderer.render(scene, camera);
    }
  }
  controls.camera.yaw = startYaw;
  placeCamera(player, 0, true);
  hud.ready();
  for (const id of ["status", "touch", "sortie"]) $(id).hidden = false;

  renderer.setAnimationLoop((stamp) => {
    if (document.hidden) return;
    const dt = lastFrame ? Math.min((stamp - lastFrame) / 1000, 0.12) : 0;
    lastFrame = stamp;
    elapsed += dt;
    budget += dt;
    while (budget >= STEP) {
      previous = { ...player };
      let intent = controls.sample(stamp - (budget - STEP) * 1000);
      const wants = Math.hypot(intent.x, intent.z) > 0.1 || intent.jump || intent.attack || intent.interact || intent.dodge;
      if (wants && !moved) {
        moved = true;
        world.dataset.moved = "";
      }
      if (leaving) {
        leaving.age += STEP;
        if (leaving.age > 0.8 && !leaving.gone) {
          leaving.gone = true;
          location.assign(leaving.href);
        }
        intent = { ...intent, x: -0.66, z: 0, sprint: false, jump: false, jumpHeld: false,
          interact: false, attack: false, dodge: false };
      }
      if (expedition.modal || room.modal) intent = STILL;
      else if (expedition.saving) intent = { ...STILL, interact: intent.interact };
      intent = expedition.dashIntent(intent, player, STEP);
      const distance = advancePlayer(player, intent, land.floorAt, obstacles, STEP, parkour, exits,
        expedition.loaded ? (x, z) => expedition.allowMovement(x, z) : undefined);
      const suppressedContact = !!(player.traversal || player.shoreClimb || player.mantle || player.swing !== null || player.hurt !== null);
      const foot = character.advanceGait(player.pose, distance, suppressedContact);
      const kind = surfaceContactKind(player, previous, foot);
      if (kind) surfaceFX.emit({ kind, x: player.x, z: player.z, yaw: player.heading, displacement: distance });
      swimDistance = player.swimming && previous.swimming ? swimDistance + distance : 0;
      if (swimDistance >= 1.32) {
        water.wake(player.x, player.z, elapsed);
        swimDistance -= 1.32;
      }
      if (scenery.hazard?.step(player, STEP)) expedition.injure(player);
      if (!expedition.step(player, intent, STEP, elapsed)) reset(layout.checkpoint ?? pier);
      budget -= STEP;
    }
    if (!world.hasAttribute("data-exploring") && moved && Math.hypot(player.x - start.x, player.z - start.z) > 1.6) {
      world.dataset.exploring = "true";
    }
    for (const place of places) {
      if (!discovered.has(place.id) && Math.hypot(player.x - place.x, player.z - place.z) < 3.65
          && Math.abs(player.y - place.y) < 1.65) {
        discovered.add(place.id);
        saved.save();
        showProgress(place);
        noteUntil = elapsed + 5.4;
      }
    }
    if (noteUntil && elapsed > noteUntil) {
      noteUntil = 0;
      showProgress();
    }
    if (hud.mapOpen && elapsed >= chartAt) {
      drawChart(player, discovered, expedition.target());
      chartAt = elapsed + 0.09;
    }
    const alpha = budget / STEP;
    const rendered = { ...player };
    for (const key of ["x", "y", "z"]) rendered[key] = T.MathUtils.lerp(previous[key], player[key], alpha);
    const turn = player.heading - previous.heading;
    rendered.heading = previous.heading + Math.atan2(Math.sin(turn), Math.cos(turn)) * alpha;
    const held = expedition.focus;
    controls.updateCamera(rendered.heading, dt, held ? Math.atan2(held.x - rendered.x, held.z - rendered.z) : undefined);
    placeCamera(rendered, dt, false);
    const floor = railFloor(parkour?.rail, land.floorAt(rendered.x, rendered.z), rendered.x, rendered.z);
    character.update(rendered, floor, dt, false, alpha, land.floorAt);
    room.update(rendered, dt);
    surfaceFX.update(dt);
    // The day goes round: evening, dusk, night with stars, dawn. Phones skip a cloud layer and draw fewer stars.
    // During a sortie the sky follows its phase; afterwards the free clock goes on from dawn.
    const run = expedition.run, running = expedition.running;
    if (dayClock && !running) lapShift = 0.985 - (lap + elapsed / LAP_SECONDS);
    dayClock = running;
    const lapNow = lap + lapShift + elapsed / LAP_SECONDS;
    const followDay = running || run?.phase === "dawn";
    weather.step({ dt, time: elapsed, player: rendered, economy: PROFILE === "phone",
      targetDark: followDay ? dayDarkness(run) : darknessAt(lapNow),
      targetWet: followDay && !forcedRain ? dayRain(run) : rainAt(lapNow) });
    character.setRain(weather.state.wet);
    scenery.update(elapsed, camera.position, saved.radio, weather.state.dark);
    home.update(elapsed);
    if ((!player.swimming && !player.grounded) || player.mantle || player.shoreClimb) {
      deckReady = false;
      nextDeckCheck = elapsed;
    } else if (elapsed >= nextDeckCheck) {
      deckReady = Boolean(planDeckClimb(player, parkour?.mantle, land.floorAt, obstacles));
      nextDeckCheck = elapsed + 0.09;
    }
    expedition.draw(player, elapsed, railDirection(player, neutral, parkour, land.floorAt, obstacles),
      !deckReady && findBankExit(player, neutral, exits, land.floorAt, obstacles), deckReady);
    drawWorld();
    perf?.frame(stamp);
  });
}
