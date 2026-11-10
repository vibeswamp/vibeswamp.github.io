import { clamp } from "./land.mjs";

export const BODY_HEIGHT = 1.25;

export function distanceToSolid(solid, x, z) {
  if (solid.minX !== undefined) {
    const dx = x - clamp(x, solid.minX, solid.maxX);
    const dz = z - clamp(z, solid.minZ, solid.maxZ);
    return Math.hypot(dx, dz);
  }
  return Math.hypot(x - solid.x, z - solid.z) - solid.radius;
}

export function overlapsSolid(solid, x, y, z, radius, height) {
  return y < (solid.maxY ?? solid.top ?? Infinity) && y + height > (solid.minY ?? -Infinity)
    && distanceToSolid(solid, x, z) < radius;
}

export function solidNormal(solid, x, z) {
  const dx = x - (solid.minX === undefined ? solid.x : clamp(x, solid.minX, solid.maxX));
  const dz = z - (solid.minZ === undefined ? solid.z : clamp(z, solid.minZ, solid.maxZ));
  const length = Math.hypot(dx, dz);
  return length > 1e-8 ? [dx / length, dz / length] : [0, 0];
}
