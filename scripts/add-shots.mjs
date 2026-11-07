// Adds screenshots to a project's gallery.
// Copies each picture into public/assets/<project>/ (unless it is already there) and appends it to "gallery"
// in content/projects/<project>.json with empty captions. ДОБАВИТЬ-СКРИНШОТЫ.bat calls this after it has shrunk
// the pictures; it also works on its own:
//   node scripts/add-shots.mjs ancient-restoration "C:\Screens\one.png" "C:\Screens\two.jpg"
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pictureExt = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

// "Screenshot 2026-11-06 19.15.30.png" -> "screenshot-2026-11-06-19-15-30"
export function slugName(file) {
  const s = basename(file, extname(file))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "shot";
}

export function freeName(dir, stem, ext) {
  let name = `${stem}${ext}`;
  for (let n = 2; existsSync(join(dir, name)); n++) name = `${stem}-${n}${ext}`;
  return name;
}

async function main() {
  const [id, ...files] = process.argv.slice(2);
  const dir = join(root, "content", "projects");
  const projectFiles = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const projects = await Promise.all(
    projectFiles.map(async (f) => ({ file: join(dir, f), data: JSON.parse((await readFile(join(dir, f), "utf8")).replace(/^\uFEFF/, "")) }))
  );
  const target = projects.find((p) => p.data.id === id);
  if (!id || !target || !files.length) {
    console.error("usage: node scripts/add-shots.mjs <project> <picture> [picture ...]");
    console.error(`projects: ${projects.map((p) => p.data.id).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const site = JSON.parse((await readFile(join(root, "content", "site.json"), "utf8")).replace(/^\uFEFF/, ""));
  const assets = join(root, "public", "assets", id);
  await mkdir(assets, { recursive: true });
  const gallery = (target.data.gallery ??= []);
  let added = 0;

  for (const raw of files) {
    const src = resolve(raw);
    const ext = extname(src).toLowerCase();
    if (!existsSync(src)) { console.log(`missing ${raw}`); process.exitCode = 1; continue; }
    if (!pictureExt.has(ext) || /\.small\.jpg$/i.test(src)) { console.log(`skipped ${basename(src)} (not a picture)`); continue; }
    const inPlace = src.toLowerCase().startsWith((assets + sep).toLowerCase());
    let name = basename(src);
    if (!inPlace) {
      name = freeName(assets, slugName(src), ext === ".jpeg" ? ".jpg" : ext);
      await copyFile(src, join(assets, name));
    }
    const rel = `assets/${id}/${relative(assets, join(assets, name)).split(sep).join("/")}`;
    if (gallery.some((g) => g.file === rel)) { console.log(`already in gallery ${rel}`); continue; }
    gallery.push({ file: rel, caption: Object.fromEntries(site.languages.map((l) => [l, ""])) });
    added++;
    console.log(`added ${rel}`);
  }

  if (added) await writeFile(target.file, JSON.stringify(target.data, null, 2) + "\n");
  console.log(`gallery ${id}: ${gallery.length} pictures, ${added} new`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(`add-shots: ${e.message}`);
    process.exitCode = 1;
  });
}
