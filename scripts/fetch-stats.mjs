// Pulls live numbers into content/stats.json:
// - Steam Workshop subscribers for every project with a workshopId (the Steam endpoint needs no key);
// - Thunderstore downloads for every project with "thunderstore": { community, namespace, name } (public API).
// If a source does not answer, its previous numbers stay, so the site still builds offline.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const STEAM = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";
const thunderstoreApi = (community) => `https://thunderstore.io/c/${community}/api/v1/package/`;

const isoDay = (unix) => (unix ? new Date(unix * 1000).toISOString().slice(0, 10) : null);
const localDay = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

async function steamItems(projects) {
  const withWorkshop = projects.filter((p) => p.workshopId);
  if (!withWorkshop.length) return {};
  const body = new URLSearchParams({ itemcount: String(withWorkshop.length) });
  withWorkshop.forEach((p, i) => body.set(`publishedfileids[${i}]`, p.workshopId));
  const res = await fetch(STEAM, { method: "POST", body, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Steam API answered ${res.status}`);
  const details = (await res.json()).response?.publishedfiledetails ?? [];
  const items = {};
  for (const p of withWorkshop) {
    const d = details.find((x) => x.publishedfileid === p.workshopId);
    if (!d || d.result !== 1) continue;
    items[p.id] = {
      subscriptions: d.subscriptions ?? 0,
      lifetimeSubscriptions: d.lifetime_subscriptions ?? 0,
      favorited: d.favorited ?? 0,
      views: d.views ?? 0,
      created: isoDay(d.time_created),
      updated: isoDay(d.time_updated),
    };
  }
  return items;
}

async function thunderstoreItems(projects) {
  const withTs = projects.filter((p) => p.thunderstore?.community && p.thunderstore?.namespace && p.thunderstore?.name);
  const items = {};
  const failed = [];
  for (const community of [...new Set(withTs.map((p) => p.thunderstore.community))]) {
    try {
      const res = await fetch(thunderstoreApi(community), { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`answered ${res.status}`);
      const packages = await res.json();
      for (const p of withTs.filter((x) => x.thunderstore.community === community)) {
        const full = `${p.thunderstore.namespace}-${p.thunderstore.name}`;
        const pkg = packages.find((x) => x.full_name === full);
        if (!pkg) continue;
        items[p.id] = {
          downloads: (pkg.versions ?? []).reduce((sum, v) => sum + (v.downloads ?? 0), 0),
          versions: (pkg.versions ?? []).length,
          created: pkg.date_created?.slice(0, 10) ?? null,
          updated: pkg.date_updated?.slice(0, 10) ?? null,
          counted: localDay(),
        };
      }
    } catch (e) {
      failed.push(`${community}: ${e.message}`);
    }
  }
  return { items, failed };
}

export async function fetchStats() {
  const dir = join(root, "content", "projects");
  const projects = await Promise.all(
    (await readdir(dir)).filter((f) => f.endsWith(".json")).map(async (f) => JSON.parse(await readFile(join(dir, f), "utf8")))
  );
  const path = join(root, "content", "stats.json");
  const previous = existsSync(path) ? JSON.parse(await readFile(path, "utf8")) : { items: {} };

  let steam = null, steamError = null;
  try { steam = await steamItems(projects); } catch (e) { steamError = e; }
  const ts = await thunderstoreItems(projects);

  const stats = {
    fetchedAt: steam ? localDay() : previous.fetchedAt ?? null,   // the date shown next to the Steam numbers
    items: { ...previous.items, ...(steam ?? {}), ...ts.items },
  };
  await writeFile(path, JSON.stringify(stats, null, 2) + "\n");
  if (ts.failed.length) console.warn(`thunderstore: ${ts.failed.join("; ")}; using the previous downloads`);
  if (steamError) throw steamError;   // build.mjs prints "stats: ...; using the previous numbers"
  return stats;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  fetchStats()
    .then((s) => console.log(s ? `stats: ${Object.keys(s.items).length} items, ${s.fetchedAt}` : "stats: nothing to fetch"))
    .catch((e) => {
      console.error(`stats: ${e.message}; keeping the previous stats.json`);
      process.exitCode = 1;
    });
}
