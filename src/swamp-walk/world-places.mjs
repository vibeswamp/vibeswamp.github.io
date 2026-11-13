// Places the world keeps free for the next layers of the game (owner, 13.11). Only where they are and how one gets
// there: what they give and cost comes from the design document and expedition.mjs, never from here.

// The shack's porch and doorstep: the walk starts here, facing the sunset over the lagoon and the sound.
// Nothing tall may stand in the sun line from these points (land.mjs VISTAS / onSunLine keep it clear).
export const PORCH = { x: -0.4, z: 23.6, heading: -2.42 };

// Where the courier fly meets Klyop with a parcel from the clicker, to be carried home: the meadow behind the shack,
// out of the sunset line, a few steps off the shore path (SHORE in land.mjs passes 4 m away).
export const COURIER = { x: -10.2, z: 29.2, radius: 1.6 };

// Trees around the house that can be worked (resin, bark, boards): willows behind the shack, south and west of it,
// so they frame the house without standing between the porch and the sun. forest-shore.mjs plants them.
export const HOME_TREES = [
  { x: -8.2, z: 28.6 },
  { x: -10.8, z: 27.4 },
  { x: -3.4, z: 30.2 },
];

// Three places a little way off, each with its own face; they are the landmarks of land.mjs LANDMARKS:
// the stump glade on the west bank by the sound (sunset side), the beaver dam and the ford to the east (running water),
// the radio hut on the hill to the north (the lookout over the forest).
export const OUTPOSTS = {
  stump: "west glade by the sound",
  beaver: "dam and ford, east",
  radio: "hill lookout, north",
};
