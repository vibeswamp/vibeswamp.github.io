import { HOME_TREES } from "./world-places.mjs";

// The middle layer of the swamp (13.11): mangroves standing in the water on arched stilt roots and weeping willows
// on the banks, between the reeds and lilies in front and the misty far shores behind. The meshes come from
// models/swamp-trees.glb (Blender, three LODs each, the forest atlas); forest.mjs instances them like the other trees.
// Sites are kept off the boardwalk, the day's stops and routes, the deck exits, the fishing cast and the sun lines
// from the porch, the fishing pier and the radio lookout (land.mjs onSunLine), and the beaver dam.
export const SHORE_TREES_URL = "/swamp-walk/models/swamp-trees.glb";
export const MANGROVE = 3, WILLOW = 4;

// [x, z, height in metres, collider radius, kind]
export const SHORE_TREES = [
  // the north shore of the lagoon, at the foot of the radio hill: they soften the cliff seen from the porch
  [11.56, -6.65, 5.4, .9, MANGROVE], [4.81, -6.31, 6.0, .9, MANGROVE], [-2, -9.46, 5.6, .9, MANGROVE],
  [-7.44, -10.2, 6.2, .9, MANGROVE], [-11.63, -13.21, 5.2, .9, MANGROVE], [-16.7, -16.03, 5.8, .9, MANGROVE],
  [6.39, -9.01, 7.2, .5, WILLOW], [-4.05, -11.51, 6.6, .5, WILLOW], [-12.08, -14.89, 7.4, .5, WILLOW],
  // the outlet by the ford and the dam
  [15.75, -1.94, 5.6, .9, MANGROVE], [16.22, 12.67, 5.0, .9, MANGROVE], [18.13, 20.95, 5.8, .9, MANGROVE],
  [19.62, 19.74, 6.8, .5, WILLOW], [20.8, 8.47, 6.4, .5, WILLOW],
  // the west bank by the stump glade and the far edge of the sound, beside the sunset
  [-31.52, 18.96, 7.0, .5, WILLOW], [-36.46, 13.28, 6.4, .5, WILLOW], [-46.03, -.66, 6.8, .5, WILLOW],
  [-47.83, 3.43, 5.6, .9, MANGROVE], [-50.85, 7.8, 6.2, .9, MANGROVE], [-54.86, -6.83, 5.4, .9, MANGROVE],
  [-29.82, -42.66, 5.8, .9, MANGROVE],
  // the trees around the house (world-places.mjs HOME_TREES)
  ...HOME_TREES.map(({ x, z }, i) => [x, z, 6.4 + i * .5, .5, WILLOW]),
];
