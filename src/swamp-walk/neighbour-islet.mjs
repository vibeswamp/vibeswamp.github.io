import * as T from "./vendor/three.mjs";
import { NEIGHBOR_ISLET } from "./world-places.mjs";

// The neighbour's islet, fixed part of the world (world-places.mjs NEIGHBOR_ISLET): survey stakes on the empty plot,
// and collision slots for a neighbour's shack (neighbour-home.mjs fills them when one stands there).
export const NEIGHBOUR_AT = { x: NEIGHBOR_ISLET.x, z: NEIGHBOR_ISLET.z, floor: NEIGHBOR_ISLET.floor - .03,
  turn: NEIGHBOR_ISLET.turn };

// The walk collects its obstacles once at start (clicker-world.mjs hands these in), so the slots are filled or
// emptied in place; an empty slot can touch nothing.
export const NEIGHBOUR_SOLIDS = Array.from({ length: 24 }, () => ({ id: "neighbour", minX: 0, maxX: 0, minY: 1e9,
  maxY: -1e9, minZ: 0, maxZ: 0 }));
export function setNeighbourSolids(boxes = []) {
  NEIGHBOUR_SOLIDS.forEach((slot, i) => Object.assign(slot, boxes[i] ?? { minY: 1e9, maxY: -1e9 }));
  if (stakes) stakes.visible = !boxes.length;
}

let stakes = null;

// Four stakes at the corners of a shack's footprint and a cord between them: one small mesh.
export function addNeighbourIslet(scene) {
  const hx = 2.25, hz = 1.85, positions = [], colors = [];
  const corners = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
  const add = (geometry, x, y, z, color) => {
    const flat = (geometry.index ? geometry.toNonIndexed() : geometry).translate(x, y, z);
    const p = flat.getAttribute("position"), c = new T.Color(color);
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      colors.push(c.r, c.g, c.b);
    }
  };
  for (const [x, z] of corners) add(new T.CylinderGeometry(.035, .045, .62, 5), x, .3, z, 0x8a6f4b);
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
    add(new T.BoxGeometry(Math.abs(bx - ax) + .012, .012, Math.abs(bz - az) + .012), (ax + bx) / 2, .48, (az + bz) / 2,
      0xd8c9a4);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  stakes = new T.Mesh(geometry, new T.MeshStandardMaterial({ vertexColors: true, roughness: .9 }));
  stakes.name = "Neighbour plot stakes";
  stakes.position.set(NEIGHBOUR_AT.x, NEIGHBOUR_AT.floor, NEIGHBOUR_AT.z);
  stakes.rotation.y = NEIGHBOUR_AT.turn;
  scene.add(stakes);
  return stakes;
}
