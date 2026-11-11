import { createWalkHud } from "./walk-hud.mjs";

const world = document.querySelector(".swalk");
const text = JSON.parse(document.getElementById("swalk-text").textContent);
let resetFacts;
const hud = createWalkHud(world, text, { resetFacts: () => resetFacts?.() ?? false });

import("./main.mjs")
  .then(({ start }) => start(world, text, hud, handler => { resetFacts = handler; }))
  .catch(error => {
    hud.fail();
    console.error(error);
  });
