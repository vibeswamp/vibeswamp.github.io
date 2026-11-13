export const FISHING_PIER = {
  id: "fishing-cove",
  z: 19.45,
  endX: -5.16,
  width: 1.64,
  endY: .93,
  action: { x: -4.50, z: 19.45, radius: .64 },
  cast: { x: -6.35, z: 19.45 },
};

const CLIMBS = [
  { id: "near-boardwalk", name: "Ближний настил", span: 0, at: .90 },
  { id: "middle-boardwalk", name: "Средний настил", span: 2, at: .50 },
];

export function createLakeSites(deck, swimFloor) {
  const fishing = {
    ...FISHING_PIER,
    action: { ...FISHING_PIER.action, y: deck.fishing.heightAt(FISHING_PIER.action.x, FISHING_PIER.action.z) },
    approach: [[0, 21.8], [0, FISHING_PIER.z], [FISHING_PIER.action.x, FISHING_PIER.z]],
  };
  const deckExits = CLIMBS.map(({ id, name, span, at }) => {
    // Boardwalk runs from the landing toward the dam. Take the water side
    // from its actual outer edge, including the miter at each turn.
    const [a, b, c, d] = deck.bridge.quads[span];
    const edge = a.map((v, i) => v + (c[i] - v) * at);
    const opposite = b.map((v, i) => v + (d[i] - v) * at);
    const length = Math.hypot(c[0] - a[0], c[2] - a[2]);
    const tx = (c[0] - a[0]) / length, tz = (c[2] - a[2]) / length;
    const sign = tz * (opposite[0] - edge[0]) - tx * (opposite[2] - edge[2]) > 0 ? 1 : -1;
    const nx = tz * sign, nz = -tx * sign;
    const across = (distance, y) => ({ x: edge[0] + nx * distance, y, z: edge[2] + nz * distance });
    const handCenter = across(.037, edge[1]);
    const hands = [-.225, .225].map(offset => {
      const x = handCenter.x + tx * offset, z = handCenter.z + tz * offset;
      return { x, y: deck.bridge.heightAt(x, z), z };
    });
    const top = across(.74, 0);
    top.y = deck.bridge.heightAt(top.x, top.z);
    return {
      id, name, span, side: "lagoon", edge: across(0, edge[1]), width: .72,
      yaw: Math.atan2(nx, nz), approach: across(-1.50, swimFloor),
      prompt: across(-.70, swimFloor), hang: across(-.40, swimFloor),
      lip: across(-.40, Math.max(top.y, edge[1]) + .04), top, hands,
    };
  });
  return { fishing, deckExits };
}
