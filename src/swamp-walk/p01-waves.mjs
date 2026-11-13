// The four night waves of the game day (candidate C).
const entrant = (kind, approach) => Object.freeze({ kind, approach });
const wave = (at, ...entrants) => Object.freeze({ at, entrants: Object.freeze(entrants) });

export const RAID_LIMIT = 6;
export const WAVES = Object.freeze([
  wave(0, entrant("fly", "shore"), entrant("beggar", "deck")),
  wave(15, entrant("tinnik", "shore")),
  wave(30, entrant("toplyak", "deck")),
  wave(45, entrant("fly", "shore"), entrant("toplyak", "deck"),
    entrant("tinnik", "shore"), entrant("beggar", "deck")),
]);
export const WAVE_TIMES = Object.freeze(WAVES.map(({ at }) => at));
