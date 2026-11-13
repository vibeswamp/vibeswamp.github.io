// The 3D swamp's day ("Первый причал") written into the clicker's save, block `expedition3d` of "vibeswamp-swamp:v2".
// Taken from the multiplayer candidate C on 12.11.2026 at the 3D chat's request; the clicker chat owns this file,
// the 3D page only imports it. Writes go under the clicker's Web Lock, so they never meet an open clicker tab.
// Block: { version: 1, amber, extraDash, warehouse: { wood, resin }, receipt: { id, reward, events, result, delivered,
// rate, croak, night, amberSeconds, floor, killCroaks, calmSeconds, start }, best, fishing, calmUntil, walkSeconds,
// pads: [{ kind, hp }] }. The walls (pads) stay between days: the 3D page writes the whole list with "defense", a lost
// night breaks the last standing one (hp 0, it stays in the list to be repaired), going home before dark breaks none.
// Every event has a key, so a repeated call after a failed write pays nothing twice.
// Economy of 13.11.2026 (docs/design/economy.md): the warehouse is the clicker's too (steps and gear take planks and
// resin from it, Tolya's goods go into it); a won night pays a minute of income plus the enemies beaten, amber adds
// 20 s more, and the swamp gets "Спокойная ночь" (calmUntil). The time of the day is added to walkSeconds: the clicker
// pays the swamp's full income for it. Numbers live in content/swamp-v2.json (expedition); the receipt keeps them, so
// a day started before an update pays by the rules it started with (a receipt without rate pays the old way).
import { baseRate, calmBoost, calmUntil, clickValue, gearOf, ledgerOf, materialsOf, rankOf, stageNeeds } from "./engine.mjs";
import { loadSave, persistSave } from "./save.mjs";

export const SWAMP_WRITE_LOCK = "vibeswamp-clicker-owner";
const MATERIALS = ["wood", "resin"];
// the old reward: seconds of income for a won day with a trophy (receipts written before 13.11.2026)
export const REWARD_SECONDS = 120;
// a day longer than an hour is a tab left open, not a walk
const LONGEST_WALK = 3600;
const MOST_PADS = 8;

function readPads(ledger) {
  return Array.isArray(ledger.pads) ? ledger.pads.filter((pad) => typeof pad?.kind === "string" && Number.isFinite(pad.hp) && pad.hp >= 0)
    .slice(0, MOST_PADS).map(({ kind, hp }) => ({ kind, hp })) : [];
}

// What the hut's next step still lacks in planks, resin and amber, or null when nothing (the board in 3D).
export function nextHomeNeed(state, data) {
  const needs = stageNeeds(state, data);
  return needs && (needs.miss.wood || needs.miss.resin || needs.miss.amber) ? { ...needs.miss } : null;
}

const readLedger = ledgerOf;

function readStock(ledger) {
  return Object.fromEntries(MATERIALS.map(key => {
    const amount = ledger.warehouse?.[key];
    return [key, Number.isSafeInteger(amount) && amount >= 0 ? amount : 0];
  }));
}

// the extra dash: any amber on the shelf, from a trip or from Tolya
export const hasAmber = (state) => Boolean(readLedger(state).extraDash) || materialsOf(state).amber > 0;
export const stockOf = (state) => readStock(readLedger(state));

export function fishOf(state) {
  const count = readLedger(state).fishing?.count;
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

export function settleCatch(state, { id, before }) {
  const ledger = readLedger(state), count = fishOf(state);
  if (ledger.fishing?.last === id) return { state, count };
  if (before !== count) return { state, count, stale: true };
  const fishing = { count: count + 1, last: id };
  return { state: { ...state, expedition3d: { ...ledger, fishing } }, count: fishing.count };
}

export function recordCatch(storage, locks, data, cast) {
  if (!storage || !locks) throw new Error("expedition-storage");
  return locks.request(SWAMP_WRITE_LOCK, { ifAvailable: true }, lock => {
    if (!lock) return null;
    const previous = loadSave(storage, data);
    const { state, count, stale } = settleCatch(previous, cast);
    if (state !== previous) persistSave(storage, state, previous.t);
    return { count, stale };
  });
}

export function reserveDay(state, data, id, time = Date.now()) {
  const ledger = readLedger(state);
  const trip = data.expedition;
  // the swamp's income when the day starts (a calm night still running counts), and the price of a croak
  const rate = baseRate(state, data) * (time < calmUntil(state) ? calmBoost(data) : 1);
  const receipt = trip
    ? { id, reward: Math.max(trip.reward.floor, Math.round(rate * trip.reward.night)), rate, croak: clickValue(state, data),
      night: trip.reward.night, amberSeconds: trip.reward.amber, floor: trip.reward.floor, killCroaks: trip.killCroaks,
      calmSeconds: trip.calm.seconds, start: time, events: {}, result: null }
    : { id, reward: Math.max(15, Math.round(baseRate(state, data) * REWARD_SECONDS)), events: {}, result: null };
  const needs = stageNeeds(state, data);
  return {
    state: { ...state, expedition3d: { ...ledger, receipt } },
    context: {
      id, stage: state.stage, owned: { ...state.own }, extraDash: hasAmber(state), stock: readStock(ledger),
      amber: materialsOf(state).amber, gear: gearOf(state), pads: readPads(ledger),
      // what the hut's next step still lacks, for the board in 3D ("the hut needs 2 planks and resin")
      needs: needs ? { ...needs.miss } : { wood: 0, resin: 0, amber: 0 },
    },
  };
}

export function settleDay(state, id, type, { kills = 0, won = false, skipped = false, operationId, materials, amber = false, pads } = {}, time = Date.now()) {
  const ledger = readLedger(state), receipt = ledger.receipt;
  if (!receipt || receipt.id !== id) return { state, flies: 0, stale: true };
  const changesStock = type === "deposit" || type === "spend", keyed = changesStock || type === "defense";
  if (type !== "trophy" && type !== "finish" && !keyed) throw new Error("unknown-expedition-event");
  if (keyed && (!Number.isSafeInteger(operationId) || operationId <= 0)) throw new Error("invalid-operation-id");
  const key = `${id}/1/${type}` + (keyed ? `/${operationId}` : "");
  if (Object.hasOwn(receipt.events, key)) return { state, flies: receipt.events[key] };
  if (type !== "finish" && receipt.result?.won === false) throw new Error("closed-expedition");
  const trophyKey = `${id}/1/trophy`;
  const hadTrophy = receipt.delivered === true || Object.hasOwn(receipt.events, trophyKey);
  const newTrophy = !hadTrophy && (type === "trophy" || (type === "deposit" && amber));
  const delivered = hadTrophy || newTrophy;
  // "Домой до темноты": the day ends at dusk, no night, no reward
  const home = type === "finish" && !won && skipped === true;
  const result = type === "finish" ? { won, kills, nights: Number(won), trophies: Number(delivered), flies: 0, ...(home ? { skipped: true } : {}) }
    : receipt.result && { ...receipt.result, trophies: Number(delivered) };
  let flies = 0;
  if (!Number.isFinite(receipt.rate)) {
    // a day started before 13.11.2026: a won night with a trophy pays the reward once
    flies = result?.won && delivered && !result.flies ? receipt.reward : 0;
    if (flies) result.flies = flies;
  } else if (result?.won) {
    // a won night pays at dawn; delivered amber pays its part once, at dawn or when it is unloaded later
    if (type === "finish") flies += Math.max(receipt.floor, Math.round(receipt.rate * receipt.night)) + Math.round(kills * receipt.killCroaks * receipt.croak);
    if (delivered && !result.amberPaid) { flies += Math.round(receipt.rate * receipt.amberSeconds); result.amberPaid = true; }
    result.flies += flies;
  }
  const stock = readStock(ledger);
  if (changesStock) for (const item of MATERIALS) {
    const amount = materials?.[item];
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("invalid-expedition-materials");
    stock[item] += type === "deposit" ? amount : -amount;
    if (!Number.isSafeInteger(stock[item]) || stock[item] < 0) throw new Error("invalid-expedition-stock");
  }
  // the walls: "defense" replaces the list; a lost night (not a trip home before dark) breaks the last standing one
  let walls = readPads(ledger);
  if (type === "defense") {
    if (!Array.isArray(pads) || pads.length > MOST_PADS) throw new Error("invalid-expedition-pads");
    walls = pads.map((pad) => {
      if (typeof pad?.kind !== "string" || !pad.kind || pad.kind.length > 32 || !Number.isFinite(pad.hp) || pad.hp < 0) throw new Error("invalid-expedition-pads");
      return { kind: pad.kind, hp: pad.hp };
    });
  }
  if (type === "finish" && !won && !home) {
    const standing = walls.map((pad) => pad.hp > 0).lastIndexOf(true);
    if (standing >= 0) walls = walls.map((pad, i) => (i === standing ? { ...pad, hp: 0 } : pad));
  }
  const best = ledger.best;
  const record = result && !result.skipped && (!best || result.nights > best.nights || (result.nights === best.nights
    && (result.trophies > best.trophies || (result.trophies === best.trophies && result.kills > best.kills))));
  // the time of the day, for the clicker to pay its full income; the calm night after a won one
  const walked = type === "finish" && Number.isFinite(receipt.start) ? Math.min(LONGEST_WALK, Math.max(0, (time - receipt.start) / 1000)) : 0;
  const calm = type === "finish" && won && Number.isFinite(receipt.rate) ? { calmUntil: time + receipt.calmSeconds * 1000 } : {};
  const events = { ...receipt.events, [key]: flies };
  if (newTrophy && type !== "trophy") events[trophyKey] = 0;
  const next = {
    ...state, flies: state.flies + flies, total: state.total + flies,
    expedition3d: {
      ...ledger,
      amber: ledger.amber + Number(newTrophy),
      extraDash: ledger.extraDash || newTrophy,
      warehouse: stock,
      receipt: { ...receipt, delivered, result, events },
      best: record ? result : best,
      ...(walls.length || ledger.pads ? { pads: walls } : {}),
      ...(walked ? { walkSeconds: (Number.isFinite(ledger.walkSeconds) ? ledger.walkSeconds : 0) + walked } : {}),
      ...calm,
    },
  };
  next.rank = rankOf(next.total);
  return { state: next, flies };
}

export function openExpeditionWriter(storage, locks, data) {
  let release, acquiring = false, closed = false;
  const close = () => { closed = true; release?.(); release = null; };
  return {
    async reserve() {
      if (!storage || !locks || closed) throw new Error("expedition-storage");
      if (acquiring) return null;
      if (!release) {
        acquiring = true;
        const held = await new Promise((resolve, reject) => {
          locks.request(SWAMP_WRITE_LOCK, { ifAvailable: true }, (lock) => {
            if (!lock || closed) { resolve(false); return; }
            return new Promise((done) => { release = done; resolve(true); });
          }).catch(reject);
        }).finally(() => { acquiring = false; });
        if (!held || closed) return null;
      }
      try {
        const previous = loadSave(storage, data);
        const { state, context } = reserveDay(previous, data, crypto.randomUUID());
        // 3D earnings do not consume the clicker's offline-income interval.
        persistSave(storage, state, previous.t);
        return context;
      } catch (error) {
        release?.();
        release = null;
        throw error;
      }
    },
    settle(id, type, result) {
      if (!release || closed) throw new Error("expedition-storage");
      const previous = loadSave(storage, data);
      const next = settleDay(previous, id, type, result);
      if (next.stale) throw new Error("stale-expedition");
      if (next.state !== previous) persistSave(storage, next.state, previous.t);
      return next.flies;
    },
    finish() { release?.(); release = null; },
    close,
  };
}
