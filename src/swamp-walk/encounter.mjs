import * as T from "./vendor/three.mjs";
import { createBeggar } from "./beggar.mjs";
import { createFly } from "./fly.mjs";
import { FOREST_ACTION_TEXT } from "./forest-curios.mjs";
import { createProximityActor } from "./proximity.mjs";
import { createSortie, SORTIE_TEXT } from "./sortie.mjs";
import { pickWalkAction, walkObjectiveHint } from "./walk-hud.mjs";
import { LANDMARKS, WATER } from "./land.mjs";

const ART = "/swamp-walk/mvp/";
const HEALTH = 3;
const distance = (player, point) => Math.hypot(player.x - point.x, player.z - point.z);

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

export function addEncounter({ scene, layout, floorAt, character, ui, copy, cabin, saved, feedback, canReach, clearAttack, tuneRadio, curios }) {
  const sortie = createSortie();
  const lang = document.documentElement.lang;
  const lines = SORTIE_TEXT[lang] ?? SORTIE_TEXT.en;
  const forestText = FOREST_ACTION_TEXT[lang] ?? FOREST_ACTION_TEXT.en;
  const beacon = layout.beacon;
  const radio = layout.radio ?? { ...LANDMARKS.find(place => place.id === "radio"), radius: 2.65 };
  const home = cabin.spawn;
  const actors = new T.Group();
  actors.visible = false;
  scene.add(actors);

  const ring = new T.Mesh(new T.RingGeometry(0.61, 0.68, 36), new T.MeshBasicMaterial({
    color: 0xffc778, side: T.DoubleSide, transparent: true, depthWrite: false, opacity: 0.66,
  }));
  ring.position.set(beacon.x, floorAt(beacon.x, beacon.z) + 0.025, beacon.z);
  ring.rotation.x = -Math.PI / 2;
  scene.add(ring);
  const marker = new T.Sprite(new T.SpriteMaterial({
    map: new T.TextureLoader().load(ART + "landmark-interact.webp", texture => {
      texture.colorSpace = T.SRGBColorSpace;
    }),
    color: 0xffffff, transparent: true, depthWrite: false,
  }));
  marker.position.set(beacon.x, ring.position.y + 1.24, beacon.z);
  marker.scale.set(0.58, 0.58, 1);
  scene.add(marker);
  const prize = makeSalvage();
  const cargo = prize.clone();
  prize.position.set(home.x - 0.72, floorAt(home.x, home.z) + (cabin.tea ? 0.77 : 0), home.z - 1.12);
  prize.rotation.y = -0.18;
  prize.visible = saved.trophy;
  cargo.visible = false;
  scene.add(prize, cargo);

  let fly, flyToken, pending = false, failed = false;
  let health = HEALTH, damageTime = 0, signature = "";
  let carrying = false, served = false, radioNote = false;
  let targetPlayer = null, curioNoteUntil = 0;

  function takeHit() {
    if (damageTime > 0 || !health) return;
    health--;
    damageTime = 0.30;
    feedback("hit");
  }
  const patrol = layout.patrol && character.attack ? createProximityActor({
    create: createBeggar, THREE: T, GLTFLoader: T.GLTFLoader, scene, loadRadius: 6,
    ...layout.patrol, url: ART + "beggar-web.glb", floorAt, canReach,
    onHit: () => {
      if (targetPlayer && clearAttack(patrol.position, targetPlayer, 0.84)) takeHit();
    },
    onLoadError: error => console.warn("First Landing patrol:", error),
  }) : null;

  function warm() {
    if (pending || fly || failed || !character.attack) return;
    pending = true;
    createFly({
      THREE: T, GLTFLoader: T.GLTFLoader, scene: actors, url: ART + "fly-web.glb",
      ...layout.fly, floorAt: (x, z) => Math.max(WATER, floorAt(x, z)), canReach,
      onHit: () => {
        if (targetPlayer && clearAttack(fly.position, targetPlayer, 0)) takeHit();
      },
    }).then(value => { fly = value; }).catch(error => {
      failed = true;
      console.warn("First Landing encounter:", error);
    }).finally(() => { pending = false; });
  }

  function reset() {
    sortie.reset();
    actors.visible = false;
    fly?.reset();
    patrol?.reset();
    flyToken = null;
    carrying = served = radioNote = false;
    curioNoteUntil = 0;
    health = HEALTH;
    damageTime = 0;
    prize.visible = saved.trophy;
  }

  const canStand = (player) => player.grounded && !player.swimming && !player.traversal;
  const patrolThreat = player => patrol?.loaded && !patrol.defeated && distance(player, patrol.position) < 5.6;
  function actionAt(player, time) {
    const candidates = [];
    if (carrying) candidates.push({ action: "deposit", point: home, radius: 1.50 });
    if (cabin.tea && (!served || health < HEALTH)) candidates.push({ action: "tea", point: cabin.tea, radius: 0.92 });
    const sortieAction = fly && sortie.action(true);
    if (sortieAction) candidates.push({ action: sortieAction, point: beacon, radius: 1.62 });
    if (!saved.radio) candidates.push({ action: "radio", point: radio, radius: radio.radius });
    const blocked = (from, to) => !clearAttack(from, to, 0.63);
    const primary = pickWalkAction(player, candidates, floorAt, blocked);
    if (primary) return primary;
    const hollow = curios?.target(player, time);
    return hollow ? pickWalkAction(player, [{ action: "knock", point: hollow, radius: 1.08 }], floorAt, blocked) : null;
  }

  function interact(player, time) {
    const action = actionAt(player, time);
    if (action === "deposit") {
      carrying = false;
      saved.trophy = prize.visible = true;
      saved.save();
      feedback("win");
    } else if (action === "tea") {
      health = HEALTH;
      served = true;
      feedback("tea");
    } else if (action === "radio") {
      saved.radio = saved.shortcut = radioNote = true;
      tuneRadio();
      saved.save();
      feedback("radio");
    } else if (action === "knock") {
      if (curios.use(player, time)) {
        curioNoteUntil = time + 3;
        feedback("knock");
      }
    } else if (action) {
      const event = sortie.interact(true);
      if (event?.type === "start") {
        flyToken = event.flyToken;
        fly.reset();
        actors.visible = true;
      } else if (event?.type === "complete") carrying = true;
      feedback("beacon");
    }
  }

  const jumpLabel = ui.jump.textContent;
  function paint(player, time, vaultReady, bankReady, deckReady) {
    const action = actionAt(player, time);
    const injured = damageTime > 0;
    const phase = carrying ? "carrying" : sortie.state === "complete" && saved.trophy ? "delivered"
      : sortie.state === "active" && !flyToken ? "return" : sortie.state;
    const hint = failed || !character.attack ? copy.unavailable
      : phase === "carrying" ? copy.carry
      : phase === "delivered" ? copy.delivered
      : phase === "return" ? copy.return
      : phase === "active" ? (distance(player, layout.fly) > 7.3 ? copy.approach : copy.fight)
      : patrolThreat(player) ? copy.patrol
      : pending ? copy.preparing
      : curioNoteUntil > time ? forestText.rustle : served ? copy.teaDone : radioNote ? copy.radioOn : lines.idle;
    const traversal = deckReady ? copy.deckReady : !action && (vaultReady ? copy.vaultReady : bankReady ? copy.bankReady : "");
    const armed = Boolean(flyToken || patrolThreat(player));
    const key = JSON.stringify([phase, action, health, hint, injured, traversal, armed, deckReady]);
    if (key === signature) return;
    signature = key;
    ui.panel.dataset.phase = phase;
    ui.panel.dataset.hit = String(injured);
    ui.objective.textContent = walkObjectiveHint(document.documentElement.lang, action, hint);
    ui.health.textContent = "●".repeat(health) + "○".repeat(HEALTH - health);
    ui.health.setAttribute("aria-label", `${copy.health} ${health} / ${HEALTH}`);
    const label = action ? lines[action] ?? copy[action] ?? forestText[action] : "";
    ui.prompt.textContent = traversal || label;
    ui.prompt.toggleAttribute("data-vault", Boolean(traversal));
    ui.prompt.toggleAttribute("data-deck-climb", deckReady);
    ui.prompt.hidden = !action && !traversal;
    ui.jump.textContent = deckReady ? copy.deckClimb : jumpLabel;
    ui.jump.toggleAttribute("data-deck-climb", deckReady);
    ui.interact.hidden = !action;
    ui.interact.textContent = label;
    ui.attack.hidden = !armed;
    ui.dodge.hidden = !armed;
  }

  return {
    reset,
    injure: takeHit,
    step(player, intent, dt, time) {
      if (distance(player, beacon) < 11 || distance(player, layout.fly) < 11) warm();
      damageTime = Math.max(0, damageTime - dt);
      if (intent.interact) interact(player, time);
      if (!canStand(player)) player.swing = null;
      const timing = character.attack;
      if (timing && intent.attack && (flyToken || patrolThreat(player)) && canStand(player) && player.swing === null) {
        player.swing = 0;
        feedback("swing");
      }
      const target = { x: player.x, y: player.y, z: player.z, yaw: player.heading };
      targetPlayer = target;
      if (player.swing !== null && timing) {
        const before = player.swing;
        player.swing += dt;
        if (before < timing.contact && player.swing >= timing.contact) {
          if (flyToken && clearAttack(fly.position, target, 0) && fly.strike(target)) {
            feedback("contact");
            if (fly.defeated && sortie.defeatFly(flyToken)) flyToken = null;
          } else if (patrol?.loaded && clearAttack(patrol.position, target, 0.84) && patrol.strike(target)) {
            feedback("contact");
          }
        }
        if (player.swing >= timing.duration) player.swing = null;
      }
      if (actors.visible) fly.update(dt, target);
      if (patrol && (patrol.loaded || !cabin.contains(player.x, player.z))) patrol.update(dt, target);
      if (damageTime > 0) player.hurt = 0.30 - damageTime;
      else player.hurt = null;
      return health > 0;
    },
    draw(player, time, vaultReady, bankReady, deckReady = false) {
      paint(player, time, vaultReady, bankReady, deckReady);
      const cleared = sortie.state === "complete";
      marker.visible = !cleared && (!flyToken || distance(player, fly.position) > 6.4);
      ring.visible = !cleared && !flyToken;
      const destination = flyToken ? fly.position : ring.position;
      marker.position.set(destination.x, destination.y + 1.24 + Math.sin(time * 2.2) * 0.12, destination.z);
      ring.material.opacity = 0.54 + 0.23 * Math.sin(time * 2.2);
      ring.material.color.setHex(flyToken ? 0xea8d66 : 0xffc778);
      cargo.visible = carrying || sortie.state === "active" && !flyToken;
      if (carrying) {
        cargo.position.set(player.x - Math.sin(player.heading) * 0.27, player.y + 0.88,
          player.z - Math.cos(player.heading) * 0.27);
        cargo.rotation.y = player.heading + Math.PI;
      } else {
        cargo.position.copy(ring.position);
        cargo.rotation.y = -0.18;
      }
    },
    target() {
      if (carrying) return home;
      if (flyToken) return fly.position;
      return sortie.state !== "complete" ? beacon : null;
    },
  };
}
