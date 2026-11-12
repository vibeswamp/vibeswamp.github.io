// Build-time helper for the 3D mode «Первый причал». Runs in Node from build.mjs; the browser never loads it.
// Owns three things so 3D changes stay out of the shared build.mjs: module versions, the startup download list,
// and the page markup.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";

const hash = content => createHash("sha256").update(content).digest("hex").slice(0, 12);
const IMPORT = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"'?]+\.mjs)\2/g;

// Every module gets ?v=<hash of its own text with its imports already versioned>, so a cached copy can never pair
// an old module with a new one. `emit(name, source)` receives the rewritten text for dist/.
export function versionWalkModules(srcRoot, emit) {
  const urls = new Map();
  function visit(name, stack) {
    if (urls.has(name)) return urls.get(name);
    if (stack.has(name)) return `/${name}?v=${hash(readFileSync(join(srcRoot, name)))}`;
    stack.add(name);
    const source = readFileSync(join(srcRoot, name), "utf8").replace(IMPORT, (match, head, quote, spec) => {
      const url = visit(posix.join(posix.dirname(name), spec), stack);
      return `${head}${quote}${spec}${url.slice(url.indexOf("?"))}${quote}`;
    });
    stack.delete(name);
    const url = `/${name}?v=${hash(source)}`;
    urls.set(name, url);
    emit(name, source);
    return url;
  }
  return name => visit(name, new Set());
}

// Files fetched before the controls appear, with their sizes for the loading bar. `profile` limits a file to
// phones ("phone") or to computers ("desktop"); quality.mjs picks the same profile in the browser.
const STARTUP = [
  ["/swamp-walk/mvp/world.json", "land"],
  ["/swamp-walk/klyop-walk-phone.glb", "character", "phone"],
  ["/swamp-walk/klyop-walk-1024.glb", "character", "desktop"],
  ["/swamp-walk/models/landing.glb", "land"],
  ...["landing-planks", "landing-deck", "forest-atlas"].map(name => [`/swamp-walk/models/${name}.webp`, "textures"]),
];

export function walkLoadingAssets(walk, publicRoot, warn = console.warn) {
  const asset = (path, group, { profile, optional = false } = {}) => {
    const file = join(publicRoot, path.slice(1));
    if (optional && !existsSync(file)) return null;
    const bytes = readFileSync(file);
    return { path, url: `${path}?v=${hash(bytes)}`, group, bytes: bytes.length, optional, ...(profile ? { profile } : {}) };
  };
  const near = (file, base) => new URL(file, new URL(base, "https://x")).pathname;
  const assets = STARTUP.map(([path, group, profile]) => asset(path, group, { profile }));
  if (walk.motionPack) {
    assets.push(asset(walk.motionPack, "motion", { optional: true }),
      asset(near("klyop-kfsos-motion.glb", walk.motionPack), "motion", { optional: true }));
  }
  for (const pack of [walk.actionPack, walk.deckPack].filter(Boolean)) {
    const config = asset(pack, "motion", { optional: true });
    if (!config) continue;
    assets.push(config);
    try {
      const { library } = JSON.parse(readFileSync(join(publicRoot, pack.slice(1)), "utf8"));
      if (typeof library === "string") assets.push(asset(near(library, pack), "motion", { optional: true }));
    } catch (error) {
      warn(`3D action profile: ${error.message}`);
    }
  }
  return assets.filter(Boolean);
}

export function walkPageHtml({ lang, w, esc, backUrl, styles, script }) {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(w.title)} · VibeSwamp</title>
<meta name="description" content="${esc(w.lead)}">
<link rel="icon" href="/favicon.png">
${styles.map(href => `<link rel="stylesheet" href="${href}">`).join("\n")}
<script type="module" src="${script}"></script>
</head>
<body>
<main class="swalk">
  <canvas id="swalk-view" tabindex="0" aria-label="${esc(w.title)}" aria-describedby="swalk-help"></canvas>
  <header class="walk-heading"><a class="walk-link" href="${backUrl}">${esc(w.back)}</a>
    <h1>${esc(w.title)}</h1><p>${esc(w.lead)}</p>
  </header>
  <div class="walk-map" id="swalk-map" hidden>
    <canvas id="swalk-chart" width="200" height="200" aria-hidden="true"></canvas>
    <button id="swalk-reset" type="button">${esc(w.reset)}</button>
    <button id="swalk-camera" type="button" title="V">${esc(w.camera)}</button>
  </div>
  <aside class="walk-sortie" id="swalk-sortie" hidden>
    <div class="walk-sortie-title"><strong>${esc(w.sortie.title)}</strong><span id="swalk-health"></span></div>
    <p id="swalk-objective" role="status"></p>
    <p id="swalk-prompt" class="walk-prompt" hidden></p>
  </aside>
  <aside id="swalk-status" class="walk-status" role="status" hidden></aside>
  <section class="walk-loading" id="swalk-loading" aria-label="${esc(w.loading)}">${esc(w.loading)}<noscript> · ${esc(w.error)}</noscript></section>
  <p class="walk-help" id="swalk-help">
    <span class="walk-help-desktop">${esc(w.controls)}</span>
    <span class="walk-help-touch">${esc(w.touchControls)}</span>
  </p>
  <div class="walk-touch" id="swalk-touch" hidden>
    <div class="walk-stick" id="swalk-stick" role="img" aria-label="${esc(w.move)}"><span class="walk-stick-ring"><span class="walk-stick-knob"></span></span></div>
    <div class="walk-touch-right">
      <button class="walk-center" id="swalk-camera-center" type="button" aria-label="${esc(w.centerCamera)}" title="${esc(w.centerCamera)}"></button>
      <div class="walk-touch-actions">
        <button class="walk-jump walk-interact" id="swalk-interact" type="button" hidden></button>
        <button class="walk-jump" id="swalk-attack" type="button" hidden>${esc(w.attack)}</button>
        <button class="walk-jump" id="swalk-dodge" type="button" hidden>${esc(w.dodge)}</button>
        <button class="walk-jump" id="swalk-jump" type="button">${esc(w.jump)}</button>
      </div>
    </div>
  </div>
</main>
<script type="application/json" id="swalk-text">${JSON.stringify(w).replace(/</g, "\\u003c")}</script>
</body>
</html>`;
}
