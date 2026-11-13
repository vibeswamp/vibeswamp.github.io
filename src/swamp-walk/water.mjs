import * as T from "./vendor/three.mjs";
import { CELLS, RADIUS, WATER, clamp, random, smooth } from "./land.mjs";
import { APRICOT, FOG, HAZE, SUN, SUNWARD_FOG, WARMTH } from "./surface.mjs";
import { createWaterReflectionCamera } from "./water-reflection.mjs";

const REFLECTION_PROFILES = {
  normal: { width: 384, interval: .1 },
  economy: { width: 192, interval: .2 },
};

function rippleMap() {
  const rng = random(701);
  const size = 128;
  const modes = Array.from({ length: 19 }, (_, i) => ({
    x: 1 + Math.floor(rng() * 13), z: -12 + Math.floor(rng() * 27),
    phase: rng() * 2 * Math.PI, amp: 0.12 / (1 + i * .10),
  }));
  const pixels = new Uint8Array(size * size * 4);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      let a = 0, b = 0, h = 0;
      for (const mode of modes) {
        const phase = 2 * Math.PI / size * (mode.x * x + mode.z * z) + mode.phase;
        const slope = Math.cos(phase) * mode.amp;
        a += mode.x / 11 * slope;
        b += mode.z / 11 * slope;
        h += Math.sin(phase) * mode.amp;
      }
      const k = (z * size + x) * 4;
      pixels.set([a, b, h].map(v => Math.round(127.5 * (1 + clamp(v * 2.05, -1, 1)))), k);
    }
  }
  // The alpha channel shares this texture with the stationary duckweed marks.
  for (let i = 0; i < 1920; i++) {
    const x = Math.floor(rng() * size), z = Math.floor(rng() * size);
    const rx = .9 + rng() * 1.5, rz = .6 + rng() * 1.1;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const radius = Math.hypot(dx / rx, dz / rz);
        if (radius >= 1) continue;
        const k = (((z + dz + size) % size) * size + (x + dx + size) % size) * 4 + 3;
        pixels[k] = Math.max(pixels[k], Math.round((1 - radius * .54) * 255));
      }
    }
  }
  const map = new T.DataTexture(pixels, size, size);
  map.wrapS = map.wrapT = T.RepeatWrapping;
  map.magFilter = T.LinearFilter;
  map.minFilter = T.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

function shorelineMap(land, roots) {
  const size = CELLS + 1;
  const data = new Uint8Array(size * size * 4);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const index = z * size + x, k = index * 4, h = land.heights[index];
      const px = x * (2 * RADIUS / CELLS) - RADIUS, pz = z * (2 * RADIUS / CELLS) - RADIUS;
      const depth = WATER - h, soil = land.grain[index];
      const eddy = Math.sin(px * .62 + pz * .45) * .18 + Math.sin(px * 1.21 - pz * .31) * .12;
      const siltBands = Math.sin(px * 1.45 + pz * .81 + soil * 3.7) * .13;
      const shallows = smooth(.035, .14, depth) * (1 - smooth(.52, .96, depth));
      const pocket = Math.sin(px * .34 - pz * .23 + eddy * 1.7) * .21;
      const mat = smooth(.05, .45, soil * .83 + eddy + pocket) * shallows;
      data[k] = Math.round(clamp((h + 2.4) / 4.8, 0, 1) * 255);
      data[k + 1] = Math.round(mat * 255);
      data[k + 2] = Math.round(clamp(.50 + soil * 1.14 + eddy * .65 + siltBands * shallows, 0, 1) * 255);
      data[k + 3] = 0;
    }
  }
  const scale = CELLS / (2 * RADIUS);
  for (const [x, z] of roots) {
    const ix = Math.round((x + RADIUS) * scale), iz = Math.round((z + RADIUS) * scale);
    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (ix + dx < 0 || ix + dx >= size || iz + dz < 0 || iz + dz >= size) continue;
        const k = ((iz + dz) * size + ix + dx) * 4 + 3;
        const pool = Math.round(255 * (1 - smooth(.7, 3.1, Math.hypot(dx, dz))));
        data[k] = Math.max(data[k], pool);
      }
    }
  }
  const map = new T.DataTexture(data, size, size);
  map.magFilter = map.minFilter = T.LinearFilter;
  map.needsUpdate = true;
  return map;
}

export function addWater(scene, land, { wetRoots = [], sky } = {}) {
  const reflection = createWaterReflectionCamera();
  const target = new T.WebGLRenderTarget(1, 1, { generateMipmaps: false });
  const lights = scene.children.filter(object => object.isLight);
  const sunLight = lights.find(light => light.isDirectionalLight);
  const sunIntensity = sunLight?.intensity || 1;
  const color = hex => ({ value: new T.Color(hex) });
  const uniforms = {
    time: { value: 0 }, bed: { value: shorelineMap(land, wetRoots) },
    ripples: { value: rippleMap() }, span: { value: RADIUS * 2 },
    reflection: { value: target.texture }, reflectionVP: { value: new T.Matrix4() }, reflected: { value: 0 },
    waterline: { value: WATER }, density: { value: FOG }, haze: { value: HAZE.clone() }, rain: { value: 0 }, sun: { value: SUN },
    daylight: { value: 1 }, warmth: WARMTH, fogApricot: { value: APRICOT },
    // The open sky the water mirrors is the sky dome itself (same uniforms, so night and rain follow).
    horizon: sky?.material.uniforms.horizon ?? { value: HAZE.clone() },
    highSky: sky?.material.uniforms.highSky ?? color(0x34405f),
    skyGlow: sky?.material.uniforms.apricot ?? { value: APRICOT.clone() },
    deep: color(0x25332b), silt: color(0x4c422d), rim: color(0x655c3d),
    sky: color(0x586a67), amber: color(0xf39342), hot: color(0xffc57c), moss: color(0x697637),
    wakes: { value: [new T.Vector4(0, 0, -20, 0), new T.Vector4(0, 0, -20, 0)] },
    eddy: { value: new T.Vector4(-5.9, 18.4, -.22, .27) },
  };
  const water = new T.Mesh(new T.PlaneGeometry(390, 390), new T.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms,
    vertexShader: `
      uniform mat4 reflectionVP;
      varying vec3 point;
      varying vec4 mirrorPoint;
      void main() {
        point = (modelMatrix * vec4(position, 1.)).xyz;
        mirrorPoint = reflectionVP * vec4(point, 1.);
        gl_Position = projectionMatrix * viewMatrix * vec4(point, 1.);
      }
    `,
    fragmentShader: `
      varying vec3 point;
      varying vec4 mirrorPoint;
      uniform vec3 deep, silt, rim, sky, amber, hot, moss, sun, haze, horizon, highSky, skyGlow, fogApricot;
      uniform sampler2D bed, ripples, reflection;
      uniform float time, span, waterline, density, reflected, daylight, rain, warmth;
      ${SUNWARD_FOG}
      vec3 skyAlong(vec3 dir) {
        float glow = max(0., dot(dir, sun));
        vec3 c = mix(horizon, highSky, smoothstep(-.07, .43, dir.y));
        float skirt = 1. - smoothstep(.026, .26, abs(dir.y - sun.y));
        return mix(c, skyGlow, pow(glow, 8.) * skirt * .74);
      }
      uniform vec4 wakes[2];
      uniform vec4 eddy;
      float ring(vec4 wake, vec2 p) {
        float age = time - wake.z;
        if (age > 1.65 || age < 0.) return 0.;
        float d = abs(length(p - wake.xy) - age * .72 - .09);
        return wake.w * (1. - smoothstep(.018, .092, d)) * (1. - smoothstep(.23, 1.65, age));
      }
      void main() {
        vec2 p = point.xz;
        vec3 a = texture2D(ripples, p * vec2(.069, .142) + vec2(time*.021, -time*.018)).rgb * 2. - 1.;
        vec3 b = texture2D(ripples, mat2(.105, -.161, .166, .084) * p - vec2(time*.014, time*.027)).rgb * 2. - 1.;
        // Open water carries a slow, longer swell on top of the ripples; shallows and duckweed stay calm.
        float open = smoothstep(.6, 2.2, waterline - (texture2D(bed, p / span + .5).r * 4.8 - 2.4));
        vec3 swell = texture2D(ripples, p * vec2(.021, .027) + vec2(time * .011, time * .006)).rgb * 2. - 1.;
        vec2 bump = a.xy * .043 + b.yx * .027 + swell.xy * .085 * open;
        float wake = ring(wakes[0], p) + ring(wakes[1], p) + ring(eddy, p);
        if (rain > .03) {
          vec2 cell = floor(p * .67);
          float age = fract(time * 1.27 + fract(sin(dot(cell, vec2(53.8, 117.1))) * 719.31));
          float edge = abs(length(fract(p * .67) - .5) - .43 * age);
          wake += (1. - smoothstep(.014, .045, edge)) * (1. - age) * rain * .34;
        }
        vec4 floorSample = texture2D(bed, (p + bump * 1.65) / span + .5);
        float height = floorSample.r * 4.8 - 2.4;
        float depth = max(0., waterline - height);
        vec3 view = cameraPosition - point;
        float roots = floorSample.a * (1. - smoothstep(.22, .85, depth));
        vec2 wave = bump + vec2(b.z, a.z) * (wake * .057 + roots * .017);
        vec3 n = normalize(vec3(wave.x, 1., wave.y));
        vec3 viewDir = normalize(view);
        vec3 reflectedDir = reflect(-viewDir, n);
        float facing = 1. - max(0., dot(n, viewDir));
        float fresnel = .035 + .965 * facing * facing * facing * facing;
        float warm = max(0., dot(reflectedDir, sun));
        float azimuth = max(0., dot(normalize(reflectedDir.xz + vec2(.0001)), normalize(sun.xz)));
        float lane = pow(azimuth, 192.);
        vec3 reflectedSky = mix(skyAlong(reflectedDir) * (.78 + .14 * daylight), amber * .75,
          pow(warm, 26.) * lane * .22 * daylight);
        vec2 uv = mirrorPoint.xy / max(.01, mirrorPoint.w) * .5 + .5 + wave * (.069 + open * .05);
        vec2 border = min(uv, 1. - uv);
        float inFrame = smoothstep(.0, .12, min(border.x, border.y)) * step(.01, mirrorPoint.w) * reflected;
        vec4 banks = texture2D(reflection, uv);
        vec3 mirrorColor = mix(reflectedSky, mix(deep * .55, banks.rgb, .82), inFrame * banks.a);
        float shallow = 1. - smoothstep(.10, 1.13, depth);
        float mudTone = smoothstep(.18, .76, floorSample.b);
        vec3 mud = silt * mix(vec3(.62, .70, .66), vec3(1.66, 1.48, 1.19), mudTone);
        vec3 rgb = mix(deep * (.81 + floorSample.b * .28), mud, shallow * .93);
        rgb *= .45 + daylight * .55;
        rgb = mix(rgb, mirrorColor, fresnel * .90 + .06);
        float ribbon = pow(warm, 51.) * lane * (.07 + .38 * pow(warm, 44.));
        float sparkle = pow(warm, 131.) * lane * clamp(.057 + a.z * .54 + b.z * .38, 0., .54);
        rgb += (amber * ribbon + hot * sparkle) * daylight * (1. - banks.a * inFrame * .87);
        float bankEdge = (1. - smoothstep(.018, .24, depth + a.z * .085 + b.z * .051)) * (.13 + b.z * .10);
        float rootRipples = roots * smoothstep(.25, .74, b.z + a.z * .34) * .19;
        // A thin pale line where the water meets the bank, breathing with the ripples.
        bankEdge *= 1.35 + .35 * sin(time * 1.3 + (p.x + p.y) * 2.3 + a.z * 3.);
        rgb = mix(rgb, rim, min(.62, bankEdge + wake * .14 + rootRipples));
        rgb += sky * .06 * smoothstep(.35, .9, swell.z) * open * fresnel * daylight;
        float duckweed = 0.;
        if (floorSample.g > .15) {
          vec2 drift = vec2(a.z, b.z) * .014 + time * vec2(.0008, -.0011);
          float flecks = texture2D(ripples, p * vec2(.44, .53) + vec2(.16, .41) + drift).a;
          float colony = smoothstep(.20, .61, floorSample.g + b.z * .033);
          duckweed = colony * smoothstep(.39, .82, flecks) * (1. - wake * .30);
          rgb = mix(rgb, moss * (.42 + floorSample.b * .50) * (.38 + .62 * daylight), duckweed);
        }
        float fog = length(view) * density;
        float drift = smoothstep(12., 54., length(view)) * (.32 + a.z * .035);
        rgb = mix(rgb, sunwardFog(haze, -view, sun, fogApricot, warmth), min(1., 1. - exp(-fog * fog) + drift));
        float alpha = mix(.28, .96, smoothstep(.02, .83, depth));
        gl_FragColor = vec4(rgb, max(alpha + duckweed * (1. - alpha), fresnel * .94));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER;
  water.name = "LandingWater";
  scene.add(water);

  const oldClear = new T.Color(), lastEye = new T.Vector3(), facing = new T.Vector3(), lastFacing = new T.Vector3();
  let nextMirror = -1, lastUpdate = -1, updates = 0, wakeSlot = 0;
  // Fish rise here and there: a ring every few seconds, some of them out in the sunset water seen from the pier.
  const rippleSites = [[-6.8, 19.07], [-12.5, 9.5], [20.50, 5.24], [-10.6, 12], [-18, 3.5], [11.2, 16.1], [-7.5, 5],
    [3.3, 14.3], [-24, -7.5], [-5.9, 18.4]]
    .filter(([x, z]) => land.heightAt(x, z) < WATER);
  let nextEddy = 1.68, site = 0;
  let reflections = true, wasOpen = false, profile = "normal", lastLight = "";
  return {
    time: uniforms.time,
    environment(rain, fog) {
      uniforms.rain.value = rain;
      uniforms.density.value = fog.density;
      uniforms.haze.value.copy(fog.color);
    },
    reflectionEnabled(enabled) { reflections = enabled; if (!enabled) uniforms.reflected.value = 0; },
    setReflectionProfile(name) {
      if (!Object.hasOwn(REFLECTION_PROFILES, name) || profile === name) return;
      profile = name;
      uniforms.reflected.value = 0;
    },
    reflectionStats() { return { profile, width: target.width, height: target.height, updates }; },
    wake(x, z, elapsed) {
      uniforms.wakes.value[wakeSlot].set(x, z, elapsed, .83);
      wakeSlot = 1 - wakeSlot;
    },
    update(renderer, camera, elapsed) {
      uniforms.time.value = elapsed;
      uniforms.daylight.value = sunLight ? clamp(sunLight.intensity / sunIntensity, .08, 1) : 1;
      if (rippleSites.length && elapsed >= nextEddy) {
        const [x, z] = rippleSites[site++ % rippleSites.length];
        uniforms.eddy.value.set(x, z, elapsed, .32);
        nextEddy = elapsed + 1.9 + (site % 3) * .47;
      }
      if (!reflections || (uniforms.reflected.value && elapsed < nextMirror)) return;
      camera.getWorldDirection(facing);
      const quality = REFLECTION_PROFILES[profile];
      const width = Math.max(1, Math.min(quality.width, Math.ceil(renderer.domElement.clientWidth / 3.5)));
      const height = Math.max(1, Math.round(width / camera.aspect));
      const resized = target.width !== width || target.height !== height;
      const opened = land.deck.isShortcutOpen();
      const lighting = lights.map(light => `${light.intensity}/${light.color.getHex()}/${Number(light.visible)}`).join("|");
      if (uniforms.reflected.value && !resized && opened === wasOpen && lighting === lastLight
          && elapsed - lastUpdate < .64 && camera.position.distanceToSquared(lastEye) < .032
          && facing.dot(lastFacing) > .9995) return;
      if (!reflection.update(camera, WATER)) {
        uniforms.reflected.value = 0;
        return;
      }
      if (resized) target.setSize(width, height);
      renderer.getClearColor(oldClear);
      const alpha = renderer.getClearAlpha();
      const previous = renderer.getRenderTarget();
      const background = scene.background;
      const autoClear = renderer.autoClear;
      const shadowUpdate = renderer.shadowMap.autoUpdate;
      const xr = renderer.xr.enabled;
      try {
        scene.background = null;
        renderer.autoClear = false;
        renderer.shadowMap.autoUpdate = false;
        renderer.xr.enabled = false;
        renderer.setRenderTarget(target);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(scene, reflection.camera);
      } finally {
        renderer.setRenderTarget(previous);
        renderer.setClearColor(oldClear, alpha);
        renderer.xr.enabled = xr;
        renderer.shadowMap.autoUpdate = shadowUpdate;
        renderer.autoClear = autoClear;
        scene.background = background;
      }
      uniforms.reflectionVP.value.multiplyMatrices(reflection.camera.projectionMatrix, reflection.camera.matrixWorldInverse);
      uniforms.reflected.value = 1;
      lastEye.copy(camera.position);
      lastFacing.copy(facing);
      wasOpen = opened;
      lastLight = lighting;
      lastUpdate = elapsed;
      nextMirror = elapsed + quality.interval;
      updates++;
    },
  };
}
