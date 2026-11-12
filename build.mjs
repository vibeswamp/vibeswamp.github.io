// Builds the static site into dist/ from content/. No dependencies: `node build.mjs` (add --offline to skip Steam).
// Rules for colours, fonts and layout: DESIGN.md. How to add posts and screenshots: README.md.
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchStats } from "./scripts/fetch-stats.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const pub = join(root, "public");
const readJson = async (...p) => JSON.parse((await readFile(join(root, ...p), "utf8")).replace(/^\uFEFF/, ""));
const warn = (m) => console.warn(`warning: ${m}`);
const sourceAssetUrl = (name, content = readFileSync(join(root, "src", name))) => {
  const revision = createHash("sha256").update(content).digest("hex").slice(0, 12);
  return `/${name}?v=${revision}`;
};
const emittedModules = new Map();
function moduleUrl(name, dependencies) {
  let source = readFileSync(join(root, "src", name), "utf8");
  for (const [specifier, url] of Object.entries(dependencies)) {
    source = source.replace(`"${specifier}"`, `"${specifier}${url.slice(url.indexOf("?"))}"`);
  }
  emittedModules.set(name, source);
  return sourceAssetUrl(name, source);
}
const siteStyles = sourceAssetUrl("style.css");
// The clicker (its own chat): every module is versioned so a cached copy cannot mix an old engine with a new save.
const swampEngine = sourceAssetUrl("swamp/engine.mjs");
const clickerScript = moduleUrl("swamp.js", {
  "./swamp/engine.mjs": swampEngine,
  "./swamp/save.mjs": moduleUrl("swamp/save.mjs", { "./engine.mjs": swampEngine }),
  "./swamp/scene.mjs": moduleUrl("swamp/scene.mjs", { "./engine.mjs": swampEngine }),
  "./swamp/expedition-save.mjs": sourceAssetUrl("swamp/expedition-save.mjs"),
  "./swamp/threshold.mjs": sourceAssetUrl("swamp/threshold.mjs"),
});
const clickerStyles = sourceAssetUrl("swamp.css");
const strollScript = sourceAssetUrl("klyop-stroll.mjs");
// The 3D mode (its own chat): module versions, startup files and page markup live in src/swamp-walk/walk-build.mjs.
const walk3d = await import("./src/swamp-walk/walk-build.mjs");
const walkScript = walk3d.versionWalkModules(join(root, "src"), (name, source) => emittedModules.set(name, source))(
  "swamp-walk/walk-entry.mjs");
const walkStyles = [sourceAssetUrl("swamp-walk/style.css"), sourceAssetUrl("swamp-walk/walk-hud.css")];

if (!process.argv.includes("--offline")) {
  try {
    await fetchStats();
  } catch (e) {
    console.warn(`stats: ${e.message}; using the previous numbers`);
  }
}

const site = await readJson("content", "site.json");
const projects = (
  await Promise.all(
    (await readdir(join(root, "content", "projects")))
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson("content", "projects", f))
  )
).sort((a, b) => a.order - b.order);
const stats = existsSync(join(root, "content", "stats.json")) ? await readJson("content", "stats.json") : { items: {} };
const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
const redditInsights = await readJson("content", "reddit-insights.json");
const posts = await loadPosts();

// ---------- small helpers ----------

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const prefix = (lang) => (lang === "en" ? "" : `/${lang}`);
const homeUrl = (lang) => `${prefix(lang)}/`;
const projectUrl = (lang, id) => `${prefix(lang)}/projects/${id}/`;
const blogUrl = (lang) => `${prefix(lang)}/blog/`;
const postUrl = (lang, slug) => `${prefix(lang)}/blog/${slug}/`;
const feedUrl = (lang) => `${prefix(lang)}/feed.xml`;
// Sections of the site, one page each: /creative/, /mods/, /games/, /packs/, /support/.
const sectionUrl = (lang, key) => `${prefix(lang)}/${key}/`;
const SECTION_OF_KIND = { mod: "mods", game: "games", modpack: "packs" };
const playUrl = (lang) => `${prefix(lang)}/creative/swamp/`;
const walkUrl = (lang) => `${playUrl(lang)}walk/`;
// The same page in every language: { en: "/x/", uk: "/uk/x/", ru: "/ru/x/" }.
const allPaths = (fn) => Object.fromEntries(site.languages.map((l) => [l, fn(l)]));
// Text in the page language, English when a translation is missing.
// a text in three languages, or one plain string for all of them (a version like "0.5.0")
const tr = (obj, lang) => (typeof obj === "string" ? obj : obj ? obj[lang] ?? obj.en ?? "" : "");
const fmt = (lang, n) => new Intl.NumberFormat(site.strings[lang].locale).format(n);

// Picks the right word form: key + One / Few / Many in site.json (Ukrainian and Russian have three forms).
function plural(lang, n, key) {
  const t = site.strings[lang];
  if (lang === "uk" || lang === "ru") {
    const d = n % 10, h = n % 100;
    if (d === 1 && h !== 11) return t[`${key}One`];
    if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return t[`${key}Few`] ?? t[`${key}Many`];
    return t[`${key}Many`];
  }
  return n === 1 ? t[`${key}One`] : t[`${key}Many`];
}

const dayOf = (iso) => new Date(`${iso}T12:00:00Z`);
function dateParts(lang, iso) {
  const parts = new Intl.DateTimeFormat(site.strings[lang].locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).formatToParts(dayOf(iso));
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: get("day"), month: get("month"), year: get("year") };
}
const longDate = (lang, iso) => {
  const d = dateParts(lang, iso);
  return `${d.day} ${d.month} ${d.year}`;
};

// A project name can be one string or { "en": ..., "uk": ... } when it is a description rather than a proper name.
const nameOf = (p, lang = "en") => (typeof p.name === "string" ? p.name : p.name?.[lang] ?? p.name?.en ?? p.id);
const statusLabel = (lang, s) => site.strings[lang][`status${s[0].toUpperCase()}${s.slice(1)}`];
const mark = (s) => `<span class="mark mark-${s}" aria-hidden="true"></span>`;

// ---------- pictures ----------

// Reads width and height from PNG, JPEG, GIF and WebP headers, so pages do not jump while pictures load.
function readSize(file) {
  const b = readFileSync(file);
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length > 10 && b.toString("ascii", 0, 3) === "GIF") return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  if (b.length > 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L") {
      const v = b.readUInt32LE(21);
      return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 };
    }
    if (kind === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const m = b[o + 1];
      if (m === 0xff) { o++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(o + 7), h: b.readUInt16BE(o + 5) };
      o += 2 + b.readUInt16BE(o + 2);
    }
  }
  return null;
}

const pictureCache = new Map();
// "assets/x/y.jpg" -> full and small versions with sizes. A small copy is "y.small.jpg" next to the picture.
function picture(rel) {
  rel = String(rel).replace(/^\/+/, "");
  if (pictureCache.has(rel)) return pictureCache.get(rel);
  const file = join(pub, rel);
  let info;
  if (!existsSync(file)) {
    warn(`picture not found: public/${rel}`);
    info = { src: `/${rel}`, small: `/${rel}` };
  } else {
    const size = readSize(file);
    const smallRel = rel.replace(/\.(png|jpe?g|webp|gif)$/i, ".small.jpg");
    const hasSmall = smallRel !== rel && existsSync(join(pub, smallRel));
    const small = hasSmall ? readSize(join(pub, smallRel)) : size;
    const midRel = rel.replace(/\.(png|jpe?g|webp|gif)$/i, ".mid.jpg");
    const hasMid = midRel !== rel && existsSync(join(pub, midRel));
    info = { src: `/${rel}`, w: size?.w, h: size?.h, small: `/${hasSmall ? smallRel : rel}`, sw: small?.w, sh: small?.h, ...(hasMid ? { mid: `/${midRel}` } : {}) };
  }
  pictureCache.set(rel, info);
  return info;
}

function gallery(p) {
  const list = (p.gallery ?? []).filter((g) => g && g.file);
  if (!list.length && p.image) list.push({ file: p.image, caption: {} });
  return list.map((g) => ({ info: picture(g.file), caption: g.caption ?? {} }));
}
// Caption text of a gallery picture; empty captions are allowed (new screenshots), then the project name is the alt text.
const captionText = (lang, g) => g.caption?.[lang] || g.caption?.en || "";
const captionOf = (lang, p, g) => captionText(lang, g) || nameOf(p, lang);
const figcaption = (lang, g) => (captionText(lang, g) ? `<figcaption>${esc(captionText(lang, g))}</figcaption>` : "");

const LOUPE = `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12.7 12.7 17 17" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;

// srcset for a big picture: the small (about 560 px) and mid (960 px) copies next to the full file.
const SIZES_MAIN = "(max-width: 900px) calc(100vw - 32px), 640px";
function srcset(info, sizes) {
  if (!info.w || (!info.mid && info.small === info.src)) return "";
  const list = [];
  if (info.small !== info.src && info.sw) list.push(`${info.small} ${info.sw}w`);
  if (info.mid) list.push(`${info.mid} 960w`);
  list.push(`${info.src} ${info.w}w`);
  return ` srcset="${esc(list.join(", "))}" sizes="${sizes}"`;
}

// A picture that opens large in the viewer (site.js). Without JS the link opens the picture itself.
function zoom(info, { alt, caption, group, small = false, eager = false, cls = "" }) {
  const src = small ? info.small : info.src;
  const w = small ? info.sw : info.w;
  const h = small ? info.sh : info.h;
  const load = eager ? ` fetchpriority="high"` : ` loading="lazy"`;
  return `<a class="zoom${cls ? ` ${cls}` : ""}" href="${esc(info.src)}" data-group="${esc(group)}" data-caption="${esc(caption)}"${
    info.w ? ` data-w="${info.w}" data-h="${info.h}"` : ""
  }><img src="${esc(src)}"${small ? "" : srcset(info, SIZES_MAIN)} alt="${esc(alt)}"${w ? ` width="${w}" height="${h}"` : ""}${load} decoding="async">${
    small ? "" : `<span class="zoom-hint">${LOUPE}</span>`
  }</a>`;
}

// ---------- the frog ----------

// Klyop, the toad mascot (approved by the owner on 07.11.2026; pictures in public/brand, see README): his head is small
// in the header and peeks out of the pond on the home page; site.js makes him jump from one to the other.
// The mascot chat (mascot/USAGE.md) may add new pictures; each one is used only once it is in public/brand.
const hasPic = (rel) => existsSync(join(pub, rel));
const ON_LILY = hasPic("brand/klyop/lily.webp");   // owner: Klyop lounging on a lily pad in the pond, then he jumps to the header
// data-mouth: where his mouth is on the picture (parts of width and height), the tongue starts there
const FROG = `<img class="toad frog" src="/brand/klyop-head.webp" width="128" height="95" alt="" decoding="async" data-mouth="0.57,0.7">`;
const FROG_BIG = ON_LILY
  ? `<button type="button" class="frog-btn on-lily" data-fly-src="/brand/klyop-head.webp"><img class="toad frog frog-big" src="/brand/klyop/lily.webp" width="611" height="608" alt="" decoding="async" data-mouth="0.40,0.21"><span class="frog-say" aria-live="polite"></span></button>`
  : `<button type="button" class="frog-btn"><img class="toad frog frog-big" src="/brand/klyop-peek.webp" width="400" height="297" alt="" decoding="async" data-mouth="0.57,0.7"><span class="frog-say" aria-live="polite"></span></button>`;

// ---------- blog posts: content/posts/YYYY-MM-DD-slug.<lang>.md ----------

function frontMatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: raw.slice(m[0].length) };
}

async function loadPosts() {
  const dir = join(root, "content", "posts");
  if (!existsSync(dir)) return [];
  const bySlug = {};
  for (const f of (await readdir(dir)).sort()) {
    const m = f.match(/^(?:(\d{4}-\d{2}-\d{2})-)?(.+)\.([a-z]{2})\.md$/);
    if (!m) continue;
    const [, fileDate, slug, lang] = m;
    if (!site.languages.includes(lang)) continue;
    const raw = (await readFile(join(dir, f), "utf8")).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    const { meta, body } = frontMatter(raw);
    const date = meta.date || fileDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) { warn(`${f}: no date, skipped`); continue; }
    if (!meta.title) { warn(`${f}: no title, skipped`); continue; }
    const ids = (meta.projects ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    ids.filter((id) => !byId[id]).forEach((id) => warn(`${f}: unknown project "${id}"`));
    const post = (bySlug[slug] ??= { slug, date, projects: ids.filter((id) => byId[id]), image: meta.image || null, langs: {} });
    post.langs[lang] = { title: meta.title, summary: meta.summary ?? "", body };
  }
  return Object.values(bySlug).sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}
const postsIn = (lang, list = posts) => list.filter((p) => p.langs[lang]);

// A small Markdown: paragraphs, ## headings, - lists, 1. lists, | tables |, ![pictures](assets/...), [links](...), **bold**, *italic*.
// A backslash keeps a sign as it is: \* writes a plain star (player names like *HARDBASS INTENSIFIED*).
const linkTarget = (u) => (/^assets\//.test(u) ? `/${u}` : u);
function inline(s) {
  const re = /\\([\\*`_[\]])|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`/g;
  let out = "", last = 0, m;
  while ((m = re.exec(s))) {
    out += esc(s.slice(last, m.index));
    m = [m[0], ...m.slice(2), m[1]];   // keep the old group numbers below; m[6] is the escaped sign
    if (m[6] !== undefined) out += esc(m[6]);
    else if (m[1] !== undefined) out += `<a href="${esc(linkTarget(m[2]))}">${inline(m[1])}</a>`;
    else if (m[3] !== undefined) out += `<strong>${inline(m[3])}</strong>`;   // a link may sit inside bold text
    else if (m[4] !== undefined) out += `<em>${esc(m[4])}</em>`;
    else out += `<code>${esc(m[5])}</code>`;
    last = re.lastIndex;
  }
  return out + esc(s.slice(last));
}

function markdown(src, group) {
  return src
    .trim()
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n").map((l) => l.trimEnd());
      let m;
      if (lines.length === 1 && (m = lines[0].match(/^(#{2,4})\s+(.+)$/))) return `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`;
      if (lines.length === 1 && (m = lines[0].match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/))) {
        const info = picture(m[2]);
        // a small picture (an icon, a card) keeps its own size instead of stretching to the column
        const small = info.w && info.w < 480;
        return `<figure${small ? ' class="fig-small"' : ""}>${zoom(info, { alt: m[1], caption: m[1], group })}${m[1] ? `<figcaption>${esc(m[1])}</figcaption>` : ""}</figure>`;
      }
      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ""))}</li>`).join("")}</ul>`;
      if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>`).join("")}</ol>`;
      if (lines.every((l) => l.trim().startsWith("|"))) {
        const rows = lines.map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()));
        const hasHead = rows[1]?.every((c) => /^:?-{3,}:?$/.test(c));
        const head = hasHead ? rows[0] : null;
        const bodyRows = hasHead ? rows.slice(2) : rows;
        const isNum = (c) => /^[\d\s.,\u00a0%+-]+$/.test(c) && /\d/.test(c);
        const numCol = (i) => i > 0 && bodyRows.every((r) => isNum(r[i] ?? ""));
        const cell = (tag, c, i) => `<${tag}${numCol(i) ? ` class="num"` : ""}>${inline(c)}</${tag}>`;
        return `<div class="table-wrap"><table>${head ? `<thead><tr>${head.map((c, i) => cell("th", c, i)).join("")}</tr></thead>` : ""}<tbody>${bodyRows
          .map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${inline(c)}</th>` : cell("td", c, i))).join("")}</tr>`)
          .join("")}</tbody></table></div>`;
      }
      return `<p>${inline(lines.join(" "))}</p>`;
    })
    .join("\n");
}

// ---------- page frame ----------

const ICON_MUSIC = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 17V5l10-2v12" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="6.5" cy="17" r="2.5" fill="currentColor"/><circle cx="16.5" cy="15" r="2.5" fill="currentColor"/></svg>`;
const ICON_THEME = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path class="i-moon" d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="currentColor"/><g class="i-sun" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></g></svg>`;
const ICON_MENU = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const ICON_CLOSE = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const ICON_FX = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path class="wave1" d="M16 9a4 4 0 0 1 0 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path class="wave2" d="M18.5 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

// Picks the language once, before the page is drawn: a language the visitor chose on the site (remembered in the
// browser) wins, otherwise the first of the browser's languages that the site has. No location lookup, no cookies.
// ---------- Swamp Radio: the player at the bottom of every page ----------
// Klyop's head nods to the music in the player (the class k-head takes the beat, see style.css).
// Swamp Radio sits bottom right, so his head there looks left, into the page (when the mascot chat's picture is in place)
const KLYOP = `<img class="k-head" src="/brand/${hasPic("brand/klyop-head-left.webp") ? "klyop-head-left" : "klyop-head"}.webp" width="128" height="95" alt="" decoding="async">`;
const trackTitle = (m, lang) => (typeof m.title === "string" ? m.title : tr(m.title, lang));
const tracksFor = (lang) =>
  (site.music ?? []).map((m) => ({ id: m.id, src: `/${m.file}`, title: trackTitle(m, lang), project: m.project, credit: m.credit ?? m.project, seconds: m.seconds, tint: site.musicProjects?.[m.project] ?? "#262B30" }));
const ico = (d, extra = "") => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"${extra}>${d}</svg>`;
const I = {
  play: ico('<path class="i-play" d="M8 5v14l11-7z" fill="currentColor"/><path class="i-pause" d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/>'),
  prev: ico('<path d="M6 5h2.4v14H6zM19 5v14L9.5 12z" fill="currentColor"/>'),
  next: ico('<path d="M15.6 5H18v14h-2.4zM5 5v14l9.5-7z" fill="currentColor"/>'),
  shuffle: ico('<path d="M3 7h3.5c2.4 0 3.6 1.2 5 3.5l1.3 2.2c1.3 2.2 2.4 3.3 4.7 3.3H21M3 17h3.5c1.6 0 2.6-.6 3.5-1.7M14 8.7c.9-1.1 1.9-1.7 3.5-1.7H21M18.5 4.5 21 7l-2.5 2.5M18.5 13.5 21 16l-2.5 2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  repeat: ico('<path d="M4 11V9a3 3 0 0 1 3-3h12M16.5 3.5 19 6l-2.5 2.5M20 13v2a3 3 0 0 1-3 3H5M7.5 20.5 5 18l2.5-2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><text class="i-one" x="12" y="15.2" font-size="7" font-weight="700" text-anchor="middle" fill="currentColor">1</text>'),
  vol: ico('<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path class="i-wave" d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path class="i-x" d="M16 9.5l5 5m0-5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  list: ico('<path d="M4 6h11M4 12h11M4 18h7M18 14v6.5M18 20.5a2 2 0 1 1-2-2h2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  fold: ico('<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
};
function radio(lang) {
  const t = site.strings[lang];
  if (!(site.music ?? []).length) return "";
  const b = (cls, label, icon, extra = "") => `<button type="button" class="rb ${cls}" aria-label="${esc(label)}" title="${esc(label)}"${extra}>${icon}</button>`;
  return `<aside class="radio" aria-label="${esc(t.radioName)}" data-play="${esc(t.radioPlay)}" data-pause="${esc(t.radioPause)}" data-r-off="${esc(t.radioRepeatOff)}" data-r-all="${esc(t.radioRepeatAll)}" data-r-one="${esc(t.radioRepeatOne)}">
<div class="radio-amp">
<button type="button" class="radio-face" aria-expanded="false" aria-controls="radio-deck" title="${esc(t.radioOpen)}"><span class="radio-klyop">${KLYOP}</span><span class="radio-name">${esc(t.radioName)}</span></button>
<span class="radio-cover" aria-hidden="true"><span class="radio-cover-name"></span></span>
<div class="radio-info"><p class="radio-title"></p><p class="radio-credit"></p></div>
<div class="radio-ctrl">${b("r-prev", t.radioPrev, I.prev)}${b("r-play", t.radioPlay, I.play)}${b("r-next", t.radioNext, I.next)}</div>
<div class="radio-deck" id="radio-deck">
<div class="radio-seek"><span class="r-cur num">0:00</span><input type="range" class="r-seek" min="0" max="1000" value="0" step="1" aria-label="${esc(t.radioSeek)}"><span class="r-dur num">0:00</span></div>
<div class="radio-side">${b("r-shuffle", t.radioShuffle, I.shuffle, ' aria-pressed="false"')}${b("r-repeat", t.radioRepeatAll, I.repeat, ' data-mode="all"')}${b("r-mute", t.radioMute, I.vol, ' aria-pressed="false"')}<input type="range" class="r-vol" min="0" max="100" value="40" step="1" aria-label="${esc(t.radioVolume)}">${b("r-queue", t.radioQueue, I.list, ' aria-expanded="false" aria-controls="radio-queue"')}</div>
</div>
${b("r-fold", t.radioHide, I.fold)}
<span class="radio-led" aria-hidden="true"></span>
</div>
<ol class="radio-queue" id="radio-queue" hidden></ol>
</aside>`;
}

// ---------- title cards: each game's own title, drawn in the style of its menu over a real screenshot ----------
const trOr = (v, lang) => (typeof v === "string" ? v : tr(v, lang));
function titlecard(lang, p, { small = false, eager = false } = {}) {
  const c = p.titlecard;
  if (!c) return "";
  const t = site.strings[lang];
  const bg = c.bg ? picture(c.bg) : null;
  const img = bg ? `<img class="tc-bg" src="${esc(small ? bg.small : bg.src)}"${small ? "" : srcset(bg, SIZES_MAIN)} alt=""${(small ? bg.sw : bg.w) ? ` width="${small ? bg.sw : bg.w}" height="${small ? bg.sh : bg.h}"` : ""}${eager ? ` fetchpriority="high"` : ` loading="lazy"`} decoding="async">` : "";
  return `<figure class="tcard tc-${esc(c.style)}${small ? " tc-small" : ""}" aria-label="${esc(`${t.titleLabel}: ${nameOf(p, lang)}`)}">
${img}<div class="tc-in">
${c.over ? `<p class="tc-over">${esc(trOr(c.over, lang))}</p>` : ""}<p class="tc-name">${c.lines.map((l, i) => `<span class="tc-l tc-l${i}">${esc(l)}</span>`).join("")}</p>${c.rule ? `<span class="tc-rule" aria-hidden="true"></span>` : ""}
${c.sub ? `<p class="tc-sub">${esc(trOr(c.sub, lang))}</p>` : ""}${!small && c.tag ? `<p class="tc-tag">${esc(trOr(c.tag, lang))}</p>` : ""}
</div>
</figure>`;
}

function langPick(lang, paths) {
  return `<script>document.documentElement.classList.add("js");(function(){try{var t=localStorage.getItem("vibeswamp-theme");if(t!=="dark"&&t!=="light")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t;}catch(e){}})();(function(){try{var a=${JSON.stringify(paths)},k="vibeswamp-lang",s=localStorage.getItem(k),w=a[s]?s:"";
if(!w&&"${lang}"==="en"){var n=navigator.languages||[navigator.language||""];for(var i=0;i<n.length&&!w;i++){var c=String(n[i]).slice(0,2).toLowerCase();if(a[c])w=c;}}
if(w&&w!=="${lang}")location.replace(a[w]+location.hash);}catch(e){}})();</script>`;
}

function layout({ lang, paths, title, description, body, jsonld, image, current = "", page = "" }) {
  const t = site.strings[lang];
  const path = paths[lang];
  const P = prefix(lang);
  const stroll = page === "page-swamp";
  const nav = [
    ["creative", sectionUrl(lang, "creative"), t.navCreative],
    ["mods", sectionUrl(lang, "mods"), t.navMods],
    ["games", sectionUrl(lang, "games"), t.navGames],
    ["packs", sectionUrl(lang, "packs"), t.navPacks],
    ["blog", blogUrl(lang), t.navBlog],
    ["support", sectionUrl(lang, "support"), t.navSupport],
  ];
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
${langPick(lang, paths)}
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#F4F6F0" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#10160E" media="(prefers-color-scheme: dark)">
<link rel="canonical" href="${site.baseUrl}${path}">
${site.languages.map((l) => `<link rel="alternate" hreflang="${l}" href="${site.baseUrl}${paths[l]}">`).join("\n")}
<link rel="alternate" hreflang="x-default" href="${site.baseUrl}${paths.en}">
<link rel="alternate" type="application/atom+xml" title="${esc(`${site.name}: ${t.blog}`)}" href="${feedUrl(lang)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${site.baseUrl}${path}">
${image ? `<meta property="og:image" content="${site.baseUrl}/${esc(String(image).replace(/^\/+/, ""))}">\n` : ""}<link rel="icon" href="/favicon.png" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bitter:wght@600;700&family=Tektur:wdth,wght@75..100,500..800&family=Overpass:wght@400;600;800&display=swap">
<link rel="stylesheet" href="${siteStyles}">
${page === "page-swamp" ? `<link rel="stylesheet" href="${clickerStyles}">\n` : ""}${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>\n` : ""}</head>
<body${page ? ` class="${page}"` : ""} data-lb-prev="${esc(t.lbPrev)}" data-lb-next="${esc(t.lbNext)}" data-lb-close="${esc(t.lbClose)}" data-frog="${esc(t.frogSays)}">
<a class="skip" href="#main">${esc(t.skip)}</a>
<header class="top">
<div class="wrap top-in">
<a class="brand" href="${homeUrl(lang)}">${FROG}<span>VibeSwamp</span></a>
<button type="button" class="menu-btn" aria-expanded="false" aria-controls="top-menu">${ICON_MENU}<span>${esc(t.menu)}</span></button>
<div class="top-menu" id="top-menu" aria-label="${esc(t.menu)}">
<div class="menu-head"><span class="menu-title">${esc(t.menu)}</span><button type="button" class="menu-close" aria-label="${esc(t.menuClose)}" title="${esc(t.menuClose)}">${ICON_CLOSE}</button></div>
<span class="langs" role="group" aria-label="${esc(t.langLabel)}">${site.languages
  .map((l) =>
    l === lang
      ? `<span class="lang-cur" lang="${l}" title="${esc(site.strings[l].langName)}">${esc(site.strings[l].langShort)}</span>`
      : `<a href="${paths[l]}" hreflang="${l}" lang="${l}" data-lang="${l}" title="${esc(site.strings[l].langName)}">${esc(site.strings[l].langShort)}</a>`
  )
  .join("")}</span>
<span class="sound" role="group" aria-label="${esc(t.soundLabel)}">
<button type="button" class="snd snd-music" aria-pressed="false" aria-label="${esc(t.musicLabel)}" title="${esc(t.musicLabel)}">${ICON_MUSIC}<span class="snd-text" aria-hidden="true">${esc(t.menuMusic)}</span></button>
<button type="button" class="snd snd-fx" aria-pressed="false" aria-label="${esc(t.fxLabel)}" title="${esc(t.fxLabel)}">${ICON_FX}<span class="snd-text" aria-hidden="true">${esc(t.menuFx)}</span></button>
<button type="button" class="snd snd-theme" aria-pressed="false" aria-label="${esc(t.themeLabel)}" title="${esc(t.themeLabel)}" data-night="${esc(t.themeNight)}" data-day="${esc(t.themeDay)}">${ICON_THEME}<span class="snd-text" aria-hidden="true">${esc(t.menuTheme)}</span></button>
</span>
<nav>
${nav.map(([key, href, label]) => `<a href="${href}"${key === current ? ` aria-current="page"` : ""}>${esc(label)}</a>`).join("\n")}

</nav>
<a class="menu-play" href="${playUrl(lang)}"><span class="menu-play-name">${esc(t.playTitle)}</span><span class="menu-play-line">${esc(t.menuPlayLine)}</span></a>
</div>
</div>
<div class="menu-shade" hidden></div>
</header>
${stroll ? `<div class="klyop-trail" aria-hidden="true" hidden>
  <div class="klyop-trail-bank">
    <span class="klyop-trail-runner" hidden>
      <span class="klyop-trail-frame"><img data-src="/klyop-stroll.webp" width="360" height="640" decoding="async" alt="" draggable="false"></span>
    </span>
  </div>
</div>` : ""}
<main id="main">
${body}
</main>
<footer class="foot">
<div class="wrap">
<ul class="foot-links">
<li>&copy; 2026 ${esc(site.author)}</li>
<li><a href="${esc(site.donate)}">Donatello</a></li>
${site.discord ? `<li><a href="${esc(site.discord)}">Discord</a></li>` : ""}
${site.links.filter((l) => l.name === "GitHub" || l.name === "Twitch").map((l) => `<li><a href="${esc(l.url)}">${esc(l.name)}</a></li>`).join("")}
<li><a href="${feedUrl(lang)}">${esc(t.feed)}</a></li>
${site.languages.filter((l) => l !== lang).map((l) => `<li><a href="${paths[l]}" hreflang="${l}" lang="${l}" data-lang="${l}">${esc(site.strings[l].langName)}</a></li>`).join("\n")}
</ul>
<p class="disclaimer" lang="en">${esc(t.disclaimer)}</p>
</div>
</footer>
<div class="prints" aria-hidden="true"></div>
${radio(lang)}
<script type="application/json" id="tracks">${JSON.stringify(tracksFor(lang)).replace(/</g, "\\u003c")}</script>
<script src="/site.js" defer></script>${stroll ? `\n<script type="module" src="${strollScript}"></script>` : ""}
${page === "page-swamp" ? `<script type="module" src="${clickerScript}"></script>` : ""}${page === "page-creative" ? '<script src="/pet.js" defer></script>' : ""}
</body>
</html>
`;
}

// ---------- pieces ----------

function facts(lang, p) {
  const t = site.strings[lang];
  const s = stats.items[p.id];
  return [
    `<li>${mark(p.status)}${esc(statusLabel(lang, p.status))}</li>`,
    p.version ? `<li>${esc(tr(p.version, lang))}</li>` : "",
    s?.subscriptions != null ? `<li><span class="num strong">${fmt(lang, s.subscriptions)}</span> ${esc(plural(lang, s.subscriptions, "subsShort"))}</li>` : "",
    s?.downloads != null ? `<li><span class="num strong">${fmt(lang, s.downloads)}</span> ${esc(plural(lang, s.downloads, "downloadsShort"))}</li>` : "",
    s?.updated ? `<li class="soft">${esc(t.updated)} ${esc(longDate(lang, s.updated))}</li>` : "",
  ].join("");
}

function platformButtons(lang, p) {
  const t = site.strings[lang];
  return p.platforms
    .map((pl) => (pl.url ? `<a class="button" href="${esc(pl.url)}">${esc(pl.name)}</a>` : `<span class="off">${esc(pl.name)}, ${esc(t.notYet)}</span>`))
    .join("");
}

// The KFSOS Lite PDA: the pack's own interface themes (TabletTheme.java), the six sections of its description, the
// Chronos radio lines and the loading-screen tips (content/projects/kfsos-lite.json "terminal"). src/site.js runs it.
const KF_THEMES = ["rust", "glass", "neon", "classic"];
function kfPanel(lang, p, { page = false } = {}) {
  const t = site.strings[lang];
  const k = p.terminal;
  const names = { rust: t.kfRust, glass: t.kfGlass, neon: t.kfNeon, classic: t.kfClassic };
  const secs = k.sections.map((s) => ({ n: tr(s.name, lang), x: tr(s.text, lang) }));
  const data = { radio: k.radio.map((r) => tr(r, lang)), tips: k.tips.map((r) => tr(r, lang)), secs };
  return `<div class="shot kf" data-kf="neon">
<div class="kf-case">
<div class="kf-bar"><span class="kf-led" aria-hidden="true"></span><span class="kf-title">${esc(nameOf(p, lang))}</span><span class="kf-sub">${esc(t.kfTitle)}</span>
<div class="kf-themes" role="group" aria-label="${esc(t.kfThemes)}"><span class="kf-thname" aria-hidden="true">${esc(names.neon)}</span>${KF_THEMES.map((th) => `<button type="button" class="kf-th kf-th-${th}" data-kf-theme="${th}" aria-pressed="${th === "neon"}" aria-label="${esc(names[th])}" title="${esc(names[th])}"><span class="kf-sw" aria-hidden="true"></span></button>`).join("")}</div></div>
<div class="kf-screen">
<p class="kf-pitch">${esc(tr(k.pitch, lang))}</p>
<ol class="kf-secs">${secs.map((s, i) => `<li><button type="button" class="kf-sec" data-i="${i}" aria-pressed="${i === 0}"><span class="kf-n num">${String(i + 1).padStart(2, "0")}</span> ${esc(s.n)}</button></li>`).join("")}</ol>
<p class="kf-sec-text">${esc(secs[0].x)}</p>
<div class="kf-radio"><span class="kf-on">${esc(t.kfOnAir)}</span><p class="kf-line">${esc(data.radio[0])}</p></div>
<p class="kf-tip"><span class="kf-tip-h">${esc(t.kfTip)}:</span> <span class="kf-tip-t">${esc(data.tips[0])}</span></p>
</div>
<div class="kf-menu">${page ? "" : `<a class="kf-btn" href="${projectUrl(lang, p.id)}">${esc(t.kfEnter)}</a>`}<button type="button" class="kf-btn kf-next">${esc(t.kfNext)}</button></div>
</div>
<p class="kf-note">${esc(t.kfNote)}</p>
<script type="application/json" class="kf-data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>
</div>`;
}

function spread(lang, p, i) {
  const t = site.strings[lang];
  const href = p.page ? projectUrl(lang, p.id) : null;
  const gal = gallery(p);
  const [main, ...rest] = gal;
  const video = p.video?.file
    ? `<figure class="shot"><video class="loop" src="/${esc(p.video.file)}"${p.video.poster ? ` poster="/${esc(p.video.poster)}"` : ""} muted loop playsinline preload="metadata" aria-label="${esc(captionOf(lang, p, { caption: p.video.caption ?? {} }))}"></video>${
        p.video.caption?.[lang] ? `<figcaption>${esc(p.video.caption[lang])}</figcaption>` : ""
      }</figure>`
    : "";
  const strip = (list) => (list.length ? `<ul class="strip">${list
    .slice(0, 4)
    .map((g) => `<li>${zoom(g.info, { alt: captionOf(lang, p, g), caption: captionText(lang, g), group: p.id, small: true })}</li>`)
    .join("")}</ul>` : "");
  const figure = p.terminal
    ? kfPanel(lang, p)
    : p.titlecard && !video
    ? `<div class="shot shot-title">${titlecard(lang, p, { eager: i === 0 })}${strip(gal)}</div>`
    : video || !main
    ? video
    : `<figure class="shot">
${zoom(main.info, { alt: captionOf(lang, p, main), caption: captionText(lang, main), group: p.id, eager: i === 0, cls: "zoom-main" })}
${figcaption(lang, main)}
${rest.length ? `<ul class="strip">${rest
          .slice(0, 4)
          .map((g) => `<li>${zoom(g.info, { alt: captionOf(lang, p, g), caption: captionText(lang, g), group: p.id, small: true })}</li>`)
          .join("")}</ul>` : ""}
</figure>`;
  const more = href
    ? `<a class="more" href="${href}">${esc(p.kind === "modpack" ? t.aboutPack : p.kind === "game" ? t.aboutGame : t.aboutMod)}</a>${gal.length > 1 ? `<span class="soft">${gal.length} ${esc(plural(lang, gal.length, "pictures"))}</span>` : ""}`
    : "";
  return `<article class="spread${main || video || p.titlecard || p.terminal ? "" : " solo"}" data-reveal>
${figure}
<div class="spread-text">
<p class="kicker">${esc(tr(p.game, lang))}</p>
<h3 class="spread-name">${href ? `<a href="${href}">${esc(nameOf(p, lang))}</a>` : esc(nameOf(p, lang))}</h3>
<ul class="facts">${facts(lang, p)}</ul>
<p class="summary">${esc(tr(p.summary, lang))}</p>
<p class="actions">${platformButtons(lang, p)}${more}</p>
</div>
</article>`;
}

// A released mod that is not "featured": a compact row on the water, one small picture, the facts and one sentence.
function releasedRow(lang, p) {
  const href = p.page ? projectUrl(lang, p.id) : null;
  const [main] = gallery(p);
  const pic = main
    ? zoom(main.info, { alt: captionOf(lang, p, main), caption: captionText(lang, main), group: p.id, small: true })
    : `<span class="wrow-nopic" aria-hidden="true"></span>`;
  return `<li class="wrow" data-reveal>
<div class="wrow-pic">${pic}</div>
<div class="wrow-name"><p class="kicker">${esc(tr(p.game, lang))}</p><h4>${href ? `<a href="${href}">${esc(nameOf(p, lang))}</a>` : esc(nameOf(p, lang))}</h4><ul class="facts">${facts(lang, p)}</ul></div>
<p class="wrow-sum">${esc(tr(p.summary, lang))}</p>
</li>`;
}

function rowNumbers(lang, p) {
  const s = stats.items[p.id];
  const bits = [];
  if (p.version) bits.push(esc(tr(p.version, lang)));
  if (s?.subscriptions != null) bits.push(`<span class="num strong">${fmt(lang, s.subscriptions)}</span> ${esc(plural(lang, s.subscriptions, "subsShort"))}`);
  if (s?.downloads != null) bits.push(`<span class="num strong">${fmt(lang, s.downloads)}</span> ${esc(plural(lang, s.downloads, "downloadsShort"))}`);
  return bits.length ? `<p class="row-facts">${bits.join(", ")}</p>` : "";
}

function laterRow(lang, p) {
  const t = site.strings[lang];
  const where = p.platforms.length
    ? `<p class="row-where">${p.platforms.map((pl) => (pl.url ? `<a href="${esc(pl.url)}">${esc(pl.name)}</a>` : `${esc(pl.name)}, ${esc(t.notYet)}`)).join("; ")}</p>`
    : "";
  // A project that is not out yet shows its screenshots only when they are in its "gallery".
  const gal = gallery(p);
  const pics = gal.length
    ? `<ul class="row-pics">${gal
        .slice(0, 3)
        .map((g) => `<li>${zoom(g.info, { alt: captionOf(lang, p, g), caption: captionText(lang, g), group: p.id, small: true })}</li>`)
        .join("")}</ul>`
    : "";
  return `<li class="row${pics ? " has-pics" : ""}">
<p class="row-status">${mark(p.status)}${esc(statusLabel(lang, p.status))}</p>
<div class="row-name"><h3>${p.page ? `<a href="${projectUrl(lang, p.id)}">${esc(nameOf(p, lang))}</a>` : esc(nameOf(p, lang))}</h3><p class="row-game">${esc(tr(p.game, lang))}</p></div>
<div class="row-text"><p class="row-sum">${esc(tr(p.summary, lang))}</p>${rowNumbers(lang, p)}${where}${pics}</div>
</li>`;
}

function dateBlock(lang, iso, cls = "date") {
  const d = dateParts(lang, iso);
  return `<time class="${cls}" datetime="${iso}"><span class="date-day">${esc(d.day)}</span><span class="date-rest">${esc(d.month)} ${esc(d.year)}</span></time>`;
}

function postList(lang, list, { showProjects = true } = {}) {
  return `<ol class="posts">
${list
  .map((p) => {
    const L = p.langs[lang];
    const names = p.projects.map((id) => nameOf(byId[id], lang));
    const thumb = p.image ? picture(p.image) : null;
    return `<li class="post-row${thumb ? "" : " no-thumb"}">
${dateBlock(lang, p.date)}
<div class="post-row-main">
<h3><a href="${postUrl(lang, p.slug)}">${esc(L.title)}</a></h3>
${L.summary ? `<p>${esc(L.summary)}</p>` : ""}
${showProjects && names.length ? `<p class="tags">${names.map(esc).join(", ")}</p>` : ""}
</div>
${thumb ? `<img class="post-thumb" src="${esc(thumb.small)}" alt=""${thumb.sw ? ` width="${thumb.sw}" height="${thumb.sh}"` : ""} loading="lazy" decoding="async">` : ""}
</li>`;
  })
  .join("\n")}
</ol>`;
}


// ---------- the swamp at the top of the home page ----------
const REEDS = (side) => `<svg class="reeds reeds-${side}" viewBox="0 0 170 230" width="170" height="230" aria-hidden="true">
<path class="blade" d="M14 230 C 24 186 42 160 54 118 C 50 166 34 196 28 230 Z"/>
<g class="reed r1"><path d="M40 230 C 37 160 44 100 36 40"/><rect x="31" y="42" width="11" height="46" rx="5.5"/></g>
<g class="reed r2"><path d="M76 230 C 78 168 71 118 80 66"/><rect x="74" y="68" width="10" height="40" rx="5"/></g>
<path class="blade" d="M98 230 C 104 190 96 150 112 104 C 112 150 112 196 108 230 Z"/>
<g class="reed r3"><path d="M132 230 C 136 176 128 136 140 100"/><rect x="134" y="102" width="9" height="34" rx="4.5"/></g>
</svg>`;
const FIREFLIES = [[8, 22, 0], [19, 48, 1.7], [31, 16, 3.3], [52, 30, 0.6], [66, 18, 2.4], [74, 46, 4.1], [86, 26, 1.2], [93, 52, 3.8], [44, 56, 5.0]]
  .map(([x, y, d]) => `<span class="firefly" style="left:${x}%;top:${y}%;animation-delay:${d}s"></span>`)
  .join("");
const WAVE = (() => {
  let d = "M0 12";
  for (let x = 0; x < 2880; x += 240) d += ` Q ${x + 60} 4 ${x + 120} 12 Q ${x + 180} 20 ${x + 240} 12`;
  return `<svg class="pond-edge" viewBox="0 0 1440 24" preserveAspectRatio="none" aria-hidden="true"><path class="wave" d="${d} V 24 H 0 Z"/></svg>`;
})();
const PAD = (cls) => `<svg class="pad ${cls}" viewBox="0 0 60 22" width="60" height="22" aria-hidden="true"><ellipse cx="30" cy="11" rx="27" ry="9"/><path class="notch" d="M30 11 L60 6 L60 13 Z"/></svg>`;
const RIPPLES = [[22, 40, 0], [70, 30, 1.6], [84, 62, 3.1]]
  .map(([x, y, d]) => `<span class="ripple" style="left:${x}%;top:${y}%;animation-delay:${d}s"></span>`)
  .join("");

function reachBlock(lang) {
  const { reach: labels, locale } = site.strings[lang];
  const workshop = site.links.find(link => link.name === "Steam Workshop");
  const lantern = byId["belt-lantern"];
  const lanternLink = lantern.platforms.find(link => link.name === "Thunderstore");
  const views = projects.filter(project => project.workshopId)
    .map(project => stats.items[project.id]?.views).filter(Number.isFinite);
  const viewTotal = views.length ? views.reduce((sum, value) => sum + value, 0) : null;
  const downloads = stats.items[lantern.id]?.downloads;
  const counted = value => Number.isFinite(value) ? fmt(lang, value) : "—";
  const reddit = redditInsights;
  const redditViews = reddit.approximate
    ? "≈" + new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(reddit.views)
    : fmt(lang, reddit.views);
  const icon = (id, url, label) => `<a class="reach-platform" href="${esc(url)}" aria-label="${esc(label)}"><img src="/platforms/${id}.svg" width="19" height="19" alt=""></a>`;
  return `<section class="reach" aria-labelledby="reach-title">
<h2 id="reach-title" class="reach-title">${esc(labels.title)}</h2>
<ul class="reach-list">
<li>${icon("steam", workshop.url, workshop.name)}<div><b class="reach-number">${counted(viewTotal)}</b> <span>${esc(labels.workshopViews)}</span></div></li>
<li>${icon("thunderstore", lanternLink.url, "Belt Lantern · Thunderstore")}<div><b class="reach-number">${counted(downloads)}</b> <span>${esc(labels.lanternDownloads)}</span></div></li>
<li>${icon("reddit", reddit.profileUrl, labels.redditProfile)}<div><b class="reach-number">${esc(redditViews)}</b> <span>${esc(labels.redditViews)}</span><div class="reach-post"><a href="${esc(reddit.postUrl)}">${esc(reddit.postTitle)}</a><time datetime="${esc(reddit.measuredOn)}" title="Reddit Insights">${esc(longDate(lang, reddit.measuredOn))}</time></div></div></li>
</ul>
</section>`;
}

function hero(lang, total) {
  const t = site.strings[lang];
  return `<section class="hero" aria-labelledby="hero-h">
<div class="hero-sky" aria-hidden="true">${FIREFLIES}</div>
${REEDS("left")}${REEDS("right")}
<div class="wrap hero-in">
<div class="hero-text">
<h1 id="hero-h">${esc(t.lead)}</h1>
<p class="lede">${esc(t.about)}</p>
</div>
<div class="hero-stats">
${total ? `<p class="count"><span class="count-num">${fmt(lang, total)}</span><span class="count-label">${esc(plural(lang, total, "subs"))}</span><span class="count-date">${esc(t.countedOn)} ${esc(longDate(lang, stats.fetchedAt))}</span></p>` : ""}
${reachBlock(lang)}
</div>
</div>
<div class="pond">
${WAVE}
${PAD("pad-1")}${PAD("pad-2")}${PAD("pad-3")}
${RIPPLES}
<span class="frog-home${ON_LILY ? " on-lily" : ""}" aria-hidden="true">${ON_LILY ? PAD("home-pad") : ""}</span>
${FROG_BIG}
<p class="fly-score" aria-live="polite" data-score="${esc(t.fliesScore)}">${esc(t.fliesHint)}</p>
<p class="pond-play"><a class="button pond-btn" href="${playUrl(lang)}">${esc(t.playTitle)}</a><a class="pond-walk" href="${walkUrl(lang)}">3D: ${esc(SWAMP_WALK[lang].title)}</a></p>
</div>
<div class="flies"></div>
</section>`;
}

// A slow strip of real screenshots from every project that has some.
function reel(lang) {
  const t = site.strings[lang];
  const lists = projects.map((p) => gallery(p).slice(0, 2).map((g) => ({ p, g })));
  const items = [];
  for (let i = 0; i < 2; i++) for (const l of lists) if (l[i]) items.push(l[i]);
  if (items.length < 6) return "";
  const li = (copy) =>
    items
      .map(({ p, g }) => {
        const cap = captionText(lang, g) ? `${nameOf(p, lang)}: ${captionText(lang, g)}` : nameOf(p, lang);
        const link = zoom(g.info, { alt: copy ? "" : captionOf(lang, p, g), caption: cap, group: "reel", small: true });
        return `<li${copy ? ` aria-hidden="true"` : ""}>${copy ? link.replace('<a class="zoom"', '<a tabindex="-1" class="zoom"') : link}<span class="reel-name">${esc(nameOf(p, lang))}</span></li>`;
      })
      .join("");
  return `<section class="reel" aria-label="${esc(t.reelLabel)}"><ul class="reel-track">${li(false)}${li(true)}</ul></section>`;
}


// ---------- section pages ----------

const familyOf = (p) => tr(p.game, "en").split(/[ ,]/)[0];

// A row with a small picture, for the section pages.
function catRow(lang, p) {
  const t = site.strings[lang];
  const href = p.page ? projectUrl(lang, p.id) : null;
  const [main] = gallery(p);
  const pic = p.titlecard ? titlecard(lang, p, { small: true }) : main ? zoom(main.info, { alt: captionOf(lang, p, main), caption: captionText(lang, main), group: `c-${p.id}`, small: true }) : "";
  const where = p.platforms.length
    ? `<p class="row-where">${p.platforms.map((pl) => (pl.url ? `<a href="${esc(pl.url)}">${esc(pl.name)}</a>` : `${esc(pl.name)}, ${esc(t.notYet)}`)).join("; ")}</p>`
    : "";
  return `<li class="crow${main || p.titlecard ? "" : " no-pic"}">
<div class="crow-pic">${pic}</div>
<div class="crow-name"><h3>${href ? `<a href="${href}">${esc(nameOf(p, lang))}</a>` : esc(nameOf(p, lang))}</h3><p class="row-game">${esc(tr(p.game, lang))}</p><p class="row-status">${mark(p.status)}${esc(statusLabel(lang, p.status))}</p></div>
<div class="crow-text"><p class="row-sum">${esc(tr(p.summary, lang))}</p>${rowNumbers(lang, p)}${where}</div>
</li>`;
}

const bandOf = (lang, p, i) => `<div class="band water" style="--tint: ${esc(p.tint ?? "var(--water)")}"><div class="wrap">${spread(lang, p, i)}</div></div>`;

// Klyop in the outfit that fits the place (public/brand/klyop/*.webp, stickers for the plain poses).
const KLYOP_SECTION = { mods: "klyop/rimworld", games: "klyop/streamer", packs: "klyop/miner", support: "stickers/wave", blog: hasPic("brand/klyop/desk.webp") ? "klyop/desk" : "stickers/smug" };
const KLYOP_PROJECT = { "toi-late": "night-shift", scrapweld: "welder", kattila: "chemist", "peak-scouts": "climber", "belt-lantern": "lantern", "kfsos-lite": "miner", "kfsos-minecraft": "miner" };
const klyopFor = (p) => KLYOP_PROJECT[p.id] ?? (tr(p.game, "en").startsWith("RimWorld") ? "rimworld" : null);
const klyopImg = (rel, cls) => `<img class="${cls}" src="/brand/${rel}.webp" alt="" aria-hidden="true" loading="lazy" decoding="async">`;

function pageHead(lang, title, lede, pose = null) {
  return `<div class="wrap page-head${pose ? " has-klyop" : ""}"><h1>${esc(title)}</h1><p class="lede">${esc(lede)}</p>${pose ? klyopImg(pose, "head-klyop") : ""}</div>`;
}

function sectionPage(lang, key) {
  const t = site.strings[lang];
  let body = "";
  if (key === "mods") {
    const mods = projects.filter((p) => p.kind === "mod");
    const families = [...new Set(mods.map(familyOf))];
    const count = (f) => mods.filter((p) => familyOf(p) === f).length;
    body = `${pageHead(lang, t.navMods, t.modsLead, KLYOP_SECTION.mods)}
<nav class="wrap subtabs" aria-label="${esc(t.modsByGame)}"><a href="#mods-all" class="subtab" data-fam="" aria-current="true">${esc(t.modsAll)} <span class="num">${mods.length}</span></a>${families
  .map((f) => `<a href="#fam-${esc(f.toLowerCase())}" class="subtab" data-fam="${esc(f.toLowerCase())}">${esc(f)} <span class="num">${count(f)}</span></a>`)
  .join("")}</nav>
<div id="mods-all"></div>
${families
  .map((f) => `<section class="wrap cat fam" data-fam="${esc(f.toLowerCase())}" aria-labelledby="fam-${esc(f.toLowerCase())}"><h2 id="fam-${esc(f.toLowerCase())}">${esc(f)}</h2><ol class="crows">${mods.filter((p) => familyOf(p) === f).map((p) => catRow(lang, p)).join("\n")}</ol></section>`)
  .join("\n")}`;
  }
  if (key === "games") {
    const games = projects.filter((p) => p.kind === "game");
    const active = games.filter((p) => p.status !== "onhold");
    const held = games.filter((p) => p.status === "onhold");
    body = `${pageHead(lang, t.navGames, t.gamesLead, KLYOP_SECTION.games)}
${active.map((p, i) => bandOf(lang, p, i + 1)).join("\n")}
${held.length ? `<section class="wrap cat held" aria-labelledby="held-h"><h2 id="held-h">${esc(t.onHold)}</h2><p class="held-note">${esc(t.onHoldNote)}</p><ol class="crows">${held.map((p) => catRow(lang, p)).join("\n")}</ol></section>` : ""}`;
  }
  if (key === "packs") {
    const packs = projects.filter((p) => p.kind === "modpack");
    body = `${pageHead(lang, t.navPacks, t.packsLead, KLYOP_SECTION.packs)}
${packs.map((p, i) => bandOf(lang, p, i + 1)).join("\n")}`;
  }
  return layout({
    lang,
    paths: allPaths((l) => sectionUrl(l, key)),
    title: `${t[`nav${key[0].toUpperCase()}${key.slice(1)}`]}: VibeSwamp`,
    description: t[`${key}Lead`],
    current: key,
    body: body + `<div class="page-end"></div>`,
    jsonld: { "@context": "https://schema.org", "@type": "CollectionPage", name: t[`nav${key[0].toUpperCase()}${key.slice(1)}`], url: `${site.baseUrl}${sectionUrl(lang, key)}`, inLanguage: lang },
  });
}

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

const STICKERS = JSON.parse(readFileSync(join(pub, "brand", "stickers", "names.json"), "utf8"));
const STICKER_ORDER = ["smug", "wave", "fixed", "shocked", "stop", "broken", "hug", "vibe", "beat", "rock", "fly"].filter((k) => STICKERS[k]);
const QUOTE = { en: ["“", "”"], uk: ["«", "»"], ru: ["«", "»"] };

// Klyop at home (src/pet.js): he walks, reacts to taps, changes outfits and repeats what you type. Texts: content/pet.json.
const PET = existsSync(join(root, "content", "pet.json")) ? JSON.parse(readFileSync(join(root, "content", "pet.json"), "utf8")) : null;
function petStage(lang) {
  const t = site.strings[lang];
  const P = PET?.[lang] ?? PET?.en;
  if (!P) return `<img class="klyop-big" src="/brand/klyop-full.webp" width="560" height="1185" alt="${esc(t.toadAlt)}">`;
  const b = (k) => `<button type="button" class="pet-btn" data-pet="${k}">${esc(P[k])}</button>`;
  return `<div class="pet" role="group" aria-label="${esc(P.label)}">
<div class="pet-floor"><div class="pet-body"><p class="pet-say" aria-live="polite"></p><span class="pet-flip"><img class="pet-img" src="/brand/klyop-full.webp" width="560" height="1185" alt="${esc(t.toadAlt)}" draggable="false"></span></div></div>
<p class="pet-hint">${esc(P.hint)}</p>
<div class="pet-ctrl">${b("tea")}${b("fly")}${b("walk")}${b("outfit")}</div>
<form class="pet-talk"><input type="text" maxlength="140" placeholder="${esc(P.placeholder)}" aria-label="${esc(P.placeholder)}"><button type="submit" class="pet-btn">${esc(P.send)}</button></form>
<script type="application/json" id="pet-text">${JSON.stringify(P.say).replace(/</g, "\\u003c")}</script>
</div>`;
}

function creativePage(lang) {
  const t = site.strings[lang];
  const tracks = tracksFor(lang);
  const brand = [
    ["klyop-full.png", t.brandFull],
    ["klyop-peek.png", t.brandPeek],
    ["klyop-avatar-512.png", t.brandAvatar],
  ];
  const groups = [...new Set(tracks.map((m) => m.project))];
  const q = QUOTE[lang] ?? QUOTE.en;
  const body = `${pageHead(lang, t.navCreative, t.creativeLead)}
<section class="wrap swamp-door" aria-labelledby="swamp-h">
<div class="swamp-door-in">
<a class="swamp-door-pic" href="${playUrl(lang)}" tabindex="-1" aria-hidden="true"><img src="/brand/swamp/v2-stage-2-960.webp" width="960" height="640" alt="" loading="lazy" decoding="async"></a>
<div class="swamp-door-text">
<h2 class="swamp-door-name" id="swamp-h">${esc(t.playTitle)}</h2>
<p class="swamp-door-line">${esc(t.playDoor)}</p>
<p class="actions"><a class="button" href="${playUrl(lang)}">${esc(t.playLabel)}</a><a class="more" href="${walkUrl(lang)}">3D: ${esc(SWAMP_WALK[lang].title)}</a></p>
</div>
</div>
</section>
<section class="wrap klyop-sheet" aria-labelledby="klyop-h">
<div class="klyop-hero">
${petStage(lang)}
<div class="klyop-about">
<h2 id="klyop-h">${esc(t.klyopName)}</h2>
<p class="klyop-say">${q[0]}${esc(t.klyopPhrase)}${q[1]}</p>
<p>${esc(t.klyopText)}</p>
<p>${esc(t.toadText)}</p>
<ul class="downloads">${brand.map(([f, label]) => `<li><a href="/brand/${f}" download>${esc(label)}</a></li>`).join("")}</ul>
<p class="fly-total" data-label="${esc(t.fliesScore)}"></p>
</div>
</div>
<h3 class="stickers-h">${esc(t.stickersTitle)}</h3>
<p class="held-note">${esc(t.stickersNote)}</p>
<ul class="stickers">
${STICKER_ORDER.map((k) => `<li class="sticker"><img src="/brand/stickers/${k}.webp" width="320" height="320" alt="${esc(`${t.klyopName}: ${STICKERS[k][lang] ?? STICKERS[k].en}`)}" loading="lazy" decoding="async"><p class="st-name">${esc(STICKERS[k][lang] ?? STICKERS[k].en)}</p><p class="st-get"><a href="/brand/stickers/${k}.png" download="klyop-${k}.png">PNG</a><button type="button" class="st-share" data-png="/brand/stickers/${k}.png" data-name="klyop-${k}.png" data-done="${esc(t.stickerCopied)}" hidden>${esc(t.stickerShare)}</button></p></li>`).join("\n")}
</ul>
</section>
<section class="wrap cat" aria-labelledby="music-h">
<h2 id="music-h">${esc(t.musicTitle)}</h2>
<p class="held-note">${esc(t.musicNote)}</p>
<div class="albums">
${groups.map((g) => {
  const list = tracks.map((m, i) => ({ m, i })).filter(({ m }) => m.project === g);
  const mins = Math.round(list.reduce((sum, { m }) => sum + m.seconds, 0) / 60);
  return `<div class="album" style="--tint: ${esc(list[0].m.tint)}">
<div class="album-cover" aria-hidden="true"><span class="album-name">${esc(g)}</span><span class="album-stamp">${FROG}</span></div>
<div class="album-list"><h3>${esc(g)}</h3><p class="album-meta">${esc(list[0].m.credit)}, ${mins} ${esc(t.minShort)}</p>
<ol class="tracks">
${list.map(({ m, i }) => `<li class="track"><button type="button" class="play" data-track="${i}" aria-label="${esc(t.playLabel)}: ${esc(m.title)}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path class="i-play" d="M8 5v14l11-7z" fill="currentColor"/><path class="i-pause" d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg></button><span class="track-title">${esc(m.title)}</span><span class="track-time num">${mmss(m.seconds)}</span></li>`).join("\n")}
</ol>
</div>
</div>`;
}).join("\n")}
</div>
</section>
<div class="page-end"></div>`;
  return layout({
    lang,
    paths: allPaths((l) => sectionUrl(l, "creative")),
    title: `${t.navCreative}: VibeSwamp`,
    description: t.creativeLead,
    current: "creative",
    page: "page-creative",
    image: "brand/klyop-avatar-512.png",
    body,
    jsonld: { "@context": "https://schema.org", "@type": "CollectionPage", name: t.navCreative, url: `${site.baseUrl}${sectionUrl(lang, "creative")}`, inLanguage: lang },
  });
}

// Klyop builds the swamp: a slow clicker with the toad (src/swamp.js, texts in content/swamp.json).
const SWAMP = existsSync(join(root, "content", "swamp.json")) ? JSON.parse(readFileSync(join(root, "content", "swamp.json"), "utf8")) : null;
const SWAMP_V2 = await readJson("content", "swamp-v2.json");
const SWAMP_WALK = await readJson("content", "swamp-walk.json");

function playPage(lang) {
  const t = site.strings[lang];
  const S = SWAMP?.[lang] ?? SWAMP?.en ?? {};
  const body = `<header class="wrap sw-intro">
  <div><h1>${esc(t.playTitle)}</h1><p>${esc(S.v2?.ui?.goal ?? S.lead ?? t.playDoor)}</p></div>
  <a class="sw-walk-link" href="${walkUrl(lang)}">${esc(SWAMP_WALK[lang].enter)} <span aria-hidden="true">→</span></a>
</header>
<div class="wrap swamp" id="swamp">
<noscript><p class="held-note">${esc(S.noscript ?? "")}</p></noscript>
</div>
<script type="application/json" id="swamp-text">${JSON.stringify(S).replace(/</g, "\\u003c")}</script>
<script type="application/json" id="swamp-v2-data">${JSON.stringify(SWAMP_V2).replace(/</g, "\\u003c")}</script>
<div class="page-end"></div>`;
  return layout({
    lang,
    paths: allPaths(playUrl),
    title: `${t.playTitle}: VibeSwamp`,
    description: S.lead ?? t.playDoor,
    current: "creative",
    page: "page-swamp",
    image: "brand/klyop-avatar-512.png",
    body,
    jsonld: { "@context": "https://schema.org", "@type": "VideoGame", name: t.playTitle, url: `${site.baseUrl}${playUrl(lang)}`, inLanguage: lang, author: { "@type": "Person", name: site.author }, gamePlatform: "Web browser" },
  });
}

function walkPage(lang) {
  const swamp = SWAMP[lang];
  const names = list => list.map(({ id, name }) => ({ id, name }));
  const walk = { ...SWAMP_WALK[lang], deckPack: "/swamp-walk/mvp/deck-climb.json" };
  const w = { ...walk, loadingAssets: walk3d.walkLoadingAssets(walk, pub, warn), economyData: SWAMP_V2, shelterLabels: {
    title: SWAMP_WALK[lang].shelterLedger, producers: names(swamp.buildings), projects: names(swamp.builds),
  } };
  return walk3d.walkPageHtml({ lang, w, esc, backUrl: playUrl(lang), styles: walkStyles, script: walkScript });
}

function supportPage(lang) {
  const t = site.strings[lang];
  const discord = site.discord ? `<a href="${esc(site.discord)}">Discord</a>` : "Discord";
  const body = `${pageHead(lang, t.navSupport, t.supportLead, KLYOP_SECTION.support)}
<div class="wrap support">
<section aria-labelledby="bug-h"><h2 id="bug-h">${esc(t.bugTitle)}</h2><p>${esc(t.bugText)}</p><p class="mono-path">${esc(t.bugLogPath)}</p><p>${discord}</p></section>
<section aria-labelledby="idea-h"><h2 id="idea-h">${esc(t.ideaTitle)}</h2><p>${esc(t.ideaText)}</p></section>
<section aria-labelledby="thx-h"><h2 id="thx-h">${esc(t.thanks)}</h2><p>${esc(t.thanksText)}</p><p><a class="button" href="${esc(site.donate)}">donatello.to/EGYS1N</a></p></section>
<section aria-labelledby="also-h"><h2 id="also-h">${esc(t.helpAlsoTitle)}</h2><p>${esc(t.helpAlsoText)}</p></section>
</div>
<div class="page-end"></div>`;
  return layout({
    lang,
    paths: allPaths((l) => sectionUrl(l, "support")),
    title: `${t.navSupport}: VibeSwamp`,
    description: t.supportLead,
    current: "support",
    body,
    jsonld: { "@context": "https://schema.org", "@type": "WebPage", name: t.navSupport, url: `${site.baseUrl}${sectionUrl(lang, "support")}`, inLanguage: lang },
  });
}

// The doors on the home page: one line per section.
function doors(lang) {
  const t = site.strings[lang];
  const names = (kind) => projects.filter((p) => p.kind === kind).map((p) => nameOf(p, lang));
  const fam = [...new Set(projects.filter((p) => p.kind === "mod").map(familyOf))].join(", ");
  const n = (kind) => projects.filter((p) => p.kind === kind).length;
  const items = [
    ["mods", t.navMods, fam, n("mod")],
    ["games", t.navGames, names("game").join(", "), n("game")],
    ["packs", t.navPacks, names("modpack").join(", "), n("modpack")],
    ["creative", t.navCreative, t.doorCreative, null],
    ["support", t.navSupport, t.doorSupport, null],
  ];
  return `<nav class="doors" aria-labelledby="doors-h">
<div class="wrap">
<h2 id="doors-h" class="visually-hidden">${esc(t.doorsTitle)}</h2>
<ol class="door-list">
${items.map(([key, title, line, num]) => `<li class="door door-${key}"><a href="${sectionUrl(lang, key)}"><span class="door-name">${esc(title)}${num ? ` <span class="door-num num">${num}</span>` : ""}</span><span class="door-line">${esc(line)}</span></a></li>`).join("\n")}
</ol>
</div>
</nav>`;
}

// ---------- pages ----------

function indexPage(lang) {
  const t = site.strings[lang];
  const P = prefix(lang);
  const total = Object.values(stats.items).reduce((sum, s) => sum + (s.subscriptions ?? 0), 0);
  const main = projects.filter((p) => p.group !== "other");
  const other = projects.filter((p) => p.group === "other");
  const released = main.filter((p) => p.status === "released");
  const later = main.filter((p) => p.status === "preparing" || p.status === "inprogress");
  const held = main.filter((p) => p.status === "onhold");
  const spot = later.filter((p) => p.spotlight);
  const recent = postsIn(lang).slice(0, 3);
  const featured = released.filter((p) => p.featured || !released.some((x) => x.featured));
  const others = released.filter((p) => !featured.includes(p));
  // the main project, closest to release, goes right under the section doors (owner, 07.11: KFSOS Lite)
  const spotHtml = spot
    .map(
      (p) => `<section class="band water spot" style="--tint: ${esc(p.tint ?? "var(--water)")}" aria-labelledby="spot-${p.id}">
<div class="wrap">
<h2 id="spot-${p.id}" class="water-h">${esc(t.spotlight)}</h2>
${spread(lang, p, 1)}
</div>
</section>`
    )
    .join("\n");
  const body = `${hero(lang, total)}
${doors(lang)}
${spotHtml}
${reel(lang)}
<section id="projects" aria-labelledby="released-h">
${featured
  .map(
    (p, i) => `<div class="band water" style="--tint: ${esc(p.tint ?? "var(--water)")}">
<div class="wrap">
${i === 0 ? `<h2 id="released-h" class="water-h">${esc(t.released)}</h2>` : ""}
${spread(lang, p, i)}
</div>
</div>`
  )
  .join("\n")}
</section>
${recent.length ? `<section id="blog" class="blog-teaser wrap" aria-labelledby="blog-h">
<div class="sec-head"><h2 id="blog-h">${esc(t.blog)}</h2><p class="sec-links"><a href="${blogUrl(lang)}">${esc(t.allPosts)}</a><a href="${feedUrl(lang)}">${esc(t.feed)}</a></p></div>
${postList(lang, recent)}
</section>` : ""}
<section id="thanks" class="thanks" aria-labelledby="thanks-h">
<div class="wrap thanks-in">
<div>
<h2 id="thanks-h">${esc(t.thanks)}</h2>
<p>${esc(t.thanksText)}</p>
</div>
<div class="thanks-side">
<p><a class="button" href="${esc(site.donate)}">donatello.to/EGYS1N</a> <a class="more" href="${sectionUrl(lang, "support")}">${esc(t.supportMore)}</a></p>
<p class="also">${esc(t.elsewhere)} ${site.links.map((l) => `<a href="${esc(l.url)}">${esc(l.name)}</a>`).join(", ")}</p>
</div>
</div>
</section>`;
  return layout({
    lang,
    paths: allPaths(homeUrl),
    title: t.title,
    description: t.description,
    page: "home",
    image: released[0] ? gallery(released[0])[0]?.info.src : null,
    current: "",
    body,
    jsonld: {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: site.name,
      url: `${site.baseUrl}${homeUrl(lang)}`,
      inLanguage: lang,
      author: { "@type": "Person", name: site.author },
    },
  });
}

// A vertical short (9:16) beside the mod's description: no autoplay, nothing loads until play (owner, 08.11.2026:
// «видос можно выложить на сайт»). The file comes from the social chat's shorts; replacing the voice is one file.
// Under it: who made what (Klyop by a neural network, music in Suno, and the voice too when "voice" is "suno"), and the
// Ludeon notice, since the footage is RimWorld.
function shortVideo(lang, p) {
  const t = site.strings[lang];
  const v = p.short;
  const credit = [tr(v.credits, lang), v.voice === "suno" ? tr(v.voiceSuno, lang) : ""].filter(Boolean).join(" ");
  return `<figure class="short">
<video class="short-video" controls preload="none" playsinline poster="/${esc(v.poster)}" width="720" height="1280" lang="${esc(v.lang ?? "ru")}" aria-label="${esc(tr(v.label, lang) ?? "")}"><source src="/${esc(v.file)}" type="video/mp4"></video>
<figcaption>${tr(v.caption, lang) ? `<span class="short-cap">${esc(tr(v.caption, lang))}</span>` : ""}${credit ? `<span class="short-credit">${esc(credit)}</span>` : ""}${p.ludeon && t.disclaimer ? `<span class="short-legal" lang="en">${esc(t.disclaimer)}</span>` : ""}</figcaption>
</figure>`;
}

function projectPage(lang, p) {
  const t = site.strings[lang];
  const s = stats.items[p.id];
  const gal = gallery(p);
  const [main, ...rest0] = gal;
  const rest = p.titlecard ? gal : rest0;
  const rows = [
    [t.status, `${mark(p.status)}${esc(statusLabel(lang, p.status))}`],
    p.version ? [t.version, esc(tr(p.version, lang))] : null,
    s?.subscriptions != null ? [t.subscribers, `<span class="num">${fmt(lang, s.subscriptions)}</span>`] : null,
    s?.downloads != null ? [t.downloads, `<span class="num">${fmt(lang, s.downloads)}</span>`] : null,
    s?.created ? [t.firstRelease, esc(longDate(lang, s.created))] : null,
    s?.updated ? [t.updatedCap, esc(longDate(lang, s.updated))] : null,
  ].filter(Boolean);
  const related = postsIn(lang).filter((x) => x.projects.includes(p.id));
  const body = `<section class="water water-top">
<div class="wrap">
<p class="crumb"><a href="${sectionUrl(lang, SECTION_OF_KIND[p.kind] ?? "mods")}">${esc(t[{ mods: "navMods", games: "navGames", packs: "navPacks" }[SECTION_OF_KIND[p.kind] ?? "mods"]])}</a></p>
<div class="spread${main || p.titlecard || p.terminal ? "" : " solo"}">
${p.terminal ? kfPanel(lang, p, { page: true }) : p.titlecard ? `<div class="shot shot-title">${titlecard(lang, p, { eager: true })}</div>` : main ? `<figure class="shot">
${zoom(main.info, { alt: captionOf(lang, p, main), caption: captionText(lang, main), group: p.id, eager: true, cls: "zoom-main" })}
${figcaption(lang, main)}
</figure>` : ""}
<div class="spread-text">
<p class="kicker">${esc(tr(p.game, lang))}</p>
<h1 class="spread-name">${esc(nameOf(p, lang))}</h1>
<p class="summary">${esc(tr(p.summary, lang))}</p>
<table class="facts-table">${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${v}</td></tr>`).join("")}</table>
${p.status === "onhold" ? `<p class="hold-note">${esc(t.onHoldNote)}</p>` : ""}
<p class="actions">${platformButtons(lang, p)}</p>
</div>
</div>
</div>
</section>
${(tr(p.details, lang) || []).length ? `<div class="wrap project-body">${!p.short && klyopFor(p) ? klyopImg(`klyop/${klyopFor(p)}`, "proj-klyop") : ""}<div class="prose">${tr(p.details, lang).map((para) => `<p>${esc(para)}</p>`).join("\n")}</div>${p.short ? shortVideo(lang, p) : ""}</div>` : ""}
${(tr(p.plans, lang) || []).length ? `<section class="wrap plans" aria-labelledby="plans-h">
<h2 id="plans-h"><span class="wire" aria-hidden="true"></span>${esc(t.plans)}</h2>
<ul class="plan-list">${tr(p.plans, lang).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
<p class="plans-note">${esc(t.plansNote)}</p>
</section>` : ""}
${rest.length ? `<section class="wrap gallery" aria-labelledby="pics-h">
<h2 id="pics-h">${esc(t.pictures)}</h2>
<ul class="gallery-cols">
${rest
  .map((g) => `<li><figure>${zoom(g.info, { alt: captionOf(lang, p, g), caption: captionText(lang, g), group: p.id })}${figcaption(lang, g)}</figure></li>`)
  .join("\n")}
</ul>
</section>` : ""}
${p.platforms.some((pl) => pl.url) ? `<div class="wrap actions-end"><p class="actions"><span class="actions-name">${esc(nameOf(p, lang))}</span>${platformButtons(lang, p)}</p></div>` : ""}
${related.length ? `<section class="wrap project-posts" aria-labelledby="posts-h">
<div class="sec-head"><h2 id="posts-h">${esc(t.projectPosts)}</h2><p class="sec-links"><a href="${blogUrl(lang)}">${esc(t.allPosts)}</a></p></div>
${postList(lang, related, { showProjects: false })}
</section>` : `<div class="page-end"></div>`}`;
  return layout({
    lang,
    paths: allPaths((l) => projectUrl(l, p.id)),
    title: `${nameOf(p, lang)}: ${tr(p.game, lang)}, VibeSwamp`,
    description: tr(p.summary, lang),
    image: main?.info.src,
    current: SECTION_OF_KIND[p.kind] ?? "mods",
    body,
    jsonld: {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: nameOf(p, lang),
      applicationCategory: "GameApplication",
      description: p.summary.en,
      author: { "@type": "Person", name: site.author },
      url: `${site.baseUrl}${projectUrl("en", p.id)}`,
      ...(main ? { image: `${site.baseUrl}${main.info.src}` } : {}),
      ...(p.version ? { softwareVersion: tr(p.version, "en") } : {}),
      ...(s?.created ? { datePublished: s.created } : {}),
      ...(s?.updated ? { dateModified: s.updated } : {}),
      sameAs: p.platforms.filter((pl) => pl.url).map((pl) => pl.url),
    },
  });
}

function blogPage(lang) {
  const t = site.strings[lang];
  const list = postsIn(lang);
  const body = `<div class="wrap page-head has-klyop">
<h1>${esc(t.blog)}</h1>
<p class="lede">${esc(t.blogLead)}</p>
<p class="sec-links"><a href="${feedUrl(lang)}">${esc(t.feed)}</a></p>
${klyopImg(KLYOP_SECTION.blog, "head-klyop")}
</div>
<div class="wrap blog-page">
${postList(lang, list)}
</div>`;
  return layout({
    lang,
    paths: allPaths(blogUrl),
    title: `${t.blog}: VibeSwamp`,
    description: t.blogLead,
    current: "blog",
    body,
    jsonld: {
      "@context": "https://schema.org",
      "@type": "Blog",
      name: `${site.name}: ${t.blog}`,
      url: `${site.baseUrl}${blogUrl(lang)}`,
      inLanguage: lang,
      author: { "@type": "Person", name: site.author },
      blogPost: list.map((p) => ({ "@type": "BlogPosting", headline: p.langs[lang].title, datePublished: p.date, url: `${site.baseUrl}${postUrl(lang, p.slug)}` })),
    },
  });
}

function postHtml(lang, p) {
  return markdown(p.langs[lang].body, `post-${p.slug}`);
}

function postPage(lang, p) {
  const t = site.strings[lang];
  const L = p.langs[lang];
  const list = postsIn(lang);
  const i = list.indexOf(p);
  const newer = list[i - 1];
  const older = list[i + 1];
  const navLink = (x, cls, label) =>
    x ? `<a class="${cls}" href="${postUrl(lang, x.slug)}"><span class="label">${esc(label)}</span><span class="title">${esc(x.langs[lang].title)}</span></a>` : "";
  const body = `<article class="post wrap">
<p class="crumb"><a href="${blogUrl(lang)}">${esc(t.blog)}</a></p>
<div class="post-grid">
${dateBlock(lang, p.date, "date date-margin")}
<div class="post-col">
<h1>${esc(L.title)}</h1>
${p.projects.length ? `<p class="tags">${p.projects.map((id) => (byId[id].page ? `<a href="${projectUrl(lang, id)}">${esc(nameOf(byId[id], lang))}</a>` : esc(nameOf(byId[id], lang)))).join(", ")}</p>` : ""}
<div class="prose">
${postHtml(lang, p)}
</div>
${newer || older ? `<nav class="post-nav">${navLink(older, "older", t.olderPost)}${navLink(newer, "newer", t.newerPost)}</nav>` : ""}
</div>
</div>
</article>`;
  return layout({
    lang,
    paths: allPaths((l) => (p.langs[l] ? postUrl(l, p.slug) : blogUrl(l))),
    title: `${L.title}: VibeSwamp`,
    description: L.summary || L.title,
    image: p.image,
    current: "blog",
    body,
    jsonld: {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: L.title,
      description: L.summary || undefined,
      datePublished: p.date,
      inLanguage: lang,
      url: `${site.baseUrl}${postUrl(lang, p.slug)}`,
      author: { "@type": "Person", name: site.author },
      ...(p.image ? { image: `${site.baseUrl}/${p.image.replace(/^\/+/, "")}` } : {}),
      about: p.projects.map((id) => ({
        "@type": "SoftwareApplication",
        name: nameOf(byId[id], lang),
        ...(byId[id].page ? { url: `${site.baseUrl}${projectUrl("en", id)}` } : {}),
      })),
    },
  });
}

// Atom feed, one per language. Feed readers call it RSS, so the site does too.
function feed(lang) {
  const t = site.strings[lang];
  const list = postsIn(lang);
  const abs = (html) => html.replace(/(href|src)="\/(?!\/)/g, `$1="${site.baseUrl}/`);
  const stamp = (iso) => `${iso}T12:00:00Z`;
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${lang}">
<title>${esc(`${site.name}: ${t.blog}`)}</title>
<subtitle>${esc(t.blogLead)}</subtitle>
<link rel="self" type="application/atom+xml" href="${site.baseUrl}${feedUrl(lang)}"/>
<link rel="alternate" type="text/html" href="${site.baseUrl}${blogUrl(lang)}"/>
<id>${site.baseUrl}${blogUrl(lang)}</id>
<updated>${stamp(list[0]?.date ?? "2026-01-01")}</updated>
<author><name>${esc(site.author)}</name></author>
<icon>${site.baseUrl}/favicon.png</icon>
${list
  .map((p) => {
    const L = p.langs[lang];
    return `<entry>
<title>${esc(L.title)}</title>
<link rel="alternate" type="text/html" href="${site.baseUrl}${postUrl(lang, p.slug)}"/>
<id>${site.baseUrl}${postUrl(lang, p.slug)}</id>
<published>${stamp(p.date)}</published>
<updated>${stamp(p.date)}</updated>
${L.summary ? `<summary>${esc(L.summary)}</summary>\n` : ""}${p.projects.map((id) => `<category term="${esc(id)}" label="${esc(nameOf(byId[id], lang))}"/>`).join("\n")}
<content type="html">${esc(abs(postHtml(lang, p)))}</content>
</entry>`;
  })
  .join("\n")}
</feed>
`;
}

// llms.txt: a plain list for AI crawlers and search assistants, with first-release dates and the blog.
function llmsTxt() {
  const t = site.strings.en;
  const groups = [
    ["Released", "released"],
    ["Being prepared", "preparing"],
    ["In the works", "inprogress"],
    ["On hold", "onhold"],
  ];
  const isOther = (p) => p.group === "other";
  const line = (p) => {
    const s = stats.items[p.id];
    const url = p.page ? `${site.baseUrl}${projectUrl("en", p.id)}` : null;
    const where = p.platforms.filter((pl) => pl.url).map((pl) => `${pl.name}: ${pl.url}`).join("; ");
    return `- ${url ? `[${nameOf(p, "en")}](${url})` : nameOf(p, "en")} (${p.game.en}${p.version ? `, ${tr(p.version, "en")}` : ""}): ${p.summary.en}${
      s?.created ? ` First released ${s.created}.` : ""
    }${s?.subscriptions != null ? ` ${s.subscriptions} Steam Workshop subscribers on ${stats.fetchedAt}.` : ""}${
      s?.downloads != null ? ` ${s.downloads} downloads on Thunderstore on ${s.counted}.` : ""
    }${where ? ` ${where}` : ""}`;
  };
  return `# ${site.name}

> ${t.description}

${groups
  .map(([title, st]) => {
    const list = projects.filter((p) => p.status === st && !isOther(p));
    return list.length ? `## ${title}\n\n${list.map(line).join("\n")}\n` : "";
  })
  .filter(Boolean)
  .join("\n")}
${projects.some(isOther) ? `## Other mods and games\n\n${projects.filter(isOther).map(line).join("\n")}\n\n` : ""}${site.discord ? `## Community\n\nDiscord server for bugs, ideas and screenshots: ${site.discord}\n\n` : ""}## Blog

Feed: ${site.baseUrl}${feedUrl("en")}

${postsIn("en")
  .map((p) => `- ${p.date}: [${p.langs.en.title}](${site.baseUrl}${postUrl("en", p.slug)})${p.langs.en.summary ? `. ${p.langs.en.summary}` : ""}`)
  .join("\n")}
`;
}

// ---------- write everything ----------

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(pub, dist, { recursive: true });
await cp(join(root, "src", "style.css"), join(dist, "style.css"));
await cp(join(root, "src", "swamp.css"), join(dist, "swamp.css"));
await cp(join(root, "src", "site.js"), join(dist, "site.js"));
await cp(join(root, "src", "swamp"), join(dist, "swamp"), { recursive: true });
await cp(join(root, "src", "swamp-walk"), join(dist, "swamp-walk"), { recursive: true });
await cp(join(root, "src", "klyop-stroll.mjs"), join(dist, "klyop-stroll.mjs"));
if (existsSync(join(root, "src", "pet.js"))) await cp(join(root, "src", "pet.js"), join(dist, "pet.js"));

for (const [name, source] of emittedModules) await writeFile(join(dist, name), source);

const pages = [];
const write = async (path, html) => {
  const file = join(dist, ...path.split("/").filter(Boolean), "index.html");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
  pages.push(path);
};

for (const lang of site.languages) {
  await write(homeUrl(lang), indexPage(lang));
  for (const p of projects.filter((x) => x.page)) await write(projectUrl(lang, p.id), projectPage(lang, p));
  await write(blogUrl(lang), blogPage(lang));
  for (const key of ["mods", "games", "packs"]) await write(sectionUrl(lang, key), sectionPage(lang, key));
  await write(sectionUrl(lang, "creative"), creativePage(lang));
  if (SWAMP) {
    await write(playUrl(lang), playPage(lang));
    await write(walkUrl(lang), walkPage(lang));
  }
  await write(sectionUrl(lang, "support"), supportPage(lang));
  for (const p of postsIn(lang)) await write(postUrl(lang, p.slug), postPage(lang, p));
  await mkdir(join(dist, ...prefix(lang).split("/").filter(Boolean)), { recursive: true });
  await writeFile(join(dist, ...feedUrl(lang).split("/").filter(Boolean)), feed(lang));
}

await writeFile(join(dist, "llms.txt"), llmsTxt());
await writeFile(
  join(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .map((p) => `<url><loc>${site.baseUrl}${p}</loc></url>`)
    .join("\n")}\n</urlset>\n`
);
await writeFile(join(dist, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${site.baseUrl}/sitemap.xml\n`);

console.log(`built ${pages.length} pages into dist/ (stats ${stats.fetchedAt ?? "none"})`);

// The GitHub profile README (github/, kept by the GitHub chat) is rebuilt from the same project files.
try { const { writeReadme } = await import("./github/build-readme.mjs"); await writeReadme(); } catch (e) { console.warn("github README:", e.message); }
