// The shack in 3D is read by the clicker's own reader, so both show the same built steps (src/swamp/save.mjs).
// The game day adds what it keeps in the same save (block `expedition3d`): amber on the shelf, the catch, the stock.
import { migrateSave, readSaveText, readShelter as readClickerShelter } from "../swamp/save.mjs";
import { fishOf, hasAmber, stockOf } from "../swamp/expedition-3d-save.mjs";

export function readShelter(storage, data) {
  const shelter = readClickerShelter(storage, data);
  let state = null;
  try {
    state = migrateSave(JSON.parse(readSaveText(storage) ?? "null"), data);
  } catch {
    // a damaged or unknown record: the day starts with an empty stock
  }
  return {
    ...shelter,
    amber: state ? hasAmber(state) : false,
    fish: state ? fishOf(state) : 0,
    stock: state ? stockOf(state) : { wood: 0, resin: 0 },
  };
}
