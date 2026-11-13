// «Первый причал» together: the browser side of a room (docs/design/multiplayer.md, stage 1). Written by the site chat;
// the 3D chat plugs it into main.mjs. No imports and nothing runs on import, so it loads only when a room is opened
// (an invite link or the «call a neighbour» button). The server lives in server/rooms/ (Cloudflare Workers).
//
//   import { joinRoom, makeRoomCode, roomCodeFromHash, inviteUrl } from "./multiplayer-client.mjs";
//   const room = joinRoom({ code, profile: { nick, color, hat }, house: { stage, items }, build, onEvent });
//   every frame:   room.setPose({ x, y, z, h, a });            // sends at most 10 a second, nothing while standing still
//                  for (const n of room.sample()) drawNeighbour(n);   // smoothed positions of the others
//   room.emote(0..3); room.leave();
//
// Events (onEvent({ type, ... }) or room.on(type, fn)):
//   status  { status: "connecting" | "open" | "reconnecting" | "full" | "version" | "error" | "closed" }
//   room    { you, peers }        you are in; peers are already there
//   join    { peer }              someone came (or came back after a drop)
//   lost    { slot }              their connection dropped; the place waits a minute (the server's LOST_GRACE_MS)
//   leave   { slot }              they are gone
//   emote   { slot, e }
// Nothing personal is sent: a nickname, a colour, a hat, the hut's build stage and visible items, and positions.

// the same numbers as server/rooms/src/protocol.mjs (server/rooms/test/protocol.test.mjs checks they agree)
export const PROTOCOL = 1;
export const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const COLORS = ["copper", "moss", "blue"];
export const POSES = ["idle", "run", "sprint", "air", "swim", "float", "wade"];
export const EMOTES = 4;
export const MAX_ITEMS = 10;
// the rooms server on Cloudflare (server/rooms, deployed 13.11.2026); a page can also pass `server` or ?server=
export const DEFAULT_SERVER = "wss://vibeswamp-rooms.vibeswamp-rooms.workers.dev";

export const SEND_HZ = 10;          // poses a second at most
export const RENDER_DELAY = 120;    // ms: neighbours are drawn this far in the past, so there is always a next point
export const EXTRAPOLATE = 300;     // ms: after the last point they glide on by their speed at most this long
export const GHOST_AFTER = 6000;    // ms without news: the neighbour turns half transparent
export const FORGET_AFTER = 60000;  // ms without news and without a «lost»: gone

export function makeRoomCode(random = Math.random) {
  let s = "";
  for (let i = 0; i < 6; i++) s += ROOM_ALPHABET[Math.floor(random() * ROOM_ALPHABET.length)];
  return s;
}
export function parseRoomCode(value) {
  const code = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");   // spaces and dashes typed by hand are fine
  return code.length === 6 && [...code].every((c) => ROOM_ALPHABET.includes(c)) ? code : null;
}
export const roomCodeFromHash = (hash = location.hash) => parseRoomCode((String(hash).match(/[#&]room=([^&]+)/) || [])[1]);
export function inviteUrl(code, page = `${location.origin}${location.pathname}`) { return `${page}#room=${code}`; }
export function serverFor(server = DEFAULT_SERVER) {
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search).get("server") : null;
  return (q || server || "").replace(/\/+$/, "").replace(/^http/, "ws");
}

const tabId = () => {
  try {
    let id = sessionStorage.getItem("vibeswamp-room-pid");
    if (!id) { id = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16); sessionStorage.setItem("vibeswamp-room-pid", id); }
    return id;
  } catch { return Math.random().toString(36).slice(2, 14).padEnd(8, "0"); }
};
const angle = (a, b, t) => { const d = Math.atan2(Math.sin(b - a), Math.cos(b - a)); return a + d * t; };

export function joinRoom({ code, server, profile, house = { stage: 0, items: [] }, build = "dev", onEvent } = {}) {
  const url = `${serverFor(server)}/room/${code}`;
  const handlers = new Map();
  const emit = (type, detail = {}) => {
    const ev = { type, ...detail };
    try { onEvent?.(ev); } catch (e) { console.error(e); }
    for (const fn of handlers.get(type) ?? []) { try { fn(ev); } catch (e) { console.error(e); } }
  };
  const peers = new Map();   // slot -> { slot, nick, color, hat, house, lost, seen, points: [{ t, x, y, z, h, a }] }
  const room = { code, url, status: "connecting", you: null, peers };
  const setStatus = (s) => { if (room.status !== s) { room.status = s; emit("status", { status: s }); } };

  let ws = null, left = false, tries = 0, timer = 0, pingTimer = 0, pingAt = 0, watch = 0;
  room.rtt = null;   // ms to the server and back, measured with the keep-alive ping
  let last = null, lastSent = 0, pending = null, idleSent = true, later = 0;

  const hello = () => ({ t: "hello", v: PROTOCOL, pid: tabId(), build, nick: profile?.nick, color: profile?.color, hat: profile?.hat ?? null,
    house: { stage: house?.stage ?? 0, items: (house?.items ?? []).slice(0, MAX_ITEMS) } });
  const send = (msg) => { if (ws?.readyState === 1) { ws.send(typeof msg === "string" ? msg : JSON.stringify(msg)); return true; } return false; };
  const upsert = (p, extra = {}) => {
    const cur = peers.get(p.s) ?? { slot: p.s, points: [] };
    Object.assign(cur, { nick: p.nick, color: p.color, hat: p.hat, house: p.house, lost: !!p.lost, seen: performance.now(), ...extra });
    peers.set(p.s, cur);
    return cur;
  };

  const connect = () => {
    if (left) return;
    clearTimeout(timer);
    setStatus(tries ? "reconnecting" : "connecting");
    try { ws = new WebSocket(url); } catch { return retry(); }
    ws.onopen = () => { send(hello()); };
    ws.onmessage = (e) => {
      if (e.data === "pong") { clearTimeout(watch); if (pingAt) { room.rtt = Math.round(performance.now() - pingAt); pingAt = 0; } return; }
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      const now = performance.now();
      if (m.t === "room") {
        tries = 0;
        room.you = m.you;
        peers.clear();
        for (const p of m.peers ?? []) upsert(p);
        setStatus("open");
        emit("room", { you: m.you, peers: [...peers.values()] });
        if (last) { idleSent = false; flush(true); }   // tell the others where we are right away
        clearInterval(pingTimer);
        pingTimer = setInterval(ping, 25000);   // keeps phone networks from dropping a quiet socket
        ping();
      } else if (m.t === "join") {
        emit("join", { peer: upsert(m.peer, { lost: false }) });
        if (last) { pending = last; flush(true); }   // the newcomer sees us at once, even if we stand still
      } else if (m.t === "pose") {
        const p = peers.get(m.s);
        if (!p) return;
        p.seen = now; p.lost = false;
        p.points.push({ t: now, ...m.p });
        if (p.points.length > 24) p.points.splice(0, p.points.length - 24);
      } else if (m.t === "emote") {
        emit("emote", { slot: m.s, e: m.e });
      } else if (m.t === "lost") {
        const p = peers.get(m.s);
        if (p) p.lost = true;
        emit("lost", { slot: m.s });
      } else if (m.t === "leave") {
        peers.delete(m.s);
        emit("leave", { slot: m.s });
      } else if (m.t === "error") {
        if (m.code === "full" || m.code === "version") { left = true; setStatus(m.code); }
        else setStatus("error");
      }
    };
    ws.onclose = (e) => {
      clearInterval(pingTimer); clearTimeout(watch);
      if (left || e.code === 4001 || e.code === 4003 || e.code === 4000) { if (!["full", "version"].includes(room.status)) setStatus("closed"); return; }
      retry();
    };
    ws.onerror = () => {};
  };
  const retry = () => {
    if (left) return;
    tries++;
    setStatus("reconnecting");
    timer = setTimeout(connect, Math.min(8000, 500 * 2 ** Math.min(tries - 1, 4)));
  };

  // a phone puts the tab to sleep and drops the socket; when it comes back, or the network does, try at once
  const wake = () => { if (!left && document.visibilityState === "visible" && ws?.readyState !== 1 && ws?.readyState !== 0) { tries = Math.max(tries, 1); connect(); } };
  document.addEventListener("visibilitychange", wake);
  addEventListener("online", wake);

  const flush = (force = false) => {
    const now = performance.now();
    if (!pending) return;
    if (!force && now - lastSent < 1000 / SEND_HZ) {
      // the last pose (he stopped) must go out even if no frame comes after it: a paused game, a tab put away
      if (!later) later = setTimeout(() => { later = 0; flush(); }, 1000 / SEND_HZ - (now - lastSent) + 1);
      return;
    }
    if (send({ t: "pose", p: pending, ts: Date.now() })) { lastSent = now; pending = null; }
  };
  const moved = (a, b) => !a || Math.abs(a.x - b.x) > 0.02 || Math.abs(a.y - b.y) > 0.02 || Math.abs(a.z - b.z) > 0.02 || Math.abs(a.h - b.h) > 0.02 || a.a !== b.a;

  room.setPose = ({ x, y, z, h = 0, a = "idle" }) => {
    if (![x, y, z, h].every(Number.isFinite)) return;
    const p = { x, y, z, h, a: POSES.includes(a) ? a : "idle" };
    if (moved(last, p)) { pending = p; idleSent = false; }
    else if (!idleSent) { pending = p; idleSent = true; }   // one last pose when he stops, so the others see him stand
    last = p;
    flush();
  };
  // the server answers «pong» without waking the room; no answer in 10 s means the socket is dead even if the phone
  // has not noticed (a network change on 4G): drop it and connect again
  const dead = () => { const old = ws; if (!old) return; old.onclose = old.onmessage = null; try { old.close(); } catch {} clearInterval(pingTimer); retry(); };
  const ping = () => { if (send("ping")) { pingAt = performance.now(); clearTimeout(watch); watch = setTimeout(dead, 10000); } };
  room.measure = ping;
  room.emote = (e) => { if (Number.isInteger(e) && e >= 0 && e < EMOTES) send({ t: "emote", e }); };

  // where to draw each neighbour now: RENDER_DELAY in the past, between two received points, or a short glide after
  room.sample = (now = performance.now()) => {
    const out = [];
    for (const p of peers.values()) {
      if (!p.lost && now - p.seen > FORGET_AFTER) { peers.delete(p.slot); emit("leave", { slot: p.slot }); continue; }
      const pts = p.points;
      if (!pts.length) continue;
      const t = now - RENDER_DELAY;
      let s;
      if (t <= pts[0].t) s = pts[0];
      else {
        let k = pts.findIndex((q) => q.t >= t);
        if (k > 0) {
          const A = pts[k - 1], B = pts[k], f = (t - A.t) / Math.max(1, B.t - A.t);
          s = { x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f, z: A.z + (B.z - A.z) * f, h: angle(A.h, B.h, f), a: B.a };
        } else {
          const B = pts[pts.length - 1], A = pts[pts.length - 2];
          const ahead = Math.min(t - B.t, EXTRAPOLATE);
          if (A && B.a !== "idle" && B.t - A.t < 400) {
            const dt = Math.max(1, B.t - A.t);
            s = { x: B.x + ((B.x - A.x) / dt) * ahead, y: B.y + ((B.y - A.y) / dt) * ahead, z: B.z + ((B.z - A.z) / dt) * ahead, h: B.h, a: B.a };
          } else s = B;
        }
      }
      const quiet = now - p.seen;
      out.push({ slot: p.slot, nick: p.nick, color: p.color, hat: p.hat, house: p.house, ...s, ghost: p.lost || quiet > GHOST_AFTER, alpha: p.lost || quiet > GHOST_AFTER ? 0.45 : 1 });
    }
    return out;
  };
  room._drop = () => { try { ws?.close(4999, "test drop"); } catch {} };   // for checks: a network drop, then reconnect
  room.on = (type, fn) => { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); return () => handlers.get(type)?.delete(fn); };
  room.leave = () => {
    if (left) return;
    left = true;
    clearTimeout(timer); clearInterval(pingTimer); clearTimeout(watch); clearTimeout(later);
    document.removeEventListener("visibilitychange", wake);
    removeEventListener("online", wake);
    send({ t: "bye" });
    try { ws?.close(1000, "bye"); } catch {}
    setStatus("closed");
  };
  connect();
  return room;
}
