// Portfolio page and one-page CV for paid work (portfolio/PLAN.md). Separate from the swamp look on purpose:
// a business page a hiring person reads in 30 seconds. Data: content/portfolio.json; numbers come from
// content/stats.json at build time so the page and the job letter quote the same figures.
// build.mjs calls portfolioPages() once per language and writes what it returns.

const PREFIX = { en: "", uk: "/uk", ru: "/ru" };
const LOCALE = { en: "en-GB", uk: "uk-UA", ru: "ru-RU" };
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function portfolioPaths(lang) {
  return { page: `${PREFIX[lang]}/portfolio/`, cv: `${PREFIX[lang]}/portfolio/cv/` };
}

function numbers(lang, stats) {
  const items = Object.values(stats?.items ?? {});
  const mods = items.filter((s) => s && s.subscriptions != null);
  const sum = (k) => mods.reduce((n, s) => n + (Number(s[k]) || 0), 0);
  const nf = new Intl.NumberFormat(LOCALE[lang]);
  const belt = stats?.items?.["belt-lantern"]?.downloads;
  const date = stats?.fetchedAt ? new Intl.DateTimeFormat(LOCALE[lang], { day: "numeric", month: "long", year: "numeric" }).format(new Date(stats.fetchedAt + "T12:00:00Z")).replace(/\s*р\.$|\s*г\.$/, "") : "";
  return { mods: String(mods.length), subs: nf.format(sum("subscriptions")), views: nf.format(sum("views")), belt: belt != null ? nf.format(belt) : "—", date };
}

const linkLabel = (u) => { try { const x = new URL(u); return x.hostname === "github.com" || x.hostname.endsWith("github.io") ? (x.hostname + x.pathname).replace(/\/$/, "") : x.hostname.replace(/^www\./, ""); } catch { return u; } };
const fill = (text, n) => String(text ?? "").replace(/\{(\w+)\}/g, (m, k) => (k in n ? n[k] : m));

const CSS = `
:root{--bg:#f5f6f1;--card:#ffffff;--ink:#1d261b;--ink-2:#4c5a48;--line:#d9ded2;--accent:#2f5d3a;--accent-2:#e8efe3}
@media (prefers-color-scheme: dark){:root{--bg:#11160f;--card:#182016;--ink:#e6ecdf;--ink-2:#a9b6a2;--line:#2c3829;--accent:#9fd18a;--accent-2:#1f2a1c}}
@font-face{font-family:Overpass;src:url(/fonts/overpass-latin.woff2) format("woff2");font-weight:100 900;unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215}
@font-face{font-family:Overpass;src:url(/fonts/overpass-cyrillic.woff2) format("woff2");font-weight:100 900;unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
@font-face{font-family:Bitter;src:url(/fonts/bitter-latin.woff2) format("woff2");font-weight:100 900;unicode-range:U+0000-00FF,U+2000-206F}
@font-face{font-family:Bitter;src:url(/fonts/bitter-cyrillic.woff2) format("woff2");font-weight:100 900;unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 Overpass,"Segoe UI",system-ui,sans-serif}
a{color:var(--accent)}a:hover{text-decoration-thickness:2px}
.wrap{max-width:880px;margin:0 auto;padding:0 16px}
.top{border-bottom:1px solid var(--line)}.top .wrap{display:flex;justify-content:space-between;align-items:center;min-height:52px;gap:12px}
.brand{font:600 15px Bitter,Georgia,serif;color:var(--ink);text-decoration:none}
.langs{display:flex;gap:4px}.langs a,.langs span{padding:4px 8px;border-radius:6px;font-size:14px;text-decoration:none}.langs span{background:var(--accent-2);color:var(--ink);font-weight:700}
h1,h2,h3{font-family:Bitter,Georgia,serif;line-height:1.2;margin:0}
.hero{padding:36px 0 12px}.who{margin:0 0 8px;color:var(--ink-2);font-weight:700;letter-spacing:.02em}
.hero h1{font-size:clamp(26px,5.4vw,38px)}.hero .sub{margin:12px 0 0;color:var(--ink-2);font-size:17px;max-width:46em}
.nums{list-style:none;padding:0;margin:22px 0 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
.nums li{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;font-size:15px}
.links{margin:18px 0 0;display:flex;flex-wrap:wrap;gap:8px 16px;font-size:15px}
section{padding:24px 0}section>h2{font-size:24px;margin-bottom:14px}
.case{background:var(--card);border:1px solid var(--line);border-radius:12px;margin:0 0 14px;overflow:hidden;display:grid;grid-template-columns:1fr}
.case.has-img{grid-template-columns:220px 1fr}.case img{width:100%;height:100%;object-fit:cover;display:block;min-height:160px}
.case .body{padding:16px 18px;min-width:0;overflow-wrap:anywhere}.case h3{font-size:20px;margin-bottom:10px}
.case dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:6px 12px}.case dt{color:var(--ink-2);font-weight:700;font-size:14px;padding-top:1px}.case dd{margin:0}
.case .go{display:inline-block;margin-top:10px;font-size:15px}
@media (max-width:640px){.case.has-img{grid-template-columns:1fr}.case img{max-height:200px}.case dl{grid-template-columns:1fr}.case dt{margin-top:6px}}
.steps{counter-reset:s;list-style:none;padding:0;margin:0;display:grid;gap:10px}
.steps li{counter-increment:s;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px 12px 52px;position:relative}
.steps li::before{content:counter(s);position:absolute;left:14px;top:11px;width:26px;height:26px;border-radius:50%;background:var(--accent);color:var(--bg);font-weight:700;display:grid;place-items:center;font-size:14px}
.steps b{display:block}.why{margin:14px 0 0;padding:12px 16px;border-left:3px solid var(--accent);font-family:Bitter,Georgia,serif;font-size:18px}
.tools{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:8px}.tools li{border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:14px;background:var(--card)}
.story{margin:0;font-size:18px;max-width:46em}.about h3{font-size:18px;margin:20px 0 10px}
.exp{list-style:none;padding:0;margin:0;display:grid;gap:10px}.exp li{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.exp b{display:block}
.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}.gallery figure{margin:0}.gallery img{width:100%;display:block;border-radius:8px;border:1px solid var(--line)}.gallery figcaption{margin-top:4px;font-size:14px;color:var(--ink-2)}
.lead-in,.station{margin:0 0 12px;max-width:46em}.station{margin:14px 0 0}
footer{border-top:1px solid var(--line);padding:18px 0 40px;color:var(--ink-2);font-size:14px}
/* one-page CV */
.cv{max-width:780px;padding-top:28px}.cv h1{font-size:30px}.cv .line{margin:6px 0 0;color:var(--ink-2)}
.cv .contacts{margin:10px 0 0;display:flex;flex-wrap:wrap;gap:4px 14px;font-size:14px}
.cv h2{font-size:17px;margin:20px 0 8px;padding-bottom:4px;border-bottom:1px solid var(--line)}
.cv ul{margin:0;padding-left:18px}.cv li{margin:0 0 6px}.cv p{margin:0}
.cv .print{margin:22px 0;font:inherit;font-size:15px;padding:8px 14px;border-radius:8px;border:1px solid var(--accent);background:var(--card);color:var(--accent);cursor:pointer}
@page{size:A4;margin:14mm 14mm}
@media print{:root{--bg:#fff;--card:#fff;--ink:#111;--ink-2:#444;--line:#ccc;--accent:#1d4a29}body{font-size:11pt;line-height:1.4}.top,.print,.no-print,footer{display:none}.cv{padding:0;max-width:none}.cv h2{margin-top:12px}a{color:inherit;text-decoration:none}}
`;

function shell({ lang, title, description, canonical, alternates, body, site }) {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${site.baseUrl}${canonical}">
${Object.entries(alternates).map(([l, p]) => `<link rel="alternate" hreflang="${l}" href="${site.baseUrl}${p}">`).join("\n")}
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${site.baseUrl}${canonical}">
<link rel="icon" href="/favicon.png" type="image/png">
<link rel="preload" href="/fonts/overpass-${lang === "en" ? "latin" : "cyrillic"}.woff2" as="font" type="font/woff2" crossorigin>
<style>${CSS}</style>
</head>
<body>
${body}
</body>
</html>`;
}

function topBar(lang, site, which) {
  const langs = site.languages.map((l) => {
    const p = portfolioPaths(l)[which];
    const label = site.strings[l]?.langShort ?? l;
    return l === lang ? `<span lang="${l}">${esc(label)}</span>` : `<a href="${p}" hreflang="${l}" lang="${l}">${esc(label)}</a>`;
  });
  return `<header class="top"><div class="wrap"><a class="brand" href="${PREFIX[lang] || "/"}${PREFIX[lang] ? "/" : ""}">VibeSwamp</a><nav class="langs" aria-label="Language">${langs.join("")}</nav></div></header>`;
}

export function portfolioPages({ lang, site, stats, data, picture }) {
  const t = data.strings[lang];
  if (!t) return [];
  const n = numbers(lang, stats);
  const L = data.links;
  const who = data.name ? `${data.name} (EGYS1N)` : "EGYS1N";
  const paths = portfolioPaths(lang);
  const alt = (which) => Object.fromEntries(site.languages.map((l) => [l, portfolioPaths(l)[which]]));
  const tr = (o) => fill(o?.[lang] ?? o?.en ?? "", n);
  const linkRow = [
    [L.site, "vibeswamp.github.io"],
    [L.github, "GitHub"],
    [L.steam, "Steam Workshop"],
    [L.discord, "Discord"],
  ];
  const img = (rel) => {
    if (!rel) return "";
    const info = picture ? picture(rel) : { src: `/${rel}` };
    const src = info.mid || info.small || info.src;
    return `<img src="${esc(src)}" alt="" loading="lazy" decoding="async">`;
  };
  const cases = data.cases
    .map((c) => `<article class="case${c.image ? " has-img" : ""}">${img(c.image)}<div class="body"><h3>${esc(tr(c.title))}</h3><dl>
<dt>${esc(t.task)}</dt><dd>${esc(tr(c.task))}</dd>
<dt>${esc(t.done)}</dt><dd>${esc(tr(c.done))}</dd>
<dt>${esc(t.how)}</dt><dd>${esc(tr(c.how))}</dd>
<dt>${esc(t.proof)}</dt><dd>${esc(tr(c.proof))}</dd>
<dt>${esc(t.role)}</dt><dd>${esc(tr(c.role))}</dd>
</dl>${c.link ? `<a class="go" href="${esc(c.link)}">${esc(c.linkText ? tr(c.linkText) : linkLabel(c.link))}</a>` : ""}</div></article>`)
    .join("\n");
  const steps = (data.steps[lang] ?? []).map(([h, p]) => `<li><b>${esc(h)}</b>${esc(p)}</li>`).join("");
  const contacts = `<p class="links">${linkRow.map(([u, l]) => `<a href="${esc(u)}">${esc(l)}</a>`).join("")}${data.contact ? `<span>${esc(data.contact)}</span>` : ""}</p>`;
  const experience = data.experience ?? [];
  // Old print work shows only once the owner sends pictures; an empty list hides the block.
  const oldWorks = (data.oldWorks ?? []).filter((w) => w.image);
  const about = t.about ? `<section class="about"><h2>${esc(t.aboutTitle)}</h2>
<p class="story">${esc(fill(t.about, n))}</p>
${experience.length ? `<h3>${esc(t.expTitle)}</h3><ul class="exp">${experience.map((e) => `<li><b>${esc(tr(e.title))}</b>${esc(tr(e.text))}</li>`).join("")}</ul>` : ""}
${oldWorks.length ? `<h3>${esc(t.oldWorksTitle)}</h3><div class="gallery">${oldWorks.map((w) => `<figure>${img(w.image)}<figcaption>${esc(tr(w.caption))}</figcaption></figure>`).join("")}</div>` : ""}
</section>` : "";

  const page = `${topBar(lang, site, "page")}
<main class="wrap">
<section class="hero">
<p class="who">${esc(who)}</p>
<h1>${esc(t.lead)}</h1>
<p class="sub">${esc(t.sub)}</p>
<ul class="nums">${t.nums.map((x) => `<li>${esc(fill(x, n))}</li>`).join("")}</ul>
<p class="links"><a href="${paths.cv}"><b>${esc(t.cvLink)}</b></a></p>
</section>
${about}
<section><h2>${esc(t.casesTitle)}</h2>
${cases}
</section>
<section><h2>${esc(t.stepsTitle)}</h2>
${t.stepsLead ? `<p class="lead-in">${esc(t.stepsLead)}</p>` : ""}
<ol class="steps">${steps}</ol>
<p class="why">${esc(data.why[lang])}</p>
</section>
<section><h2>${esc(t.toolsTitle)}</h2><ul class="tools">${data.tools.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>${t.station ? `<p class="station">${esc(t.station)}</p>` : ""}${t.vr ? `<p class="station">${esc(t.vr)}</p>` : ""}</section>
<section><h2>${esc(t.contactsTitle)}</h2>${contacts}</section>
</main>
<footer><div class="wrap">${esc(fill(t.updated, n))}</div></footer>`;

  // The CV uses each case's short "cv" line so the whole sheet fits one A4 page.
  const cvItems = data.cases
    .map((c) => `<li>${c.cv ? esc(tr(c.cv)) : `<b>${esc(tr(c.title))}.</b> ${esc(tr(c.done))}`}</li>`)
    .join("\n");
  const bare = (u) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const cvLinks = [`${site.baseUrl}${paths.page}`, L.site, L.github, L.steam, L.discord];
  const cv = `${topBar(lang, site, "cv")}
<main class="wrap cv">
<h1>${esc(who)}</h1>
<p class="line">${esc(t.lead)}</p>
<p class="contacts">${cvLinks.map((u) => `<a href="${esc(u)}">${esc(bare(u))}</a>`).join("")}${data.contact ? `<span>${esc(data.contact)}</span>` : ""}</p>
<h2>${esc(t.cvTitle)}</h2>
<p>${esc(t.cvSummary)}</p>
${experience.length ? `<h2>${esc(t.expTitle)}</h2>
<ul>${experience.map((e) => `<li><b>${esc(tr(e.title))}.</b> ${esc(tr(e.text))}</li>`).join("")}</ul>` : ""}
<h2>${esc(t.cvProjects)}</h2>
<ul>${cvItems}</ul>
<h2>${esc(t.cvSkills)}</h2>
<p>${esc(data.tools.join(", "))}.</p>${t.station || t.vr ? `<p>${esc([t.station, t.cvVr ?? t.vr].filter(Boolean).join(" "))}</p>` : ""}
<h2>${esc(t.cvLanguages)}</h2>
<p>${esc(t.langs)}</p>
<button type="button" class="print no-print" onclick="window.print()">${esc(t.print)}</button>
<p class="no-print"><a href="${paths.page}">${esc(t.backLink)}</a></p>
</main>`;

  return [
    { path: paths.page, html: shell({ lang, title: `${t.title} — EGYS1N`, description: t.description, canonical: paths.page, alternates: alt("page"), body: page, site }) },
    { path: paths.cv, html: shell({ lang, title: `${t.cvTitle} — EGYS1N`, description: t.description, canonical: paths.cv, alternates: alt("cv"), body: cv, site }) },
  ];
}
