const THICKNESS = 0.17;

const mix = (a, b, t) => a + (b - a) * t;
const between = (a, b, t) => a.map((v, i) => mix(v, b[i], t));

// Each quad is ordered right, left, right, left along the direction of travel.
// Use the same diagonal for the visual mesh and the support query.
function triangleHeight(x, z, a, b, c) {
  const ax = b[0] - a[0], az = b[2] - a[2];
  const bx = c[0] - a[0], bz = c[2] - a[2];
  const det = ax * bz - az * bx;
  if (Math.abs(det) < 1e-9) return -Infinity;
  const dx = x - a[0], dz = z - a[2];
  const u = (dx * bz - dz * bx) / det, v = (ax * dz - az * dx) / det;
  if (u < -1e-7 || v < -1e-7 || u + v > 1 + 1e-7) return -Infinity;
  return a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * v;
}

function ribbon(points, width) {
  const normals = [];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0], dz = points[i][1] - points[i - 1][1];
    const length = Math.hypot(dx, dz);
    normals.push([dz / length, -dx / length]);
  }
  const sides = points.map(([x, z, y], i) => {
    const a = normals[Math.max(0, i - 1)], b = normals[Math.min(normals.length - 1, i)];
    const factor = width / (2 * (1 + a[0] * b[0] + a[1] * b[1]));
    const dx = factor * (a[0] + b[0]), dz = factor * (a[1] + b[1]);
    return [[x + dx, y, z + dz], [x - dx, y, z - dz]];
  });
  const spans = normals.map((_, i) => {
    const [a, b] = sides[i], [c, d] = sides[i + 1];
    const length = Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
    const count = Math.ceil(length / 0.37);
    const panels = Array.from({ length: count }, (_, j) => [
      between(a, c, j / count), between(b, d, j / count),
      between(a, c, (j + 1) / count), between(b, d, (j + 1) / count),
    ]);
    const quad = [a, b, c, d];
    const boundsOf = corners => [
      Math.min(...corners.map(p => p[0])), Math.max(...corners.map(p => p[0])),
      Math.min(...corners.map(p => p[2])), Math.max(...corners.map(p => p[2])),
    ];
    return {
      quad, panels, bounds: boundsOf(quad), panelBounds: panels.map(boundsOf),
    };
  });
  return {
    panels: spans.flatMap(span => span.panels),
    quads: spans.map(span => span.quad),
    heightAt(x, z) {
      let top = -Infinity;
      for (const { panels, panelBounds, bounds: [left, right, start, end] } of spans) {
        if (x < left || x > right || z < start || z > end) continue;
        for (let i = 0; i < panels.length; i++) {
          const [lowX, highX, lowZ, highZ] = panelBounds[i];
          if (x < lowX || x > highX || z < lowZ || z > highZ) continue;
          const [a, b, c, d] = panels[i];
          top = Math.max(top, triangleHeight(x, z, a, b, c), triangleHeight(x, z, c, b, d));
        }
      }
      return top;
    },
  };
}

function landing(pier) {
  const count = 18;
  const stations = Array.from({ length: count + 1 }, (_, i) => {
    const offset = pier.radius * (2 * i / count - 1);
    const reach = Math.sqrt(Math.max(0, pier.radius ** 2 - offset ** 2));
    return [[pier.x + offset, pier.y, pier.z + reach], [pier.x + offset, pier.y, pier.z - reach]];
  });
  const panels = stations.slice(1).map(([c, d], i) => [stations[i][1], stations[i][0], d, c]);
  return {
    panels,
    heightAt(x, z) {
      const t = (x - pier.x + pier.radius) * count / (2 * pier.radius);
      if (t < 0 || t > count) return -Infinity;
      const i = Math.min(Math.floor(t), count - 1);
      const extent = mix(stations[i][0][2], stations[i + 1][0][2], t - i) - pier.z;
      return Math.abs(z - pier.z) <= extent + 1e-7 ? pier.y : -Infinity;
    },
  };
}

export function createDeck(pier, bridge, bridgeWidth, shortcut, terrainHeight) {
  const pad = landing(pier);
  const main = ribbon(bridge, bridgeWidth);
  const returnPath = ribbon(shortcut.points.map(([x, z]) => [x, z, terrainHeight(x, z)]), shortcut.width);
  let opened = false;
  return {
    pier: pad, bridge: main, shortcut: returnPath, thickness: THICKNESS,
    isShortcutOpen: () => opened,
    setShortcutOpen(value) { opened = value === true; },
    heightAt(x, z) {
      return Math.max(pad.heightAt(x, z), main.heightAt(x, z), opened ? returnPath.heightAt(x, z) : -Infinity);
    },
  };
}
