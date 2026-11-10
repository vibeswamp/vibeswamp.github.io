// The clicker owns this block and the fly balance. A result and its receipt
// are persisted together by the caller before either becomes visible.
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const rewardFor = (rate) => Math.min(3000, Math.max(15, Math.round(rate * 15) || 0));
const trophyCount = (mask) => (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1);

function progressOf(state) {
  const progress = state.expedition;
  return {
    serial: count(progress?.serial),
    active: progress?.active ?? null,
    amber: progress?.amber === true,
    champion: progress?.champion === true,
    best: {
      nights: Math.min(3, count(progress?.best?.nights)),
      trophies: Math.min(3, count(progress?.best?.trophies)),
      kills: count(progress?.best?.kills)
    }
  };
}

export function expeditionContext(state, rate) {
  const { amber, champion, best } = progressOf(state);
  const tier = (id) => [1, 3, 7].filter((threshold) => count(state.own[id]) >= threshold).length;
  return {
    stage: state.stage,
    support: { flytrap: tier("flytrap"), beaver: tier("beaver"), stump: tier("stump"), radio: tier("radio") },
    reward: rewardFor(rate),
    starts: ["kit", ...(amber ? ["runner"] : []), ...(champion ? ["warden"] : [])],
    best
  };
}

export function reserveExpedition(state, rate, start) {
  const context = expeditionContext(state, rate);
  if (!context.starts.includes(start)) throw new Error("locked-start");
  const progress = progressOf(state);
  const runId = progress.serial + 1;
  if (!Number.isSafeInteger(runId)) throw new Error("expedition-serial");
  progress.serial = runId;
  progress.active = { runId, nights: 0, mask: 0, reward: context.reward, finished: false };
  return { state: { ...state, expedition: progress }, context: { ...context, runId, start } };
}

function higherScore(candidate, best) {
  for (const key of ["nights", "trophies", "kills"]) {
    if (candidate[key] !== best[key]) return candidate[key] > best[key];
  }
  return false;
}

export function settleExpedition(state, event) {
  const progress = progressOf(state);
  const active = { ...progress.active };
  const { runId, day, type, kills } = event;
  if (!Number.isSafeInteger(runId) || runId < 1 || !Number.isInteger(day) || day < 1 || day > 3
      || !["deposit", "night", "finish"].includes(type)) throw new Error("expedition-event");

  // An older callback cannot affect a newer run, even after a reload.
  if (runId !== active.runId || runId !== progress.serial) throw new Error("expedition-expired");
  const bit = 1 << (day - 1);
  const duplicate = type === "deposit" ? (active.mask & bit) !== 0
    : type === "night" ? day <= active.nights : active.finished;
  if (duplicate) return { state, flies: type === "night" && (active.mask & bit) ? active.reward : 0 };
  if (active.finished || day !== active.nights + 1) throw new Error("expedition-order");

  let flies = 0;
  if (type === "deposit") {
    active.mask |= bit;
    progress.amber = true;
  } else if (type === "night") {
    active.nights = day;
    if (active.mask & bit) flies = active.reward;
    if (day === 3) {
      active.finished = true;
      progress.champion = true;
    }
  } else {
    active.finished = true;
  }
  const score = { nights: active.nights, trophies: trophyCount(active.mask), kills: count(kills) };
  if (higherScore(score, progress.best)) progress.best = score;
  progress.active = active;
  return {
    state: { ...state, flies: state.flies + flies, total: state.total + flies, expedition: progress },
    flies
  };
}
