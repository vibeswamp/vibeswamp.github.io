import * as T from "./vendor/three.mjs";
import { CELLS, RADIUS, WATER, random, smooth } from "./land.mjs";

export const SUN = new T.Vector3(0.19, 0.086, -0.976).normalize();
export const HAZE = new T.Color(0x69716a);
export const FOG = 0.0105;
const col = (hex) => new T.Color(hex);

export function groundMist(material) {
  const compile = material.onBeforeCompile;
  const cacheKey = compile.toString();
  material.customProgramCacheKey = () => "ground-mist:" + cacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.vertexShader = "varying float mistY;\n" + shader.vertexShader.replace("#include <fog_vertex>", 
      "#include <fog_vertex>\n  vec4 fogPoint = vec4(transformed, 1.);\n  #ifdef USE_INSTANCING\n    fogPoint = instanceMatrix * fogPoint;\n  #endif\n  mistY = (modelMatrix * fogPoint).y;");
    shader.fragmentShader = "varying float mistY;\n" + shader.fragmentShader.replace("#include <fog_fragment>", 
      "#include <fog_fragment>\n  #ifdef USE_FOG\n    float groundHaze = (1. - smoothstep(.16, 2.65, mistY)) * smoothstep(9., 58., vFogDepth) * .52;\n    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, groundHaze);\n  #endif");
  };
  return material;
}

export function createSky(scene) {
  scene.fog = new T.FogExp2(HAZE, FOG);
  scene.add(new T.HemisphereLight(0xa2b9c9, 0x7e795b, 1.57));
  const key = new T.DirectionalLight(0xffc493, 2.36);
  key.position.copy(SUN).multiplyScalar(46);
  key.position.y += 13;
  scene.add(key);
  const fill = new T.DirectionalLight(0xcbdbfa, 0.72);
  fill.position.set(15, 15, 20);
  scene.add(fill);
  const sky = new T.Mesh(new T.SphereGeometry(190, 32, 20), new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false,
    uniforms: {
      sun: { value: SUN }, horizon: { value: col(0x746a69) }, highSky: { value: col(0x34445d) },
      apricot: { value: col(0xff8650) }, sunCore: { value: col(0xffbb58).multiplyScalar(1.38) },
    },
    vertexShader: `
      varying vec3 direction;
      void main() {
        direction = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }
    `,
    fragmentShader: `
      uniform vec3 sun, horizon, highSky, apricot, sunCore;
      varying vec3 direction;
      void main() {
        vec3 dir = normalize(direction);
        float glow = max(0., dot(dir, sun));
        vec3 sky = mix(horizon, highSky, smoothstep(-.07, .43, dir.y));
        float skirt = 1. - smoothstep(.026, .26, abs(dir.y - sun.y));
        float streak = sin(dir.y * 118. + sin(dir.x * 13. + dir.z * 4.) * 1.8) * .07;
        sky = mix(sky, apricot, pow(glow, 8.) * skirt * (.74 + streak));
        sky += sunCore * (pow(glow, 92.) * .34 + smoothstep(.99933, .99986, glow) * .48);
        gl_FragColor = vec4(sky, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }));
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);
  return sky;
}

function earthGrain() {
  const rng = random(285);
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  const grain = new Float32Array(size * size), felt = new Float32Array(size * size);
  for (let i = 0; i < grain.length; i++) {
    grain[i] = .77 + rng() * .16;
    felt[i] = .87 + rng() * .09;
  }
  for (let i = 0; i < 2200; i++) {
    const x = Math.floor(rng() * size), y = Math.floor(rng() * size), lean = rng() > .54 ? 1 : -1;
    const strength = (rng() - .54) * .32;
    const length = 2 + Math.floor(rng() * 5);
    for (let step = 0; step < length; step++) {
      const px = (x + Math.round(step * step * lean / length) + size) % size, py = (y + step) % size;
      felt[py * size + px] += strength * (1 - step / (length + 1));
    }
  }
  for (let i = 0; i < grain.length; i++) {
    const value = Math.min(255, Math.floor(grain[i] * 255));
    const tuft = Math.max(42, Math.min(255, Math.floor(felt[i] * 255)));
    data.set([value, tuft, Math.floor(tuft * .93), 255], i * 4);
  }
  const texture = new T.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export function addTerrain(scene, land) {
  const { heights, paths, grain } = land;
  const positions = new Float32Array(heights.length * 3);
  const colors = new Float32Array(positions.length);
  const faces = new Float32Array(heights.length);
  const vegetation = new Float32Array(heights.length);
  const uvs = new Float32Array(heights.length * 2);
  const indices = [];
  const size = CELLS + 1, step = 2 * RADIUS / CELLS;
  const mud = col(0x342d24), reed = col(0x4b5739), grass = col(0x778443);
  const stone = col(0x56483c), clay = col(0x9b8965), moss = col(0x607145), color = new T.Color();
  for (let iz = 0; iz < size; iz++) {
    for (let ix = 0; ix < size; ix++) {
      const i = iz * size + ix, h = heights[i], g = grain[i];
      const x = ix * step - RADIUS, z = iz * step - RADIUS;
      positions.set([x, h, z], i * 3);
      uvs.set([x * 0.34, z * 0.34], i * 2);
      const dx = heights[i + Number(ix < CELLS)] - heights[i - Number(ix > 0)];
      const dz = heights[i + (iz < CELLS ? size : 0)] - heights[i - (iz > 0 ? size : 0)];
      const slope = Math.hypot(dx, dz) / (step * 2);
      const face = smooth(0.56, 1.15, slope);
      faces[i] = face;
      const turf = smooth(.01, .59, h) * smooth(-.26, .12, g) * (1 - face);
      const clumps = smooth(-.42, .45, g * 2.6 + Math.sin(x * .68 + z * .34) * .42);
      vegetation[i] = smooth(-.02, .40, h) * (1 - paths[i]) * (1 - face * .95) * (.57 + clumps * .43);
      color.copy(mud).lerp(reed, smooth(-.13, .40, h)).lerp(grass, turf * .84);
      color.lerp(moss, smooth(.06, .34, -g) * smooth(.19, 1.6, h) * .73);
      color.lerp(stone, face * smooth(WATER + .05, WATER + .89, h))
        .lerp(clay, paths[i] * (1 - face) * .87);
      color.multiplyScalar(.91 + g * .65);
      color.toArray(colors, i * 3);
      if (ix < CELLS && iz < CELLS) indices.push(i, i + size, i + 1, i + 1, i + size, i + size + 1);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new T.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new T.BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new T.BufferAttribute(uvs, 2));
  geometry.setAttribute("face", new T.BufferAttribute(faces, 1));
  geometry.setAttribute("vegetation", new T.BufferAttribute(vegetation, 1));
  geometry.computeVertexNormals();
  const material = new T.MeshStandardMaterial({
    vertexColors: true, roughness: 0.96, map: earthGrain(),
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `
      attribute float face;
      attribute float vegetation;
      varying float steepness;
      varying float turf;
      varying vec3 soil;
    ` + shader.vertexShader.replace("#include <begin_vertex>", `
      #include <begin_vertex>
      steepness = face;
      turf = vegetation;
      soil = position;
    `);
    shader.fragmentShader = `
      varying float steepness;
      varying float turf;
      varying vec3 soil;
    ` + shader.fragmentShader.replace("#include <map_fragment>", `
      vec3 grain = texture2D(map, vMapUv + vec2(soil.y * steepness * .79, 0.)).rgb;
      vec3 matGrass = vec3(grain.g * .92, grain.b * 1.07, grain.r * .81);
      diffuseColor.rgb *= mix(vec3(grain.r), matGrass * (.89 + grain.g * .19), turf);
    `).replace("#include <color_fragment>", `
      #include <color_fragment>
      float fault = sin(soil.x * .78 + soil.z * .52) * .43 + sin(soil.x * 1.76 - soil.z * 1.32) * .26;
      float wet = 1. - smoothstep(.08, .67, soil.y + fault * .53);
      diffuseColor.rgb *= 1. - wet * (.20 + steepness * .19);
      if (steepness > .045) {
        float bedY = soil.y + sin(soil.x * .43 + soil.z * .57) * .17 + fault * .24;
        float layer = fract(bedY * 2.36);
        float exposure = smoothstep(.01, .58, sin(soil.x * 1.27 + soil.z * .84)
          * sin(soil.y * 2.68 + soil.x * .32 - soil.z * 1.16) + fault * .38);
        float seams = smoothstep(.59, .87, layer) * (1. - smoothstep(.89, 1., layer)) * exposure;
        float mottling = smoothstep(.10, .69, sin(soil.x * .79 + soil.z * .58)
          * sin(soil.y * 1.51 - soil.z * 1.43 + fault));
        diffuseColor.rgb *= 1. - steepness * (.17 * seams + .22 * mottling);
        diffuseColor.rgb += vec3(.022, .013, .008) * steepness * (1. - wet) * (.32 + .68 * exposure) * (1. - seams);
      }
    `);
  };
  scene.add(new T.Mesh(geometry, groundMist(material)));
}
