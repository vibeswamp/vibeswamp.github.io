import * as T from "./vendor/three.mjs";
import { addCabin } from "./cabin.mjs";
import { antennaGeometry, furnishHut } from "./clicker-world.mjs";
import { reflectInWater } from "./water-reflection.mjs";
import { NEIGHBOUR_AT, setNeighbourSolids } from "./neighbour-islet.mjs";

// A neighbour's shack on the islet across the lagoon (multiplayer, docs/design/multiplayer.md). The room calls
// addNeighbourHome({ scene, stage, items, data }) when a neighbour comes and again when their stage changes; the
// returned dispose() takes it away. The islet, its footbridge and the survey stakes are a fixed part of the world
// (land.mjs, deck.mjs, neighbour-islet.mjs).
// The shack is our own shack's builder (cabin.mjs) at the islet, furnished by the clicker's rules (clicker-world.mjs),
// then baked into one mesh per material, so a whole shack costs about fifteen draw calls (five more in the water's
// reflection) instead of a hundred. Nothing new is downloaded: the landing models are in the scene already, the planks
// picture is shared with our shack (8 KB, fetched once if our shack has no boards yet).

const AT = NEIGHBOUR_AT;

// Parts [{ geometry, matrix, color? }] -> one non-indexed geometry with normals, uvs and vertex colours.
function mergeParts(parts) {
  const positions = [], normals = [], uvs = [], colors = [];
  const p = new T.Vector3(), n = new T.Vector3(), normal = new T.Matrix3(), tint = new T.Color();
  for (const { geometry, matrix, color } of parts) {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    const position = source.getAttribute("position"), norm = source.getAttribute("normal");
    const uv = source.getAttribute("uv"), own = source.getAttribute("color");
    normal.getNormalMatrix(matrix);
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i).applyMatrix4(matrix);
      positions.push(p.x, p.y, p.z);
      if (norm) n.fromBufferAttribute(norm, i).applyMatrix3(normal).normalize();
      else n.set(0, 1, 0);
      normals.push(n.x, n.y, n.z);
      uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      tint.set(color ?? 0xffffff);
      if (own) tint.multiply(new T.Color(own.getX(i), own.getY(i), own.getZ(i)));
      colors.push(tint.r, tint.g, tint.b);
    }
  }
  const merged = new T.BufferGeometry();
  merged.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  merged.setAttribute("normal", new T.Float32BufferAttribute(normals, 3));
  merged.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2));
  merged.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  return merged;
}

// Every visible mesh under `root` (plain or instanced), grouped by material, baked in root's own space.
function bake(root) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const groups = new Map(), instance = new T.Matrix4(), tint = new T.Color();
  root.traverse(object => {
    if (!object.isMesh) return;
    let hidden = false;
    for (let node = object; node && node !== root; node = node.parent) hidden ||= !node.visible;
    if (hidden) return;
    const base = inverse.clone().multiply(object.matrixWorld);
    if (!groups.has(object.material)) groups.set(object.material, []);
    const list = groups.get(object.material);
    if (object.isInstancedMesh) {
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, instance);
        const color = object.instanceColor ? object.getColorAt(i, tint).getHex() : null;
        list.push({ geometry: object.geometry, matrix: base.clone().multiply(instance), color });
      }
    } else {
      list.push({ geometry: object.geometry, matrix: base, color: null });
    }
  });
  const baked = new T.Group();
  for (const [material, parts] of groups) {
    const merged = new T.Mesh(mergeParts(parts), material.clone());
    merged.material.vertexColors = true;
    merged.name = `Neighbour ${material.name || "part"}`;
    baked.add(merged);
  }
  // The five biggest pieces (boards, roof, frame...) also show in the water; the small ones would only cost draws.
  [...baked.children].sort((a, b) => b.geometry.getAttribute("position").count - a.geometry.getAttribute("position").count)
    .slice(0, 5).forEach(mesh => reflectInWater(mesh));
  return baked;
}

let generation = 0, current = null;

// stage: built steps of the neighbour's clicker (0-21); items: up to 10 ids the neighbour owns (buildings such as
// "tussock", "antenna", "stump", "radio", "review", "peat", "flytrap"; unknown ids are ignored); data: economy data
// (content/swamp-v2.json, text.economyData). Calling again replaces the previous shack.
export async function addNeighbourHome({ scene, stage = 0, items = [], data }) {
  const ticket = ++generation;
  current?.dispose();
  current = null;
  const count = Math.max(0, Math.min(data?.stages?.length ?? 0, Math.floor(Number(stage) || 0)));
  const stages = new Set((data?.stages ?? []).slice(0, count).map(({ id }) => id));
  const known = new Set((data?.buildings ?? []).map(({ id }) => id));
  const owned = Object.fromEntries((Array.isArray(items) ? items : []).slice(0, 10)
    .filter(id => typeof id === "string" && known.has(id)).map(id => [id, 1]));
  const draft = new T.Group();
  const cabin = await addCabin({ THREE: T, scene: draft, stages, owned, at: AT, prefix: "Neighbour", lights: false });
  if (ticket !== generation) return { dispose() {} };
  const material = new T.MeshStandardMaterial({ vertexColors: true, roughness: .82 });
  furnishHut({ scene, cabin, owned, stages, material });
  // Outside, by the clicker's sides: the laptop hummock to the left of the door, the flytrap to the right, the reed
  // antenna in the water behind the shack.
  const landing = id => scene.getObjectByName(`Landing-${id}`)?.levels?.[0]?.object;
  // (Seen from our side, looking north at the door: the tech on the left, the living things on the right.)
  for (const [id, x, z, scale] of [["tussock", 1.2, 2.25, .5], ["flytrap", 1.15, -2.2, .5]]) {
    const source = landing(id);
    if (!owned[id] || !source) continue;
    const holder = new T.Group();
    holder.add(source.clone());
    holder.position.set(x, 0, z);
    holder.scale.setScalar(scale);
    cabin.root.add(holder);
  }
  if (owned.antenna) {
    const mast = new T.Mesh(antennaGeometry(3.2), material);
    mast.position.set(-2.55, -.45, .4);
    cabin.root.add(mast);
  }
  const home = bake(cabin.root);
  home.name = "Neighbour home";
  home.position.copy(cabin.root.position);
  home.rotation.copy(cabin.root.rotation);
  scene.add(home);
  setNeighbourSolids(cabin.solids);
  const result = {
    stage: count,
    dispose() {
      if (!home.parent) return;
      home.removeFromParent();
      home.traverse(object => {
        if (!object.isMesh) return;
        object.geometry.dispose();
        object.material.dispose();
      });
      if (current === result) {
        current = null;
        setNeighbourSolids();
      }
    },
  };
  current = result;
  return result;
}
