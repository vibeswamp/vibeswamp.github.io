// Copies only the site into a separate folder for the public repository vibeswamp/vibeswamp.github.io.
// Other chats' folders (discord/, twitch/, steam/, github/), launchers for this PC, screenshots and dist/ stay out.
//
//   node scripts/export-site.mjs --dry-run            list what would go into the repository, copy nothing
//   node scripts/export-site.mjs <folder>              copy into <folder> (default ../vibeswamp-site-export)
//
// The target folder is cleared first, but only if it is empty or was made by this script (it holds .export-site).
import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { privateArena } from "./site-assets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEEP = ["build.mjs", "content", "public", "src", "scripts", ".github", ".gitignore", "README.public.md", "DESIGN.md"];
// README.md here is written for the owner; the repository gets README.public.md under the name README.md.
const RENAME = { "README.public.md": "README.md" };
const SKIP = [/(^|\/)\.claude(\/|$)/, /\.tmp$/, /-log\.txt$/, /(^|\/)node_modules(\/|$)/, /(^|\/)__pycache__(\/|$)/];

async function walk(p, out) {
  const rel = relative(root, p).replaceAll("\\", "/");
  if (rel.startsWith("public/") && privateArena(rel.slice("public/".length))) return;
  const s = await stat(p);
  if (s.isDirectory()) for (const n of await readdir(p)) await walk(join(p, n), out);
  else out.push({ path: p, size: s.size });
}

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const target = resolve(root, args.find((a) => !a.startsWith("--")) ?? "../vibeswamp-site-export");

const files = [];
for (const k of KEEP) if (existsSync(join(root, k))) await walk(join(root, k), files);
const list = files.filter((f) => !SKIP.some((re) => re.test(relative(root, f.path).replaceAll("\\", "/"))));
const total = list.reduce((s, f) => s + f.size, 0);
const big = list.filter((f) => f.size > 50 * 1024 * 1024);

console.log(`${list.length} files, ${(total / 1024 / 1024).toFixed(1)} MB${big.length ? `, OVER 50 MB: ${big.map((f) => relative(root, f.path)).join(", ")}` : ""}`);
if (dry) {
  const byTop = {};
  for (const f of list) { const top = relative(root, f.path).split(/[\\/]/)[0]; byTop[top] = (byTop[top] || 0) + f.size; }
  for (const [k, v] of Object.entries(byTop)) console.log(`  ${k.padEnd(12)} ${(v / 1024 / 1024).toFixed(1)} MB`);
  process.exit(0);
}

if (existsSync(target)) {
  const inside = await readdir(target);
  if (inside.length && !inside.includes(".export-site")) {
    console.error(`stop: ${target} is not empty and was not made by this script`);
    process.exit(1);
  }
  for (const n of inside) if (n !== ".git") await rm(join(target, n), { recursive: true, force: true });
}
await mkdir(target, { recursive: true });
for (const f of list) {
  const rel = relative(root, f.path);
  const to = join(target, RENAME[rel] ?? rel);
  await mkdir(dirname(to), { recursive: true });
  await cp(f.path, to);
}
await writeFile(join(target, ".export-site"), `made by scripts/export-site.mjs on ${new Date().toISOString()}\n`);
console.log(`copied into ${target}`);
