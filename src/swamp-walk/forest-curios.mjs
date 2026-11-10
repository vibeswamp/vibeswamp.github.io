import * as T from "./vendor/three.mjs";
import { WATER, random } from "./land.mjs";

export const FOREST_ACTION_TEXT = {
  ru: { knock: "Стукнуть по дуплу", rustle: "Из дупла вылетели светляки." },
  uk: { knock: "Постукати по дуплу", rustle: "З дупла вилетіли світляки." },
  en: { knock: "Knock on the hollow", rustle: "Fireflies spilled out of the hollow." },
};
const MARKS = [
  [[7.6, 25], [6.22, 24.70]],
  [[24, 4.7], [23.30, 3.65]],
  [[-29.5, 14.1], [-28.17, 13.82]],
];

export function addForestCurios(scene, land, anchors) {
  const glyph = new T.BoxGeometry(.062, .12, .036);
  const sap = new T.MeshBasicMaterial({ color: 0xc99c59 });
  const marks = MARKS.flatMap(([[tx, tz], [markX, markZ]]) => {
    const tree = anchors.find(anchor => anchor.sourceX === tx && anchor.sourceZ === tz);
    if (!tree) return [];
    const x = markX + (tree.x - tx), z = markZ + (tree.z - tz);
    const y = land.floorAt(x, z);
    if (y <= WATER) return [];
    const angle = Math.atan2(x - tree.x, z - tree.z);
    const reach = tree.radius + .17;
    const origin = new T.Vector3(tree.x + Math.sin(angle) * reach, tree.y + 1.08, tree.z + Math.cos(angle) * reach);
    const mark = new T.Group();
    mark.position.copy(origin);
    mark.rotation.y = angle;
    for (const offset of [-.075, 0, .075]) {
      const cut = new T.Mesh(glyph, sap);
      cut.position.set(offset, offset * .30, 0);
      cut.rotation.z = -.23;
      mark.add(cut);
    }
    mark.visible = false;
    scene.add(mark);
    return [{ x, y, z, origin, mark, used: -8 }];
  });
  const seeds = random(55181), positions = [];
  for (let i = 0; i < 26; i++) positions.push(seeds() * 2 - 1, seeds(), seeds() * 2 - 1);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  const material = new T.ShaderMaterial({
    uniforms: { age: { value: 4 }, origin: { value: new T.Vector3() } },
    transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    vertexShader: [
      "uniform vec3 origin;",
      "uniform float age;",
      "varying float glow;",
      "void main() {",
      "  float delay = position.y * .45;",
      "  float t = clamp((age - delay) / 1.5, 0., 1.);",
      "  vec3 point = origin + vec3(position.x * (t * 1.7 + .06), t * (1.4 + delay), position.z * (t * 1.6 + .06));",
      "  point.x += sin(t * 13. + position.z * 8.) * t * .22;",
      "  point.z += cos(t * 10. + position.x * 10.) * t * .21;",
      "  vec4 eye = viewMatrix * vec4(point, 1.);",
      "  gl_Position = projectionMatrix * eye;",
      "  gl_PointSize = clamp(58. / max(1., -eye.z), 2., 7.);",
      "  glow = smoothstep(0., .10, t) * (1. - smoothstep(.58, 1., t));",
      "}",
    ].join("\n"),
    fragmentShader: [
      "varying float glow;",
      "void main() {",
      "  float halo = 1. - smoothstep(.05, .49, distance(gl_PointCoord, vec2(.5)));",
      "  gl_FragColor = vec4(.97, .72, .19, halo * glow * .88);",
      "}",
    ].join("\n"),
  });
  const swarm = new T.Points(geometry, material);
  swarm.name = "HollowFireflies";
  swarm.frustumCulled = false;
  swarm.visible = false;
  scene.add(swarm);
  let started = -8;
  function target(player, time) {
    if (!player.grounded || player.swimming || player.traversal) return null;
    return marks.find(point => time - point.used >= 7
      && Math.hypot(player.x - point.x, player.z - point.z) <= 1.08
      && Math.abs(player.y - point.y) < .58) ?? null;
  }
  return {
    points: marks.map(({ x, y, z }) => ({ x, y, z })),
    target,
    use(player, time) {
      const point = target(player, time);
      if (!point) return false;
      started = point.used = time;
      material.uniforms.origin.value.copy(point.origin);
      material.uniforms.age.value = 0;
      swarm.visible = true;
      return true;
    },
    update(time, eye) {
      material.uniforms.age.value = time - started;
      swarm.visible = time - started < 2;
      for (const point of marks) point.mark.visible = time - point.used >= 7
        && Math.hypot(eye.x - point.x, eye.z - point.z) < 17;
    },
  };
}
