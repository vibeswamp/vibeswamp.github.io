import * as T from "./vendor/three.mjs";
import { WATER, WATER_EXITS, random } from "./land.mjs";

const COVES = [
  { id: "fishing", x: -6.2, z: 18.25, rx: 1.80, rz: 1.12, leaves: 14 },
  { id: "launch", x: 3.8, z: 17.28, rx: 1.40, rz: 1.03, leaves: 10 },
  { id: "east-shoal", x: 8.08, z: 16.30, rx: 2.10, rz: 1.38, leaves: 11 },
  { id: "dam-cove", x: 20.05, z: 6.02, rx: 1.76, rz: 1.40, leaves: 10 },
  { id: "west-bank", x: -9.92, z: 20.07, rx: 2.31, rz: 1.21, leaves: 12 },
  { id: "creek", x: -24.30, z: -16.30, rx: 2.58, rz: 1.62, leaves: 10 },
];
const GREENS = [0x557244, 0x3c5b3b, 0x747744, 0x869052, 0x516637];

function distanceToSegment(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
}

export function clearLakeAccess(land, x, z, margin) {
  if (!land.lakes) return true;
  const { fishing, deckExits } = land.lakes;
  const waterExits = WATER_EXITS.some(({ points }) => points.some(([px, pz]) => Math.hypot(x - px, z - pz) < .66 + margin));
  return !waterExits
    && Math.hypot(x - fishing.cast.x, z - fishing.cast.z) > .72 + margin
    && deckExits.every(exit => distanceToSegment(x, z, exit.approach, exit.edge) > exit.width * .5 + margin);
}

export function lilyGroups(land) {
  const rng = random(24851);
  return COVES.map(({ id, x, z, rx, rz, leaves }) => {
    const pads = [];
    for (let attempts = 0; pads.length < leaves && attempts < leaves * 40; attempts++) {
      const angle = rng() * Math.PI * 2, radius = Math.sqrt(rng());
      const px = x + Math.cos(angle) * radius * rx, pz = z + Math.sin(angle) * radius * rz;
      const scale = .23 + rng() * .26;
      const depth = WATER - land.heightAt(px, pz);
      if (depth < .18 || depth > 1.36 || !clearLakeAccess(land, px, pz, scale + .12)) continue;
      if ([[0, 0], [-scale, 0], [scale, 0], [0, -scale], [0, scale]]
        .some(([dx, dz]) => land.deck.heightAt(px + dx, pz + dz) > WATER)) continue;
      if (pads.some(pad => Math.hypot(pad.x - px, pad.z - pz) < (pad.scale + scale) * .69)) continue;
      const flower = pads.length === 0 || (pads.length === 5 && id !== "creek");
      pads.push({ x: px, z: pz, scale, flower, yaw: angle, color: GREENS[Math.floor(rng() * GREENS.length)] });
    }
    return { id, pads };
  });
}

function dragonflyShape() {
  const positions = [], colors = [], flex = [];
  const triangle = (points, color, wing = false) => {
    for (const p of points) {
      positions.push(...p);
      colors.push(...color);
      flex.push(wing ? Math.abs(p[0]) : 0);
    }
  };
  const teal = [.23, .52, .47], bronze = [.29, .23, .12];
  triangle([[-.019, 0, -.14], [.019, .024, -.14], [0, .016, .077]], teal);
  triangle([[.019, 0, -.14], [-.019, .024, -.14], [0, .016, .077]], bronze);
  for (const sign of [-1, 1]) {
    for (const [z, span] of [[.015, .145], [-.042, .132]]) {
      const tip = [sign * span, .005, z - .018];
      triangle([[0, 0, z - .018], tip, [sign * span * .68, .006, z + .027]], [.69, .78, .66], true);
      triangle([[0, 0, z - .018], [sign * span * .68, .006, z + .027], [0, .009, z + .017]], [.42, .63, .55], true);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("wing", new T.Float32BufferAttribute(flex, 1));
  return geometry;
}

// A frog: a squat body, two eye bumps and a pale throat; about 9 cm long, vertex colours, one instanced draw for all.
export function frogShape() {
  const positions = [], colors = [];
  const part = (geometry, matrix, rgb) => {
    const flat = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).applyMatrix4(matrix);
    const p = flat.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      const shade = .82 + .18 * Math.max(0, p.getY(i) * 12);
      colors.push(rgb[0] * shade, rgb[1] * shade, rgb[2] * shade);
    }
  };
  const m = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), v = new T.Vector3();
  const body = new T.IcosahedronGeometry(1, 1);
  part(body, m.compose(v.set(0, .024, 0), q.identity(), s.set(.036, .024, .05)), [.33, .45, .19]);
  part(body, m.compose(v.set(0, .014, .028), q.identity(), s.set(.026, .012, .022)), [.70, .66, .42]);
  for (const side of [-1, 1]) {
    part(body, m.compose(v.set(side * .019, .046, .022), q.identity(), s.set(.011, .011, .011)), [.36, .42, .17]);
    part(body, m.compose(v.set(side * .028, .012, -.026), q.identity(), s.set(.016, .011, .026)), [.30, .40, .17]);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function addPondLife(scene, land) {
  // Frogs sit on some of the lily pads and look toward open water; their throats pulse now and then.
  const pads = lilyGroups(land).flatMap(({ pads }) => pads.filter((pad, i) => i % 4 === 2 && pad.scale > .3));
  const frogTime = { value: 0 };
  const frogMaterial = new T.MeshStandardMaterial({ vertexColors: true, roughness: .55 });
  frogMaterial.onBeforeCompile = shader => {
    shader.uniforms.frogTime = frogTime;
    shader.vertexShader = "uniform float frogTime;\n" + shader.vertexShader.replace("#include <begin_vertex>", `
      #include <begin_vertex>
      float seed = instanceMatrix[3].x * 3.1 + instanceMatrix[3].z * 1.7;
      float croak = smoothstep(.0, .2, sin(frogTime * 1.3 + seed)) * step(.6, fract(frogTime * .07 + seed));
      transformed.y += croak * .006 * smoothstep(.02, .0, position.y) * step(.0, position.z);
      transformed.xz *= 1. + croak * .12 * step(.0, position.z) * (1. - smoothstep(.0, .03, position.y));
    `);
  };
  frogMaterial.customProgramCacheKey = () => "pond-frog-v1";
  const frogs = new T.InstancedMesh(frogShape(), frogMaterial, Math.max(1, pads.length));
  frogs.name = "Pond frogs";
  frogs.count = pads.length;
  const frogMatrix = new T.Matrix4(), frogTurn = new T.Quaternion(), frogScale = new T.Vector3();
  for (const [i, pad] of pads.entries()) {
    const size = 1.6 + (i % 3) * .35;
    frogTurn.setFromAxisAngle(new T.Vector3(0, 1, 0), pad.yaw + 2.2);
    frogMatrix.compose(new T.Vector3(pad.x, WATER + .05, pad.z), frogTurn, frogScale.set(size, size, size));
    frogs.setMatrixAt(i, frogMatrix);
  }
  if (pads.length) scene.add(frogs);

  const anchors = [[-5.67, 18.36], [-4.75, 20.75], [8.7, 16.85], [20.05, 6.12], [-15.85, 18.3], [-24.1, -16.6]]
    .filter(([x, z]) => land.heightAt(x, z) < WATER - .12 && clearLakeAccess(land, x, z, .32));
  const geometry = dragonflyShape();
  const phases = anchors.map((_, i) => i * 1.81);
  geometry.setAttribute("phase", new T.InstancedBufferAttribute(new Float32Array(phases), 1));
  const time = { value: 0 };
  const material = new T.ShaderMaterial({
    uniforms: { time }, side: T.DoubleSide, vertexColors: true,
    vertexShader: `
      uniform float time;
      attribute float phase, wing;
      varying vec3 tint;
      varying float flash;
      void main() {
        float orbit = time * (.91 + phase * .037) + phase;
        float yaw = orbit + sin(orbit * .57) * .75;
        float flaps = sin(time * 63. + phase);
        vec3 p = position;
        p.y += wing * flaps * .86;
        p.xz = mat2(cos(yaw), -sin(yaw), sin(yaw), cos(yaw)) * p.xz;
        p += vec3(sin(orbit) * .42, sin(orbit * 1.37) * .13, cos(orbit * 1.14) * .32);
        tint = color;
        flash = .82 + flaps * .18;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.);
      }
    `,
    fragmentShader: `
      varying vec3 tint;
      varying float flash;
      void main() {
        gl_FragColor = vec4(tint * flash, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new T.InstancedMesh(geometry, material, anchors.length);
  mesh.name = "Pond dragonflies";
  mesh.frustumCulled = false;
  for (const [i, [x, z]] of anchors.entries()) {
    mesh.setMatrixAt(i, new T.Matrix4().makeTranslation(x, WATER + .32 + (i % 2) * .11, z));
  }
  scene.add(mesh);
  return {
    update(elapsed) { time.value = elapsed; frogTime.value = elapsed; },
    setEconomy(enabled) { mesh.count = enabled ? Math.min(3, anchors.length) : anchors.length; },
  };
}
