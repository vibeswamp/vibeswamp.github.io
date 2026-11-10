import { BEAVER, beaverBaseY, beaverPoint } from "./beaver-site.mjs";

export const RADIO_YAW = 2.9;
export const MUG = [.525, .639, .031];
export const FOAM = [19.25, 6.68];
const sluice = [[1.209, .736, .324], [1.57, .539, .58], [2.12, .275, 1.06]];
const bank = [[23.27, 4.98], [22.78, 5.23], [21.92, 5.59], [20.78, 6.07], FOAM, [18.70, 6.98]];

const fogAndOutput = `
  float distanceToEye = length(cameraPosition - point) * fogDensity;
  rgb = mix(rgb, fogColor, 1. - exp(-distanceToEye * distanceToEye));
  gl_FragColor = vec4(rgb, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

function waterMaterial(T, time, haze, fog, paint) {
  return new T.ShaderMaterial({
    transparent: true, depthWrite: false, side: T.DoubleSide,
    uniforms: { time, fogColor: { value: haze }, fogDensity: { value: fog } },
    vertexShader: `
      varying vec2 st;
      varying vec3 point;
      void main() {
        st = uv;
        point = (modelMatrix * vec4(position, 1.)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: `
      varying vec2 st;
      varying vec3 point;
      uniform vec3 fogColor;
      uniform float time, fogDensity;
      void main() {
        ${paint}
        ${fogAndOutput}
      }`,
  });
}

export function addDamRunoff(T, scene, land, { water, time, haze, fog }) {
  const base = land.beaver?.y ?? beaverBaseY(land.heightAt);
  const route = new T.CatmullRomCurve3([
    ...sluice.map(p => beaverPoint(base, ...p)),
    ...bank.map(([x, z], i) => [x, Math.max(water + .016, land.heightAt(x, z) + .026,
      i === 0 ? base + .165 * BEAVER.scale : -Infinity), z]),
  ].map(p => new T.Vector3(...p)));
  const positions = [], uv = [], indices = [], banks = [];
  const segments = 64;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const center = route.getPointAt(t), tangent = route.getTangentAt(t);
    const halfWidth = BEAVER.scale * (.115 + t * .115 + .018 * Math.sin(t * 42));
    for (const side of [-1, 1]) {
      const x = center.x + tangent.z * halfWidth * side, z = center.z - tangent.x * halfWidth * side;
      const y = Math.max(center.y, water + .015, land.heightAt(x, z) + .017);
      positions.push(x, y, z);
      uv.push((side + 1) * .5, t);
      const bx = center.x + (x - center.x) * 1.84, bz = center.z + (z - center.z) * 1.84;
      banks.push(bx, land.heightAt(bx, bz) + .026, bz);
    }
    if (i === segments) break;
    const a = 2 * i;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new T.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  const bedGeometry = geometry.clone();
  bedGeometry.setAttribute("position", new T.Float32BufferAttribute(banks, 3));
  const bed = new T.Mesh(bedGeometry, waterMaterial(T, time, haze, fog, `
    float bank = .26 + .022 * sin(st.y * 171.) + .038 * sin(st.y * 93. + st.x * 13.);
    float verge = 1. - smoothstep(bank - .11, bank + .20, abs(st.x - .5));
    float mud = sin(st.y * 83. + st.x * 20.) * sin(st.x * 37. - st.y * 107.) * .20 + .56;
    vec3 rgb = mix(vec3(.041, .050, .030), vec3(.106, .115, .055), mud);
    float alpha = verge * smoothstep(.28, .41, st.y) * (1. - smoothstep(.76, .90, st.y)) * .93;
  `));
  bed.name = "Dark wet silt in runoff bed";
  bed.renderOrder = 1;
  const stream = new T.Mesh(geometry, waterMaterial(T, time, haze, fog, `
    float edge = smoothstep(0., .22, st.x) * (1. - smoothstep(.77, 1., st.x));
    float roll = st.y * 90. - time * 10.;
    float stripe = sin(roll + 1.9 * sin(st.x * 9. + roll * .17));
    float thread = sin(st.x * 39. + st.y * 7. + sin(roll * .33 + st.x * 7.) * .98);
    float breakUp = .64 + .36 * sin(st.x * 21. - st.y * 93. + time * 3.);
    float highlight = smoothstep(.28, .96, stripe * .43 + thread * .57) * breakUp;
    vec3 rgb = mix(vec3(.055, .097, .081), vec3(.37, .48, .39), highlight);
    float alpha = edge * (1. - smoothstep(.87, 1., st.y)) * (.66 + .29 * highlight);
  `));
  stream.name = "Spillway with moving water";
  stream.renderOrder = 2;
  const foam = new T.Mesh(new T.PlaneGeometry(.68 * BEAVER.scale, .64 * BEAVER.scale), waterMaterial(T, time, haze, fog, `
    vec2 d = (st - .5) * 2.;
    float r = length(d);
    float a = atan(d.y, d.x);
    float ring = sin(r * 28. - time * 7. + sin(a * 4.) * .71 + sin(a * 9. + time) * .31);
    float arcMask = .5 + .5 * sin(a * 5. + sin(r * 16. - time * 3.) * 1.4);
    float rim = smoothstep(.34, .96, ring) * smoothstep(.16, .87, arcMask) * (1. - smoothstep(.44, 1., r));
    float churn = sin(d.x * 37. + time * 3.7) * sin(d.y * 29. + time * 4.1 + sin(d.x * 13.) * 2.);
    float flecks = smoothstep(.27, .96, churn) * (1. - smoothstep(.04, .68, r));
    float alpha = max(rim * .52, flecks * .74);
    vec3 rgb = vec3(.64, .67, .53);
  `));
  foam.name = "Lagoon confluence foam";
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(FOAM[0], water + .023, FOAM[1]);
  foam.renderOrder = 3;
  scene.add(bed, stream, foam);
  return { bed, stream, foam };
}

function steamMap(T) {
  const width = 32, height = 64;
  const rgba = new Uint8Array(width * height * 4);
  for (let j = 0; j < height; j++) {
    const y = (j + .5) / height;
    const center = .50 + .12 * Math.sin(y * 8) - .08 * Math.sin(y * 17);
    const taper = Math.sin(y * Math.PI) ** .74;
    for (let i = 0; i < width; i++) {
      const x = (i + .5) / width, k = (i + j * width) * 4;
      const offset = (x - center) / (.074 + .09 * y);
      const shape = Math.exp(-offset * offset);
      rgba[k] = rgba[k + 1] = rgba[k + 2] = 255;
      rgba[k + 3] = Math.round(255 * shape * taper);
    }
  }
  const map = new T.DataTexture(rgba, width, height);
  map.minFilter = map.magFilter = T.LinearFilter;
  map.needsUpdate = true;
  return map;
}

export function addTeaSteam(T, tussock) {
  const group = new T.Group();
  group.name = "Tea steam at cup rim";
  group.position.set(...MUG);
  tussock.add(group);
  const map = steamMap(T);
  const wisps = Array.from({ length: 4 }, () => {
    const wisp = new T.Sprite(new T.SpriteMaterial({
      map, color: 0xdfdbc7, transparent: true, opacity: 0, depthWrite: false,
    }));
    group.add(wisp);
    return wisp;
  });
  const world = new T.Vector3();
  return {
    group,
    update(time, eye) {
      group.visible = group.getWorldPosition(world).distanceToSquared(eye) < 18 ** 2;
      if (!group.visible) return;
      for (const [i, wisp] of wisps.entries()) {
        const age = (time * (.48 + i * .045) + i * .271) % 1;
        const bend = Math.sin(time * 1.9 + i * 2.4) * age * .085;
        wisp.position.set((i - 1.5) * .038 + bend, .059 + age * .30, .018 * Math.cos(time * 1.8 + i));
        wisp.material.rotation = bend * 3.3;
        wisp.material.opacity = Math.sin(age * Math.PI) ** 1.5 * .40;
        wisp.scale.set(.060 + age * .09, .13 + age * .10, 1);
      }
    },
  };
}

export function makeShoreStoneGeometry(T, variant) {
  const geometry = variant === 1 ? new T.DodecahedronGeometry(1, 0) : new T.IcosahedronGeometry(1, variant === 2 ? 1 : 0);
  const pos = geometry.attributes.position, tints = [];
  const stone = new T.Color(0xbfb5a1), moss = new T.Color(0x9ba06f), tint = new T.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    pos.setXYZ(i, x * (1 + .19 * z) + y * .19, y * (1 + .16 * x) - .11 * z, z * (1 + .16 * x));
    const damp = Math.max(0, Math.min(1, (y + .24 + z * .40) * .96));
    tint.copy(stone).lerp(moss, damp);
    tints.push(tint.r, tint.g, tint.b);
  }
  geometry.setAttribute("color", new T.Float32BufferAttribute(tints, 3));
  geometry.computeVertexNormals();
  return geometry;
}
