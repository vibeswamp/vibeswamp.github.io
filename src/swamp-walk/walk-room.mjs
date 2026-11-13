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

export function createWalkRoom({ world, scene, camera, character, floorAt, storage, text, shelter, button }) {
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
  button.addEventListener("click", () => {
    if (room) dialog.show("room", { url: link(), state: statusText() });
    else dialog.show(roomInHash() ? "join" : "invite", { profile: profile ?? { nick: copy.defaultNick, color: "copper" } });
  });
  // an invite link: ask for the nickname and colour first, then come over
  if (roomInHash()) queueMicrotask(() => button.click());
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
      onEvent: refresh,
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
    if (dialog.open && dialog.mode === "room") dialog.setStatus(statusText());
    if (room && ["full", "version", "closed"].includes(room.status)) {
      for (const slot of [...peers.keys()]) forget(slot);
    }
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

  return {
    get modal() { return dialog.open; },
    get room() { return room; },
    // every frame: our pose out (the client sends at most 10 a second, nothing while standing), the others in
    update(player, dt) {
      if (!room) return;
      room.setPose({ x: player.x, y: player.y, z: player.z, h: player.heading, a: toRoomPose(player.pose) });
      for (const slot of [...peers.keys()]) if (!room.peers.has(slot)) forget(slot);
      for (const n of room.sample()) {
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
    },
  };
}
