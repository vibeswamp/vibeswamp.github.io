// Compact live 3D appearance customizer drawer (coat, headwear, gear & lantern, skin, pouch colour).
import { COATS, GEARS, HATS, SKINS, normalizeLook } from "./klyop-look.mjs";

export function createLookPanel({ world, button, copy, colors, initialLook, initialColor, onChange, onColorChange, onToggle }) {
  const lookCopy = copy?.look ?? {};
  const panel = document.createElement("aside");
  panel.className = "walk-look";
  panel.id = "swalk-look-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", copy?.lookTitle ?? "Look");

  const header = document.createElement("div");
  header.className = "walk-look-head";
  const title = document.createElement("strong");
  title.textContent = copy?.lookTitle ?? "Look";
  const done = document.createElement("button");
  done.type = "button";
  done.className = "walk-look-done";
  done.textContent = copy?.lookDone ?? "Done";
  header.append(title, done);

  const body = document.createElement("div");
  body.className = "walk-look-body";

  let current = normalizeLook(initialLook);
  let currentColor = colors?.[initialColor] ? initialColor : "copper";
  const groupButtons = new Map();

  function addGroup(key, label, items, labels, swatchOnly = false) {
    const row = document.createElement("div");
    row.className = "walk-look-row";
    const heading = document.createElement("span");
    heading.className = "walk-look-label";
    heading.textContent = label;
    const list = document.createElement("div");
    list.className = "walk-look-choices";
    const btns = items.map((item, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = swatchOnly ? "walk-look-swatch" : "walk-look-pill";
      if (item.swatch) btn.style.setProperty("--swatch", item.swatch);
      const name = labels?.[idx] ?? item.id;
      if (swatchOnly) {
        btn.title = name;
        btn.setAttribute("aria-label", name);
      } else {
        btn.textContent = name;
      }
      btn.addEventListener("click", () => {
        if (key === "pouch") {
          currentColor = item.id;
          syncSelection();
          onColorChange?.(currentColor);
        } else {
          current = normalizeLook({ ...current, [key]: idx });
          syncSelection();
          onChange?.(current);
        }
      });
      list.append(btn);
      return { btn, value: key === "pouch" ? item.id : idx };
    });
    groupButtons.set(key, btns);
    row.append(heading, list);
    body.append(row);
  }

  addGroup("hat", lookCopy.hat ?? "Hat", HATS, lookCopy.hats);
  addGroup("coat", lookCopy.coat ?? "Coat", COATS, lookCopy.coats, true);
  addGroup("skin", lookCopy.skin ?? "Skin", SKINS, lookCopy.skins, true);
  addGroup("gear", lookCopy.gear ?? "Gear", GEARS, lookCopy.gears);
  if (colors) {
    const pouchItems = Object.entries(colors).map(([id, hex]) => ({ id, swatch: hex }));
    const pouchLabels = pouchItems.map(({ id }) => copy?.colors?.[id] ?? id);
    addGroup("pouch", copy?.color ?? "Pouch", pouchItems, pouchLabels);
  }

  function syncSelection() {
    for (const [key, btns] of groupButtons) {
      const active = key === "pouch" ? currentColor : current[key];
      for (const { btn, value } of btns) {
        btn.setAttribute("aria-pressed", String(value === active));
      }
    }
  }
  syncSelection();

  panel.append(header, body);
  world.append(panel);

  function setOpen(open) {
    panel.hidden = !open;
    world.toggleAttribute("data-look-open", open);
    button?.setAttribute("aria-expanded", String(open));
    const focusTarget = open ? done : document.getElementById("swalk-view");
    focusTarget?.focus({ preventScroll: true });
    onToggle?.(open);
  }

  if (button) {
    button.textContent = copy?.lookButton ?? "Look";
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", panel.id);
    button.addEventListener("click", () => setOpen(panel.hidden));
  }
  done.addEventListener("click", () => setOpen(false));
  addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden) {
      event.stopPropagation();
      setOpen(false);
    }
  });

  return {
    get open() { return !panel.hidden; },
    show: () => setOpen(true),
    close: () => setOpen(false),
    setState(look, color) {
      if (look) current = normalizeLook(look);
      if (color && colors?.[color]) currentColor = color;
      syncSelection();
    },
  };
}
