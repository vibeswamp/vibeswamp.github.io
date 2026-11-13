// Pacing check for the clicker economy (content/swamp-v2.json + src/swamp/engine.mjs). No dependencies.
//   node scripts/swamp-pace.mjs            -> the timeline of an active and a calm player, and the checks
//   node scripts/swamp-pace.mjs --quiet    -> only the checks; exit code 1 if one fails
// Active: 4 croaks a second and a fly every 8 s. Calm: 1 croak a second and a fly every 20 s. Both buy the building
// with the best price per fly a second, build the next step as soon as it opens, and run every project they can
// afford. Badges that can be counted give their +1%. No vibe, radio, tea or fat flies, so real players are a bit faster.
// Since 13.11.2026 steps also need planks, resin and amber (docs/design/economy.md): this player never goes to 3D and
// buys them from Tolya. Trips and the mixed player are checked by scripts/swamp-economy.mjs.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const E = await import(pathToFileURL(join(root, "src/swamp/engine.mjs")).href);
const D = JSON.parse(readFileSync(join(root, "content/swamp-v2.json"), "utf8"));
const quiet = process.argv.includes("--quiet");

function play({ cps, flyEvery, minutes }) {
  const S = { flies: 0, total: 0, clicks: 0, own: {}, done: {}, run: null, stage: 0, caught: 0, activities: {}, visited: ["shore"], ach: {} };
  const stepAt = [], firstBuy = {}, events = [];
  const dt = 0.25;
  for (let t = 0; t < minutes * 60 && S.stage < D.stages.length; t += dt) {
    // badges that can be counted open as they would in the game (+1% each)
    if (t % 5 < dt / 2) for (const [id, [v, g]] of Object.entries(E.achievementProgress(S, D))) if (v >= g) S.ach[id] ||= t;
    S.clicks += cps * dt; S.caught += flyEvery && t > 0 && t % flyEvery < dt / 2 ? 1 : 0;
    const income = E.incomeRate(S, D) * dt + E.clickValue(S, D) * cps * dt;
    S.flies += income; S.total += income;
    if (flyEvery && t > 0 && t % flyEvery < dt / 2) {
      const fly = Math.max(1, E.baseRate(S, D) * 2, E.clickValue(S, D));
      S.flies += fly; S.total += fly;
    }
    if (S.run && E.finishProject(S, D, t * 1000)) events.push([t, "project"]);
    for (const p of D.builds) if (!S.done[p.id] && !S.run && S.flies >= p.cost) E.startProject(S, D, p.id, t * 1000);
    const next = D.stages[S.stage];
    // the materials from Tolya once the step and his price are both in reach
    if (next && S.total >= next.total && E.missingPrice(S, D) && S.flies >= next.cost + E.missingPrice(S, D)) E.buyMissing(S, D);
    if (next && E.buyStage(S, D)) { stepAt.push(t); events.push([t, `step ${S.stage} ${next.id}`]); }
    // a step (with Tolya's goods) less than five minutes of income away: save for it instead of buying buildings
    const want = next && S.total >= next.total ? next.cost + E.missingPrice(S, D) : Infinity;
    if (want - S.flies <= E.baseRate(S, D) * 300) continue;
    let best = null, score = Infinity;
    for (const b of D.buildings) {
      const s = E.priceOf(S, b, D) / (b.rate * E.producerMultiplier(S, b.id, D));
      if (s < score) { score = s; best = b; }
    }
    if (best && S.flies >= E.priceOf(S, best, D)) {
      if (!S.own[best.id]) { firstBuy[best.id] = t; events.push([t, `first ${best.id}`]); }
      E.buyBuilding(S, D, best.id);
    }
  }
  const gaps = stepAt.map((t, i) => t - (stepAt[i - 1] ?? 0));
  return { stepAt, gaps, firstBuy, events };
}

const fmt = (s) => `${(s / 60).toFixed(1)} мин`;
const active = play({ cps: 4, flyEvery: 8, minutes: 600 });
const calm = play({ cps: 1, flyEvery: 20, minutes: 900 });
if (!quiet) {
  for (const [name, run] of [["активный", active], ["спокойный", calm]]) {
    console.log(`\n== ${name} ==`);
    for (const [t, what] of run.events.filter(([, w]) => !w.startsWith("project"))) console.log(`${fmt(t).padStart(10)}  ${what}`);
  }
}
const n = D.stages.length;
const at = (run, id) => run.stepAt[D.stages.findIndex((s) => s.id === id)];
const checks = [
  ["первая постройка ≤ 15 с (активный)", Math.min(...Object.values(active.firstBuy)) <= 15],
  ["первый шаг ≤ 30 с (активный)", active.stepAt[0] <= 30],
  ["все шаги построены (активный, за 10 ч)", active.stepAt.length === n],
  ["чайный уголок 30–60 мин (активный)", at(active, "tea_corner") >= 1800 && at(active, "tea_corner") <= 3600],
  ["болотная студия 60–120 мин (активный)", at(active, "office") >= 3600 && at(active, "office") <= 7200],
  // 8 minutes before the materials; a player who never goes to 3D now waits up to 12 (economy.md, item 9)
  ["шаг не дольше 12 мин после первых 15 мин (активный, всё у Толи)", Math.max(...active.gaps) <= 720],
  // 3 minutes before the materials; economy.md lets the first 15 minutes be a quarter slower
  ["первые 15 мин — шаг хотя бы раз в 4 мин (активный)", active.gaps.filter((_, i) => active.stepAt[i] <= 900).every((g) => g <= 240)],
];
for (const [label, ok] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
console.log(`активный: студия ${fmt(at(active, "office") ?? NaN)}, спокойный: ${fmt(at(calm, "office") ?? NaN)}; самый долгий шаг ${fmt(Math.max(...active.gaps))}`);
if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
