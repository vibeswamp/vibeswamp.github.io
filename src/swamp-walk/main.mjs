import * as T from "./vendor/three.mjs";
import { addCabin, onCabinPlot } from "./cabin.mjs";
import { addCharacter } from "./character.mjs";
import { createChart } from "./chart.mjs";
import { overlapsSolid } from "./collisions.mjs";
import { createControls } from "./controls.mjs";
import { createDeckExits, planDeckClimb } from "./deck-climb.mjs";
import { addEncounter } from "./encounter.mjs";
import { createFeedback } from "./feedback.mjs";
import { createLand, LANDMARKS, PIER, WATER } from "./land.mjs";
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
import { addWater } from "./water.mjs";
import { createPerfOverlay } from "./perf.mjs";
import { PROFILE } from "./quality.mjs";
import { markThreshold, takeThreshold, THRESHOLD } from "../swamp/threshold.mjs";

const $ = (id) => document.getElementById(`swalk-${id}`);
const STEP = 1 / 90;
// On the first visit Klyop walks out of the shack door himself, then turns to the sunset over the lagoon.
// He steps out east, walks to a spot on the pier where nothing stands between the camera and the lagoon,
// and turns a little right of the sun, so the first frame shows him, the water and the sunset.
const DOOR_OUT_X = -0.6;
const VIEW_SPOT = { x: 0, z: 24.0 };
const VIEW_HEADING = -2.7;
const INTRO_SECONDS = 3.4;
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
// How far the evening has gone: 0 day, 1 night. Stars start to show from about 0.8.
const DUSK = 0.9;
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
    addScenery(scene, terrain, assets.manager),
    addCharacter(scene, text.motionPack, text.actionPack, {
      manager: assets.manager, readJson: assets.json, deckUrl: text.deckPack, deckExits,
    }),
    assets.json("/swamp-walk/mvp/world.json").then(result => result.data),
  ]);
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
  const obstacles = [...scenery.obstacles, ...cabin.solids];
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
  const water = addWater(scene, land, scenery.reflection);
  const drawChart = createChart($("chart"), land, text, [[cabin.spawn.x, cabin.spawn.z], [0, 25.55], ...layout.route]);
  const places = LANDMARKS.map((point) => ({ ...point, y: land.heightAt(point.x, point.z) }));
  const saved = openWorldSave(() => window.localStorage);
  scenery.setRadio?.(saved.radio);
  const discovered = saved.seen;
  const feedback = createFeedback();
  const surfaceFX = createSurfaceFX(T, scene, land, { water: WATER, play: feedback });
  const buttons = { stick: $("stick"), jump: $("jump"), interact: $("interact"), attack: $("attack"), dodge: $("dodge") };
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
  const encounter = addEncounter({
    scene, layout: { ...layout, radio: worldRules.RADIO_TUNING }, floorAt: land.floorAt,
    character, cabin, saved, feedback, clearAttack, copy: text.sortie,
    curios: scenery.curios,
    tuneRadio: () => scenery.setRadio?.(true),
    ui: { panel: $("sortie"), objective: $("objective"), health: $("health"), prompt: $("prompt"), ...buttons },
    canReach: (x, z, y) => !obstacles.some(solid => overlapsSolid(solid, x, y, z, 0.25, 0.78)),
  });
  const target = new T.Vector3(), offset = new T.Vector3(), goal = new T.Vector3();
  const sight = new T.Ray(), sightHit = new T.Vector3();
  const pier = { x: PIER.x, z: PIER.z, heading: Math.PI };
  let player, previous;
  let swimDistance = 0;
  let deckReady = false, nextDeckCheck = 0;
  let boom = 0, elapsed = 0, lastFrame = 0, budget = 0, chartAt = 0, noteUntil = 0;
  let intro = null, leaving = null, moved = false;

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
    intro = null;
    world.toggleAttribute("data-exploring", point !== cabin.spawn);
    controls.resetCamera(player.heading);
    encounter.reset();
    noteUntil = 0;
    showProgress();
    drawChart(player, discovered, encounter.target());
    placeCamera(player, 0, true);
    character.update(player, player.y, 0, true, 1, land.floorAt);
  }

  function drawWorld() {
    water.update(renderer, camera, elapsed);
    renderer.render(scene, camera);
  }

  const center = () => controls.center(player.heading);
  const controls = createControls(canvas, buttons, () => reset(pier), center, touchLayout);
  $("reset").addEventListener("click", event => {
    reset(pier);
    if (event.detail > 0) canvas.focus({ preventScroll: true });
  });
  $("camera").addEventListener("click", center);
  $("camera-center").addEventListener("click", center);
  document.addEventListener("visibilitychange", () => { lastFrame = 0; budget = 0; });
  setResetFacts(() => {
    if (!saved.reset()) return false;
    scenery.setRadio?.(false);
    reset(cabin.spawn);
    return true;
  });
  resize();
  new ResizeObserver(resize).observe(canvas);
  // With reduced motion there is no walk: Klyop already stands at the view spot.
  if (calm) reset({ ...VIEW_SPOT, heading: VIEW_HEADING });
  else reset(arrivedThroughDoor ? THRESHOLD.inside : cabin.spawn);
  if (!calm) intro = { age: 0 };
  // «← В кликер»: Klyop steps back into the door, the clicker shows him coming out of it.
  const back = world.querySelector(".walk-link");
  back?.addEventListener("click", event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || leaving) return;
    markThreshold("in", new URL(back.href).pathname);
    if (calm) return;
    event.preventDefault();
    reset({ ...THRESHOLD.outside });
    leaving = { age: 0, href: back.href };
  });
  addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
  // `?debug` exposes the player for automated checks (teleport into water next to each deck edge and so on).
  if (new URLSearchParams(location.search).has("debug")) {
    window.__walk = {
      get player() { return player; },
      get deckReady() { return deckReady; },
      exits: parkour?.mantle?.exits ?? [],
      setup: parkour?.mantle ?? null,
      obstacles,
      floorAt: land.floorAt,
      teleport(x, z, heading) { reset({ x, z, heading }); },
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
  encounter.draw(player, 0, false);
  drawWorld();
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
      } else if (intro) {
        intro.age += STEP;
        if (wants || intro.age > INTRO_SECONDS) {
          intro = null;
          if (!wants) center();
        } else {
          intro.outside ||= player.x >= DOOR_OUT_X;
          const dx = VIEW_SPOT.x - player.x, dz = VIEW_SPOT.z - player.z, gap = Math.hypot(dx, dz);
          intro.there ||= intro.outside && gap < 0.2;
          if (intro.there) intro.facing = (intro.facing ?? 0) + STEP;
          if (intro.facing > 0.3) {
            intro = null;
            center();
          } else {
            const [x, z] = !intro.outside ? [0.62, 0] : !intro.there ? [0.62 * dx / gap, 0.62 * dz / gap]
              : [0.3 * Math.sin(VIEW_HEADING), 0.3 * Math.cos(VIEW_HEADING)];
            intent = { ...intent, x, z, sprint: false };
          }
        }
      }
      const distance = advancePlayer(player, intent, land.floorAt, obstacles, STEP, parkour, exits);
      const suppressedContact = !!(player.traversal || player.shoreClimb || player.mantle || player.swing !== null || player.hurt !== null);
      const foot = character.advanceGait(player.pose, distance, suppressedContact);
      const kind = surfaceContactKind(player, previous, foot);
      if (kind) surfaceFX.emit({ kind, x: player.x, z: player.z, yaw: player.heading, displacement: distance });
      swimDistance = player.swimming && previous.swimming ? swimDistance + distance : 0;
      if (swimDistance >= 1.32) {
        water.wake(player.x, player.z, elapsed);
        swimDistance -= 1.32;
      }
      if (scenery.hazard?.step(player, STEP)) encounter.injure();
      if (!encounter.step(player, intent, STEP, elapsed)) reset(layout.checkpoint ?? pier);
      budget -= STEP;
    }
    if (!world.hasAttribute("data-exploring") && !cabin.contains(player.x, player.z)) {
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
      drawChart(player, discovered, encounter.target());
      chartAt = elapsed + 0.09;
    }
    const alpha = budget / STEP;
    const rendered = { ...player };
    for (const key of ["x", "y", "z"]) rendered[key] = T.MathUtils.lerp(previous[key], player[key], alpha);
    const turn = player.heading - previous.heading;
    rendered.heading = previous.heading + Math.atan2(Math.sin(turn), Math.cos(turn)) * alpha;
    controls.updateCamera(rendered.heading, dt);
    placeCamera(rendered, dt, false);
    const floor = railFloor(parkour?.rail, land.floorAt(rendered.x, rendered.z), rendered.x, rendered.z);
    character.update(rendered, floor, dt, false, alpha, land.floorAt);
    surfaceFX.update(dt);
    // Dusk: clouds drift, the first stars show high up. Phones skip the second cloud layer and draw fewer stars.
    sky.userData.weather?.(elapsed, DUSK, 0, PROFILE === "phone");
    scenery.update(elapsed, camera.position, saved.radio);
    if ((!player.swimming && !player.grounded) || player.mantle || player.shoreClimb) {
      deckReady = false;
      nextDeckCheck = elapsed;
    } else if (elapsed >= nextDeckCheck) {
      deckReady = Boolean(planDeckClimb(player, parkour?.mantle, land.floorAt, obstacles));
      nextDeckCheck = elapsed + 0.09;
    }
    encounter.draw(player, elapsed, railDirection(player, neutral, parkour, land.floorAt, obstacles),
      !deckReady && findBankExit(player, neutral, exits, land.floorAt, obstacles), deckReady);
    drawWorld();
    perf?.frame(stamp);
  });
}
