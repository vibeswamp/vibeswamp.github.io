import * as T from "./vendor/three.mjs";
import { ledgePoint } from "./day-world.mjs";
import { reflectInWater } from "./water-reflection.mjs";
import { groundMist } from "./surface.mjs";
import { WATER } from "./land.mjs";

export function addDayLedges(scene, land) {
  if (!land.day) return;
  const material = groundMist(new T.MeshStandardMaterial({
    vertexColors: true, roughness: .88, flatShading: true,
  }));
  const bands = [0x3b3127, 0x443a2d, 0x74604a, 0x74764b].map(color => new T.Color(color));
  const tint = new T.Color();
  function bank(ledge, name, outline) {
    const count = outline.length;
    const positions = [], colors = [], faces = [];
    for (let ring = 0; ring < bands.length; ring++) {
      for (const [i, [side, forward, top]] of outline.entries()) {
        const [x, z] = ledgePoint(ledge, side, forward);
        const bottom = Math.min(top - .30, land.heightAt(x, z) - .13);
        const wear = Math.sin(i * 3.63 + ledge.x * .8);
        const y = ring === 0 ? bottom : ring === 1 ? top * .36 + bottom * .64
          : ring === 2 ? top - .12 - wear * .045 : top;
        positions.push(x, y, z);
        colors.push(...tint.copy(bands[ring]).multiplyScalar(.92 + wear * .12).toArray());
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
    scene.add(reflectInWater(shelf));
  }
  for (const ledge of land.day.ledges) {
    const half = ledge.width / 2;
    const cut = ledge.chamfer, end = ledge.length;
    const crown = [[-half + cut, 0], [-half, cut], [-half, end - cut], [-half + cut, end],
      [half - cut, end], [half, end - cut], [half, cut], [half - cut, 0]];
    bank(ledge, ledge.id, crown.map(([side, forward]) => [side, forward, ledge.y]));
    const ramp = ledge.ramp;
    if (ramp) {
      const { inner, outer, from, flat, to, y } = ramp;
      bank(ledge, "Radio bank slope", [[inner, from, y], [inner, flat, ledge.y],
        [outer, flat, ledge.y], [outer, from, y]]);
      bank(ledge, "Radio bank turn", [[inner, flat, ledge.y], [inner, to, ledge.y],
        [outer, to, ledge.y], [outer, flat, ledge.y]]);
    }
  }
  const { takeoff, landing } = land.day.jump;
  const posts = new T.BufferGeometry();
  const points = [];
  for (const [x, z] of [takeoff, landing]) {
    for (const offset of [-.67, .67]) {
      const y = land.heightAt(x, z + offset);
      if (y <= WATER) continue;
      points.push(x - .15, y + .025, z + offset, x + .15, y + .025, z + offset,
        x, y + .24, z + offset);
    }
  }
  posts.setAttribute("position", new T.Float32BufferAttribute(points, 3));
  const marker = new T.Mesh(posts, new T.MeshBasicMaterial({ color: 0xb9a76e, side: T.DoubleSide }));
  marker.name = "ReedCutMarkers";
  scene.add(marker);
}
