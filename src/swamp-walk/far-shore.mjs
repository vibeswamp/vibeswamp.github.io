import * as T from "./vendor/three.mjs";
import { SUN_DIR, VISTAS, WATER, random, smooth } from "./land.mjs";
import { APRICOT, SUN, SUNWARD_FOG, WARMTH } from "./surface.mjs";
import { reflectInWater } from "./water-reflection.mjs";

// The far shores (13.11): two rings of misty treeline silhouettes beyond the edge of the map, one at 92 m and one
// at 150 m from the middle, so every view over open water ends in layered shores like the clicker painting, not in a
// grey line. One mesh, one draw call (plus one in the water reflection); the picture is drawn on a canvas at start.
const RINGS = [
  { radius: 92, bottom: -1.2, top: 10.5, row: 0 },
  { radius: 150, bottom: -1.2, top: 17, row: 1 },
];
const SEGMENTS = 96;

// Where the sun line from the pier crosses a ring, as a share of the way round (CylinderGeometry: x = r sin, z = r cos).
function sunU(radius) {
  const [px, pz] = VISTAS[0], [dx, dz] = SUN_DIR;
  const b = px * dx + pz * dz, c = px * px + pz * pz - radius * radius;
  const t = -b + Math.sqrt(b * b - c);
  const angle = Math.atan2(px + dx * t, pz + dz * t);
  return ((angle / (Math.PI * 2)) % 1 + 1) % 1;
}

function treeline(width) {
  const rows = 128, canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = rows * 2;
  const g = canvas.getContext("2d");
  const rng = random(81517);
  for (const ring of RINGS) {
    const top = ring.row * rows, floor = top + rows - 3, span = ring.top - ring.bottom;
    const toPx = metres => floor - (metres - ring.bottom) / span * (rows - 6);
    const yPerM = (rows - 6) / span;
    const gapU = sunU(ring.radius);
    const xPerM = width / (Math.PI * 2 * ring.radius);
    // Under the sun the shore is lower, so the sun sits above the trees as in the painting.
    const gap = u => {
      const d = Math.min(Math.abs(u - gapU), 1 - Math.abs(u - gapU));
      return .4 + .6 * smooth(.01, .055, d);
    };
    const shade = g.createLinearGradient(0, top, 0, floor);
    shade.addColorStop(0, "#ffffff");
    shade.addColorStop(.6, "#b0b0b0");
    shade.addColorStop(1, "#707070");
    g.fillStyle = shade;
    const blob = (x, y, rx, ry) => {
      for (const shift of [-width, 0, width]) {
        if (x + shift < -60 || x + shift > width + 60) continue;
        g.beginPath();
        g.ellipse(x + shift, y, Math.max(.6, rx), Math.max(.6, ry), 0, 0, Math.PI * 2);
        g.fill();
      }
    };
    const post = (x, y0, y1, w, lean = 0) => {
      for (const shift of [-width, 0, width]) {
        if (x + shift < -60 || x + shift > width + 60) continue;
        g.beginPath();
        g.moveTo(x + shift - w, y0);
        g.lineTo(x + shift + lean - w * .5, y1);
        g.lineTo(x + shift + lean + w * .5, y1);
        g.lineTo(x + shift + w, y0);
        g.fill();
      }
    };
    // A low line of reeds and bushes, broken here and there by open water.
    g.beginPath();
    g.moveTo(0, floor + 3);
    for (let x = 0; x <= width; x += 2) {
      const u = x / width;
      const bush = .55 + .45 * Math.sin(u * 6.283 * 23 + ring.row) * Math.sin(u * 6.283 * 7 + 1) + .25 * Math.sin(u * 6.283 * 151);
      g.lineTo(x, toPx(Math.max(.15, bush * (ring.row ? 2.4 : 1.6) * gap(u))));
    }
    g.lineTo(width, floor + 3);
    g.fill();
    // Trees stand in loose groves with gaps of mist and water between them. A crown is a cluster of small
    // leaf clumps, so its outline is ragged like foliage and not a smooth cloud.
    const groves = ring.row ? 110 : 84;
    for (let i = 0; i < groves; i++) {
      const centre = (i + rng() * .7) / groves;
      const trees = 3 + Math.floor(rng() * (ring.row ? 7 : 5));
      const spread = (ring.row ? .0075 : .0065) * (.6 + rng() * .8);
      for (let k = 0; k < trees; k++) {
        const u = centre + (k / Math.max(1, trees - 1) - .5) * spread + (rng() - .5) * spread * .3;
        const x = (((u % 1) + 1) % 1) * width;
        const scale = gap(u) * (ring.row ? 1.3 : 1);
        const h = (3 + rng() * 4.4) * scale, crownR = (1.7 + rng() * 1.6) * scale;
        const kind = rng(), base = toPx(0), crown = toPx(h);
        const rx = crownR * xPerM, ry = crownR * yPerM;
        const lean = (rng() - .5) * rx * .4;
        if (kind < .34) {
          // Bald cypress: a flared trunk and a flat crown in soft tiers.
          post(x, base, crown + ry * .3, Math.max(1, rx * .2), lean);
          for (let c = 0; c < 9; c++) {
            const tier = Math.floor(c / 3);
            blob(x + lean + (rng() - .5) * rx * (1.9 - tier * .4), crown + tier * ry * .38 + (rng() - .5) * ry * .2,
              rx * (.2 + rng() * .14), ry * (.13 + rng() * .08));
          }
        } else if (kind < .86) {
          // Live oak or mangrove: a broad, ragged crown on a short trunk.
          post(x, base, crown + ry * .8, Math.max(.8, rx * .1), lean);
          for (let c = 0; c < 10; c++) {
            const a = rng() * Math.PI, r = Math.sqrt(rng());
            blob(x + lean + Math.cos(a) * rx * r * 1.15, crown + ry * (.6 - Math.sin(a) * r * .5),
              rx * (.2 + rng() * .16), ry * (.14 + rng() * .1));
          }
        } else {
          // Willow: a round crown with a hanging fringe down toward the water.
          post(x, base, crown + ry, Math.max(.8, rx * .09), lean);
          for (let c = 0; c < 8; c++) {
            const a = rng() * Math.PI * 2, r = Math.sqrt(rng());
            blob(x + lean + Math.cos(a) * rx * r * .9, crown + ry * .6 + Math.sin(a) * ry * r * .45,
              rx * (.2 + rng() * .12), ry * (.18 + rng() * .1));
          }
          for (let f = -6; f <= 6; f++) {
            const fx = x + lean + f * rx * .14;
            const length = ry * (1 + rng() * .9) * (1 - Math.abs(f) * .06);
            g.fillRect(fx - .6, crown + ry * .6, 1.2, length);
          }
        }
      }
    }
  }
  // One soft pass over the finished picture (a filter on every shape costs about a second on a slow phone).
  const soft = document.createElement("canvas");
  soft.width = canvas.width;
  soft.height = canvas.height;
  const s = soft.getContext("2d");
  s.filter = "blur(.5px)";
  s.drawImage(canvas, 0, 0);
  const texture = new T.CanvasTexture(soft);
  texture.wrapS = T.RepeatWrapping;
  texture.anisotropy = 2;
  return texture;
}

function ringGeometry() {
  // The far ring first: one draw call, painted back to front, so the near ring covers it and both blend with the sky.
  const parts = [...RINGS].reverse().map(ring => {
    const geometry = new T.CylinderGeometry(ring.radius, ring.radius, ring.top - ring.bottom, SEGMENTS, 1, true);
    geometry.translate(0, (ring.top + ring.bottom) / 2, 0);
    const uv = geometry.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setY(i, (ring.row ? 0 : .5) + uv.getY(i) * .5 * (125 / 128) + (ring.row ? 0 : 1 / 256));
    geometry.setAttribute("layer", new T.Float32BufferAttribute(new Float32Array(uv.count).fill(ring.row), 1));
    return geometry;
  });
  const merged = new T.BufferGeometry();
  for (const name of ["position", "uv", "layer"]) {
    const size = parts[0].getAttribute(name).itemSize;
    merged.setAttribute(name, new T.Float32BufferAttribute(parts.flatMap(part => [...part.getAttribute(name).array]), size));
  }
  const indices = [];
  let offset = 0;
  for (const part of parts) {
    for (const index of part.index.array) indices.push(index + offset);
    offset += part.getAttribute("position").count;
  }
  merged.setIndex(indices);
  return merged;
}

// Birds over the sound at sunset: a few dark ticks that glide and flap, one instanced draw.
function birdGeometry() {
  const positions = [0, 0, .12, -.62, .06, -.18, 0, .02, -.1, 0, 0, .12, 0, .02, -.1, .62, .06, -.18];
  const wing = [0, 1, 0, 0, 0, 1];
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("wing", new T.Float32BufferAttribute(wing, 1));
  return geometry;
}

export function addFarShore(scene, { economy = false, sky } = {}) {
  const haze = { value: scene.fog.color };
  const dome = sky?.material.uniforms;
  const material = new T.ShaderMaterial({
    side: T.BackSide, transparent: true, depthWrite: false,
    uniforms: { map: { value: treeline(economy ? 1024 : 2048) }, haze, sun: { value: SUN }, apricot: { value: APRICOT },
      warmth: WARMTH, highSky: dome?.highSky ?? { value: new T.Color(0x34405f) }, skyGlow: dome?.apricot ?? { value: APRICOT },
      sunCore: dome?.sunCore ?? { value: new T.Color(0xffbb58) }, belt: dome?.belt ?? { value: new T.Color(0xc99aa3) } },
    vertexShader: `
      attribute float layer;
      varying vec2 vUv;
      varying vec3 ray;
      varying float far, height;
      void main() {
        vUv = uv;
        far = layer;
        vec4 world = modelMatrix * vec4(position, 1.);
        ray = world.xyz - cameraPosition;
        height = position.y;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform vec3 haze, sun, apricot, highSky, skyGlow, sunCore, belt;
      uniform float warmth;
      varying vec2 vUv;
      varying vec3 ray;
      varying float far, height;
      ${SUNWARD_FOG}
      void main() {
        vec4 tree = texture2D(map, vUv);
        if (tree.a < .02 || height < ${WATER.toFixed(3)}) discard;
        vec3 air = sunwardFog(haze, ray, sun, apricot, warmth);
        // About the sky right behind this point (the dome's own rule): the shore is a shade darker than its sky.
        vec3 dir = normalize(ray);
        float glow = max(0., dot(dir, sun));
        float skirt = 1. - smoothstep(.026, .26, abs(dir.y - sun.y));
        float streak = sin(dir.y * 118. + sin(dir.x * 13. + dir.z * 4.) * 1.8) * .07;
        vec3 behind = mix(mix(haze, highSky, smoothstep(-.07, .43, dir.y)), skyGlow, pow(glow, 8.) * skirt * (.74 + streak));
        float away = pow(max(0., -dot(normalize(dir.xz), normalize(sun.xz))), 1.4);
        behind = mix(behind, belt, away * smoothstep(-.03, .07, dir.y) * (1. - smoothstep(.09, .36, dir.y)) * warmth * .45);
        behind += sunCore * pow(glow, 92.) * .34;
        // Against the sun the shore is a dark cut-out; away from it, a soft blue-violet, lighter for the far ring.
        float toward = pow(max(0., dot(normalize(ray.xz), normalize(sun.xz))), 3.);
        vec3 tint = mix(vec3(.36, .37, .50), vec3(.40, .28, .30), toward * warmth);
        // Below the horizon the shore stands against far water (it shows the sunward air), above it against the sky.
        vec3 backdrop = mix(air, behind, smoothstep(-.012, .02, dir.y));
        vec3 body = backdrop * tint;
        // Mist lies on the water: the lower metres fade into whatever is behind (sky or far water), and the far ring
        // is paler as a whole - real transparency, so nothing has to match the sky exactly.
        float mist = 1. - smoothstep(-.2, mix(2.6, 6., far), height);
        gl_FragColor = vec4(body, tree.a * (1. - mist * .92) * mix(.9, .5, far));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const ring = new T.Mesh(ringGeometry(), material);
  ring.name = "Far shores";
  ring.frustumCulled = false;
  // After the water (which writes no depth), so the misty foot of the shore blends over the far water and the sky.
  ring.renderOrder = 1;
  scene.add(reflectInWater(ring));

  const flock = 7, rng = random(3307);
  const birds = new T.InstancedMesh(birdGeometry(), new T.ShaderMaterial({
    side: T.DoubleSide,
    uniforms: { time: { value: 0 }, haze },
    vertexShader: `
      uniform float time;
      attribute float wing;
      void main() {
        float phase = instanceMatrix[3].w;
        mat4 m = instanceMatrix;
        m[3].w = 1.;
        float t = time * .05 + phase;
        vec3 centre = (m * vec4(0., 0., 0., 1.)).xyz;
        vec3 p = position * 1.6;
        p.y += wing * sin(time * (5. + phase) + phase * 7.) * .45 * step(.5, fract(time * .09 + phase));
        float yaw = t + 1.57;
        p.xz = mat2(cos(yaw), -sin(yaw), sin(yaw), cos(yaw)) * p.xz;
        vec3 world = centre + vec3(cos(t) * 14., sin(t * 1.7) * 1.5, sin(t) * 9.) + p;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.);
      }
    `,
    fragmentShader: `
      uniform vec3 haze;
      void main() {
        gl_FragColor = vec4(haze * .32, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }), flock);
  birds.name = "Sunset birds";
  birds.frustumCulled = false;
  const transform = new T.Matrix4();
  for (let i = 0; i < flock; i++) {
    // Over the sound, a little to each side of the sun line from the pier.
    const along = 55 + rng() * 40, side = (rng() - .5) * 34;
    const x = VISTAS[0][0] + SUN_DIR[0] * along - SUN_DIR[1] * side;
    const z = VISTAS[0][1] + SUN_DIR[1] * along + SUN_DIR[0] * side;
    transform.makeTranslation(x, 17 + rng() * 14, z);
    transform.elements[15] = rng() * 6.28;
    birds.setMatrixAt(i, transform);
  }
  scene.add(birds);
  return {
    update(time, dark) {
      birds.material.uniforms.time.value = time;
      birds.visible = dark < .7;
    },
  };
}
