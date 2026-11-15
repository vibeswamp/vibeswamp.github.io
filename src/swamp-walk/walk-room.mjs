// «Первый причал» together (docs/design/multiplayer.md, stage 2): a nickname and a pouch colour, an invite link, and
// the other Klyops of the room drawn where they walk, swim and jump. The network code (multiplayer-client.mjs, the
// site chat's) loads only when a room is opened: by a link with #room=CODE or by «Позвать соседа» on the map panel.
// Nothing goes into the clicker's save; the profile lives in vibeswamp-klyop-profile:v1 (the same as candidate C).
// Each neighbour is a copy of the light Klyop already on the page (the model comes from the browser's cache).
import * as T from "./vendor/three.mjs";
import { addCharacter } from "./character.mjs";
import { createRoomDialog } from "./room-ui.mjs";

export const PROFILE_KEY = "vibeswamp-klyop-profile:v1";
export const POUCH_COLORS = Object.freeze({ copper: "#e8a65c", moss: "#94bf67", blue: "#76c5e4" });
// what the server accepts as the page's build: one short word, the same on both phones
const BUILD = "walk-2";
const ITEM = /^[a-z0-9-]{1,24}$/;
const LABEL_RANGE = 24;

const nickGlyph = /[\p{L}\p{N}]\p{M}*|[ _-]/gu;
// 2–20 letters, digits, spaces, _ and -, at least one letter or digit (the server's rule, server/rooms/src/protocol.mjs)
export function parseProfile(value) {
  if (typeof value?.nick !== "string" || value.nick.length > 120 || !Object.hasOwn(POUCH_COLORS, value.color)) return null;
  const nick = value.nick.normalize("NFC").trim();
  const glyphs = nick.match(nickGlyph) ?? [];
  if (glyphs.length < 2 || glyphs.length > 20 || glyphs.join("") !== nick || !/[\p{L}\p{N}]/u.test(nick)) return null;
  return { nick, color: value.color };
}

// The walk's poses in the room protocol: wading is "wade" there, a strafe around a held target goes as a run.
export const toRoomPose = pose => (pose === "walk" ? "wade" : pose === "strafe" ? "run" : pose);
export const fromRoomPose = pose => (pose === "wade" ? "walk" : pose);
const roomInHash = () => /[#&]room=[^&]+/.test(location.hash);

// `placeHome(house)` (optional) builds the first neighbour's hut on the islet and resolves to { dispose }.
export function createWalkRoom({ world, scene, camera, character, floorAt, storage, text, shelter, button, placeHome }) {
  const copy = text.room;
  if (!copy || !button) return { update() {}, get modal() { return false; } };
  let profile = null, client = null, room = null, opening = null, lastLabel = "";
  try { profile = parseProfile(JSON.parse(storage?.getItem(PROFILE_KEY) ?? "null")); } catch {}
  if (profile) character.setPouchColor(POUCH_COLORS[profile.color]);
  const peers = new Map();
  const tags = document.createElement("div");
  tags.className = "walk-nameplates";
  tags.setAttribute("aria-hidden", "true");
  world.append(tags);
  const dialog = createRoomDialog(world, copy, POUCH_COLORS, parseProfile, {
    onInvite(next) { remember(next); open(next, null); },
    onJoin(next) { remember(next); open(next, location.hash); },
    onLeave: leave,
  });
  button.textContent = copy.button;
  // Emotes (stage 3): a small bar while in a room, keys 1-4 on a computer. A speech bubble over the head, nothing in the save.
  const EMOTE_COOLDOWN = 900, BUBBLE_MS = 2200;
  const emotes = Array.isArray(copy.emotes) ? copy.emotes : [];
  const bubbles = new Map();   // "me" or a slot -> { el, until, x, y, z }
  const bar = document.createElement("div");
  bar.className = "walk-emotes";
  bar.hidden = true;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "walk-emote-toggle";
  toggle.textContent = copy.emote ?? "";
  toggle.setAttribute("aria-expanded", "false");
  const list = document.createElement("div");
  list.className = "walk-emote-list";
  list.hidden = true;
  emotes.forEach(([name], index) => {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.textContent = name;
    choice.title = String(index + 1);
    choice.addEventListener("click", () => { sendEmote(index); setOpen(false); });
    list.append(choice);
  });
  bar.append(toggle, list);
  world.append(bar);
  function setOpen(open) {
    list.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  }
  toggle.addEventListener("click", () => setOpen(list.hidden));
  let lastEmote = 0;
  function sendEmote(index) {
    const now = performance.now();
    if (!room || room.status !== "open" || !emotes[index] || now - lastEmote < EMOTE_COOLDOWN) return;
    lastEmote = now;
    room.emote(index);
    showEmote("me", index);
  }
  function showEmote(key, index) {
    const say = emotes[index]?.[1];
    if (!say) return;
    let bubble = bubbles.get(key);
    if (!bubble) {
      const el = document.createElement("span");
      el.className = "walk-bubble";
      el.hidden = true;
      tags.append(el);
      bubble = { el, until: 0, x: 0, y: 0, z: 0, seen: false };
      bubbles.set(key, bubble);
    }
    bubble.el.textContent = say;
    bubble.until = performance.now() + BUBBLE_MS;
  }
  addEventListener("keydown", event => {
    if (!room || dialog.open || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName)) return;
    const index = "1234".indexOf(event.key);
    if (index >= 0) sendEmote(index);
  });

  button.addEventListener("click", () => {
    if (room) dialog.show("room", { url: link(), state: statusText() });
    else dialog.show(roomInHash() ? "join" : "invite", { profile: profile ?? { nick: copy.defaultNick, color: "copper" } });
  });
  // an invite link: ask for the nickname and colour first, then come over
  if (roomInHash()) queueMicrotask(() => button.click());
  // the link pasted into a tab that already shows the walk: only the #room= part changes, the page stays
  addEventListener("hashchange", () => { if (!room && !dialog.open && roomInHash()) button.click(); });
  addEventListener("pagehide", () => room?.leave(), { once: true });

  function remember(next) {
    profile = next;
    character.setPouchColor(POUCH_COLORS[next.color]);
    try { storage?.setItem(PROFILE_KEY, JSON.stringify(next)); } catch { dialog.setStatus(copy.noStorage); }
  }

  // What the neighbours learn about this hut: how far it is built and its visible things (ids the server accepts).
  function house() {
    const stage = Math.min(99, [...(shelter.stages ?? [])].length);
    const items = [...(shelter.projects ?? [])].filter(id => ITEM.test(id)).slice(0, 10);
    return { stage, items };
  }

  async function open(next, hash) {
    if (room || opening) return;
    dialog.setStatus(copy.status.connecting);
    try {
      opening = import("./multiplayer-client.mjs");
      client = await opening;
    } catch (error) {
      console.warn("Room client:", error);
      dialog.setStatus(copy.status.error);
      return;
    } finally {
      opening = null;
    }
    const code = hash ? client.roomCodeFromHash(hash) : client.makeRoomCode();
    if (!code) { dialog.setStatus(copy.status.error); return; }
    history.replaceState(null, "", `${location.pathname}${location.search}#room=${code}`);
    room = client.joinRoom({
      code, build: BUILD, house: house(),
      profile: { nick: next.nick, color: next.color, hat: null },
      onEvent: event => { if (event.type === "emote") showEmote(event.slot, event.e); refresh(); },
    });
    if (dialog.open) dialog.show("room", { url: link(), state: statusText() });
    refresh();
  }

  function leave() {
    room?.leave();
    room = null;
    for (const slot of [...peers.keys()]) forget(slot);
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    refresh();
  }

  const link = () => (room && client ? client.inviteUrl(room.code) : "");
  const here = () => (room ? [...room.peers.values()] : []);
  function statusText() {
    if (!room) return "";
    if (room.status !== "open") return copy.status[room.status] ?? "";
    const gone = here().find(peer => peer.lost);
    if (gone) return copy.status.lost.replace("{nick}", gone.nick);
    const names = here().map(peer => peer.nick);
    return names.length ? copy.status.together.replace("{nicks}", names.join(", ")) : copy.status.waiting;
  }
  function refresh() {
    const names = here().filter(peer => !peer.lost).map(peer => peer.nick);
    const label = room && names.length ? `${copy.inRoom}: ${names.join(", ")}` : copy.button;
    if (label !== lastLabel) button.textContent = lastLabel = label;
    button.toggleAttribute("data-room", Boolean(room));
    bar.hidden = !(room && emotes.length && room.status === "open");
    if (bar.hidden) setOpen(false);
    if (dialog.open && dialog.mode === "room") dialog.setStatus(statusText());
    if (room && ["full", "version", "closed"].includes(room.status)) {
      for (const slot of [...peers.keys()]) forget(slot);
    }
    syncHome();
  }

  // The islet holds one hut: the first neighbour's, as far as their clicker has built it. A new stage rebuilds it.
  let home = null, homeWanted = "";
  function syncHome() {
    if (!placeHome) return;
    const first = room && room.status === "open" ? here().sort((a, b) => a.slot - b.slot)[0] : null;
    const key = first ? `${first.slot}/${first.house?.stage ?? 0}/${(first.house?.items ?? []).join(",")}` : "";
    if (key === homeWanted) return;
    homeWanted = key;
    if (!first) { home?.dispose(); home = null; return; }
    Promise.resolve(placeHome({ stage: first.house?.stage ?? 0, items: first.house?.items ?? [] })).then(next => {
      if (homeWanted !== key) { next?.dispose(); return; }
      home?.dispose();
      home = next;
    }).catch(error => console.warn("Neighbour hut:", error));
  }

  function forget(slot) {
    const peer = peers.get(slot);
    if (!peer) return;
    peer.actor?.dispose();
    peer.tag.remove();
    peers.delete(slot);
  }

  function neighbour(slot) {
    let peer = peers.get(slot);
    if (peer) return peer;
    const tag = document.createElement("span");
    tag.className = "walk-nameplate";
    tag.hidden = true;
    tags.append(tag);
    peer = { actor: null, tag, shown: null, color: null };
    peers.set(slot, peer);
    addCharacter(scene, null, null).then(actor => {
      if (peers.get(slot) === peer) peer.actor = actor;
      else actor.dispose();
    }).catch(error => console.warn("Neighbour Klyop:", error));
    return peer;
  }

  const head = new T.Vector3();
  function placeTag(peer, n) {
    const { tag } = peer;
    head.set(n.x, n.y + 1.72, n.z);
    if (camera.position.distanceToSquared(head) > LABEL_RANGE ** 2) { tag.hidden = true; return; }
    head.project(camera);
    tag.hidden = Math.abs(head.x) > 1 || Math.abs(head.y) > 1 || head.z > 1;
    if (tag.hidden) return;
    if (tag.textContent !== n.nick) tag.textContent = n.nick;
    tag.style.setProperty("--pouch", POUCH_COLORS[n.color] ?? POUCH_COLORS.copper);
    tag.toggleAttribute("data-ghost", Boolean(n.ghost));
    // at the screen's edge the tag stays whole instead of being cut in half
    tag.style.left = `clamp(3.4em, ${((head.x + 1) * 50).toFixed(2)}%, calc(100% - 3.4em))`;
    tag.style.top = `${((1 - head.y) * 50).toFixed(2)}%`;
  }

  // a bubble rides above the head of whoever spoke; a bubble of someone gone is dropped
  function placeBubbles(now) {
    for (const [key, bubble] of bubbles) {
      const gone = key !== "me" && !room?.peers.has(key);
      if (gone || now > bubble.until || !room) { bubble.el.remove(); bubbles.delete(key); continue; }
      head.set(bubble.x, bubble.y + 2.05, bubble.z);
      head.project(camera);
      const hidden = !bubble.seen || Math.abs(head.x) > 1 || Math.abs(head.y) > 1 || head.z > 1;
      bubble.el.hidden = hidden;
      if (hidden) continue;
      bubble.el.style.left = `clamp(2.6em, ${((head.x + 1) * 50).toFixed(2)}%, calc(100% - 2.6em))`;
      bubble.el.style.top = `${((1 - head.y) * 50).toFixed(2)}%`;
    }
  }

  return {
    get modal() { return dialog.open; },
    get room() { return room; },
    // every frame: our pose out (the client sends at most 10 a second, nothing while standing), the others in
    update(player, dt) {
      if (!room) { if (bubbles.size) placeBubbles(performance.now()); return; }
      room.setPose({ x: player.x, y: player.y, z: player.z, h: player.heading, a: toRoomPose(player.pose) });
      const me = bubbles.get("me");
      if (me) { me.x = player.x; me.y = player.y; me.z = player.z; me.seen = true; }
      for (const slot of [...peers.keys()]) if (!room.peers.has(slot)) forget(slot);
      for (const n of room.sample()) {
        const spoke = bubbles.get(n.slot);
        if (spoke) { spoke.x = n.x; spoke.y = n.y; spoke.z = n.z; spoke.seen = true; }
        const peer = neighbour(n.slot);
        if (!peer.actor) continue;
        if (peer.color !== n.color) {
          peer.color = n.color;
          peer.actor.setPouchColor(POUCH_COLORS[n.color] ?? POUCH_COLORS.copper);
        }
        const pose = fromRoomPose(n.a);
        const swimming = pose === "swim" || pose === "float";
        const step = peer.shown ? Math.hypot(n.x - peer.shown.x, n.z - peer.shown.z) : 0;
        const snap = !peer.shown || step > 3;
        peer.actor.advanceGait(pose, snap ? 0 : step, true);
        peer.actor.update({
          x: n.x, y: n.y, z: n.z, heading: n.h, pose, swimming, grounded: !swimming && pose !== "air",
          speed: dt > 0 ? step / dt : 0, dy: 0, airAge: null, runningJump: false, strafe: null, swing: null, swingIndex: 0,
          hurt: null, dodge: null, landing: null, mantle: null, shoreClimb: null, traversal: null,
        }, floorAt(n.x, n.z), dt, snap, 1, floorAt);
        peer.shown = { x: n.x, z: n.z };
        placeTag(peer, n);
      }
      if (bubbles.size) placeBubbles(performance.now());
    },
  };
}
