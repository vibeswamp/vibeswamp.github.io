import { MAP_EXTENT, RETURN_PASSAGE, WATER_EXITS, WORLD_LIMIT } from "./land.mjs";

export function mapProjection(size) {
  const half = size / 2;
  const coordinate = value => half + value * half / MAP_EXTENT;
  return {
    coordinate,
    player(x, z) {
      const distance = Math.hypot(x, z), max = MAP_EXTENT - 6;
      const scale = distance > max ? max / distance : 1;
      return { x: coordinate(x * scale), z: coordinate(z * scale), outside: scale < 1 };
    },
  };
}

export function drawWorldGeography(ctx, land, coordinate) {
  ctx.save();
  ctx.strokeStyle = "#aaa98070";
  ctx.lineWidth = .8;
  ctx.setLineDash([1.8, 3.3]);
  const edge = coordinate(-WORLD_LIMIT);
  const width = coordinate(WORLD_LIMIT) - edge;
  ctx.strokeRect(edge, edge, width, width);
  ctx.setLineDash([]);
  ctx.strokeStyle = "#d7bf82";
  ctx.lineWidth = 1.4;
  for (const { points } of WATER_EXITS) {
    const [x, z] = points[1];
    ctx.strokeRect(coordinate(x) - 1.65, coordinate(z) - 1.65, 3.3, 3.3);
  }
  if (land.deck.isShortcutOpen()) {
    ctx.strokeStyle = "#edd095";
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    for (const [x, z] of RETURN_PASSAGE.points) ctx.lineTo(coordinate(x), coordinate(z));
    ctx.stroke();
  }
  ctx.restore();
}
