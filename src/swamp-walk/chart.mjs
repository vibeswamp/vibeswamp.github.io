import { BRIDGE, CELLS, LANDMARKS, MAP_EXTENT, RADIUS, WATER, WATER_EXITS, clamp, smooth } from "./land.mjs";
import { drawWalkMarkers } from "./walk-hud.mjs";
import { drawWorldGeography, mapProjection } from "./world-map.mjs";

export function createChart(canvas, land, text, route = []) {
  const ctx = canvas.getContext("2d");
  const size = canvas.width, middle = size / 2, extent = MAP_EXTENT;
  const ground = document.createElement("canvas");
  ground.width = ground.height = size;
  const paint = ground.getContext("2d");
  const pixels = paint.createImageData(size, size);
  const loc = mapProjection(size).coordinate;
  const world = (v) => (v - middle) * (extent / middle);
  const cell = (v) => clamp(Math.round((world(v) + RADIUS) * CELLS / (2 * RADIUS)), 0, CELLS);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const i = (z * size + x) * 4;
      const h = land.heightAt(world(x), world(z));
      const contour = h > 2.1 && h % 0.91 < 0.15 ? -11 : 0;
      const hill = smooth(0.04, 6.1, h);
      const path = land.paths[cell(z) * (CELLS + 1) + cell(x)] * 23;
      if (h < WATER) pixels.data.set([27, h > -0.24 ? 67 : 54, 59, 255], i);
      else pixels.data.set([54 + hill * 54 + path + contour, 74 + hill * 21 + path + contour, 53 + hill * 14, 255], i);
    }
  }
  paint.putImageData(pixels, 0, 0);
  paint.strokeStyle = "#d0ae76";
  paint.lineWidth = 2.3;
  paint.beginPath();
  for (const [x, z] of BRIDGE) paint.lineTo(loc(x), loc(z));
  paint.stroke();
  paint.fillStyle = "#f9e1af";
  paint.strokeStyle = "#15271e";
  paint.lineWidth = 4;
  paint.font = "bold 16px system-ui";
  paint.textAlign = "center";
  paint.strokeText(text.north, middle, 20);
  paint.fillText(text.north, middle, 20);

  return (player, discovered, target) => {
    ctx.drawImage(ground, 0, 0);
    function path(points, color, dash = []) {
      ctx.setLineDash(dash);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      for (const [x, z] of points) ctx.lineTo(loc(x), loc(z));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (target) path(route, "#ffd58cb0", [2.4, 2.7]);
    drawWorldGeography(ctx, land, loc);
    if (player.swimming) for (const { points } of WATER_EXITS) path(points, "#a4f4da");
    drawWalkMarkers(ctx, loc, LANDMARKS, discovered, target, player);
  };
}
