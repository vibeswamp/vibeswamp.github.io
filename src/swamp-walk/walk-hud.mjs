const COPY = {
  ru: {
    phases: ["Подготовка сцены", "Загрузка Клёпы и лачуги", "Подключение управления"],
    map: "Карта", retry: "Повторить загрузку", reset: "Сбросить открытия 3D",
    confirm: "Сбросить открытия и трофей «Первого причала»?",
    resetDone: "Открытия 3D сброшены.", resetFailed: "Браузер не разрешил сбросить открытия.",
    player: "Клёпа", objective: "Цель вылазки",
    start: "Метка у плотины. Здесь можно начать вылазку.",
    finish: "Муха побеждена. Забери добычу у метки.",
  },
  uk: {
    phases: ["Підготовка сцени", "Завантаження Кльопи й хатини", "Підключення керування"],
    map: "Карта", retry: "Повторити завантаження", reset: "Скинути відкриття 3D",
    confirm: "Скинути відкриття й трофей «Першого причалу»?",
    resetDone: "Відкриття 3D скинуто.", resetFailed: "Браузер не дозволив скинути відкриття.",
    player: "Кльопа", objective: "Мета вилазки",
    start: "Позначка біля греблі. Тут можна почати вилазку.",
    finish: "Муху переможено. Забери здобич біля позначки.",
  },
  en: {
    phases: ["Preparing the scene", "Loading Klyop and the hut", "Setting up controls"],
    map: "Map", retry: "Try loading again", reset: "Reset 3D discoveries",
    confirm: "Reset your First Landing discoveries and trophy?",
    resetDone: "3D discoveries reset.", resetFailed: "The browser blocked the reset.",
    player: "Klyop", objective: "Sortie objective",
    start: "The marker is at the dam. Start the sortie here.",
    finish: "The fly is defeated. Collect the reward at the marker.",
  },
};

const copyFor = (lang) => COPY[lang] ?? COPY.en;

export function createWalkHud(world, text, { resetFacts } = {}) {
  const lang = world.ownerDocument.documentElement.lang;
  const copy = copyFor(lang);
  const doc = world.ownerDocument;
  const get = (id) => world.querySelector(`#swalk-${id}`);
  const make = (tag, className, label) => {
    const element = doc.createElement(tag);
    element.className = className;
    if (label) element.textContent = label;
    return element;
  };
  const button = (className, label) => {
    const element = make("button", className, label);
    element.type = "button";
    return element;
  };

  world.dataset.hud = "";
  const loading = get("loading");
  const loadingTitle = make("strong", "walk-load-title", text.loading);
  const loadingStep = make("span", "walk-load-step");
  const progress = make("progress", "walk-load-progress");
  progress.max = copy.phases.length;
  const retry = button("walk-load-retry", copy.retry);
  retry.hidden = true;
  retry.addEventListener("click", () => doc.defaultView.location.reload());
  loading.replaceChildren(loadingTitle, loadingStep, progress, retry);

  const map = get("map");
  const mapButton = button("walk-map-toggle", copy.map);
  const tools = make("div", "walk-map-tools");
  tools.id = "swalk-map-tools";
  tools.hidden = true;
  mapButton.setAttribute("aria-controls", tools.id);
  mapButton.setAttribute("aria-expanded", "false");
  tools.append(...map.children);
  const legend = make("ul", "walk-map-legend");
  const labels = [["▲", copy.player], ["⚑", copy.objective], ["●", text.places.stump[0]],
    ["■", text.places.beaver[0]], ["◆", text.places.radio[0]]];
  for (const [symbol, label] of labels) {
    const item = make("li", "");
    const icon = make("span", "", symbol);
    icon.setAttribute("aria-hidden", "true");
    item.append(icon, label);
    legend.append(item);
  }
  tools.append(legend);
  if (resetFacts) {
    const clear = button("walk-clear-facts", copy.reset);
    const notice = make("span", "walk-clear-notice");
    notice.setAttribute("role", "status");
    clear.addEventListener("click", () => {
      if (doc.defaultView.confirm(copy.confirm)) notice.textContent = resetFacts() ? copy.resetDone : copy.resetFailed;
    });
    tools.append(clear, notice);
  }
  map.append(mapButton, tools);

  function toggleMap(open) {
    tools.hidden = !open;
    world.toggleAttribute("data-map-open", open);
    mapButton.setAttribute("aria-expanded", String(open));
  }
  mapButton.addEventListener("click", event => {
    const opening = tools.hidden;
    toggleMap(opening);
    if (!opening && event.detail > 0) get("view").focus({ preventScroll: true });
  });
  map.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !tools.hidden) {
      toggleMap(false);
      mapButton.focus();
    }
  });

  function phase(index) {
    progress.value = index + 1;
    progress.setAttribute("aria-label", copy.phases[index]);
    loadingStep.textContent = `${index + 1} / ${copy.phases.length} · ${copy.phases[index]}`;
  }
  phase(0);

  return {
    phase,
    get mapOpen() { return !tools.hidden; },
    ready() {
      loading.hidden = true;
      world.dataset.ready = "true";
      map.hidden = false;
    },
    fail() {
      loading.setAttribute("role", "alert");
      loadingTitle.textContent = text.error;
      loadingStep.hidden = progress.hidden = true;
      retry.hidden = false;
    },
  };
}

export function walkObjectiveHint(lang, action, fallback) {
  if (action === "start" || action === "finish") return copyFor(lang)[action];
  return fallback;
}

const INTERACT_FACING = Math.cos(70 * Math.PI / 180);

export function pickWalkAction(player, candidates, floorAt, obstructed) {
  if (!player.grounded || player.swimming || player.traversal || player.swing != null) return null;
  const facingX = Math.sin(player.heading), facingZ = Math.cos(player.heading);
  let nearest = null, closest = Infinity;
  for (const { action, point, radius } of candidates) {
    const dx = point.x - player.x, dz = point.z - player.z;
    const distance = Math.hypot(dx, dz);
    if (distance >= Math.min(closest, radius)) continue;
    const y = floorAt(point.x, point.z);
    if (Math.abs(player.y - y) >= 0.5) continue;
    if (distance > 0.35 && facingX * dx + facingZ * dz < distance * INTERACT_FACING) continue;
    if (obstructed?.(player, { x: point.x, y, z: point.z })) continue;
    nearest = action;
    closest = distance;
  }
  return nearest;
}

const MARKER_OFFSETS = [[0, 0], [0, -15], [15, 0], [-15, 0], [0, 15], [13, -13], [-13, -13], [13, 13], [-13, 13]];

function offsetMarker(x, y, positions, size) {
  for (const [dx, dy] of MARKER_OFFSETS) {
    const u = x + dx, v = y + dy;
    if (u < 8 || v < 8 || u > size - 8 || v > size - 8) continue;
    if (positions.every(([a, b]) => Math.hypot(u - a, v - b) >= 13)) return [u, v];
  }
  return [x, y];
}

export function drawWalkMarkers(ctx, loc, landmarks, discovered, target, player, scale = 1) {
  const px = loc(player.x * scale), py = loc(player.z * scale);
  const positions = [[px, py]];
  const items = target ? [{ ...target, id: "objective" }, ...landmarks] : landmarks;
  for (const item of items) {
    const x = loc(item.x), y = loc(item.z);
    const [u, v] = offsetMarker(x, y, positions, ctx.canvas.width);
    positions.push([u, v]);
    if (u !== x || v !== y) {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(u, v);
      ctx.strokeStyle = "#fff4d0aa"; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.beginPath();
    if (item.id === "objective") {
      ctx.moveTo(u - 4, v + 6); ctx.lineTo(u - 4, v - 5);
      ctx.lineTo(u + 6, v - 5); ctx.lineTo(u + 3, v); ctx.lineTo(u - 4, v); ctx.closePath();
    } else if (item.id === "beaver") ctx.rect(u - 4.2, v - 4.2, 8.4, 8.4);
    else if (item.id === "radio") {
      ctx.moveTo(u, v - 5.6); ctx.lineTo(u + 4.5, v); ctx.lineTo(u, v + 5.6); ctx.lineTo(u - 4.5, v); ctx.closePath();
    } else ctx.arc(u, v, 4.4, 0, 2 * Math.PI);
    ctx.fillStyle = item.id === "objective" ? "#ffe189" : discovered.has(item.id) ? "#c9de92" : "#20372c";
    ctx.strokeStyle = item.id === "objective" ? "#231a16" : "#fff4ce";
    ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke();
  }

  ctx.save(); ctx.translate(px, py); ctx.rotate(-player.heading);
  ctx.beginPath(); ctx.moveTo(0, 7); ctx.lineTo(-4.3, -4.2); ctx.lineTo(4.3, -4.2); ctx.closePath();
  ctx.fillStyle = "#fff7d7"; ctx.strokeStyle = "#15251e"; ctx.lineWidth = 2.2;
  ctx.stroke(); ctx.fill(); ctx.restore();
}
