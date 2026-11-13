import { owned, roomOpen } from "./engine.mjs";

// Where each building stands (owner, 13.11: «расположить органично… дизайнером интерьера»): a place with a meaning
// and the hut's scale, by building era on the shore and by room inside. [x, bottom, height, z, flags] in % of the
// painting (rooms: of the close-up). Flags: "ground" - stands on the deck or the floor, gets a contact shadow;
// "back" - behind the hut's walls and roof (only its top shows).
// Safe band, measured at 412×892, 1366, 1440 and 1920: x 19.5–86.5 (a phone shows 10.7–89.3 and keeps the room
// buttons in a column at x < 19, a count badge sticks out on the right), bottom ≥ 11 (room buttons bottom left and
// the vibe meter bottom right on desktop and phone), top ≤ 72 (the counter and the rank at the top), Klyop's body in
// the middle. So the left bank is tech (the laptop and its antenna), the right one is life (flytrap, beaver).
// Sketch: docs/redesign/clicker-layout.png.
const SHORE = {
  // the open tussock: the laptop hummock on the left with its reed antenna in the water behind it; the flytrap's pot
  // on the island's right end, the beaver dam in the water beyond it
  0: { tussock: [26, 11, 16, 7], antenna: [26, 29, 22, 2], flytrap: [71, 11, 14, 7], beaver: [80, 20, 13, 3] },
  // the deck and its posts: the flytrap moves onto the deck's corner by the right post
  1: { tussock: [26, 11, 16, 7], antenna: [26, 29, 22, 2], flytrap: [70, 14, 13, 8, "ground"], beaver: [80, 22, 12, 3] },
  // the closed hut: the antenna stands behind it and shows its dish over the roof, the flytrap waits by the door,
  // the dam comes to the front water at the right
  2: { tussock: [25, 11, 15, 7], antenna: [76, 33, 36, 1, "back"], flytrap: [67, 17, 12, 8, "ground"], beaver: [82, 12, 11, 7] },
  // the furnished hut is part of the painting: nothing in front of its room; the antenna in the reeds at the right
  3: { tussock: [25, 11, 15, 7], antenna: [81, 30, 32, 3], flytrap: [70, 14, 12, 8, "ground"], beaver: [83, 12, 10, 7] }
};
const ROOMS = {
  // a work corner by the window for the stump computer, a reading corner by the desk lamp for the frogs
  workshop: { stump: [76, 11, 26, 5, "ground"], review: [29, 11, 20, 6, "ground"] },
  // the radio set on the floor by the bench, next to the tea (its bottom 7% is clipped: the base shows at 12%)
  radio: { radio: [74, 10, 26, 5, "ground"] },
  // the peat server by the desk against the left wall (its swamp water, the bottom 15%, is clipped indoors)
  server: { peat: [29, 6, 32, 5, "ground"] },
  office: {}
};

const STEP_DIR = "/brand/swamp/steps/";
const painting = (name) => `/brand/swamp/${name}.webp`;

// What the shore shows after `count` built steps (content/swamp-v2.json art.steps, cut by scripts/swamp-steps.py):
// the painting underneath (it changes when a step brings a new one), the dimmed room inside the hut, the built parts,
// and the next step (for the card). Steps of later eras without pictures yet show nothing.
export function shoreArt(count, data) {
  const steps = data.art.steps || {};
  const built = data.stages.slice(0, count);
  let start = 0, base = null, dark = null;
  built.forEach((stage, i) => {
    const step = steps[stage.id];
    if (step?.base) { start = i; base = step.base; dark = step.dark || null; }
  });
  const hidden = new Set(built.slice(start).flatMap((stage) => steps[stage.id]?.hides || []));
  const layers = built.slice(start).map((stage) => stage.id).filter((id) => steps[id]?.layer && !hidden.has(id));
  const next = data.stages[count];
  const step = next && steps[next.id];
  const sameEra = !!(step?.layer && !step.base);
  // The room stays dim only while something inside is still to come; after the last corner it is fully lit.
  return { base, dark: sameEra ? dark : null, layers, ghost: sameEra ? next.id : null, next: next?.id ?? null };
}

const layerHtml = (name, className = "") => `<span class="sw-layer ${className}" style="--src:url('${STEP_DIR}${name}.webp');--src-m:url('${STEP_DIR}${name}-960.webp')"></span>`;
const warm = new Set();
const preload = (url) => { if (url && !warm.has(url)) { warm.add(url); const image = new Image(); image.src = url; } };

export function createScene({ world, houses, housesBack, rooms, data, text, producerLabels, onRoom, onBackdrop }) {
  const shelter = world.querySelector(".sw-shelter");
  const backdrop = world.querySelector(".sw-backdrop");
  let signature = "", lastStage = null;

  // Rooms are small round buttons on the scene itself: open ones show their picture, closed ones a dark silhouette
  // (tap: Klyop says what opens it). The name of the current room sits next to them.
  rooms.innerHTML = `${data.rooms.map((room) => `<button type="button" class="sw-door" data-room="${room.id}">
    <img src="/brand/swamp/${room.icon}.webp" alt="" draggable="false" loading="lazy"></button>`).join("")}<span class="sw-room-name"></span>`;
  const buttons = [...rooms.querySelectorAll(".sw-door")];
  const roomName = rooms.querySelector(".sw-room-name");
  rooms.addEventListener("click", (event) => {
    const button = event.target.closest(".sw-door");
    if (button) onRoom(button.dataset.room);
  });

  return function draw(state, freshBuilding) {
    let openCount = 0;
    for (const button of buttons) {
      const { room } = button.dataset;
      const open = roomOpen(state, data, room);
      if (open) openCount++;
      // closed rooms are not shown: dark circles over the water read as stains (owner, 12.11)
      button.hidden = !open;
      button.setAttribute("aria-pressed", String(state.room === room));
      const label = open ? text.rooms[room] : `${text.rooms[room]}: ${text.roomHints[room]}`;
      if (button.getAttribute("aria-label") !== label) { button.setAttribute("aria-label", label); button.title = label; }
    }
    // Until a second room opens there is nothing to switch, so the row stays hidden.
    rooms.hidden = openCount < 2;
    if (roomName.textContent !== text.rooms[state.room]) roomName.textContent = text.rooms[state.room];
    const key = JSON.stringify([state.room, state.stage, state.own]);
    if (key === signature) return;
    signature = key;
    world.dataset.room = state.room;
    world.dataset.stage = String(state.stage);
    // How big Klyop stands depends on what is built around him (swamp.css, data-era): the open tussock, the deck with
    // posts, the closed hut with a door, the furnished hut he walks inside.
    const built = new Set(data.stages.slice(0, state.stage).map(({ id }) => id));
    world.dataset.era = built.has("floor") ? "3" : built.has("awning") ? "2" : built.has("deck") ? "1" : "0";
    const steps = data.art.steps || {};
    const view = data.rooms.find((room) => room.id === state.room)?.view;
    const background = view ? painting(view.image) : null;
    const art = state.room === "shore" ? shoreArt(state.stage, data) : null;
    const source = background || (art?.base ? painting(art.base) : data.art.background);
    // a room is a close-up of the hut painting: scale it up and move its centre into the middle of the scene
    if (view) {
      const at = (c) => `${((c * view.zoom - 0.5) / (view.zoom - 1) * 100).toFixed(2)}%`;
      backdrop.style.setProperty("--sw-size", `${view.zoom * 100}% ${view.zoom * 100}%`);
      backdrop.style.setProperty("--sw-pos", `${at(view.x)} ${at(view.y)}`);
    } else {
      backdrop.style.removeProperty("--sw-size");
      backdrop.style.removeProperty("--sw-pos");
    }
    world.dataset.dim = String(!!view?.dim);
    const mobileSource = source.replace(/.webp$/, "-960.webp");
    // The previous painting stays underneath until the new one has loaded, so the scene never flashes empty.
    const previous = backdrop.style.getPropertyValue("--sw-background");
    if (previous && previous !== `url("${source}")`) {
      backdrop.style.setProperty("--sw-previous", previous);
      backdrop.style.setProperty("--sw-mobile-previous", backdrop.style.getPropertyValue("--sw-mobile-background"));
    }
    backdrop.style.setProperty("--sw-background", `url("${source}")`);
    backdrop.style.setProperty("--sw-mobile-background", `url("${mobileSource}")`);
    world.dataset.artRoom = String(!!background);
    // the living backdrop (backdrop-gl.mjs) moves the shore painting; the rooms keep the still close-up
    onBackdrop?.(source, art?.base === "v2-stage-3" ? "stage3" : "bg", state.room === "shore");
    world.dataset.stageArt = String(!!art?.base);
    const fresh = lastStage !== null && state.stage === lastStage + 1 ? data.stages[state.stage - 1]?.id : null;
    lastStage = state.stage;
    shelter.innerHTML = art ? [
      art.dark ? layerHtml(art.dark, "sw-dark") : "",
      // the next part is shown only as a silhouette in the "Next build" card: in the scene a grey shape read as a stub
      ...art.layers.map((id) => layerHtml(steps[id].layer, id === fresh ? "new" : ""))
    ].join("") : "";
    // When the next step brings a new painting, fetch it now so building it shows at once.
    const coming = art?.next && steps[art.next];
    if (coming?.base) {
      const phone = matchMedia("(max-width: 900px)").matches ? "-960" : "";
      preload(`/brand/swamp/${coming.base}${phone}.webp`);
      for (const name of [coming.dark, coming.layer]) if (name) preload(`${STEP_DIR}${name}${phone}.webp`);
    }
    const anchors = state.room === "shore" ? SHORE[world.dataset.era] : ROOMS[state.room];
    const front = [], back = [];
    for (const building of data.buildings) {
      const count = owned(state, building.id), spot = anchors?.[building.id];
      if (building.room !== state.room || count < 1 || !spot) continue;
      const [x, bottom, height, z, flag = ""] = spot;
      // a few more of the same make it a little bigger, never out of scale with the hut
      const size = height * (1 + Math.min(0.08, Math.log10(count) * 0.04));
      const classes = ["sw-house", building.id === freshBuilding ? "new" : "", flag, state.room === "shore" ? "" : "indoor"].filter(Boolean).join(" ");
      // Only the count sits on the picture; the name is in the shop list (names over the art covered each other).
      (flag === "back" ? back : front).push(`<div class="${classes}" data-id="${building.id}" title="${producerLabels[building.id]}" style="left:${x}%;bottom:${bottom}%;height:${size.toFixed(1)}%;z-index:${z}">
        <img src="/brand/swamp/${building.id}.webp" alt="" draggable="false" decoding="async">${count > 1 ? `<span class="sw-n num">×${count}</span>` : ""}</div>`);
    }
    houses.innerHTML = front.join("");
    housesBack.innerHTML = back.join("");
  };
}
