import * as T from "./vendor/three.mjs";
import { CELLS, RADIUS, SUN_DIR, WATER, random, smooth } from "./land.mjs";
import { addNightStars, cloudTexture } from "./sky-weather.mjs";
import { reflectInWater } from "./water-reflection.mjs";
// The sun sets north-west, over the open sound seen from the pier (land.mjs SUN_DIR); 6 degrees up, so on a phone
// the sun itself stands in the frame above the far treeline. Due north it hid behind the radio hill.
export const SUN = new T.Vector3(SUN_DIR[0], 0.105, SUN_DIR[1]).normalize();
// One evening palette for the sky, the fog, the far shore and the water: the haze is the sky at the horizon, and
// toward the sun both turn apricot by the same rule, so far banks melt into the sky instead of cutting a grey line.
export const HAZE = new T.Color(0x7c7070);
export const FOG = 0.0105;
export const APRICOT = new T.Color(0xff8a4e);
// How much apricot is in the air: 1 in the evening, 0 at night and in rain (weather.mjs).
export const WARMTH = { value: 1 };
const col = (hex) => new T.Color(hex);
// GLSL: the fog colour seen along a world-space ray, the same glow the sky has around the sun.
export const SUNWARD_FOG = `
  vec3 sunwardFog(vec3 fogBase, vec3 ray, vec3 sunDir, vec3 apricot, float warmth) {
    float toward = max(0., dot(normalize(ray), sunDir));
    float glow = pow(toward, 8.) * .55 + pow(toward, 40.) * .25;
    return mix(fogBase, apricot, glow * warmth);
  }
`;

// The sunward fog, for materials with their own onBeforeCompile (the forest): call it inside that hook. It replaces
// three's fog_fragment so the fog turns apricot toward the sun, and leaves `airColor` for code after it.
export function sunwardFogShader(shader) {
  Object.assign(shader.uniforms, { fogSun: { value: SUN }, fogApricot: { value: APRICOT }, fogWarmth: WARMTH });
  shader.vertexShader = "varying vec3 fogRay;\nvarying float fogY;\n" + shader.vertexShader.replace("#include <fog_vertex>", `#include <fog_vertex>
    vec4 sunwardPoint = vec4(transformed, 1.);
    #ifdef USE_INSTANCING
      sunwardPoint = instanceMatrix * sunwardPoint;
    #endif
    sunwardPoint = modelMatrix * sunwardPoint;
    fogRay = sunwardPoint.xyz - cameraPosition;
    fogY = sunwardPoint.y;`);
  shader.fragmentShader = "varying vec3 fogRay;\nvarying float fogY;\nuniform vec3 fogSun, fogApricot;\nuniform float fogWarmth;\n"
    + SUNWARD_FOG + shader.fragmentShader.replace("#include <fog_fragment>", `
    #ifdef USE_FOG
      vec3 airColor = sunwardFog(fogColor, fogRay, fogSun, fogApricot, fogWarmth);
      float fogFactor = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, airColor, fogFactor);
    #endif`);
}

// Scenery materials (terrain, timber, reeds, grass): the sunward fog plus a low mist band over the water.
export function groundMist(material) {
  const compile = material.onBeforeCompile;
  const cacheKey = compile.toString();
  material.customProgramCacheKey = () => "ground-mist-v2:" + cacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    sunwardFogShader(shader);
    shader.fragmentShader = shader.fragmentShader.replace("gl_FragColor.rgb = mix(gl_FragColor.rgb, airColor, fogFactor);", `
      gl_FragColor.rgb = mix(gl_FragColor.rgb, airColor, fogFactor);
      float groundHaze = (1. - smoothstep(.16, 2.65, fogY)) * smoothstep(9., 58., vFogDepth) * .52;
      gl_FragColor.rgb = mix(gl_FragColor.rgb, airColor, groundHaze);`);
  };
  return material;
}

export function createSky(scene) {
  scene.fog = new T.FogExp2(HAZE.clone(), FOG);
  const ambient = new T.HemisphereLight(0xb3b6cc, 0x7e745b, 1.57);
  scene.add(reflectInWater(ambient));
  const key = new T.DirectionalLight(0xffb987, 2.5);
  key.position.copy(SUN).multiplyScalar(46);
  key.position.y += 13;
  scene.add(reflectInWater(key));
  const fill = new T.DirectionalLight(0xcbdbfa, 0.72);
  fill.position.set(15, 15, 20);
  scene.add(reflectInWater(fill));
  // Clouds and stars come from the candidate C (sky-weather.mjs): one 128x64 noise texture, no extra objects.
  const cloudState = { value: new T.Vector4() };
  const sky = new T.Mesh(new T.SphereGeometry(190, 32, 20), new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false,
    uniforms: {
      sun: { value: SUN }, horizon: { value: HAZE.clone() }, highSky: { value: col(0x34405f) },
      apricot: { value: APRICOT.clone() }, sunCore: { value: col(0xffbb58).multiplyScalar(1.38) },
      cloudMap: { value: cloudTexture() }, cloudState,
      // Opposite the sun the evening sky keeps a pink band low over the trees (the "belt" of a clear sunset).
      belt: { value: col(0xc99aa3) }, warmth: WARMTH,
    },
    vertexShader: `
      varying vec3 direction;
      void main() {
        direction = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }
    `,
    fragmentShader: `
      uniform vec3 sun, horizon, highSky, apricot, sunCore, belt;
      uniform float warmth;
      uniform sampler2D cloudMap;
      uniform vec4 cloudState;
      varying vec3 direction;
      void main() {
        vec3 dir = normalize(direction);
        float glow = max(0., dot(dir, sun));
        vec3 sky = mix(horizon, highSky, smoothstep(-.07, .43, dir.y));
        float skirt = 1. - smoothstep(.026, .26, abs(dir.y - sun.y));
        float streak = sin(dir.y * 118. + sin(dir.x * 13. + dir.z * 4.) * 1.8) * .07;
        sky = mix(sky, apricot, pow(glow, 8.) * skirt * (.74 + streak));
        float away = pow(max(0., -dot(normalize(dir.xz + vec2(.0001)), normalize(sun.xz))), 1.4);
        float band = away * smoothstep(-.03, .07, dir.y) * (1. - smoothstep(.09, .36, dir.y)) * warmth;
        sky = mix(sky, belt, band * .45);
        vec2 cloudUV = dir.xz * vec2(.49, .35) / (.34 + max(dir.y, 0.));
        float cloud = texture2D(cloudMap, cloudUV + vec2(cloudState.x, .17)).r;
        if (cloudState.w < .5) {
          float veil = texture2D(cloudMap, cloudUV * .63 + vec2(cloudState.x * .51, .61)).r;
          cloud = mix(cloud, veil, .26);
        }
        float cloudCover = smoothstep(.45, .58, cloud + cloudState.z * .12);
        // A clear band low over the trees, so the far shores stand against the glow and not against cloud.
        cloudCover *= smoothstep(.035, .19, dir.y) * (1. - smoothstep(.62, .94, dir.y));
        vec3 overcast = mix(sky * .52, apricot * .53 + sky * .37, skirt * pow(glow, 6.) * (1. - cloudState.y));
        overcast = mix(overcast, belt * .82, band * .55);
        sky = mix(sky, overcast, cloudCover * (.78 + cloudState.z * .18));
        sky += sunCore * (pow(glow, 92.) * .34 + smoothstep(.99933, .99986, glow) * .48);
        gl_FragColor = vec4(sky, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }));
  sky.frustumCulled = false;
  sky.userData.weather = addNightStars(sky, cloudState);
  sky.userData.lights = [ambient, key, fill];
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

// `detail`: { mud, moss } tileable photos-like textures (textures/ground-*.webp, made with ComfyUI on 13.11), each
// normalised to a mean of 0.5, so they add grain to the painted vertex colours instead of replacing them.
export function addTerrain(scene, land, detail = null) {
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
  if (detail) {
    for (const texture of [detail.mud, detail.moss]) {
      texture.wrapS = texture.wrapT = T.RepeatWrapping;
      texture.colorSpace = T.SRGBColorSpace;
      texture.anisotropy = 4;
    }
    material.defines = { ...material.defines, GROUND_DETAIL: "" };
  }
  material.customProgramCacheKey = () => detail ? "terrain-detail" : "terrain";
  material.onBeforeCompile = (shader) => {
    if (detail) Object.assign(shader.uniforms, { mudMap: { value: detail.mud }, mossMap: { value: detail.moss } });
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
      #ifdef GROUND_DETAIL
        uniform sampler2D mudMap, mossMap;
      #endif
    ` + shader.fragmentShader.replace("#include <map_fragment>", `
      vec3 grain = texture2D(map, vMapUv + vec2(soil.y * steepness * .79, 0.)).rgb;
      vec3 matGrass = vec3(grain.g * .92, grain.b * 1.07, grain.r * .81);
      #ifdef GROUND_DETAIL
        // Two scales of each texture against tiling: 2.4 m and 11 m. Cliffs stretch the mud along the slope.
        vec2 groundUv = soil.xz * .41 + vec2(soil.y * steepness * .6, 0.);
        vec3 mudDetail = texture2D(mudMap, groundUv).rgb * texture2D(mudMap, soil.zx * .09 + .37).rgb * 4.;
        vec3 mossDetail = texture2D(mossMap, groundUv * 1.2).rgb * texture2D(mossMap, soil.zx * .083 + .61).rgb * 4.;
        vec3 ground = mix(mudDetail, mossDetail, turf);
        diffuseColor.rgb *= mix(vec3(1.), ground, .85) * mix(vec3(grain.r), vec3(1.), .55);
      #else
        diffuseColor.rgb *= mix(vec3(grain.r), matGrass * (.89 + grain.g * .19), turf);
      #endif
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
  scene.add(reflectInWater(new T.Mesh(geometry, groundMist(material))));
}
