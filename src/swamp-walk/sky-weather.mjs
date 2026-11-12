import * as T from "./vendor/three.mjs";
import { random, smooth } from "./land.mjs";

export function cloudTexture() {
  const rng = random(4217);
  const width = 128, height = 64;
  const layers = [[5, 3, .49], [10, 6, .27], [22, 11, .16], [45, 19, .08]].map(([x, z, weight]) => ({
    x, z, weight, grid: Array.from({ length: x * z }, rng),
  }));
  const pixels = new Uint8Array(width * height);
  const mix = (a, b, t) => a + (b - a) * t;
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      let amount = 0;
      for (const layer of layers) {
        const px = x * layer.x / width, pz = z * layer.z / height;
        const ix = Math.floor(px), iz = Math.floor(pz);
        const sx = smooth(0, 1, px - ix), sz = smooth(0, 1, pz - iz);
        const at = (x, z) => layer.grid[(z % layer.z) * layer.x + x % layer.x];
        amount += layer.weight * mix(mix(at(ix, iz), at(ix + 1, iz), sx),
          mix(at(ix, iz + 1), at(ix + 1, iz + 1), sx), sz);
      }
      pixels[z * width + x] = Math.round(amount * 255);
    }
  }
  const texture = new T.DataTexture(pixels, width, height, T.RedFormat);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export function addNightStars(sky, cloudState) {
  const rng = random(7942), count = 174;
  const positions = [], brightness = [];
  for (let i = 0; i < count; i++) {
    const yaw = rng() * Math.PI * 2, y = .13 + rng() * .86, ring = Math.sqrt(1 - y * y);
    positions.push(Math.cos(yaw) * ring * 187, y * 187, Math.sin(yaw) * ring * 187);
    brightness.push(.19 + rng() ** 1.8 * .81);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("brightness", new T.Float32BufferAttribute(brightness, 1));
  const time = { value: 0 }, opacity = { value: 0 };
  const material = new T.ShaderMaterial({
    uniforms: { time, opacity }, transparent: true, depthWrite: false,
    blending: T.AdditiveBlending,
    vertexShader: `
      uniform float time;
      attribute float brightness;
      varying float glow;
      void main() {
        glow = brightness * (.87 + sin(time * .37 + brightness * 31.) * .13);
        gl_PointSize = 1.15 + brightness * 1.45;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }
    `,
    fragmentShader: `
      uniform float opacity;
      varying float glow;
      void main() {
        float shape = 1. - smoothstep(.12, .48, length(gl_PointCoord - .5));
        gl_FragColor = vec4(.68, .79, 1., shape * glow * opacity);
        #include <colorspace_fragment>
      }
    `,
  });
  const stars = new T.Points(geometry, material);
  stars.name = "First Landing stars";
  stars.frustumCulled = false;
  stars.renderOrder = -8;
  stars.visible = false;
  sky.add(stars);
  return (elapsed, dark, wet, economy) => {
    cloudState.value.set(elapsed * .003, dark, wet, Number(economy));
    time.value = elapsed;
    opacity.value = smooth(.78, .99, dark) * (1 - wet * .86) * .83;
    stars.visible = opacity.value > .005;
    geometry.setDrawRange(0, economy ? 76 : count);
  };
}
