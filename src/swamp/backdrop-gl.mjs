// The living backdrop of the clicker's shore (owner, 13.11: «облака, шелест листьев, движение волн»).
// One small WebGL shader draws the painting and moves its own pixels a little, by a mask
// (public/brand/swamp/motion/mask-*.png, scripts/swamp-motion-masks.py):
//   red   - leaves, hanging moss and reeds sway in gusts (a slow wind with stronger moments, not a pendulum);
//   green - water ripples and the reflection wobbles;
//   blue  - cloud light drifts over the bright sky.
// The painting is not cut into layers, so there are no seams. The canvas lies over the CSS backdrop and stays
// hidden until its first frame; without WebGL, with reduced motion or in the rooms the CSS picture shows as before.
// Rendered at up to 2x pixel density (1.6 megapixels at most) and 30 frames a second, only while the scene is on screen.

const VERTEX = `attribute vec2 p; varying vec2 uv;
void main() { uv = vec2(p.x * .5 + .5, .5 - p.y * .5); gl_Position = vec4(p, 0., 1.); }`;

const FRAGMENT = `precision mediump float;
varying vec2 uv;
uniform sampler2D img, mask;
uniform float t;
float hash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 q) {
  vec2 i = floor(q), f = fract(q); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x), u.y);
}
float fbm(vec2 q) { float v = 0., a = .5; for (int k = 0; k < 4; k++) { v += a * noise(q); q *= 2.03; a *= .5; } return v; }
void main() {
  vec4 m = texture2D(mask, uv);
  // wind: a slow envelope with stronger gusts, and a sway whose phase drifts across the picture
  float gust = .35 + .65 * smoothstep(.25, .95, noise(vec2(t * .09, 1.7)));
  float sway = sin(t * 1.7 + uv.x * 9. + uv.y * 4. + 2. * noise(uv * 5. + t * .25));
  vec2 d = m.r * gust * vec2(.0034 * sway, .0007 * sway);
  // water: two crossing ripple trains move the reflection a pixel or two
  float w1 = sin(uv.y * 260. - t * 1.3 + 2.2 * sin(uv.x * 21. + t * .55));
  float w2 = sin(uv.y * 130. + uv.x * 34. - t * .8);
  d += m.g * vec2(.0011 * w1 + .0006 * w2, .0004 * w2);
  vec4 c = texture2D(img, uv + d);
  // cloud light: soft wisps drift slowly, only where the sky is bright (never over the dark crowns)
  float lum = dot(c.rgb, vec3(.299, .587, .114));
  float cl = fbm(vec2(uv.x * 2.6 - t * .0075, uv.y * 6.5 + .3 * sin(t * .02)));
  float a = m.b * smoothstep(.36, .62, lum) * smoothstep(.48, .86, cl);
  c.rgb = mix(c.rgb, c.rgb * vec3(1.07, 1.03, .98) + vec3(.045, .028, .016), a * .65);
  gl_FragColor = vec4(c.rgb, 1.);
}`;

export function createLivingBackdrop({ art, world, phone }) {
  const canvas = document.createElement("canvas");
  canvas.className = "sw-backdrop-gl";
  canvas.setAttribute("aria-hidden", "true");
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
  if (!gl) return null;
  const shader = (type, source) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, source); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
    return s;
  };
  let program;
  try {
    program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  } catch { return null; }
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  const uT = gl.getUniformLocation(program, "t");
  gl.uniform1i(gl.getUniformLocation(program, "img"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "mask"), 1);
  const texture = (unit) => {
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return tex;
  };
  const textures = [texture(0), texture(1)];
  const upload = (unit, image) => {
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, textures[unit]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
  };
  const load = (src) => new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image); image.onerror = reject;
    image.src = src;
  });

  art.querySelector(".sw-backdrop").after(canvas);
  let ready = false, wanted = "", shown = "", active = false, visible = true, raf = 0, last = 0, lost = false;
  const start = performance.now();
  const size = () => {
    const box = art.getBoundingClientRect();
    let scale = Math.min(devicePixelRatio || 1, 2);
    const pixels = box.width * box.height * scale * scale;
    if (pixels > 1.6e6) scale *= Math.sqrt(1.6e6 / pixels);
    const w = Math.max(2, Math.round(box.width * scale)), h = Math.max(2, Math.round(box.height * scale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
  };
  const frame = (time) => {
    raf = 0;
    if (!running()) return;
    raf = requestAnimationFrame(frame);
    if (time - last < 32) return;
    last = time;
    gl.uniform1f(uT, (time - start) / 1000);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  const running = () => ready && active && visible && !document.hidden && !lost;
  const kick = () => { canvas.hidden = !(ready && active && !lost); if (running() && !raf) raf = requestAnimationFrame(frame); };

  new ResizeObserver(size).observe(art);
  if ("IntersectionObserver" in window) new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; kick(); }).observe(world);
  document.addEventListener("visibilitychange", kick);
  canvas.addEventListener("webglcontextlost", (event) => { event.preventDefault(); lost = true; kick(); });

  return {
    // painting: the shore picture's URL ("/brand/swamp/bg.webp"), mask: "bg" or "stage3", shore: false in the rooms
    set(painting, mask, shore) {
      active = shore;
      const key = `${painting}|${mask}`;
      if (!shore || key === wanted) { kick(); return; }
      wanted = key;
      const src = phone() ? painting.replace(/\.webp$/, "-960.webp") : painting;
      Promise.all([load(src), load(`/brand/swamp/motion/mask-${mask}.png`)]).then(([image, maskImage]) => {
        if (wanted !== key || lost) return;
        upload(0, image); upload(1, maskImage);
        shown = key; ready = true;
        size(); gl.uniform1f(uT, (performance.now() - start) / 1000); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        kick();
      }).catch(() => { /* the CSS picture stays */ });
    },
    get live() { return ready && !lost; }
  };
}
