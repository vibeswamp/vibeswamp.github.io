// Every number of the fight in one place (enhance 13.11): enemy health and damage, telegraphs, hitstop and
// knockback, the combo stages, the dodge, the focus and the boss. Times are seconds, distances metres.
// Rewards (flies, materials) are not here: they belong to the clicker's economy.

// Enemies. `hits` - wrench hits to defeat; `structureDamage` - what one strike takes from a barricade or the hut;
// `ram` - night raiders check the line to a structure before they hit it; `tell` - the windup the player sees
// before the strike lands (at least 0.4 s, the clip slows down to fit); `weight` divides the knockback;
// `rehit` - a staggered foe can be hit again after this long (so every hit of the combo lands).
export const FOES = Object.freeze({
  fly: Object.freeze({ hits: 3, cacheHits: 2, structureDamage: 12, tell: 0.55, weight: 0.8, rehit: 0.14 }),
  beggar: Object.freeze({ hits: 3, structureDamage: 19, tell: 0.5, weight: 1, rehit: 0.14 }),
  tinnik: Object.freeze({ hits: 2, structureDamage: 8, ram: true, tell: 0.5, weight: 0.9, rehit: 0.14 }),
  toplyak: Object.freeze({ hits: 4, structureDamage: 22, ram: true, tell: 0.72, weight: 1.6, rehit: 0.14 }),
  // The angry Fly (see BOSS): the smash of a Fly, slower and heavier.
  boss: Object.freeze({ hits: 12, structureDamage: 20, tell: 0.65, weight: 3, rehit: 0.14 }),
});

// The angry Fly guarding the exit - only with ?boss=1 until its own model comes from the mascot chat; until then
// the Fly model `scale`d and `tint`ed. It charges along a lane shown on the ground: `tell` to aim, then `speed`
// m/s for `length` metres, hurting Klyop if he is within `width` of its path; afterwards it hangs low for
// `recover` seconds - the moment to hit it. Below half health (`rage`) it chases faster, aims quicker, charges
// sooner and twice in a row.
export const BOSS = Object.freeze({
  scale: 1.55, tint: Object.freeze([1, 0.6, 0.5]), aggro: 9, leash: 7, chase: 2.4,
  charge: Object.freeze({ tell: 0.85, speed: 9, length: 6, width: 1.1, min: 2.4, max: 7, cooldown: 3.2, recover: 0.9 }),
  rage: Object.freeze({ chase: 1.3, tell: 0.6, cooldown: 1.8, twice: true }),
});

// Klyop: three hearts; after a hit he cannot be hurt again for `hurt` seconds.
export const HERO = Object.freeze({ health: 3, hurt: 0.65 });

// The combo, stage by stage: damage (doubled by the forged wrench), knockback distance, hitstop - how long the
// struck foe and Klyop's strike pose hold still at contact (the rest of the world keeps going) - and the step into
// the blow: Klyop follows the foe he pushed back, up to `lunge` metres, so that it stands `close` metres from his
// body again (at least `step`, the weight of the heavy third blow, even with nobody in front), and turns to it by
// at most `turn` radians. Clip timing (contact, chain window, playback rate) is data: public/swamp-walk/mvp/combat.json.
export const COMBO = Object.freeze([
  Object.freeze({ power: 1, knock: 0.32, hitstop: 0.07 }),
  Object.freeze({ power: 1, knock: 0.45, hitstop: 0.07, lunge: 0.4, close: 0.42, turn: 0.35 }),
  Object.freeze({ power: 1, knock: 1.05, hitstop: 0.1, lunge: 0.6, close: 0.42, turn: 0.35, step: 0.3 }),
]);

// Knockback slows down evenly: a push of d metres starts at sqrt(2 * decel * d) m/s.
export const KNOCK = Object.freeze({ decel: 14, step: 0.1 });

// The dodge roll: `time` long, invulnerable for the first `guard` seconds, `speed` (reached at `accel` m/s2) until
// the last `settle` seconds; another roll after `gap`. In a sortie each roll uses a charge (one, two with the amber
// trophy) that comes back in `recharge` seconds - no stamina bar.
export const DODGE = Object.freeze({ time: 0.42, guard: 0.28, speed: 6.6, accel: 60, settle: 0.12, gap: 0.08,
  recharge: 0.9 });

// Focus on a foe (G, the phone button «Цель»): the nearest one within `range`, the one in front preferred; it
// lets go past `keep`; when the target falls, the next one within `retarget` is taken. Klyop faces it and steps
// around it at `strafe` m/s.
export const FOCUS = Object.freeze({ range: 7.2, keep: 8.6, retarget: 6, strafe: 2.9 });
