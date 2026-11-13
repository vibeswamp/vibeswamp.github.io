export const DAY_STOPS = {
  store: { x: -1.40, z: 25.55 },
  bench: { x: -2, z: 24.60 },
  nearCache: { x: -14, z: 23 },
  resinCache: { x: -20, z: 17 },
  fishBasket: { x: -5.30, z: 22.80 },
  tolya: { x: -8.10, z: 23.90 },
  amber: { x: 8, z: -33.40 },
  ford: { x: 19, z: 2.50 },
  // Economy of 13.11: a third cache beyond the ford, under the willow on the dam bank, and one at the foot of the
  // beaver dam that opens with the hut's workshop.
  fordCache: { x: 18.1, z: -5.5 },
  damCache: { x: 23.2, z: -4.6 },
};

export const DAY_APPROACHES = {
  shore: [[-15.2, 23.6], [-12.1, 23.7], [-9.45, 25.1], [-8.35, 25.15], [-7.4, 25.02], [-6.80, 25.52]],
  deck: [[5, 13], [0, 18], [0, 23], [-.15, 24.1], [-1.60, 25.25], [-2.16, 25.55]],
};

// A narrow finger of peat extends from the dam bank. The channel at its
// tip stays open to the outlet; the last stretch is crossed in the water.
export const DAY_FORD_BANK = [[19, 2.5, .90], [19.11, 3.88, .76], [17.13, 6.0, .62],
  [12.86, 9.52, .55], [9.57, 13.28, .42], [6.02, 17.3, .32], [5.42, 18.06, -.28]];
export const DAY_FORD_EXIT = { id: "ford-home", points: [[5, 18.8], [4.3, 19.3], [2.8, 20.6]] };
export const DAY_FORD_CROSSING = { entry: [6.02, 17.3], exit: DAY_FORD_EXIT.points[1], width: 2.8 };

export const DAY_ROUTES = {
  near: [[-2.16, 25.55], ...DAY_APPROACHES.shore.slice().reverse().slice(0, -1), [-14, 23]],
  amber: [[0, 23], [0, 18], [5, 13], [10, 8], [15, 5], [18, 1], [19.05, 1.45],
    [21.18, -1.76], [23.15, -5.35], [24.5, -7.25], [27, -8], [27, -11],
    [28, -17], [25, -24], [19, -29], [12, -31], [8, -33.4]],
  lateDeck: [[19, 2.5], [19.05, 1.45], [18, 1], [15, 5], [10, 8], [5, 13],
    [0, 18], [0, 21.8], [0, 25.55], [-1.4, 25.55]],
  ford: [[19, 2.5], [19.11, 3.88], [17.13, 6.0],
    ...DAY_FORD_EXIT.points.slice(1), [-1.4, 25.55]],
};

export const DAY_JUMP = {
  start: [-3.8, 22.07],
  takeoff: [-4.55, 22.07],
  landing: [-12.0, 22.07],
  bypass: [[-3.8, 22.07], [-8.96, 23.8], [-9.52, 23.8], [-12.0, 22.07]],
};

const SHELVES = [
  { id: "reed-ledge", x: -8.3, z: 22.75, yaw: -Math.PI / 2, rise: .94,
    around: [[-7.65, 23.85], [-10.25, 23.85]] },
  { id: "radio-ledge", x: 24.25, z: -19, yaw: -2.75, rise: 1.18,
    ramp: { inner: .79, outer: 2.04, from: -2.70, flat: .65, to: 1.36 } },
];

export function ledgePoint(ledge, side, forward) {
  const sin = Math.sin(ledge.yaw), cos = Math.cos(ledge.yaw);
  return [ledge.x + cos * side + sin * forward, ledge.z - sin * side + cos * forward];
}

export function createDayWorld(groundAt) {
  const ledges = SHELVES.map(site => {
    const entry = ledgePoint(site, 0, -.72);
    const length = 1.48;
    const ledge = { ...site, width: 1.64, depth: .55, length, chamfer: .11, entry, y: groundAt(...entry) + site.rise };
    const exit = ledgePoint(ledge, 0, length + .45);
    if (ledge.ramp) {
      const { inner, outer, from, flat, to } = ledge.ramp;
      const middle = (inner + outer) / 2;
      const base = ledgePoint(ledge, middle, from);
      ledge.ramp = { ...ledge.ramp, y: groundAt(...base) };
      const rampEntry = from - .65;
      ledge.bypass = [entry, ledgePoint(ledge, .30, rampEntry), ledgePoint(ledge, middle, rampEntry), base,
        ledgePoint(ledge, middle, (flat + to) / 2), ledgePoint(ledge, 0, (flat + to) / 2), exit];
    } else {
      ledge.bypass = [entry, ...site.around, exit];
    }
    return ledge;
  });

  function floorAt(x, z) {
    let floor = groundAt(x, z);
    for (const ledge of ledges) {
      const dx = x - ledge.x, dz = z - ledge.z;
      const sin = Math.sin(ledge.yaw), cos = Math.cos(ledge.yaw);
      const forward = dx * sin + dz * cos;
      const side = dx * cos - dz * sin;
      const front = Math.min(forward, ledge.length - forward);
      const edge = ledge.width / 2 - Math.abs(side);
      if (front >= 0 && edge >= 0 && front + edge >= ledge.chamfer) {
        floor = Math.max(floor, ledge.y);
      }
      const ramp = ledge.ramp;
      if (ramp && forward >= ramp.from && forward <= ramp.to && side >= ramp.inner && side <= ramp.outer) {
        const progress = Math.min(1, (forward - ramp.from) / (ramp.flat - ramp.from));
        floor = Math.max(floor, ramp.y + (ledge.y - ramp.y) * progress);
      }
    }
    return floor;
  }

  return { ledges, floorAt, stops: DAY_STOPS, routes: DAY_ROUTES, approaches: DAY_APPROACHES,
    jump: DAY_JUMP, fordCrossing: DAY_FORD_CROSSING };
}
