import * as T from "./vendor/three.mjs";
import { CABIN } from "./cabin.mjs";
import { frogShape } from "./pond-life.mjs";
import { reflectInWater } from "./water-reflection.mjs";
import { groundMist } from "./surface.mjs";

// The clicker is the source of truth for the home (owner, 13.11: «уловить логику… кликера»). Its painting puts the
// tech on the left of the hut (the laptop hummock and its reed antenna) and the living things on the right (the
// flytrap, the beaver dam); inside, the stump computer works in a corner by the bench, the review frogs read under
// the lamp, the radio sits by the tea and the peat server against the wall (src/swamp/scene.mjs SHORE and ROOMS).
// Here the same things appear in 3D only when the save says they were bought, and the antenna moves as the hut grows,
// as it does in the painting. Nothing here writes the save.

// The hut's era, by the same rule as the clicker (scene.mjs data-era): the open hummock, the deck, the closed hut,
// the furnished hut.
export function hutEra(stages) {
  return stages.has("floor") ? 3 : stages.has("awning") ? 2 : stages.has("deck") ? 1 : 0;
}

// The laptop hummock's antenna: stands by the hummock while the hut is open, then behind the closed hut, its dish
// over the roof. World positions, kept off the boardwalk, the fishing pier, the shortcut and the shore path.
const ANTENNA = [
  { x: -3.4, z: 20.55, height: 2.3 },
  { x: -6.95, z: 26.95, height: 4.7 },
];

// Simple parts merged into one mesh with vertex colours: one draw call per prop.
function merge(parts) {
  const positions = [], normals = [], colors = [];
  for (const { geometry, matrix, color } of parts) {
    const flat = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).applyMatrix4(matrix);
    flat.computeVertexNormals();
    const p = flat.getAttribute("position"), n = flat.getAttribute("normal"), c = new T.Color(color);
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      colors.push(c.r, c.g, c.b);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new T.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  return geometry;
}
const at = (x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => new T.Matrix4().compose(
  new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new T.Vector3(sx, sy, sz));

// A reed antenna: three lashed reed poles, a crossbar with a little dish, a red light on top.
function antennaGeometry(height) {
  const reed = new T.CylinderGeometry(.5, 1, 1, 5), cone = new T.ConeGeometry(1, 1, 9, 1, true), ring = new T.TorusGeometry(1, .3, 3, 8);
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1;
    parts.push({ geometry: reed, matrix: at(Math.cos(a) * .045, height / 2, Math.sin(a) * .045, .032, height, .032, Math.sin(a) * .03, 0, Math.cos(a) * .03), color: 0x8a7a4c });
  }
  for (const y of [.35, height * .45, height * .8]) {
    parts.push({ geometry: ring, matrix: at(0, y, 0, .085, .085, .085, Math.PI / 2), color: 0x5d4a2e });
  }
  parts.push({ geometry: reed, matrix: at(0, height * .86, 0, .02, .7, .02, 0, 0, Math.PI / 2), color: 0x6f5f3c });
  parts.push({ geometry: cone, matrix: at(.3, height * .86 + .05, 0, .19, .1, .19, 0, 0, -1.1), color: 0xb8ab8a });
  parts.push({ geometry: reed, matrix: at(-.3, height * .86 - .12, 0, .012, .26, .012), color: 0x54462c });
  return merge(parts);
}

// The peat server: a block of cut peat with a vent and green lamps, as in the clicker's server room.
function peatServerGeometry() {
  const box = new T.BoxGeometry(1, 1, 1), parts = [];
  parts.push({ geometry: box, matrix: at(0, .27, 0, .42, .54, .36), color: 0x3b3022 });
  parts.push({ geometry: box, matrix: at(0, .56, 0, .46, .05, .4), color: 0x56602f });
  for (const y of [.16, .29, .42]) {
    parts.push({ geometry: box, matrix: at(0, y, .182, .34, .07, .01), color: 0x2a241b });
    parts.push({ geometry: box, matrix: at(.12, y, .19, .04, .025, .01), color: 0x9fe07a });
  }
  return merge(parts);
}

export function addClickerWorld({ scene, pack, shelter, cabin, land }) {
  const { stages = new Set(), owned = {} } = shelter;
  const bought = id => Number(owned?.[id]) > 0;
  const era = hutEra(stages);
  const obstacles = [];
  const material = groundMist(new T.MeshStandardMaterial({ vertexColors: true, roughness: .82 }));
  const glows = [];

  if (bought("antenna")) {
    const spot = ANTENNA[era >= 2 ? 1 : 0];
    const ground = land.heightAt(spot.x, spot.z);
    const mast = new T.Mesh(antennaGeometry(spot.height), material);
    mast.name = "Clicker antenna";
    mast.position.set(spot.x, ground - .05, spot.z);
    mast.rotation.y = -.6;
    scene.add(reflectInWater(mast));
    const lamp = new T.Mesh(new T.SphereGeometry(.05, 8, 6), new T.MeshBasicMaterial({ color: 0xff6a45 }));
    lamp.position.set(0, spot.height + .03, 0);
    mast.add(lamp);
    glows.push(lamp);
    obstacles.push({ id: "antenna", x: spot.x, z: spot.z, radius: .12, minY: ground - .1, top: ground + spot.height });
  }

  // Inside the hut, in its own coordinates. Each prop is solid, so Klyop walks round it.
  const inside = [];
  const place = (object, x, y, z, yaw, footprint) => {
    object.position.set(x, y, z);
    object.rotation.y = yaw;
    cabin.root.add(object);
    if (footprint) cabin.block(x, y + footprint[1] / 2, z, footprint[0], footprint[1], footprint[2]);
    inside.push(object);
  };
  const mini = (id, scale) => {
    // scenery.mjs has already moved the landing meshes into their LOD objects: take the near level from there.
    const source = scene.getObjectByName(`Landing-${id}`)?.levels?.[0]?.object ?? pack.getObjectByName(id);
    if (!source?.isMesh) return null;
    // The model keeps its own offset from the landing pack (it stands on y = 0 there); the holder shrinks it.
    const holder = new T.Group();
    holder.name = `Clicker ${id}`;
    holder.add(source.clone());
    holder.scale.setScalar(scale);
    return holder;
  };
  // The stump computer in the work corner by the door, next to the workbench (clicker: «рабочий угол»).
  if (bought("stump")) {
    const stump = mini("stump", .27);
    if (stump) place(stump, 1.62, 0, -1.22, -2.4, [.62, .6, .62]);
  }
  // The radio by the tea: on the desk's free end when there is a desk, else on the floor by the back wall.
  if (bought("radio")) {
    const radio = mini("radio", cabin.desk ? .085 : .12);
    if (radio) {
      if (cabin.desk) place(radio, -1.08, .77, -1.27, .3);
      else place(radio, -1.62, 0, -1.2, .5, [.42, .42, .42]);
    }
  }
  // The review frogs read under the lamp (south side), a sheet of notes between them.
  if (bought("review")) {
    const frogs = new T.Group();
    frogs.name = "Clicker review frogs";
    const frog = frogShape();
    const skin = new T.MeshStandardMaterial({ vertexColors: true, roughness: .55 });
    for (const [dx, yaw] of [[-.07, .5], [.09, -.4]]) {
      const one = new T.Mesh(frog, skin);
      one.position.set(dx, 0, 0);
      one.rotation.y = Math.PI + yaw;
      one.scale.setScalar(2.4);
      frogs.add(one);
    }
    const sheet = new T.Mesh(new T.BoxGeometry(.16, .006, .21), new T.MeshStandardMaterial({ color: 0xe0cfa4, roughness: .9 }));
    sheet.position.set(0, .004, -.09);
    sheet.rotation.y = .2;
    frogs.add(sheet);
    place(frogs, -1.3, 0, .52, 0, [.4, .2, .3]);
  }
  // The peat server against the back wall; the server room stage brings its own rack, so it stands beside it.
  if (bought("peat")) {
    const server = new T.Mesh(peatServerGeometry(), material);
    server.name = "Clicker peat server";
    place(server, -1.72, 0, stages.has("server_room") ? .45 : 1.2, Math.PI / 2, [.4, .58, .46]);
  }
  for (const object of inside) object.traverse(child => { if (child.isMesh) reflectInWater(child); });

  return {
    era,
    obstacles,
    // Shore buildings shown only when owned (scenery.mjs keeps them as landmarks otherwise).
    shows: id => bought(id),
    update(time) {
      for (const lamp of glows) lamp.visible = Math.sin(time * 2.2) > -.35;
    },
  };
}
