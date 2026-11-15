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

// The neighbour's islet (multiplayer, docs/design/multiplayer.md): a peat islet about 6 x 5 m in the lagoon, in sight of
// the porch (16 m away, to the right of the sunset), joined to the fishing pier by a footbridge that lands at the
// neighbour's door. land.mjs raises the islet and its flat top (`floor`), deck.mjs lays the footbridge,
// neighbour-home.mjs builds the neighbour's shack on it, door to the south toward our home (`turn`, three.js yaw).
export const NEIGHBOR_ISLET = {
  x: -3.4, z: 8.0, rx: 3.6, rz: 3.1, radius: 3.0, floor: .42, turn: -Math.PI / 2,
  // the footbridge: from the fishing pier's north edge to the neighbour's doorstep, 1.25 m wide
  pier: [[-3.4, 18.75], [-3.35, 10.45]], pierWidth: 1.25,
};

// Three places a little way off, each with its own face; they are the landmarks of land.mjs LANDMARKS:
// the stump glade on the west bank by the sound (sunset side), the beaver dam and the ford to the east (running water),
// the radio hut on the hill to the north (the lookout over the forest).
export const OUTPOSTS = {
  stump: "west glade by the sound",
  beaver: "dam and ford, east",
  radio: "hill lookout, north",
};
