import * as T from "./vendor/three.mjs";
import { ledgePoint } from "./day-world.mjs";
import { reflectInWater } from "./water-reflection.mjs";
import { groundMist } from "./surface.mjs";
import { WATER } from "./land.mjs";

export function addDayLedges(scene, land) {
  if (!land.day) return;
  const material = groundMist(new T.MeshStandardMaterial({
    vertexColors: true, roughness: .92,
  }));
  const wood = groundMist(new T.MeshStandardMaterial({
    color: 0x6f5335, roughness: .90,
  }));
  const bands = [0x4b4330, 0x595138, 0x65603c, 0x5a6531].map(color => new T.Color(color));
  const tint = new T.Color();
  function bank(ledge, name, outline, { keepInner = false, beam = false } = {}) {
    const count = outline.length;
    const midSide = outline.reduce((s, p) => s + p[0], 0) / count;
    const midFwd = outline.reduce((s, p) => s + p[1], 0) / count;
    const positions = [], colors = [], faces = [];
    for (let ring = 0; ring < bands.length; ring++) {
      const flare = (1 - ring / (bands.length - 1)) ** 1.15;
      for (const [i, [side, forward, top]] of outline.entries()) {
        const ds = side - midSide, df = forward - midFwd;
        const len = Math.hypot(ds, df) || 1;
        const wear = Math.sin(i * 3.63 + ledge.x * .8);
        const frontFace = !keepInner && forward <= .08;
        const spread = keepInner ? (side > midSide ? .68 * flare : 0)
          : (frontFace ? .24 * flare : (.82 + wear * .08) * flare);
        const [x, z] = ledgePoint(ledge, side + (ds / len) * spread, forward + (df / len) * spread);
        const bottom = Math.min(top - .30, land.heightAt(x, z) - .20);
        const y = ring === 0 ? bottom : ring === 1 ? top * .38 + bottom * .62
          : ring === 2 ? top - .10 - wear * .02 : top;
        positions.push(x, y, z);
        colors.push(...tint.copy(bands[ring]).multiplyScalar(.95 + wear * .07).toArray());
      }
    }
    for (let ring = 0; ring < bands.length - 1; ring++) {
      for (let i = 0; i < count; i++) {
        const a = count * ring + i, b = count * ring + (i + 1) % count;
        faces.push(a, b, a + count, b, b + count, a + count);
      }
    }
    const crown = count * (bands.length - 1);
    for (let i = 1; i + 1 < count; i++) faces.push(crown, crown + i, crown + i + 1);
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
    geometry.setIndex(faces);
    geometry.computeVertexNormals();
    const shelf = new T.Mesh(geometry, material);
    shelf.name = name;
    if (beam) {
      const [bx, bz] = ledgePoint(ledge, 0, .055);
      const log = new T.Mesh(new T.CylinderGeometry(.075, .08, ledge.width - .22, 8), wood);
      log.position.set(bx, ledge.y - .072, bz);
      log.rotation.order = "YXZ";
      log.rotation.set(0, ledge.yaw, Math.PI / 2);
      shelf.add(log);
    }
    scene.add(reflectInWater(shelf));
  }
  for (const ledge of land.day.ledges) {
    const half = ledge.width / 2;
    const cut = ledge.chamfer, end = ledge.length;
    const crown = [[-half + cut, 0], [-half, cut], [-half, end - cut], [-half + cut, end],
      [half - cut, end], [half, end - cut], [half, cut], [half - cut, 0]];
    bank(ledge, ledge.id, crown.map(([side, forward]) => [side, forward, ledge.y]), { beam: true });
    const ramp = ledge.ramp;
    if (ramp) {
      const { inner, outer, from, flat, to, y } = ramp;
      bank(ledge, "Radio bank slope", [[inner, from, y], [inner, flat, ledge.y],
        [outer, flat, ledge.y], [outer, from, y]], { keepInner: true });
      bank(ledge, "Radio bank turn", [[inner, flat, ledge.y], [inner, to, ledge.y],
        [outer, to, ledge.y], [outer, flat, ledge.y]], { keepInner: true });
    }
  }
  const { takeoff, landing } = land.day.jump;
  const points = [], faces = [];
  const sides = 5;
  for (const [x, z] of [takeoff, landing]) {
    for (const offset of [-.67, .67]) {
      const y = land.heightAt(x, z + offset);
      if (y <= WATER) continue;
      const base = points.length / 3;
      const leanX = Math.sin(x * 1.9 + offset) * .018;
      const leanZ = Math.cos(z * 1.3 + offset) * .015;
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        points.push(x + Math.cos(a) * .036, y - .08, z + offset + Math.sin(a) * .036);
      }
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        points.push(x + leanX + Math.cos(a) * .023, y + .28, z + offset + leanZ + Math.sin(a) * .023);
      }
      points.push(x + leanX, y + .31, z + offset + leanZ);
      const top = base + sides * 2;
      for (let i = 0; i < sides; i++) {
        const n = (i + 1) % sides;
        faces.push(base + i, base + sides + i, base + n, base + n, base + sides + i, base + sides + n);
        faces.push(base + sides + i, top, base + sides + n);
      }
    }
  }
  const posts = new T.BufferGeometry();
  posts.setAttribute("position", new T.Float32BufferAttribute(points, 3));
  posts.setIndex(faces);
  posts.computeVertexNormals();
  const marker = new T.Mesh(posts, wood);
  marker.name = "ReedCutMarkers";
  scene.add(marker);
}
