import { owned, roomOpen } from "./engine.mjs";

// Each anchor is on dry ground or floorboards in its own room: [x, bottom, height, z-index] in % of the painting.
// On a phone the painting is cut by about a tenth on each side, so the shore keeps its buildings within 13–87%.
const ANCHORS = {
  shore: { tussock: [21, 6, 24, 7], antenna: [15, 21, 36, 3], flytrap: [79, 6, 22, 7], beaver: [81, 22, 19, 3] },
  // inside the hut the buildings stand on the floor, left and right of Klyop
  workshop: { stump: [22, 2, 42, 5], review: [76, 2, 34, 6] },
  radio: { radio: [75, -3, 48, 5] },
  server: { peat: [22, -8, 56, 5] },
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

export function createScene({ world, houses, rooms, data, text, producerLabels, onRoom }) {
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
    houses.innerHTML = data.buildings.filter((building) => building.room === state.room && owned(state, building.id) > 0).map((building) => {
      const [x, bottom, height, z] = ANCHORS[state.room][building.id];
      const count = owned(state, building.id);
      const size = height * (1 + Math.min(0.16, Math.log10(count) * 0.08));
      // Only the count sits on the picture; the name is in the shop list (names over the art covered each other).
      return `<div class="sw-house${building.id === freshBuilding ? " new" : ""}" data-id="${building.id}" title="${producerLabels[building.id]}" style="left:${x}%;bottom:${bottom}%;height:${size.toFixed(1)}%;z-index:${z}">
        <img src="/brand/swamp/${building.id}.webp" alt="" draggable="false" decoding="async">${count > 1 ? `<span class="sw-n num">×${count}</span>` : ""}</div>`;
    }).join("");
  };
}
