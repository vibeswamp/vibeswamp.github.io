// Shared terrain samples feed both the visible ground mesh and floorAt.
const smooth = (from, to, value) => {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

export function gradeLedgeApproaches(heights, cells, radius, heightAt, ledges) {
  const spacing = 2 * radius / cells;
  const stride = cells + 1;
  const pads = ledges.map(ledge => ({
    ...ledge, floor: heightAt(...ledge.entry), sin: Math.sin(ledge.yaw), cos: Math.cos(ledge.yaw),
  }));
  for (const { id, x, z, sin, cos, floor } of pads) {
    const ix0 = Math.max(0, Math.floor((x + radius - 3.1) / spacing));
    const iz0 = Math.max(0, Math.floor((z + radius - 3.1) / spacing));
    const ix1 = Math.min(cells, Math.ceil((x + radius + 3.1) / spacing));
    const iz1 = Math.min(cells, Math.ceil((z + radius + 3.1) / spacing));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const dx = ix * spacing - radius - x, dz = iz * spacing - radius - z;
      const side = dx * cos - dz * sin;
      const along = dx * sin + dz * cos;
      // The jump crosses south of the reed lip. Keep its wet cell row in place.
      const left = id === "reed-ledge" ? smooth(-.60, -.37, side) : smooth(-1.26, -.83, side);
      const right = 1 - smooth(.83, 1.26, side);
      const fore = smooth(-2.35, -1.65, along) * (1 - smooth(.29, .77, along));
      const weight = left * right * fore;
      const i = iz * stride + ix;
      heights[i] += (floor - heights[i]) * weight;
    }
  }
}

export function swimMantles(exits = []) {
  return exits.map(exit => {
    const { id, edge, top, yaw, hands } = exit;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const depth = (top.x - edge.x) * sin + (top.z - edge.z) * cos;
    const side = (a, b) => (b.x - a.x) * cos - (b.z - a.z) * sin;
    return { id, ...edge, yaw, depth, width: exit.width + .76, length: 1.40,
      deckExit: exit, handTargets: [...hands].sort(side) };
  });
}

