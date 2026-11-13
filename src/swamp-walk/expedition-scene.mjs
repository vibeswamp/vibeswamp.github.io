// The game day of «Первый причал» in the scene (candidate C, expedition-scene.mjs), on our HUD and controls:
// sortie board at the lantern -> near cache -> bag (I) -> stock -> amber at the radio hut -> defenses at dusk ->
// four night waves -> dawn and the reward. Every result is written into the clicker's save under its Web Lock
// (src/swamp/expedition-3d-save.mjs); a failed write keeps the day waiting on «Повторить сохранение».
// The kit (board post, cache, stock crate, barricade, trap, amber) loads when the board is first used.
// Between sorties Klyop can fish from the fishing pier; a bite comes in 6–15 s and each catch is counted in the same
// save (recordCatch).
// Economy of 13.11 (docs/design/economy.md): the board says what the hut still lacks and what the house gives the
// trip (bag, wrench, lantern); walls go to the clicker's save ("defense") and stand between days; after unloading at
// dusk the board offers «Домой до темноты».
import * as T from "./vendor/three.mjs";
import { gearOf } from "../swamp/engine.mjs";
import { nextHomeNeed, openExpeditionWriter, recordCatch } from "../swamp/expedition-3d-save.mjs";
import { loadSave } from "../swamp/save.mjs";
import { THRESHOLD } from "../swamp/threshold.mjs";
import {
  active, advanceExpedition, BAG_SIZE, BUILDS, canGoHome, canSpend, COST, defenseList, dropMaterials, fail,
  fordAllowsMovement, gather, goHome, holdAmber, load, MOST_WALLS, PADS, spend, startDay, timeLeft, unload, walls,
  WAVE_TIMES,
} from "./expedition.mjs";
import { createExpeditionCombat, distance } from "./expedition-combat.mjs";
import { DODGE } from "./combat-tuning.mjs";
import { createBagSlots, createSupplyVisuals } from "./expedition-art.mjs";
import { FOREST_ACTION_TEXT } from "./forest-curios.mjs";
import { SWIM_FLOOR, WATER } from "./land.mjs";
import { pickWalkAction } from "./walk-hud.mjs";

const KIT = "/swamp-walk/mvp/expedition-kit.glb";
const MARKER = "/swamp-walk/mvp/landmark-interact.webp";
const clock = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
// A fish bites somewhere between 6 and 15 seconds after the cast (economy, 13.11).
const BITE = { soonest: 6, latest: 15 };

// The lantern from the clicker: a warm glow at Klyop's side in the dusk and at night, seen from across the water.
function makeLanternGlow() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d");
  const fade = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  fade.addColorStop(0, "rgba(255,226,170,1)");
  fade.addColorStop(0.22, "rgba(255,190,104,.55)");
  fade.addColorStop(1, "rgba(255,160,70,0)");
  g.fillStyle = fade;
  g.fillRect(0, 0, 64, 64);
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  const sprite = (size, attenuate) => {
    const item = new T.Sprite(new T.SpriteMaterial({
      map, color: 0xffd08a, transparent: true, depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: attenuate,
    }));
    item.scale.set(size, size, 1);
    item.renderOrder = 3;
    return item;
  };
  const glow = new T.Group();
  glow.name = "Lantern glow";
  // a halo around the lantern near by, and a spark that keeps its size on screen, so it reads from far away
  glow.add(sprite(1.15, true), sprite(0.028, false));
  glow.visible = false;
  return glow;
}

// The old sortie's trophy (a salvage crate by the door) stays for players who already carried it home.
function makeSalvage() {
  const crate = new T.Group();
  crate.name = "RecoveredSalvage";
  const plank = new T.MeshStandardMaterial({ color: 0x684c2d, roughness: 0.88 });
  const trim = new T.MeshStandardMaterial({ color: 0xa38449, roughness: 0.70 });
  const latch = new T.MeshStandardMaterial({ color: 0xb8bc78, emissive: 0x5c6231, emissiveIntensity: 0.28 });
  function part(material, x, y, z, width, height, depth) {
    const mesh = new T.Mesh(new T.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    crate.add(mesh);
  }
  part(plank, 0, 0.12, 0, 0.39, 0.24, 0.27);
  part(trim, 0, 0.25, 0, 0.41, 0.055, 0.29);
  for (const x of [-0.14, 0.14]) part(trim, x, 0.11, 0.14, 0.035, 0.23, 0.024);
  part(latch, 0, 0.20, 0.149, 0.074, 0.059, 0.033);
  return crate;
}

export function addExpedition({
  scene, layout, floorAt, day, character, clearAttack, cabin, saved, shelter, storage, text, ui, feedback, curios,
  tuneRadio, returnHome, refreshNeeded, refreshShelter, canReach, homeDoor = THRESHOLD.center, handheld = false,
  fishingSite, wake = () => {},
}) {
  const copy = text.expedition;
  const worldCopy = text.sortie;
  const { store: storePoint, bench: benchPoint, ford: fordPoint, amber: amberPoint, nearCache, resinCache } = day.stops;
  const [fordX, fordZ] = day.fordCrossing.entry;
  const fordEntry = { x: fordX, z: fordZ };
  const forestCopy = FOREST_ACTION_TEXT[document.documentElement.lang] ?? FOREST_ACTION_TEXT.en;
  const writer = openExpeditionWriter(storage, navigator.locks, text.economyData);
  const group = new T.Group();
  group.name = "First Landing expedition sites";
  scene.add(group);
  let run, pendingWrite, notice = "", loading = false, armedAmber = false, served = false, lastKey = "";
  let shownBuild = false, dash = [], serial = 0, nextOperation = 0;
  let cast, fishingHint, slotsFor = 0;
  const jumpLabel = ui.jump.textContent;
  const focusButton = ui.focus ?? document.getElementById("swalk-focus");
  const dodgeLabel = ui.dodge.textContent;

  const stamp = (point, tint, radius = 0.52) => {
    const mesh = new T.Mesh(new T.RingGeometry(radius - 0.05, radius, 24), new T.MeshBasicMaterial({
      color: tint, side: T.DoubleSide, transparent: true, opacity: 0.72, depthWrite: false,
    }));
    mesh.position.set(point.x, floorAt(point.x, point.z) + 0.024, point.z);
    mesh.rotation.x = -Math.PI / 2;
    group.add(mesh);
    return mesh;
  };
  const board = stamp(storePoint, 0xffc675);
  const fordMark = stamp(fordPoint, 0x85ddd5, 0.65);
  const fordEntryMark = stamp(fordEntry, 0x85ddd5, 0.55);
  const amberMark = stamp(amberPoint, 0xffc76d, 0.9);
  const benchMark = stamp(benchPoint, 0xeec481);
  const padMarks = PADS.map(point => stamp(point, 0xeec481, 0.63));
  // In the order of dayCaches(): the bank, the resin stump, beyond the ford, the dam (with the workshop).
  const cacheMarks = [nearCache, resinCache, day.stops.fordCache, day.stops.damCache].map(point => stamp(point, 0xffcf7b));
  const lantern = makeLanternGlow();
  group.add(lantern);
  const fishingMark = fishingSite && stamp(fishingSite.action, 0x8cdbd3, .36);
  const fishingFloat = fishingSite && new T.Mesh(new T.SphereGeometry(.045, 8, 6), new T.MeshBasicMaterial({ color: 0xffd28c }));
  if (fishingFloat) {
    fishingFloat.name = "Fishing float";
    fishingFloat.scale.y = 1.5;
    fishingFloat.visible = false;
    group.add(fishingFloat);
  }
  // A small lantern sprite floats over the next place to go; it hides when Klyop is there.
  const marker = new T.Sprite(new T.SpriteMaterial({
    map: new T.TextureLoader().load(MARKER, texture => { texture.colorSpace = T.SRGBColorSpace; }),
    color: 0xffffff, transparent: true, depthWrite: false,
  }));
  marker.scale.set(0.58, 0.58, 1);
  group.add(marker);
  const salvage = makeSalvage();
  const home = cabin.spawn;
  salvage.position.set(home.x - 0.72, floorAt(home.x, home.z) + (cabin.tea ? 0.77 : 0), home.z - 1.12);
  salvage.rotation.y = -0.18;
  salvage.visible = Boolean(saved.trophy);
  group.add(salvage);

  const combat = createExpeditionCombat({
    scene, floorAt, day, character, canReach, clearAttack, feedback,
    onKill({ runId }) {
      if (run?.id !== runId || run.phase !== "day" || run.build || shownBuild) return;
      shownBuild = true;
      showBuild();
    },
  });

  // The kit: models for the board, caches, stock crate, stump, amber and the two defenses.
  let kit = null, kitLoad = null, storeModel, amberModel, cacheModels = [], paintSupplies = () => {}, shelfAmber;
  const boardModelPoint = { x: storePoint.x + 0.22, z: storePoint.z + 0.75 };
  const cratePoint = { x: -.34, z: 26.25 };
  function installMesh(name, point, rotation = 0) {
    const model = kit?.getObjectByName(name)?.clone(true);
    if (!model) return null;
    model.position.set(point.x, point.y ?? floorAt(point.x, point.z), point.z);
    model.rotation.y = rotation;
    group.add(model);
    return model;
  }
  function ensureKit() {
    kitLoad ??= new T.GLTFLoader().loadAsync(KIT).then(({ scene: pack }) => {
      kit = pack;
      storeModel = installMesh("SignalPost", boardModelPoint, 0.34);
      const stockCrate = installMesh("StockCrate", cratePoint,
        Math.atan2(storePoint.x - cratePoint.x, storePoint.z - cratePoint.z));
      installMesh("ForgeStump", { x: benchPoint.x - 0.01, z: benchPoint.z - 0.45 }, 0.34);
      amberModel = installMesh("Amber", { ...amberPoint, y: floorAt(amberPoint.x, amberPoint.z) + 0.26 });
      // Delivered amber rests on the stock crate's rim, a little smaller than the one at the radio hut.
      shelfAmber = installMesh("Amber", { x: cratePoint.x, z: cratePoint.z, y: floorAt(cratePoint.x, cratePoint.z) + 0.25 });
      shelfAmber?.scale.setScalar(0.7);
      cacheModels = cacheMarks.map(({ position }) => installMesh("Cache", position, 0.32));
      const padModels = PADS.map(point => ({
        wall: installMesh("Barricade", point, point.approach === "shore" ? Math.PI / 2 : 0.46),
        trap: installMesh("DefenseTrap", point, 0.46),
      }));
      paintSupplies = createSupplyVisuals(stockCrate, padModels);
      lastKey = "";
    }).catch(error => {
      kitLoad = null;
      console.warn("First Landing kit:", error);
    });
    return kitLoad;
  }
  // The bag's slots follow its size (8, 10 or 12 with the clicker's baskets); drawn again when the size changes.
  let paintBag = () => {};
  function bagSlots(size) {
    if (!ui.supply || size === slotsFor) return;
    ui.supply.querySelector(".walk-supply-art")?.remove();
    paintBag = createBagSlots(ui.supply, size);
    slotsFor = size;
  }
  bagSlots(BAG_SIZE);
  // Back to the scene after a choice, so the tapped button does not keep a focus ring.
  ui.dialog.addEventListener("close", () => document.getElementById("swalk-view")?.focus({ preventScroll: true }));

  function option(label, act, disabled = false, detail = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.disabled = disabled;
    if (detail) {
      const description = document.createElement("small");
      description.textContent = detail;
      button.append(description);
    }
    button.addEventListener("click", () => {
      ui.dialog.close();
      act();
    });
    return button;
  }

  function dialog(title, body, options, bag) {
    ui.dialogTitle.textContent = title;
    ui.dialogBody.textContent = body;
    if (ui.supply) {
      ui.supply.hidden = !bag;
      if (bag) {
        bagSlots(run?.bagSize ?? BAG_SIZE);
        paintBag(bag);
      }
    }
    ui.options.replaceChildren(...options, option(copy.cancel, () => {}));
    if (!ui.dialog.open) ui.dialog.showModal();
  }

  function showBuild() {
    dialog(copy.build, "", BUILDS.map(kind =>
      option(copy.builds[kind][0], () => { if (active(run)) run.build = kind; }, false, copy.builds[kind][1])));
  }

  async function begin() {
    if (loading || pendingWrite || active(run)) return;
    if (refreshNeeded()) { refreshShelter(); return; }
    if (!character.attack) { notice = copy.assetLost; return; }
    loading = true;
    notice = copy.preparing;
    const token = ++serial;
    ensureKit();
    try {
      await combat.prepare();
    } catch (error) {
      if (token !== serial) return;
      console.error("First Landing opponents:", error);
      notice = copy.assetLost;
      loading = false;
      return;
    }
    if (token !== serial) return;
    try {
      const context = await writer.reserve();
      if (token !== serial) { writer.finish(); return; }
      if (!context) { notice = copy.busy; return; }
      // the dam cache opens once the hut's workshop step is built
      const workshop = (text.economyData?.stages ?? []).findIndex(stage => stage.id === "workshop");
      run = startDay({ ...context, workshop: workshop >= 0 && context.stage > workshop }, day.stops);
      run.needs = context.needs;
      shelter.stock = run.stock;
      cast = fishingHint = undefined;
      nextOperation = 0;
      pendingWrite = null;
      notice = "";
      armedAmber = shownBuild = served = false;
      dash = Array.from({ length: context.extraDash ? 2 : 1 }, () => 0);
      combat.resetHealth();
      combat.day(run, layout.fly);
      feedback("beacon");
    } catch {
      if (token !== serial) return;
      pendingWrite = begin;
      notice = copy.saveError;
    } finally {
      if (token === serial) loading = false;
    }
  }

  function write(operation, done) {
    const attempt = () => {
      let value;
      try {
        value = operation();
      } catch {
        pendingWrite = attempt;
        notice = copy.saveError;
        return;
      }
      pendingWrite = null;
      notice = "";
      done?.(value);
    };
    attempt();
  }

  // The end of the day for the clicker. A won night and a trip home before dark first write the walls as they stand;
  // a night lost (only at night) breaks the last standing wall on the clicker's side. A day given up or lost before
  // the night goes as "skipped": no reward and no wall broken. The operation ids are taken once, so a retried write
  // repeats the same events and nothing is paid twice.
  function settle(lostAtNight = false) {
    const won = run.phase === "dawn", home = run.phase === "home";
    const runId = run.id, kills = run.kills, pads = defenseList(run);
    const defense = won || home ? ++nextOperation : 0;
    const result = won ? { won, kills } : { won: false, kills, ...(lostAtNight ? {} : { skipped: true }) };
    write(() => {
      if (defense) writer.settle(runId, "defense", { operationId: defense, pads });
      return writer.settle(runId, "finish", result);
    }, flies => {
      run.flies = flies;
      if (!won) writer.finish();
    });
  }

  // «Домой до темноты»: after unloading at dusk the day ends here, the night does not come.
  function homeBeforeDark() {
    if (pendingWrite || !goHome(run)) return;
    combat.clear();
    armedAmber = false;
    settle();
    feedback("win");
  }

  // What the board says before a day: what the hut's next step still lacks and what the house gives the trip.
  // Read from the save without taking it; the trip itself reads it again under the lock.
  function boardNotes() {
    const data = text.economyData;
    if (!storage || !data) return "";
    try {
      const state = loadSave(storage, data);
      const need = nextHomeNeed(state, data), gear = gearOf(state);
      const lack = need && [[copy.wood, need.wood], [copy.resin, need.resin], [copy.amberWord, need.amber]]
        .filter(([, n]) => n > 0).map(([word, n]) => `${word} ${n}`).join(", ");
      const kit = [
        gear.bag && copy.gearBag.replace("{n}", BAG_SIZE + 2 * gear.bag),
        gear.wrench && copy.gearWrench.replace("{n}", 20 * gear.wrench),
        gear.lantern && copy.gearLantern,
      ].filter(Boolean).join(", ");
      return [lack && copy.needs.replace("{list}", lack), kit && copy.gear.replace("{list}", kit)].filter(Boolean).join("\n");
    } catch {
      return "";
    }
  }

  function deliver() {
    if (!run || !(load(run.bag) || run.bag.amber) || run.phase === "lost") return;
    if (run.phase === "dawn" && run.flies === undefined) return;
    const { amber, wood, resin } = run.bag;
    const runId = run.id, operationId = ++nextOperation;
    write(() => writer.settle(runId, "deposit", { operationId, materials: { wood, resin }, amber }), flies => {
      unload(run);
      if (flies) run.flies = (run.flies ?? 0) + flies;
      if (amber) shelter.amber = true;
      feedback("win");
    });
  }

  function end(reason) {
    const night = run.phase === "night";
    if (reason) fail(run, reason);
    combat.clear();
    armedAmber = false;
    if (ui.dialog.open) ui.dialog.close();
    settle(Boolean(reason) && night);
  }

  function leave(reset) {
    if (loading) { serial++; loading = false; notice = ""; }
    const exit = () => {
      combat.clear();
      writer.finish();
      run = undefined;
      cast = fishingHint = undefined;
      pendingWrite = null;
      notice = "";
      dash = [];
      reset?.();
    };
    if (!active(run)) {
      if (pendingWrite && run) {
        dialog(copy.saveError, "", [option(copy.retry, () => {
          retry();
          if (!pendingWrite) leave(reset);
        })]);
        return;
      }
      if (run?.phase === "dawn" && (load(run.bag) || run.bag.amber)) {
        dialog(copy.leaveTitle, copy.leaveBody, [option(copy.leave, exit)]);
      } else exit();
      return;
    }
    dialog(copy.leaveTitle, copy.leaveBody, [option(copy.leave, () => {
      end("leave");
      if (!pendingWrite) exit();
    })]);
  }

  function repairMenu(target, title, kinds) {
    dialog(title, copy.work, kinds.map(kind => {
      const cost = COST[kind];
      const label = `${copy[kind]} · ${copy.wood} ${cost.wood}${cost.resin ? `, ${copy.resin} ${cost.resin}` : ""}`;
      const full = kind === "wall" && walls(run) >= MOST_WALLS;
      return option(label, () => {
        if (pendingWrite || !canSpend(run, kind, target)) return;
        const runId = run.id, operationId = ++nextOperation;
        // A pad's change also goes to the clicker's list of walls, in the same write: the list is taken from a copy
        // with the change made, so a failed write leaves the day as it was.
        const index = run.pads.indexOf(target), pad = index >= 0 ? ++nextOperation : 0;
        write(() => {
          const spent = writer.settle(runId, "spend", { operationId, materials: cost });
          if (pad) {
            const trial = { ...run, stock: { ...run.stock }, pads: run.pads.map(item => ({ ...item })) };
            spend(trial, kind, trial.pads[index]);
            writer.settle(runId, "defense", { operationId: pad, pads: defenseList(trial) });
          }
          return spent;
        }, () => {
          spend(run, kind, target);
          feedback("knock");
        });
      }, !canSpend(run, kind, target), full ? copy.wallLimit : "");
    }));
  }

  function offer(point, radius, label, use) {
    return { point, radius, face: false, extraReach: handheld ? 0.22 : 0, action: { label, use } };
  }

  // Fishing (candidate C): cast from the edge of the fishing pier, stand still two seconds, the catch is saved.
  function castLine(time) {
    if (!storage || !navigator.locks || typeof crypto.randomUUID !== "function") {
      fishingHint = { text: copy.storageUnavailable, until: time + 7 };
      return;
    }
    cast = { id: crypto.randomUUID(), before: shelter.fish, elapsed: 0, status: "waiting",
      biteAt: BITE.soonest + Math.random() * (BITE.latest - BITE.soonest) };
    wake(fishingSite.cast, time);
    feedback("knock");
  }

  async function saveCatch(time) {
    const operation = cast;
    operation.status = "saving";
    try {
      const result = await recordCatch(storage, navigator.locks, text.economyData, operation);
      if (cast !== operation) return;
      if (!result) {
        operation.status = "retry";
        fishingHint = { text: copy.busy, until: time + 7 };
        return;
      }
      shelter.fish = result.count;
      cast = undefined;
      if (result.stale) fishingHint = { text: copy.fishingStale, until: time + 7 };
      else {
        wake(fishingSite.cast, time);
        feedback("win");
        fishingHint = { text: copy.fishingCatch.replace("{n}", result.count), until: time + 7 };
      }
    } catch {
      if (cast !== operation) return;
      operation.status = "retry";
      fishingHint = { text: copy.saveError, until: time + 7 };
    }
  }

  function stepFishing(player, dt, time) {
    if (cast?.status !== "waiting") return;
    const point = fishingSite.action;
    if (!player.grounded || player.swimming || distance(player, point) > point.radius || Math.abs(player.y - point.y) > .32) {
      cast = undefined;
      fishingHint = { text: copy.fishingCancel, until: time + 7 };
    } else {
      cast.elapsed += dt;
      if (cast.elapsed >= cast.biteAt) saveCatch(time);
    }
  }

  function actionAt(p, time) {
    const candidates = [offer(homeDoor, 1.04, copy.desk, () => leave(returnHome))];
    const store = (label, use) => candidates.push(offer(storePoint, 1.05, label, use));
    const blocked = (a, b) => !clearAttack(a, b, 0.63);
    if (pendingWrite) return { label: copy.retry, use: retry };
    if (!run || ["lost", "dawn", "home"].includes(run.phase)) {
      if (refreshNeeded()) store(copy.newProfile, refreshShelter);
      else if (run?.phase === "dawn" && (load(run.bag) || run.bag.amber)) store(copy.unload, deliver);
      else store(run ? copy.retryRun : copy.start, () => {
        ensureKit();
        dialog(copy.start, [copy.task, boardNotes()].filter(Boolean).join("\n\n"), [
          option(copy.accept, begin, loading),
          ...(run?.phase === "dawn" ? [option(copy.repair, () => repairMenu(run.base, copy.base, ["repair"]))] : []),
        ]);
      });
    } else if (load(run.bag) || run.bag.amber) store(copy.unload, deliver);
    else if (canGoHome(run)) store(copy.start, () => dialog(copy.start, copy.homeBody, [
      option(copy.goHome, homeBeforeDark, false, copy.goHomeDetail),
      ...(run.base.hp < run.base.maxHp ? [option(copy.repair, () => repairMenu(run.base, copy.base, ["repair"]))] : []),
    ]));

    if (run?.phase === "day") {
      for (const cache of run.caches) if (load(cache)) {
        candidates.push(offer(cache, 1.35, copy.take, () => { if (gather(run, cache)) feedback("knock"); }));
      }
      if (shownBuild && !run.build) store(copy.build, showBuild);
    }
    if (run && ["day", "dusk"].includes(run.phase) && !run.amberTaken) {
      candidates.push(offer(amberPoint, 1.35, holdLabel(), () => { armedAmber = true; }));
    }
    if (run && run.phase !== "lost" && load(run.bag)) {
      const activeRun = run;
      const confirmFord = () => dialog(copy.dropTitle, copy.dropBody, [
        option(copy.drop, () => { if (run === activeRun && run.phase !== "lost") dropMaterials(run); }),
      ]);
      candidates.push(offer(fordEntry, 1.48, copy.drop, confirmFord));
      if (run.phase === "night") candidates.push(offer(fordPoint, 1.38, copy.drop, confirmFord));
    }
    if (run && ["dusk", "dawn"].includes(run.phase)) {
      if (run.phase === "dusk") candidates.push(offer(benchPoint, 0.83, copy.bench, () => repairMenu(null, copy.bench, ["forge"])));
      for (const pad of run.pads) {
        if (run.phase === "dawn" && !pad.kind) continue;
        candidates.push(offer(pad, 0.99, pad.kind ? copy.repair : copy.pad, () => repairMenu(pad, copy.pad,
          pad.kind ? ["repair"] : ["wall", "trap"])));
      }
    }
    const first = pickWalkAction(p, candidates, floorAt, blocked);
    if (first) return first;
    const optional = [];
    if (!saved.radio) optional.push(offer(layout.radio, layout.radio.radius, worldCopy.radio, () => {
      saved.radio = saved.shortcut = true;
      tuneRadio();
      saved.save();
      feedback("radio");
    }));
    if (cabin.tea && !active(run) && (!served || combat.health < combat.maxHealth)) optional.push(offer(cabin.tea, 0.92, worldCopy.tea, () => {
      served = true;
      combat.resetHealth();
      feedback("tea");
    }));
    if (!run && !loading && fishingSite && (!cast || cast.status === "retry")) {
      const { action: point } = fishingSite;
      const choice = cast ? offer(point, point.radius, copy.retry, () => saveCatch(time))
        : offer(point, point.radius, copy.fishing, () => castLine(time));
      choice.extraReach = 0;
      optional.push(choice);
    }
    const hollow = curios?.target(p, time);
    if (hollow) optional.push(offer(hollow, 1.08, forestCopy.knock, () => {
      if (curios.use(p, time)) feedback("knock");
    }));
    return pickWalkAction(p, optional, floorAt, blocked);
  }

  function retry() {
    const attempt = pendingWrite;
    pendingWrite = null;
    attempt?.();
  }

  const holdLabel = () => (run?.gear?.lantern ? copy.holdLantern : copy.hold);

  function objective(time) {
    if (notice) return notice;
    if (cast?.status === "waiting") return copy.fishingWait;
    if (cast?.status === "saving") return copy.fishingSaving;
    if (fishingHint && time < fishingHint.until) return fishingHint.text;
    if (!run) return copy.free;
    if (run.phase === "lost") return copy[run.reason] ?? copy.leaveBody;
    if (run.phase === "home") return copy.homeDone;
    if (run.phase === "dawn") return copy.dawn;
    if (run.phase === "night") {
      if (load(run.bag) && !run.discarded) return copy.fordHint;
      const next = WAVE_TIMES[run.nextWave] - run.elapsed;
      if (run.support.radio && next > 0 && next <= 2 + run.support.radio) return copy.warning;
      return copy.night;
    }
    if (armedAmber) return `${holdLabel()} · ${Math.min(run.amberHold, Math.floor(run.amberProgress))}/${run.amberHold}`;
    if (run.bag.amber) return copy.amber;
    return run.phase === "day" ? copy.scavenge : copy.dusk;
  }

  const bagLabel = (title = true) => run && `${title ? `${copy.bag} ` : ""}${load(run.bag)}/${run.bagSize}: ${copy.wood} ${run.bag.wood}, ${copy.resin} ${run.bag.resin}${run.bag.amber ? " · ◆" : ""}`;
  const stockLabel = () => run && `${copy.stock}: ${copy.wood} ${run.stock.wood}, ${copy.resin} ${run.stock.resin} · ${copy.base} ${run.base.hp}/${run.base.maxHp}`;

  function target() {
    if (!run || ["lost", "dawn", "home"].includes(run.phase)) return storePoint;
    if (run.phase === "night") return { ...storePoint, route: day.routes.lateDeck, waterRoute: day.routes.ford };
    if (run.bag.amber || run.phase === "dusk" || load(run.bag)) return storePoint;
    // the bank first, then whatever still has something and fits in the bag; the far caches lie on the way to the amber
    const cache = load(run.bag) < run.bagSize && run.caches.find(item => item.wood || item.resin);
    if (!cache) return { ...amberPoint, route: day.routes.amber };
    return { ...cache, route: cache === run.caches[0] || cache === run.caches[1] ? day.routes.near : day.routes.amber };
  }

  function draw(p, time, vault, bank, deckReady = false) {
    const action = actionAt(p, time);
    const phase = run?.phase ?? "free";
    const seconds = Math.ceil(timeLeft(run));
    const traversal = deckReady ? worldCopy.deckReady
      : !action && (vault ? worldCopy.vaultReady : bank ? worldCopy.bankReady : "");
    const label = traversal || action?.label || "";
    const bags = bagLabel(), stock = stockLabel();
    const carried = run && `${copy.recovered}: ${copy.wood} ${run.deliveredMaterials.wood}, ${copy.resin} ${run.deliveredMaterials.resin}`;
    const tally = run?.phase === "dawn" && run.flies !== undefined ? `${carried} · +${run.flies} ${copy.flies}`
      : run?.phase === "home" ? carried : "";
    const hint = objective(time);
    const injured = combat.hurt > 0;
    const readyDashes = dash.filter(n => n <= 0).length;
    const armed = combat.nearFoe(p) || p.swing != null;
    const attackAvailable = Boolean(character.attack) && armed && combat.canSwing(p);
    const dodgeAvailable = armed && !p.swimming && !p.traversal && !p.mantle && !p.shoreClimb;
    const held = Boolean(combat.focus);
    const focusAvailable = held || (!p.swimming && combat.canFocus(p));

    const key = JSON.stringify([phase, seconds, hint, label, !!action, !!traversal, deckReady, combat.health, injured,
      bags, stock, tally, shelter.amber, readyDashes, attackAvailable, dodgeAvailable, p.dodgeCooldown > 0,
      focusAvailable, held]);
    if (key !== lastKey) {
      lastKey = key;
      ui.panel.dataset.phase = phase;
      ui.panel.dataset.hit = String(injured);
      ui.phase.textContent = copy.phases[phase] + (active(run) ? ` · ${clock(seconds)}` : "");
      if (ui.objective.textContent !== hint) ui.objective.textContent = hint;
      ui.health.textContent = "●".repeat(combat.health) + "○".repeat(combat.maxHealth - combat.health);
      ui.health.setAttribute("aria-label", `${worldCopy.health} ${combat.health} / ${combat.maxHealth}`);
      ui.bag.hidden = ui.stock.hidden = !run;
      ui.bag.textContent = bags ?? "";
      ui.stock.textContent = stock ?? "";
      ui.result.hidden = !(tally || shelter.amber);
      ui.result.textContent = [tally, shelter.amber ? copy.trophy : ""].filter(Boolean).join(" · ");
      ui.prompt.hidden = !label;
      ui.prompt.textContent = label;
      ui.prompt.toggleAttribute("data-vault", Boolean(traversal));
      ui.prompt.toggleAttribute("data-deck-climb", deckReady);
      ui.jump.textContent = deckReady ? worldCopy.deckClimb : jumpLabel;
      ui.jump.toggleAttribute("data-deck-climb", deckReady);
      ui.interact.hidden = !action;
      ui.interact.textContent = action?.label ?? "";
      ui.inventory.hidden = !run;
      ui.attack.hidden = !attackAvailable;
      ui.dodge.hidden = !dodgeAvailable;
      // With the amber trophy there are two rolls in a row: the label says how many are ready.
      ui.dodge.textContent = active(run) && dash.length > 1 ? `${dodgeLabel} ${readyDashes}` : dodgeLabel;
      ui.dodge.toggleAttribute("data-cooling", (active(run) && !readyDashes) || p.dodgeCooldown > 0);
      if (focusButton) {
        focusButton.hidden = !focusAvailable;
        focusButton.setAttribute("aria-pressed", String(held));
      }
    }
    if (fishingMark) fishingMark.visible = phase === "free";
    if (fishingFloat) {
      fishingFloat.visible = cast?.status === "waiting";
      // the float bobs on the ripples and dips under just before the bite
      const bite = fishingFloat.visible && cast.elapsed > cast.biteAt - .7 ? -.045 : 0;
      if (fishingFloat.visible) fishingFloat.position.set(fishingSite.cast.x, WATER + .02 + bite + Math.sin(time * 11) * .015, fishingSite.cast.z);
    }
    lantern.visible = Boolean(run?.gear?.lantern && ["dusk", "night"].includes(phase));
    if (lantern.visible) {
      const side = (p.heading ?? 0) + Math.PI / 2;
      lantern.position.set(p.x + Math.sin(side) * .26, p.y + .78 + Math.sin(time * 3.1) * .02, p.z + Math.cos(side) * .26);
    }
    const goal = target();
    const goalY = floorAt(goal.x, goal.z);
    marker.visible = phase !== "night" && distance(p, goal) > 2.2;
    marker.position.set(goal.x, goalY + 1.24 + Math.sin(time * 2.2) * 0.12, goal.z);
    board.material.opacity = 0.68 + 0.19 * Math.sin(time * 2.9);
    fordMark.visible = phase === "night";
    fordEntryMark.visible = Boolean(run && phase !== "lost" && load(run.bag));
    amberMark.visible = Boolean(run && ["day", "dusk"].includes(phase) && !run.amberTaken);
    if (amberModel) amberModel.visible = amberMark.visible;
    if (shelfAmber) shelfAmber.visible = Boolean(shelter.amber);
    benchMark.visible = phase === "dusk";
    for (let index = 0; index < cacheMarks.length; index++) {
      const cache = run?.caches[index];
      const visible = phase === "day" && Boolean(cache) && load(cache) > 0;
      cacheMarks[index].visible = visible;
      if (cacheModels[index]) cacheModels[index].visible = visible;
    }
    padMarks.forEach((mark, index) => {
      const pad = run?.pads[index];
      mark.visible = phase === "dusk" || Boolean(pad?.kind && pad.hp > 0 && phase !== "lost");
    });
    paintSupplies({ stock: run?.stock ?? shelter.stock, pads: run?.pads, phase });
    salvage.visible = Boolean(saved.trophy);
  }

  addEventListener("pagehide", () => { serial++; cast = undefined; combat.clear(); writer.close(); }, { once: true });
  // ?debug: the fight's state for automated checks, as window.__walkCombat and (once main.mjs made it) __walk.combat.
  if (new URLSearchParams(location.search).has("debug")) {
    window.__walkCombat = combat.debug;
    queueMicrotask(() => { if (window.__walk) window.__walk.combat = combat.debug; });
  }
  return {
    get phase() { return run?.phase ?? "free"; },
    get running() { return active(run); },
    get modal() { return ui.dialog.open; },
    get saving() { return Boolean(pendingWrite && active(run)); },
    get pending() { return Boolean(pendingWrite); },
    get run() { return run; },
    get loaded() { return Boolean(run && run.phase !== "lost" && load(run.bag) > 0); },
    get kitReady() { return Boolean(kit); },
    get health() { return combat.health; },
    get lastContact() { return combat.lastContact; },
    get fishing() { return cast?.status ?? null; },
    draw, leave, target, focusTargets: combat.focusTargets,
    // The held target for the camera ({ x, y, z } or null), see controls.updateCamera(heading, dt, focusYaw).
    get focus() { return combat.focus; },
    resetHealth: combat.resetHealth,
    injure(p) { combat.hitPlayer(p); },
    allowMovement(x, z) {
      return floorAt(x, z) >= SWIM_FLOOR - .02 && fordAllowsMovement(day.fordCrossing, x, z);
    },
    // Called by main.mjs every step before Klyop moves: the focus (strafe around the target), then the roll charges.
    dashIntent(intent, p, dt) {
      if (!ui.dialog.open) intent = combat.aim(intent, p);
      for (let i = 0; i < dash.length; i++) dash[i] = Math.max(0, dash[i] - dt);
      if (!intent.dodge || !active(run)) return intent;
      const index = dash.indexOf(0);
      if (index === -1) return { ...intent, dodge: false };
      if (p.grounded && !p.swimming && p.y >= WATER && !p.traversal && p.dodgeCooldown <= dt) dash[index] = DODGE.recharge;
      return intent;
    },
    // ?debug: jump the day clock to just before a phase, so a check need not wait two minutes of daylight.
    skipTo(phase) {
      if (!active(run)) return false;
      const at = { dusk: 120, night: 150, dawn: 210 }[phase];
      if (at == null) return false;
      const tick = Math.round(at * 90) - 1;
      if (tick <= run.tick) return false;
      run.tick = tick;
      return true;
    },
    step(p, intent, dt, time) {
      if (ui.dialog.open) return true;
      if (intent.inventory && run && !pendingWrite) dialog(copy.bag, `${bagLabel(false)}\n${stockLabel()}`, [], run.bag);
      else if (intent.interact) actionAt(p, time)?.use();
      if (ui.dialog.open) return true;
      if (!active(run)) {
        if (!run) stepFishing(p, dt, time);
        combat.step(null, p, intent, dt);
        return combat.health > 0 || run?.phase === "lost";
      }
      if (pendingWrite) return true;
      if (armedAmber) {
        const present = p.grounded && !p.swimming && distance(p, amberPoint) < 1.45
          && Math.abs(p.y - floorAt(amberPoint.x, amberPoint.z)) < 0.45;
        if (holdAmber(run, dt, present)) { armedAmber = false; feedback("win"); }
        else if (!present) armedAmber = false;
      }
      advanceExpedition(run, index => {
        if (index === 0) armedAmber = false;
        combat.wave(run, index);
      });
      if (run.phase === "dawn") { end(); return true; }
      combat.step(run, p, intent, dt);
      if (combat.health <= 0 || run.base.hp <= 0 || run.combatError) {
        end(run.combatError ? "assetLost" : combat.health <= 0 ? "heroLost" : "baseLost");
        return false;
      }
      return true;
    },
  };
}
