# VibeSwamp

The site of EGYS1N's mods and games, made in Ukraine: RimWorld mods, the KFSOS Lite Minecraft modpack, mods for
PEAK and Darkwater, and EGYS1N's own games (Toi-Late, SCRAPWELD and others). English, Ukrainian and Russian.

Live at https://vibeswamp.github.io. Bugs, ideas and screenshots: [Discord](https://discord.gg/6K3gXm94SG).

## How it is built

A static site without dependencies. `node build.mjs` (Node 24) reads `content/` (projects, posts, texts, music) and
writes the pages into `dist/`. Steam Workshop and Thunderstore numbers are fetched during the build; if a source does
not answer, the last numbers stay. GitHub Actions builds and publishes the site on every push and once a day.

- `content/projects/*.json`: one file per mod or game.
- `content/posts/*.{en,uk,ru}.md`: blog posts, one file per language.
- `content/site.json`: interface texts, links, music list.
- `src/`: styles and scripts; `public/`: pictures, music, the toad.

Portions of the materials used to create the RimWorld mods are trademarks and/or copyrighted works of Ludeon Studios
Inc. All rights reserved by Ludeon. This content is not official and is not endorsed by Ludeon.
