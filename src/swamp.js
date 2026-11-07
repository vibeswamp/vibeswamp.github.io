// Klyop builds the swamp: a slow clicker with the site toad. Texts come from content/swamp.json (built into the page),
// the save lives in localStorage ("vibeswamp-swamp"). Flies caught in the pond on the home page come in here too.
(() => {
  const host = document.getElementById("swamp");
  const textEl = document.getElementById("swamp-text");
  if (!host || !textEl) return;
  const T = JSON.parse(textEl.textContent || "{}");
  const lang = document.documentElement.lang;
  const locale = { uk: "uk-UA", ru: "ru-RU" }[lang] || "en-GB";
  const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const tenth = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const big = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 2 });
  const fmt = (n) => (n >= 1e6 ? big.format(n) : whole.format(Math.floor(n)));
  const fmtRate = (n) => (n >= 1e6 ? big.format(n) : n < 10 ? tenth.format(n) : whole.format(n));
  const fill = (s, o) => String(s).replace(/\{(\w+)\}/g, (_, k) => o[k]);
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const VS = () => window.VibeSwamp || {};

  // our own numbers: costs grow by 17% per copy, each building catches about seven times more than the one before
  const BASE = [[12, 0.2], [90, 1.2], [700, 7], [6500, 40], [60000, 210], [520000, 1100], [4.8e6, 6000], [4.5e7, 32000]];
  const GROW = 1.17;
  const BUILD = [[50, 10], [600, 30], [5000, 60], [40000, 90], [300000, 120], [2.5e6, 180]];
  const buildings = (T.buildings || []).map((b, i) => ({ ...b, cost: BASE[i][0], rate: BASE[i][1] }));
  const builds = (T.builds || []).map((b, i) => ({ ...b, cost: BUILD[i][0], sec: BUILD[i][1] }));

  // ---------- save ----------
  const KEY = "vibeswamp-swamp";
  let S;
  try { S = JSON.parse(store.get(KEY) || "null"); } catch (e) { S = null; }
  if (!S || S.v !== 1) S = { v: 1, flies: 0, total: 0, clicks: 0, own: {}, done: {}, run: null, t: Date.now(), pondSeen: null };
  const save = () => { S.t = Date.now(); store.set(KEY, JSON.stringify(S)); };

  const pond = +(store.get("vibeswamp-flies") || 0);
  let note = "";
  const fromPond = Math.max(0, pond - (S.pondSeen ?? 0));
  if (fromPond > 0) { S.flies += fromPond; S.total += fromPond; note = fill(T.pond, { n: fmt(fromPond) }); }
  S.pondSeen = pond;

  // ---------- the economy ----------
  const own = (id) => S.own[id] || 0;
  const priceOf = (b) => Math.ceil(b.cost * Math.pow(GROW, own(b.id)));
  const multOf = (id) => {
    let m = 1;
    if (S.done.rimworld && (id === "tussock" || id === "antenna")) m *= 2;
    if (S.done.kfsos && (id === "flytrap" || id === "stump")) m *= 2;
    return m;
  };
  const baseRate = () => buildings.reduce((sum, b) => sum + own(b.id) * b.rate * multOf(b.id), 0) * (S.done.seams ? 1.5 : 1);
  const vibePct = () => (S.done.track ? 50 : 25);
  const vibing = () => !!VS().playing;
  const rate = () => baseRate() * (vibing() ? 1 + vibePct() / 100 : 1);
  const perClick = () => (S.done.bug ? 2 : 1) + (S.done.friday ? rate() * 0.02 : 0);

  // away: half of the calm catch, two hours at most
  const away = Math.min(2 * 3600, Math.max(0, (Date.now() - (S.t || Date.now())) / 1000));
  if (away > 60 && baseRate() > 0) {
    const got = baseRate() * away * 0.5;
    S.flies += got; S.total += got;
    note = [note, fill(T.away, { n: fmt(got) })].filter(Boolean).join(" ");
  }

  // ---------- small pictures for the swamp ----------
  const ICON = {
    tussock: '<path d="M2 19c2.5-5 6-7.5 10-7.5S19.5 14 22 19z" fill="currentColor"/><path d="M8 12V6M11 11.5V4M14 12V7M17 13V8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    antenna: '<path d="M12 22V9" stroke="currentColor" stroke-width="1.8"/><rect x="10" y="4" width="4" height="8" rx="2" fill="currentColor"/><path d="M6.5 6.5a8 8 0 0 0 0 9M17.5 6.5a8 8 0 0 1 0 9M4 4a12 12 0 0 0 0 14M20 4a12 12 0 0 1 0 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    flytrap: '<path d="M4 11c3-6 13-6 16 0-4 1.5-12 1.5-16 0z" fill="currentColor"/><path d="M4 13c4 1.5 12 1.5 16 0-3 6-13 6-16 0z" fill="currentColor" opacity=".7"/><path d="M6 11l1-2M10 10.5l.5-2.5M14 10.5l-.5-2.5M18 11l-1-2" stroke="currentColor" stroke-width="1.3"/>',
    stump: '<path d="M5 21l1.5-9h11L19 21z" fill="currentColor"/><ellipse cx="12" cy="12" rx="5.5" ry="2" fill="currentColor" opacity=".6"/><rect x="8" y="3" width="8" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 9v2" stroke="currentColor" stroke-width="1.6"/>',
    review: '<circle cx="7" cy="10" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17" cy="10" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M11 10h2M3 9l-1-1M21 9l1-1" stroke="currentColor" stroke-width="1.8"/><path d="M6 18c3 2 9 2 12 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    beaver: '<path d="M2 18h20M4 18l2-5h12l2 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M6 13l1-4h10l1 4M8 9l1-3h6l1 3" fill="none" stroke="currentColor" stroke-width="1.6"/>',
    peat: '<rect x="5" y="3" width="14" height="18" rx="2" fill="currentColor"/><path d="M8 7h5M8 11h5M8 15h5" stroke="var(--sw-ground, #F4F6F0)" stroke-width="1.6"/><circle cx="16" cy="7" r="1.1" fill="var(--sw-led, #E8B04A)"/><circle cx="16" cy="11" r="1.1" fill="var(--sw-led, #E8B04A)"/>',
    radio: '<rect x="3" y="7" width="18" height="13" rx="2" fill="currentColor"/><circle cx="9" cy="13.5" r="3.6" fill="none" stroke="var(--sw-ground, #F4F6F0)" stroke-width="1.5"/><path d="M15 11h3M15 14h3M15 17h3M7 7l8-4" stroke="var(--sw-ground, #F4F6F0)" stroke-width="1.4" stroke-linecap="round"/>',
  };
  const icon = (id) => `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">${ICON[id] || ""}</svg>`;

  // ---------- the page ----------
  const klyop = '<img class="k-head" src="/brand/klyop-full.webp" width="560" height="1185" alt="" decoding="async">';
  host.innerHTML = `<div class="sw-grid">
<section class="sw-scene" aria-label="${T.click}">
<p class="sw-count"><span class="sw-num num">0</span> <span class="sw-unit">${T.flies}</span></p>
<p class="sw-rate"><span class="num sw-rate-n">0</span> ${T.perSec}</p>
<div class="sw-stage"><button type="button" class="sw-klyop" aria-label="${T.click}">${klyop}</button><div class="sw-pops" aria-hidden="true"></div></div>
<p class="sw-hint">${T.clickHint}: <span class="num sw-per">1</span> ${T.perClick}</p>
<p class="sw-say" aria-live="polite"></p>
<p class="sw-vibe"></p>
<ul class="sw-yard" aria-hidden="true"></ul>
</section>
<section class="sw-shop">
<h2>${T.shop}</h2>
<ol class="sw-list">${buildings.map((b) => `<li><button type="button" class="sw-buy" data-id="${b.id}"><span class="sw-icon">${icon(b.id)}</span><span class="sw-what"><span class="sw-name">${b.name}</span><span class="sw-text">${b.text}</span></span><span class="sw-price"><span class="num sw-cost"></span><span class="sw-own"></span></span></button></li>`).join("")}</ol>
<h2>${T.projects}</h2>
<ol class="sw-list sw-builds">${builds.map((b) => `<li><button type="button" class="sw-build" data-id="${b.id}"><span class="sw-what"><span class="sw-name">${b.name}</span><span class="sw-text">${b.text}</span></span><span class="sw-price"><span class="num sw-cost">${fmt(b.cost)}</span><span class="sw-state"></span></span><span class="sw-bar" aria-hidden="true"><span></span></span></button></li>`).join("")}</ol>
</section>
</div>
<p class="sw-foot"><span class="sw-stats"></span><button type="button" class="sw-reset">${T.reset}</button></p>`;

  const $ = (s) => host.querySelector(s);
  const num = $(".sw-num"), rateN = $(".sw-rate-n"), per = $(".sw-per"), say = $(".sw-say"), vibeEl = $(".sw-vibe"), yard = $(".sw-yard"), stats = $(".sw-stats");
  const btn = $(".sw-klyop"), pops = $(".sw-pops"), stage = $(".sw-stage");
  const buyBtns = [...host.querySelectorAll(".sw-buy")], buildBtns = [...host.querySelectorAll(".sw-build")];

  let sayTimer = 0;
  const speak = (s) => { say.textContent = s; say.classList.add("on"); clearTimeout(sayTimer); sayTimer = setTimeout(() => say.classList.remove("on"), 3200); };
  if (note) speak(note);

  const drawYard = () => {
    const items = [];
    for (const b of buildings) for (let k = 0; k < Math.min(own(b.id), 6); k++) items.push(`<li class="sw-thing sw-${b.id}">${icon(b.id)}</li>`);
    yard.innerHTML = items.join("");
  };

  const render = () => {
    num.textContent = fmt(S.flies);
    rateN.textContent = fmtRate(rate());
    per.textContent = fmtRate(perClick());
    vibeEl.textContent = fill(vibing() ? T.vibeOn : T.vibeOff, { p: vibePct() });
    vibeEl.classList.toggle("on", vibing());
    stats.textContent = fill(T.stats, { n: fmt(S.total), c: whole.format(S.clicks) });
    buildings.forEach((b, i) => {
      const el = buyBtns[i], price = priceOf(b);
      const seen = own(b.id) > 0 || S.total >= b.cost * 0.5 || i === 0;
      el.classList.toggle("hidden-thing", !seen);
      el.querySelector(".sw-name").textContent = seen ? b.name : T.locked;
      el.querySelector(".sw-text").textContent = seen ? b.text : "";
      el.querySelector(".sw-icon").style.visibility = seen ? "" : "hidden";
      el.querySelector(".sw-cost").textContent = fmt(price);
      el.querySelector(".sw-own").textContent = own(b.id) ? `${T.owned}: ${own(b.id)}` : "";
      el.disabled = !seen || S.flies < price;
    });
    builds.forEach((b, i) => {
      const el = buildBtns[i];
      const li = el.parentElement;
      const prevDone = i === 0 || S.done[builds[i - 1].id];
      li.hidden = !(S.done[b.id] || prevDone || S.total >= b.cost * 0.3);
      const running = S.run && S.run.id === b.id;
      el.classList.toggle("done", !!S.done[b.id]);
      el.classList.toggle("running", !!running);
      el.querySelector(".sw-state").textContent = S.done[b.id] ? T.done : running ? T.running : "";
      el.querySelector(".sw-cost").hidden = !!(S.done[b.id] || running);
      const bar = el.querySelector(".sw-bar span");
      bar.style.width = running ? `${Math.min(100, (100 * (Date.now() - S.run.start)) / (b.sec * 1000))}%` : S.done[b.id] ? "100%" : "0%";
      el.disabled = !!(S.done[b.id] || S.run || S.flies < b.cost);
    });
  };

  // ---------- croak ----------
  const pop = (text, x, y) => {
    if (calm) return;
    const p = document.createElement("span");
    p.className = "sw-pop num";
    p.textContent = text;
    p.style.left = `${x}px`; p.style.top = `${y}px`;
    pops.append(p);
    setTimeout(() => p.remove(), 900);
  };
  btn.addEventListener("click", (e) => {
    const v = perClick();
    S.flies += v; S.total += v; S.clicks++;
    const r = stage.getBoundingClientRect();
    const x = e.clientX ? e.clientX - r.left : r.width / 2, y = e.clientY ? e.clientY - r.top : r.height / 3;
    pop(`+${fmtRate(v)}`, x, y);
    btn.classList.remove("croak"); void btn.offsetWidth; btn.classList.add("croak");
    VS().sound?.("plop");
    if (S.clicks % 50 === 0) speak(T.say[Math.floor(Math.random() * T.say.length)]);
    render();
  });

  host.addEventListener("click", (e) => {
    const buy = e.target.closest(".sw-buy");
    if (buy && !buy.disabled) {
      const b = buildings.find((x) => x.id === buy.dataset.id);
      const price = priceOf(b);
      if (S.flies >= price) {
        S.flies -= price; S.own[b.id] = own(b.id) + 1;
        VS().sound?.("land");
        if (own(b.id) === 1) speak(T.say[Math.floor(Math.random() * T.say.length)]);
        drawYard(); render(); save();
      }
      return;
    }
    const bld = e.target.closest(".sw-build");
    if (bld && !bld.disabled) {
      const b = builds.find((x) => x.id === bld.dataset.id);
      if (S.flies >= b.cost && !S.run) {
        S.flies -= b.cost; S.run = { id: b.id, start: Date.now() };
        VS().sound?.("tick");
        speak(T.say[3]);
        render(); save();
      }
    }
  });

  $(".sw-reset").addEventListener("click", () => {
    if (!confirm(T.resetAsk)) return;
    S = { v: 1, flies: 0, total: 0, clicks: 0, own: {}, done: {}, run: null, t: Date.now(), pondSeen: pond };
    drawYard(); render(); save();
  });

  // ---------- the fat fly: now and then it crosses the swamp; catch it for a big bite ----------
  const fat = () => {
    if (document.hidden) return later();
    const f = document.createElement("button");
    f.type = "button"; f.className = "sw-fat"; f.setAttribute("aria-label", "+");
    f.innerHTML = '<svg viewBox="0 0 16 12" aria-hidden="true"><ellipse class="fly-wing" cx="5" cy="4" rx="3.4" ry="2.2"/><ellipse class="fly-wing" cx="11" cy="4" rx="3.4" ry="2.2"/><ellipse class="fly-body" cx="8" cy="7.5" rx="3.2" ry="2.6"/></svg>';
    const w = host.clientWidth, top = 40 + Math.random() * 220;
    f.style.top = `${top}px`;
    host.append(f);
    const run = f.animate([{ transform: `translate(-40px, 0)` }, { transform: `translate(${w * 0.5}px, -30px)` }, { transform: `translate(${w + 40}px, 10px)` }], { duration: calm ? 12000 : 8000, easing: "linear" });
    run.onfinish = () => { f.remove(); later(); };
    f.addEventListener("click", () => {
      const got = Math.max(15, rate() * 45);
      S.flies += got; S.total += got;
      speak(fill(T.fat, { n: fmt(got) }));
      VS().sound?.("croak");
      run.cancel(); f.remove(); render(); save(); later();
    });
  };
  const later = () => setTimeout(fat, (60 + Math.random() * 90) * 1000);
  later();

  // ---------- the clock ----------
  let last = performance.now();
  const tick = () => {
    const now = performance.now(), dt = Math.min(5, (now - last) / 1000);
    last = now;
    const got = rate() * dt;
    S.flies += got; S.total += got;
    if (S.run) {
      const b = builds.find((x) => x.id === S.run.id);
      if (!b) S.run = null;
      else if (Date.now() - S.run.start >= b.sec * 1000) { S.done[b.id] = true; S.run = null; speak(`${T.done}: ${b.name}`); VS().sound?.("splash"); save(); }
    }
    render();
  };
  setInterval(tick, 250);
  setInterval(save, 5000);
  addEventListener("pagehide", save);
  document.addEventListener("vibeswamp:radio", render);
  drawYard(); render(); save();
})();
