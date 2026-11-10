export const BEAVER = Object.freeze({
  x: 27.75, z: -0.75, yaw: -1.7231149675460231, scale: 2.86,
  width: 13.18, entranceWidth: 2.6598,
});
export const BEAVER_APPROACH = Object.freeze({ x: 21.18, z: -1.76, marker: "beaver" });

const angle = .31;
const front = 1.884;
const rampHeight = (z) => .47 + Math.tan(angle) * (.93 - z) + (.055 + .039) / Math.cos(angle);
const c = Math.cos(BEAVER.yaw), s = Math.sin(BEAVER.yaw);
const parts = [
  { x: [-2.25, 2.27], z: [-1.40, .65], bottom: -.24, top: 2.12, strips: 8 },
  { x: [-1.91, -.49], z: [.65, 1.30], bottom: -.19, top: 1.73, strips: 4 },
  { x: [.49, 1.92], z: [.65, 1.29], bottom: -.19, top: 1.73, strips: 4 },
  { x: [1.24, 2.35], z: [.60, 1.18], bottom: -.20, top: .80, strips: 3 },
];
const footprint = [...parts, { x: [-.50, .50], z: [.65, front + .10] }];

export function beaverPoint(base, x, y, z) {
  return [BEAVER.x + BEAVER.scale * (c * x + s * z),
    base + BEAVER.scale * y, BEAVER.z + BEAVER.scale * (-s * x + c * z)];
}

function localAt(x, z) {
  const dx = x - BEAVER.x, dz = z - BEAVER.z;
  return [(c * dx - s * dz) / BEAVER.scale, (s * dx + c * dz) / BEAVER.scale];
}

export function beaverBaseY(heightAt) {
  const [x, , z] = beaverPoint(0, 0, 0, front);
  return heightAt(x, z) + .034 - BEAVER.scale * rampHeight(front);
}

export function createBeaverSite(heightAt) {
  const y = beaverBaseY(heightAt);
  const obstacles = parts.flatMap(({ x: [left, right], z: [rear, fore], bottom, top, strips }) => {
    const width = (right - left) / strips;
    return Array.from({ length: strips }, (_, i) => {
      const corners = [left + i * width, left + (i + 1) * width]
        .flatMap(x => [rear, fore].map(z => beaverPoint(y, x, 0, z)));
      const xs = corners.map(p => p[0]), zs = corners.map(p => p[2]);
      return {
        id: "beaver", minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs),
        minY: y + BEAVER.scale * bottom, maxY: y + BEAVER.scale * top,
      };
    });
  });
  const outside = (u, v, [a, b], [d, e]) => Math.hypot(Math.max(a - u, 0, u - b), Math.max(d - v, 0, v - e));
  const occupied = (x, z, margin = 0) => {
    const [u, v] = localAt(x, z);
    return footprint.some(part => outside(u, v, part.x, part.z) * BEAVER.scale <= margin);
  };
  return {
    ...BEAVER, y, obstacles, occupied,
    rampAt(x, z) {
      const [u, v] = localAt(x, z);
      return Math.abs(u) <= .465 && v >= .62 && v <= front ? y + BEAVER.scale * rampHeight(v) : -Infinity;
    },
  };
}
