// Stage format (character.mjs, from combat.json): { state, duration, contact, chain: [from, to] | null, cancel, tip }.
// A press inside `chain` queues the next stage; it starts at `cancel` (or at the end of this one).
export function advanceCombo(player, stages, pressed, canStart, canContinue, dt) {
  if (!canContinue || !stages.length) player.swing = null;
  let started = false;
  if (player.swing == null) {
    player.swingIndex = 0;
    player.swingQueued = false;
    if (!pressed || !canStart || !canContinue || !stages.length) return null;
    player.swing = 0;
    started = true;
  }

  const current = stages[player.swingIndex ?? 0];
  const before = player.swing;
  if (!started && pressed && stages[player.swingIndex + 1] && current.chain
      && before >= current.chain[0] && before <= current.chain[1]) {
    player.swingQueued = true;
  }
  player.swing += dt;
  const contact = before < current.contact && player.swing >= current.contact;
  if (player.swing >= (player.swingQueued ? current.cancel ?? current.duration : current.duration)) {
    if (player.swingQueued) {
      player.swingIndex++;
      player.swing = 0;
      player.swingQueued = false;
      started = true;
    } else player.swing = null;
  }
  return { started, contact };
}
