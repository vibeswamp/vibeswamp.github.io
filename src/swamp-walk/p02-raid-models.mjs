// Night kinds of the game day (candidate C): files and the wrench hurt volume in metres above the feet - the body
// only, without the tips of reeds or branches. Loaded when night comes. Health and damage: combat-tuning.mjs.
import { createTinnik, createToplyak, P02_MODELS } from "./actors.mjs";

export const P02_RAID_MODELS = Object.freeze({
  tinnik: Object.freeze({
    url: P02_MODELS.tinnik, create: createTinnik,
    lift: 0.84, radius: 0.24, bottom: 0.12, top: 1.22,
  }),
  toplyak: Object.freeze({
    url: P02_MODELS.toplyak, create: createToplyak,
    lift: 0.84, radius: 0.37, bottom: 0.12, top: 1.34,
  }),
});
