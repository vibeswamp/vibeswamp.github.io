// Bag slots and stock/defense looks for the game day (candidate C).
export const SUPPLY_ICONS = Object.freeze({
  wood: "/swamp-walk/mvp/icons/wood.webp",
  resin: "/swamp-walk/mvp/icons/resin.webp",
  amber: "/swamp-walk/mvp/icons/amber.webp",
});

export function createBagSlots(panel, capacity) {
  const document = panel.ownerDocument;
  const art = document.createElement("div");
  art.className = "walk-supply-art";
  art.setAttribute("aria-hidden", "true");
  const slots = document.createElement("div");
  slots.className = "walk-supply-grid";
  art.append(slots);

  function cell(parent, pocket = false) {
    const frame = document.createElement("span");
    frame.className = pocket ? "walk-supply-slot walk-supply-amber" : "walk-supply-slot";
    const img = document.createElement("img");
    img.alt = "";
    img.width = img.height = 32;
    img.hidden = true;
    frame.append(img);
    parent.append(frame);
    let last;
    return id => {
      if (id === last) return;
      last = id;
      img.hidden = !id;
      if (id) img.src = SUPPLY_ICONS[id];
      else img.removeAttribute("src");
    };
  }

  const items = Array.from({ length: capacity }, () => cell(slots));
  const amber = cell(art, true);
  panel.append(art);
  return bag => {
    for (const [index, paint] of items.entries()) {
      paint(index < bag.wood ? "wood" : index < bag.wood + bag.resin ? "resin" : null);
    }
    amber(bag.amber ? "amber" : null);
  };
}

// The scene owns placement and supplies only committed counts and its current defense state.
export function createSupplyVisuals(stockCrate, padModels) {
  const wood = stockCrate?.getObjectByName("StockWood");
  const resin = stockCrate?.getObjectByName("StockResin");
  const variants = new WeakMap();

  function materialVariants(material) {
    if (variants.has(material)) return variants.get(material);
    const damaged = material.clone();
    if (damaged.color) {
      damaged.color.multiplyScalar(.70);
      damaged.color.g *= .81;
    }
    const spent = material.clone();
    spent.color?.multiplyScalar(.56);
    if (spent.emissive) spent.emissiveIntensity *= .13;
    const states = { ready: material, damaged, spent };
    variants.set(material, states);
    return states;
  }

  function watch(model, kind) {
    const parts = [];
    model?.traverse(part => {
      if (part.isMesh) {
        const materials = Array.isArray(part.material) ? part.material : [part.material];
        const palettes = materials.map(materialVariants);
        const states = Object.fromEntries(["ready", "damaged", "spent"].map(state => {
          const value = palettes.map(palette => palette[state]);
          return [state, Array.isArray(part.material) ? value : value[0]];
        }));
        parts.push({ part, states });
      }
    });
    let previous;
    return (pad, phase) => {
      if (!model) return;
      model.visible = phase !== "lost" && pad?.kind === kind && pad.hp > 0;
      if (!model.visible) return;
      const state = kind === "trap" && pad.cooldown > 0 ? "spent" : pad.hp < pad.maxHp * .5 ? "damaged" : "ready";
      if (previous === state) return;
      previous = state;
      for (const { part, states } of parts) part.material = states[state];
    };
  }

  const defenses = padModels.map(({ wall, trap }) => [watch(wall, "wall"), watch(trap, "trap")]);
  return ({ stock, pads, phase }) => {
    if (wood) wood.visible = stock?.wood > 0;
    if (resin) resin.visible = stock?.resin > 0;
    for (const [index, display] of defenses.entries()) {
      for (const apply of display) apply(pads?.[index], phase);
    }
  };
}
