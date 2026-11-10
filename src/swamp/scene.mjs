import { owned, roomOpen } from "./engine.mjs";

// Each anchor is on dry ground or floorboards in its own room.
const ANCHORS = {
  shore: { tussock: [18, 3, 28, 7], antenna: [10, 22, 40, 3], flytrap: [82, 4, 25, 7], beaver: [83, 24, 24, 3] },
  workshop: { stump: [40, 22, 34, 5], review: [66, 20, 29, 6] },
  radio: { radio: [75, 14, 48, 5] },
  server: { peat: [24, 12, 45, 5] },
  office: {}
};

// The existing paintings use the same composition. Reveal the earned part of each painting.
const PAINTED = {
  deck: 1, plank: 1, awning: 2, wall_l: 2, wall_r: 2,
  window_hole: 2, window: 2, door: 2, floor: 2, furniture: 3, chair: 3
};

export function createScene({ world, houses, doors, stageStatus, data, text, producerLabels, onRoom }) {
  const shelter = world.querySelector(".sw-shelter");
  const backdrop = world.querySelector(".sw-backdrop");
  const stageLabel = stageStatus.querySelector(".sw-stage-label");
  const nextLabel = stageStatus.querySelector(".sw-stage-next");
  let signature = "";

  doors.innerHTML = `<h2>${text.ui.locations}</h2><div class="sw-open-rooms">${data.rooms.map((room) => `<button type="button" class="sw-door" data-room="${room.id}">
    <img src="/brand/swamp/${room.icon}.webp" alt="" draggable="false" loading="lazy"><span>${text.rooms[room.id]}</span></button>`).join("")}</div>
    <details class="sw-locked-rooms"><summary></summary><ul>${data.rooms.map((room) =>
      `<li data-locked-room="${room.id}"><strong>${text.rooms[room.id]}</strong><span>${text.roomHints[room.id]}</span></li>`).join("")}</ul></details>`;
  const buttons = [...doors.querySelectorAll(".sw-door")];
  const locked = doors.querySelector(".sw-locked-rooms");
  const summary = locked.querySelector("summary");
  const requirements = [...locked.querySelectorAll("[data-locked-room]")];
  doors.addEventListener("click", (event) => {
    const button = event.target.closest(".sw-door");
    if (button && !button.hidden) onRoom(button.dataset.room);
  });

  return function draw(state, freshBuilding) {
    let lockedCount = 0;
    for (const [i, button] of buttons.entries()) {
      const { room } = button.dataset;
      const open = roomOpen(state, data, room);
      button.hidden = !open;
      button.setAttribute("aria-pressed", String(state.room === room));
      requirements[i].hidden = open;
      if (!open) lockedCount++;
    }
    locked.hidden = lockedCount === 0;
    const summaryText = text.ui.lockedRooms.replace("{n}", lockedCount);
    if (summary.textContent !== summaryText) summary.textContent = summaryText;
    const key = JSON.stringify([state.room, state.stage, state.own]);
    if (key === signature) return;
    signature = key;
    world.dataset.room = state.room;
    world.dataset.stage = String(state.stage);
    const completed = data.stages.slice(0, state.stage);
    const next = data.stages[state.stage];
    stageLabel.textContent = completed.length ? text.ui.builtStage.replace("{name}", text.stages[completed.at(-1).id]) : text.open;
    nextLabel.textContent = next ? text.ui.nextStage.replace("{name}", text.stages[next.id]) : text.allBuilt;
    nextLabel.disabled = !next;
    const background = data.rooms.find((room) => room.id === state.room)?.background;
    const stageBackground = state.room === "shore" ? completed.map((stage) => data.art.stageBackgrounds[stage.id]).filter(Boolean).at(-1) : null;
    const source = background || stageBackground?.src || data.art.background;
    const mobileSource = source.endsWith(".webp") ? source.replace(/\.webp$/, "-960.webp") : source;
    backdrop.style.setProperty("--sw-background", `url("${source}")`);
    backdrop.style.setProperty("--sw-mobile-background", `url("${mobileSource}")`);
    world.dataset.artRoom = String(!!background);
    world.dataset.stageArt = String(!!stageBackground);
    const covered = new Set(stageBackground?.covers || []);
    shelter.innerHTML = state.room === "shore" ? completed.filter((stage) => !covered.has(stage.id)).map((stage) => {
      if (stage.id === "window_hole" && completed.some(({ id }) => id === "window")) return "";
      const painting = PAINTED[stage.id];
      if (painting) return `<span class="sw-painted sw-painted-${painting}" data-part="${stage.id}"></span>`;
      const layer = data.art.stageLayers[stage.id];
      return `<span class="sw-part sw-part-${stage.part}" data-part="${stage.id}">
        ${layer ? `<img src="${layer}" alt="" draggable="false">` : ""}</span>`;
    }).join("") : "";
    houses.innerHTML = data.buildings.filter((building) => building.room === state.room && owned(state, building.id) > 0).map((building) => {
      const [x, bottom, height, z] = ANCHORS[state.room][building.id];
      const count = owned(state, building.id);
      const size = height * (1 + Math.min(0.16, Math.log10(count) * 0.08));
      const quantity = text.ui.houseCount.replace("{name}", producerLabels[building.id]).replace("{n}", count);
      return `<div class="sw-house${building.id === freshBuilding ? " new" : ""}" data-id="${building.id}" style="left:${x}%;bottom:${bottom}%;height:${size.toFixed(1)}%;z-index:${z}">
        <img src="/brand/swamp/${building.id}.webp" alt="" draggable="false" decoding="async">${count > 1 ? `<span class="sw-n num">${quantity}</span>` : ""}</div>`;
    }).join("");
  };
}
