import * as T from "./vendor/three.mjs";
import { CELLS, RADIUS, WATER, clamp, random, smooth } from "./land.mjs";
import { FOG, HAZE, SUN } from "./surface.mjs";

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
      const shallows = smooth(.035, .14, depth) * (1 - smooth(.52, .96, depth));
      const mat = smooth(-.10, .39, soil * .83 + eddy) * shallows;
      data[k] = Math.round(clamp((h + 2.4) / 4.8, 0, 1) * 255);
      data[k + 1] = Math.round(mat * 255);
      data[k + 2] = Math.round(clamp(.50 + soil * 1.14 + eddy * .65, 0, 1) * 255);
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

function reflectedBanks(land) {
  const cells = 45, count = cells + 1;
  const position = [], index = [], color = [];
  const mud = new T.Color(0x56463b), moss = new T.Color(0x68704b), tint = new T.Color();
  for (let z = 0; z <= cells; z++) {
    for (let x = 0; x <= cells; x++) {
      const px = x / cells * 132 - 66, pz = z / cells * 132 - 66;
      const y = Math.max(WATER - .02, land.heightAt(px, pz));
      position.push(px, y, pz);
      color.push(...tint.copy(mud).lerp(moss, clamp(y / 3, 0, 1)).toArray());
      if (x > 0 && z > 0) {
        const v = z * count + x;
        const a = v - count - 1, b = v - count, c = v - 1;
        if (Math.max(y, position[a * 3 + 1], position[b * 3 + 1], position[c * 3 + 1]) > WATER + .045) {
          index.push(a, c, b, b, c, v);
        }
      }
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(position, 3));
  geometry.setAttribute("color", new T.Float32BufferAttribute(color, 3));
  geometry.setIndex(index);
  return new T.Mesh(geometry, new T.MeshBasicMaterial({ vertexColors: true, fog: true }));
}

export function addWater(scene, land, proxies) {
  const mirrorScene = new T.Scene();
  mirrorScene.fog = new T.FogExp2(HAZE, FOG);
  const mirror = new T.Group();
  mirror.scale.y = -1;
  mirror.position.y = 2 * WATER;
  mirror.add(reflectedBanks(land), proxies);
  mirrorScene.add(mirror);
  const target = new T.WebGLRenderTarget(1, 1, { generateMipmaps: false });
  const color = hex => ({ value: new T.Color(hex) });
  const uniforms = {
    time: { value: 0 }, bed: { value: shorelineMap(land, proxies.userData.wetRoots ?? []) },
    ripples: { value: rippleMap() }, span: { value: RADIUS * 2 },
    reflection: { value: target.texture }, reflectionVP: { value: new T.Matrix4() }, reflected: { value: 0 },
    waterline: { value: WATER }, density: { value: FOG }, haze: { value: HAZE }, sun: { value: SUN },
    deep: color(0x25352e), silt: color(0x544d33), rim: color(0x6a6c48),
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
      uniform vec3 deep, silt, rim, sky, amber, hot, moss, sun, haze;
      uniform sampler2D bed, ripples, reflection;
      uniform float time, span, waterline, density, reflected;
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
        vec2 bump = a.xy * .043 + b.yx * .027;
        float wake = ring(wakes[0], p) + ring(wakes[1], p) + ring(eddy, p);
        vec4 floorSample = texture2D(bed, (p + bump * 1.65) / span + .5);
        float height = floorSample.r * 4.8 - 2.4;
        float depth = max(0., waterline - height);
        vec3 view = cameraPosition - point;
        float roots = floorSample.a * (1. - smoothstep(.22, .85, depth));
        vec3 n = normalize(vec3(bump.x + wake * .036 + roots * b.z * .028, 1., bump.y));
        vec3 viewDir = normalize(view);
        vec3 reflectedDir = reflect(-viewDir, n);
        float facing = 1. - max(0., dot(n, viewDir));
        float fresnel = .035 + .965 * facing * facing * facing * facing;
        float warm = max(0., dot(reflectedDir, sun));
        float azimuth = max(0., dot(normalize(reflectedDir.xz + vec2(.0001)), normalize(sun.xz)));
        float lane = pow(azimuth, 178.);
        vec3 reflectedSky = mix(sky * .74, amber * .75, pow(warm, 24.) * (.06 + lane * .36));
        vec2 uv = mirrorPoint.xy / max(.01, mirrorPoint.w) * .5 + .5 + bump * .102;
        vec2 border = min(uv, 1. - uv);
        float inFrame = smoothstep(.0, .12, min(border.x, border.y)) * step(.01, mirrorPoint.w) * reflected;
        vec4 banks = texture2D(reflection, uv);
        vec3 mirrorColor = mix(reflectedSky, mix(deep, banks.rgb * .57, .65), inFrame * banks.a * .78);
        vec3 mud = silt * (.61 + floorSample.b * .64);
        vec3 rgb = mix(mud, deep * (.81 + floorSample.b * .28), 1. - exp2(-depth * 2.9));
        rgb = mix(rgb, mirrorColor, fresnel * .91 + .075);
        float ribbon = pow(warm, 51.) * lane * (.07 + .38 * pow(warm, 44.));
        float sparkle = pow(warm, 131.) * lane * clamp(.057 + a.z * .54 + b.z * .38, 0., .54);
        rgb += (amber * ribbon + hot * sparkle) * (1. - banks.a * inFrame * .76);
        float bankEdge = (1. - smoothstep(.022, .29, depth + a.z * .14 + b.z * .061)) * (.12 + b.z * .14);
        float rootRipples = roots * smoothstep(.25, .74, b.z + a.z * .34) * .19;
        rgb = mix(rgb, rim, bankEdge + wake * .14 + rootRipples);
        float duckweed = 0.;
        if (floorSample.g > .15) {
          float flecks = texture2D(ripples, p * vec2(.42, .48) + vec2(.16, .41) + time * vec2(.001, -.0015)).a;
          float colony = smoothstep(.17, .60, floorSample.g);
          duckweed = colony * (.18 + smoothstep(.42, .80, flecks) * .70);
          rgb = mix(rgb, moss * (.56 + floorSample.b * .49), duckweed);
        }
        float fog = length(view) * density;
        float drift = smoothstep(12., 54., length(view)) * (.32 + a.z * .035);
        rgb = mix(rgb, haze, min(1., 1. - exp(-fog * fog) + drift));
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
  let nextMirror = -1, wakeSlot = 0;
  const rippleSites = [[-5.9, 18.4], [20.50, 5.24], [-10.6, 12], [11.2, 16.1], [3.3, 14.3]]
    .filter(([x, z]) => land.heightAt(x, z) < WATER);
  let nextEddy = 1.68, site = 0;
  let reflections = true, wasOpen = false;
  return {
    time: uniforms.time,
    reflectionEnabled(enabled) { reflections = enabled; if (!enabled) uniforms.reflected.value = 0; },
    wake(x, z, elapsed) {
      uniforms.wakes.value[wakeSlot].set(x, z, elapsed, .83);
      wakeSlot = 1 - wakeSlot;
    },
    update(renderer, camera, elapsed) {
      uniforms.time.value = elapsed;
      if (rippleSites.length && elapsed >= nextEddy) {
        const [x, z] = rippleSites[site++ % rippleSites.length];
        uniforms.eddy.value.set(x, z, elapsed, .32);
        nextEddy = elapsed + 2.5 + (site % 3) * .51;
      }
      if (!reflections || (uniforms.reflected.value && elapsed < nextMirror)) return;
      camera.getWorldDirection(facing);
      const width = Math.min(384, Math.ceil(renderer.domElement.clientWidth / 3.5));
      const height = Math.max(1, Math.round(width / camera.aspect));
      const resized = target.width !== width || target.height !== height;
      const opened = land.deck.isShortcutOpen();
      if (uniforms.reflected.value && !resized && opened === wasOpen && camera.position.distanceToSquared(lastEye) < .33
          && facing.dot(lastFacing) > .9982) return;
      if (resized) target.setSize(width, height);
      renderer.getClearColor(oldClear);
      const alpha = renderer.getClearAlpha();
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.render(mirrorScene, camera);
      renderer.setRenderTarget(previous);
      renderer.setClearColor(oldClear, alpha);
      uniforms.reflectionVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      uniforms.reflected.value = 1;
      lastEye.copy(camera.position);
      lastFacing.copy(facing);
      wasOpen = opened;
      nextMirror = elapsed + .095;
    },
  };
}
