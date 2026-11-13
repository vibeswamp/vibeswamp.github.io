import * as T from "./vendor/three.mjs";
import { random, smooth } from "./land.mjs";
import { WARMTH } from "./surface.mjs";

// Time of day and rain for the free walk. Lighting, fog, sky colours and rain lines come from the candidate C
// (expedition-weather.mjs); here they are driven by a clock instead of the game day.
// One lap is 8 minutes: amber evening, dusk, night with stars, dawn, back to the evening.
export const LAP_SECONDS = 480;
const PHASES = [[0, 0], [.55, 0], [.64, 1], [.86, 1], [.97, 0], [1, 0]];

export function darknessAt(lap) {
  const t = ((lap % 1) + 1) % 1;
  for (let i = 1; i < PHASES.length; i++) {
    const [t0, d0] = PHASES[i - 1], [t1, d1] = PHASES[i];
    if (t <= t1) return d0 + (d1 - d0) * smooth(0, 1, (t - t0) / (t1 - t0));
  }
  return 0;
}

// Rain comes once a lap for about a minute in the late evening, then clears before dusk.
// `?rain=1` keeps it raining, `?rain=0` keeps it dry.
export function rainAt(lap, search = location.search) {
  const forced = new URLSearchParams(search).get("rain");
  if (forced === "1") return 1;
  if (forced === "0") return 0;
  const t = ((lap % 1) + 1) % 1;
  return smooth(.30, .34, t) * (1 - smooth(.43, .47, t));
}

// `?time=0.7` (a share of the lap) or `?time=night` starts the walk at that moment, for checks and screenshots.
export function startLap(search = location.search) {
  const value = new URLSearchParams(search).get("time");
  if (value === "night") return .75;
  if (value === "dusk") return .6;
  if (value === "dawn") return .92;
  const number = Number(value);
  return Number.isFinite(number) && value !== null ? number : 0;
}

export function createWeather(scene, sky, water) {
  const lights = sky.userData.lights;
  const fogDay = scene.fog.color.clone(), fogNight = new T.Color(0x313e54), fogRain = new T.Color(0x667772);
  const u = sky.material.uniforms;
  const palettes = [
    ["highSky", 0x161d36], ["apricot", 0x463848], ["sunCore", 0x232842],
  ].map(([key, night]) => ({ key, day: u[key].value.clone(), night: new T.Color(night) }));
  const base = lights.map(light => light.intensity);
  const drops = 160, rng = random(4031);
  const seeds = Array.from({ length: drops }, () => [(rng() - 0.5) * 17, rng() * 7, (rng() - 0.5) * 17]);
  const vertices = new Float32Array(drops * 6);
  const geometry = new T.BufferGeometry();
  const position = new T.BufferAttribute(vertices, 3).setUsage(T.DynamicDrawUsage);
  geometry.setAttribute("position", position);
  const material = new T.LineBasicMaterial({ color: 0xbce1ce, transparent: true, opacity: 0, depthWrite: false });
  const rain = new T.LineSegments(geometry, material);
  rain.frustumCulled = false;
  rain.visible = false;
  scene.add(rain);

  let dark = -1, wet = 0, lastRain = -1;
  const state = { get dark() { return dark; }, get wet() { return wet; } };
  return {
    state,
    step({ dt, time, player, economy, targetDark, targetWet = 0 }) {
      dark = dark < 0 ? targetDark : T.MathUtils.damp(dark, targetDark, 2.4, dt);
      wet = T.MathUtils.damp(wet, targetWet, 1.8, dt);
      lights[0].intensity = base[0] - dark * 0.75 - wet * 0.18;
      lights[1].intensity = base[1] - dark * 2.12 - wet * 0.86;
      lights[2].intensity = base[2] + dark * 0.12;
      scene.fog.color.copy(fogDay).lerp(fogNight, dark).lerp(fogRain, wet * 0.64);
      scene.fog.density = 0.0105 + dark * 0.003 + wet * 0.006;
      for (const { key, day, night } of palettes) u[key].value.copy(day).lerp(night, dark).lerp(fogRain, wet * 0.55);
      // The sky at the horizon is the fog itself, so far shores fade into the sky with no seam.
      u.horizon.value.copy(scene.fog.color);
      WARMTH.value = (1 - dark) * (1 - wet * 0.8);
      sky.userData.weather?.(time, dark, wet, economy);
      water.environment?.(wet, scene.fog);
      rain.visible = wet > 0.04;
      if (!rain.visible || time - lastRain < (economy ? 0.037 : 0.018)) return;
      lastRain = time;
      material.opacity = wet * 0.39;
      const count = economy ? 90 : drops;
      geometry.setDrawRange(0, count * 2);
      for (let i = 0; i < count; i++) {
        const [sx, sy, sz] = seeds[i];
        const height = (sy + 70 - time * 7.1 % 7) % 7;
        const x = player.x + sx + height * 0.15, y = player.y - 1.15 + height, z = player.z + sz;
        vertices.set([x, y, z, x + 0.044, y + 0.29, z], i * 6);
      }
      position.needsUpdate = true;
    },
  };
}
