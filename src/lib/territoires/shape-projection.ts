/**
 * Projection shared by `scripts/build-territoires-svg.ts` (which bakes the outlines) and the
 * pages (which place a commune marker on a baked outline). Both sides must go through the
 * same two steps, or the marker drifts off the shape.
 *
 * Step 1, `projectLonLat`: spherical Mercator, conformal, so a department keeps its shape
 * whatever its latitude. Y grows southward, as in SVG.
 * Step 2, a per-frame affine transform `[scale, translateX, translateY]` stored next to each
 * generated outline, mapping projected units to that frame's viewBox.
 */

export type FrameTransform = readonly [scale: number, translateX: number, translateY: number];

const DEG = Math.PI / 180;

export function projectLonLat(lon: number, lat: number): [number, number] {
  return [lon * DEG, -Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2))];
}

export function projectInFrame(
  transform: FrameTransform,
  lon: number,
  lat: number
): [number, number] {
  const [x, y] = projectLonLat(lon, lat);
  const [k, tx, ty] = transform;
  return [x * k + tx, y * k + ty];
}
