/**
 * Génère les contours SVG décoratifs de la rubrique Territoires depuis les GeoJSON du dépôt.
 *
 * Entrées : public/data/departements.geojson (métropole) et public/data/outremer.geojson
 * (DROM et COM, produit par `npm run territoires:outremer`, provenance dans
 * public/data/outremer-provenance.json et public/data/README.md).
 * Sortie : src/config/territoires-shapes.ts, committé. Le script est déterministe : le
 * relancer sans changer les GeoJSON ne produit aucun diff.
 *
 * Usage : npm run territoires:svg
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { format, resolveConfig } from "prettier";
import { DEPARTMENTS } from "../src/config/departments";
import { getRegionForDepartment } from "../src/config/regions";
import { projectLonLat, type FrameTransform } from "../src/lib/territoires/shape-projection";

const ROOT = join(__dirname, "..");
const OUTPUT = join(ROOT, "src/config/territoires-shapes.ts");

type Ring = [number, number][];
type Geometry =
  | { type: "Polygon"; coordinates: Ring[] }
  | { type: "MultiPolygon"; coordinates: Ring[][] }
  | { type: "Point"; coordinates: [number, number] };
interface Feature {
  properties: { code: string; nom: string };
  geometry: Geometry;
}

/** Frame settings: long side of the viewBox, padding, simplification tolerance, min ring area. */
interface FrameSpec {
  size: number;
  padding: number;
  tolerance: number;
  minArea: number;
  /**
   * Draw the islands below `minArea` as a small dot instead of dropping them, so an
   * archipelago (Polynesia, Wallis-et-Futuna) keeps every island it is made of.
   */
  smallAsDot?: boolean;
}

const DEPARTMENT_FRAME: FrameSpec = { size: 300, padding: 6, tolerance: 0.6, minArea: 6 };
const REGION_FRAME: FrameSpec = { size: 300, padding: 6, tolerance: 0.7, minArea: 6 };
const FRANCE_FRAME: FrameSpec = { size: 600, padding: 4, tolerance: 0.6, minArea: 3 };
const FRANCE_MINI_FRAME: FrameSpec = { size: 240, padding: 2, tolerance: 0.6, minArea: 1.5 };
/**
 * Overseas department or collectivity, each in its own frame. Dots only where the islands are
 * the territory (Polynesia spans about 2,300 km, most of its islands are atolls a few
 * kilometres wide): around New Caledonia the islets would only blur the coastline.
 */
const OVERSEAS_FRAME: FrameSpec = DEPARTMENT_FRAME;
const ARCHIPELAGO_FRAME: FrameSpec = { ...DEPARTMENT_FRAME, smallAsDot: true };
const ARCHIPELAGOS = new Set(["986", "987"]);
/** The five DROM insets under metropolitan France, as on official French maps. */
const DROM_CODES = ["971", "972", "973", "974", "976"] as const;
const INSET_SIZE = 108;
const INSET_GAP = 15;
const INSET_FRAME: FrameSpec = {
  size: INSET_SIZE,
  padding: 8,
  tolerance: 0.5,
  minArea: 1,
  smallAsDot: true,
};
/** Below this extent (viewBox units of the inset), a highlighted department also gets a halo. */
const SMALL_EXTENT = 8;

function readFeatures(file: string): Feature[] {
  const raw = JSON.parse(readFileSync(join(ROOT, file), "utf-8")) as { features: Feature[] };
  return raw.features;
}

/** Projected polygons (outer ring first, then holes) of a feature; empty for a point. */
function projectedPolygons(feature: Feature): Ring[][] {
  const g = feature.geometry;
  const polygons =
    g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  return polygons.map((polygon) =>
    polygon.map((ring) => ring.map(([lon, lat]) => projectLonLat(lon, lat)))
  );
}

function bounds(polygonsList: Ring[][][]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polygons of polygonsList)
    for (const polygon of polygons)
      for (const [x, y] of polygon[0] ?? []) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
  return [minX, minY, maxX, maxY];
}

function frameFor(polygonsList: Ring[][][], spec: FrameSpec) {
  const [minX, minY, maxX, maxY] = bounds(polygonsList);
  const k = (spec.size - 2 * spec.padding) / Math.max(maxX - minX, maxY - minY);
  const transform: FrameTransform = [
    round6(k),
    round6(spec.padding - minX * k),
    round6(spec.padding - minY * k),
  ];
  const width = Math.ceil((maxX - minX) * k + 2 * spec.padding);
  const height = Math.ceil((maxY - minY) * k + 2 * spec.padding);
  return { transform, viewBox: `0 0 ${width} ${height}` };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Ramer-Douglas-Peucker, iterative so long coastlines cannot overflow the stack. */
function simplify(points: Ring, tolerance: number): Ring {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    const [x1, y1] = points[start]!;
    const [x2, y2] = points[end]!;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    let farthest = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const [x, y] = points[i]!;
      const d =
        length === 0
          ? Math.hypot(x - x1, y - y1)
          : Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / length;
      if (d > farthest) {
        farthest = d;
        index = i;
      }
    }
    if (index !== -1 && farthest > tolerance) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/**
 * Path data with integer coordinates: absolute `M` per ring, then relative `l` deltas, which
 * roughly halves the bytes. Deltas come from already-rounded points, so rounding never drifts.
 * Tiny islands below `minArea` are dropped (or become dots with `smallAsDot`), except the
 * largest ring of the feature, which is always kept so a small territory (Paris in the mini
 * map) never loses its outline.
 */
function toPath(polygons: Ring[][], transform: FrameTransform, spec: FrameSpec): string {
  const [k, tx, ty] = transform;
  const rings: { ring: Ring; framed: Ring; area: number; hole: boolean }[] = [];
  for (const polygon of polygons) {
    for (const [index, ring] of polygon.entries()) {
      const framed = ring.map(([x, y]) => [x * k + tx, y * k + ty] as [number, number]);
      const simplified = simplify(framed, spec.tolerance);
      const rounded: Ring = [];
      for (const [x, y] of simplified) {
        const p: [number, number] = [Math.round(x), Math.round(y)];
        const last = rounded[rounded.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) rounded.push(p);
      }
      const first = rounded[0];
      const last = rounded[rounded.length - 1];
      if (rounded.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) {
        rounded.pop();
      }
      rings.push({ ring: rounded, framed, area: ringArea(framed), hole: index > 0 });
    }
  }
  const largest = Math.max(...rings.map((r) => r.area));
  const parts: string[] = [];
  const dots = new Set<string>();
  for (const { ring, framed, area, hole } of rings) {
    if (area < spec.minArea && area !== largest) {
      if (spec.smallAsDot && !hole) {
        const [cx, cy] = centre(framed);
        // One dot per 4-unit cell: the motus of one atoll make a single mark.
        const cell = `${Math.round(cx / 4)},${Math.round(cy / 4)}`;
        if (!dots.has(cell)) {
          dots.add(cell);
          parts.push(`M${Math.round(cx)} ${Math.round(cy) - 2}l2 2-2 2-2-2z`);
        }
      }
      continue;
    }
    if (ring.length < 3) continue;
    let d = `M${ring[0]![0]} ${ring[0]![1]}l`;
    for (let i = 1; i < ring.length; i++) {
      const dx = ring[i]![0] - ring[i - 1]![0];
      const dy = ring[i]![1] - ring[i - 1]![1];
      d += `${i > 1 && dx >= 0 ? " " : ""}${dx}${dy >= 0 ? " " : ""}${dy}`;
    }
    parts.push(`${d}z`);
  }
  return parts.join("");
}

function centre(ring: Ring): [number, number] {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

function groupOutline(features: Feature[], spec: FrameSpec) {
  const projected = features.map(projectedPolygons);
  const { transform, viewBox } = frameFor(projected, spec);
  const departments: Record<string, string> = {};
  features.forEach((f, i) => {
    departments[f.properties.code] = toPath(projected[i]!, transform, spec);
  });
  return { viewBox, transform, departments };
}

/**
 * Centre of every department too small to be seen once highlighted at inset size (the
 * Paris area), so the inset can draw a halo there instead of a fill nobody sees.
 */
function smallAnchors(features: Feature[], spec: FrameSpec): Record<string, [number, number]> {
  const projected = features.map(projectedPolygons);
  const { transform } = frameFor(projected, spec);
  const [k, tx, ty] = transform;
  const anchors: Record<string, [number, number]> = {};
  features.forEach((f, i) => {
    const [minX, minY, maxX, maxY] = bounds([projected[i]!]);
    if (Math.max(maxX - minX, maxY - minY) * k >= SMALL_EXTENT) return;
    anchors[f.properties.code] = [
      Math.round((((minX + maxX) / 2) * k + tx) * 10) / 10,
      Math.round((((minY + maxY) / 2) * k + ty) * 10) / 10,
    ];
  });
  return anchors;
}

/**
 * The five DROM in a row of boxes under metropolitan France, as on official French maps. Each
 * territory has its own frame (never a shared projection with metropolitan France), centred in
 * its box. Paths are already in the coordinates of the France viewBox, extended downwards.
 */
function dromInsets(outreMer: Feature[], franceViewBox: string) {
  const [, , width, height] = franceViewBox.split(" ").map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const rowWidth = DROM_CODES.length * INSET_SIZE + (DROM_CODES.length - 1) * INSET_GAP;
  const left = Math.round((width - rowWidth) / 2);
  const top = height + INSET_GAP;
  const boxes = DROM_CODES.map((code, i) => {
    const feature = outreMer.find((f) => f.properties.code === code);
    const region = getRegionForDepartment(code);
    if (!feature || !region) throw new Error(`Cartouche impossible pour ${code}`);
    const polygons = projectedPolygons(feature);
    const { transform, viewBox } = frameFor([polygons], INSET_FRAME);
    const [, , w, h] = viewBox.split(" ").map(Number) as [number, number, number, number];
    const x = left + i * (INSET_SIZE + INSET_GAP);
    const dx = x + Math.round((INSET_SIZE - w) / 2);
    const dy = top + Math.round((INSET_SIZE - h) / 2);
    const [k, tx, ty] = transform;
    const shifted: FrameTransform = [k, round6(tx + dx), round6(ty + dy)];
    return {
      code,
      region: region.name,
      box: [x, top, INSET_SIZE, INSET_SIZE] as [number, number, number, number],
      d: toPath(polygons, shifted, INSET_FRAME),
    };
  });
  return { viewBox: `0 0 ${width} ${top + INSET_SIZE + 2}`, boxes };
}

function byCode(a: Feature, b: Feature): number {
  return a.properties.code.localeCompare(b.properties.code);
}

async function main() {
  const metropole = readFeatures("public/data/departements.geojson").sort(byCode);
  const outreMer = readFeatures("public/data/outremer.geojson").sort(byCode);

  const unknown = [...metropole, ...outreMer].filter((f) => !DEPARTMENTS[f.properties.code]);
  if (unknown.length) {
    throw new Error(`Codes absents de DEPARTMENTS : ${unknown.map((f) => f.properties.code)}`);
  }

  const pointsOnly = outreMer.filter((f) => f.geometry.type === "Point");
  if (pointsOnly.length) {
    throw new Error(`Points sans contour : ${pointsOnly.map((f) => f.properties.code)}`);
  }

  const departmentOutlines: Record<
    string,
    { viewBox: string; transform: FrameTransform; d: string }
  > = {};
  for (const [features, defaultSpec] of [
    [metropole, DEPARTMENT_FRAME],
    [outreMer, OVERSEAS_FRAME],
  ] as const) {
    for (const feature of features) {
      const spec = ARCHIPELAGOS.has(feature.properties.code) ? ARCHIPELAGO_FRAME : defaultSpec;
      const polygons = projectedPolygons(feature);
      const { transform, viewBox } = frameFor([polygons], spec);
      departmentOutlines[feature.properties.code] = {
        viewBox,
        transform,
        d: toPath(polygons, transform, spec),
      };
    }
  }

  const regionNames = [...new Set(metropole.map((f) => DEPARTMENTS[f.properties.code]!.region))];
  regionNames.sort((a, b) => a.localeCompare(b, "fr"));
  const regionOutlines: Record<string, ReturnType<typeof groupOutline>> = {};
  for (const name of regionNames) {
    const members = metropole.filter((f) => DEPARTMENTS[f.properties.code]!.region === name);
    regionOutlines[name] = groupOutline(members, REGION_FRAME);
  }
  // Each DROM region is a single department: its outline is the department's, keyed by the
  // region name of src/config/regions.ts (DEPARTMENTS files them all under "DOM-TOM").
  for (const code of DROM_CODES) {
    const region = getRegionForDepartment(code);
    const outline = departmentOutlines[code];
    if (!region || !outline) throw new Error(`Région ou contour absent pour ${code}`);
    regionOutlines[region.name] = {
      viewBox: outline.viewBox,
      transform: outline.transform,
      departments: { [code]: outline.d },
    };
  }

  const france = groupOutline(metropole, FRANCE_FRAME);
  const insets = dromInsets(outreMer, france.viewBox);
  const franceMini = {
    ...groupOutline(metropole, FRANCE_MINI_FRAME),
    smallAnchors: smallAnchors(metropole, FRANCE_MINI_FRAME),
  };

  for (const [label, record] of [
    [
      "département",
      Object.fromEntries(Object.entries(departmentOutlines).map(([c, o]) => [c, o.d])),
    ],
    ["France", france.departments],
    ["cartouches", Object.fromEntries(insets.boxes.map((b) => [b.code, b.d]))],
    ["France vignette", franceMini.departments],
  ] as const) {
    const empty = Object.entries(record).filter(([, d]) => !d);
    if (empty.length) throw new Error(`Contour vide (${label}) : ${empty.map(([c]) => c)}`);
  }

  const header = `/**
 * FICHIER GÉNÉRÉ par scripts/build-territoires-svg.ts (npm run territoires:svg).
 * Ne pas modifier à la main : relancer le script.
 *
 * Contours décoratifs (aria-hidden) de la rubrique Territoires. Provenance des tracés :
 * - métropole : public/data/departements.geojson, identique géométrie par géométrie au fichier
 *   departements-version-simplifiee.geojson de github.com/gregoiredavid/france-geojson,
 *   lui-même dérivé d'IGN Admin Express COG (édition 2018), Licence Ouverte Etalab ;
 * - outre-mer : public/data/outremer.geojson. IGN ADMIN EXPRESS COG CARTO PE 2026 (Licence
 *   Ouverte) pour 971 à 978, Gouvernement de la Nouvelle-Calédonie (Licence Ouverte) pour 988,
 *   Section Cadastre-Topographie de la Polynésie française (CC-BY) pour 987, Natural Earth
 *   (domaine public) pour 986.
 * Détail et attribution : public/data/README.md et public/data/outremer-provenance.json.
 *
 * Projection : Mercator sphérique puis transformation affine propre à chaque cadre
 * (src/lib/territoires/shape-projection.ts). Chaque territoire d'outre-mer a son propre cadre.
 * Coordonnées entières. Outre-mer : les îles trop petites pour être tracées sont des points.
 *
 * Sans contour : TAAF (984) et Clipperton (989), qui n'ont pas de page département.
 */`;

  const source = `${header}

import { projectInFrame, type FrameTransform } from "@/lib/territoires/shape-projection";

export interface TerritoryOutline {
  viewBox: string;
  transform: FrameTransform;
  d: string;
}

export interface TerritoryGroupOutline {
  viewBox: string;
  transform: FrameTransform;
  /** Department code to path data, in this group's viewBox. */
  departments: Readonly<Record<string, string>>;
}

export const DEPARTMENT_OUTLINES: Readonly<Record<string, TerritoryOutline>> = ${JSON.stringify(departmentOutlines)};

/** Keyed by the region name used in DEPARTMENTS (src/config/departments.ts). */
export const REGION_OUTLINES: Readonly<Record<string, TerritoryGroupOutline>> = ${JSON.stringify(regionOutlines)};

/** Metropolitan France, every department, for the entry page and region highlights. */
export const FRANCE_OUTLINE: TerritoryGroupOutline = ${JSON.stringify(france)};

/**
 * The five DROM as insets under FRANCE_OUTLINE: \`viewBox\` is the France viewBox extended
 * downwards, \`box\` the inset frame [x, y, width, height] and \`d\` the outline, both in that
 * viewBox. \`region\` is the region name of src/config/regions.ts.
 */
export const FRANCE_DROM_INSETS: {
  viewBox: string;
  boxes: readonly { code: string; region: string; box: readonly [number, number, number, number]; d: string }[];
} = ${JSON.stringify(insets)};

/**
 * Lighter metropolitan France for a small inset (about 100 px wide). \`smallAnchors\` holds the
 * centre of the departments too small to see once highlighted at that size.
 */
export const FRANCE_MINI_OUTLINE: TerritoryGroupOutline & {
  smallAnchors: Readonly<Record<string, readonly [number, number]>>;
} = ${JSON.stringify(franceMini)};

/** Position of a point (a commune) in a department's viewBox, or null without an outline. */
export function projectInDepartment(
  code: string,
  lon: number,
  lat: number
): [number, number] | null {
  const outline = Object.hasOwn(DEPARTMENT_OUTLINES, code) ? DEPARTMENT_OUTLINES[code] : undefined;
  return outline ? projectInFrame(outline.transform, lon, lat) : null;
}
`;

  const config = await resolveConfig(OUTPUT);
  const formatted = await format(source, { ...config, filepath: OUTPUT });
  writeFileSync(OUTPUT, formatted);

  const kb = (s: string) => (Buffer.byteLength(s) / 1024).toFixed(1);
  const largest = Object.entries(departmentOutlines).sort(
    (a, b) => b[1].d.length - a[1].d.length
  )[0]!;
  console.log(`Écrit ${OUTPUT} (${kb(formatted)} Ko)`);
  console.log(`  ${Object.keys(departmentOutlines).length} départements avec contour`);
  console.log(`  plus gros tracé : ${largest[0]} (${kb(largest[1].d)} Ko)`);
  console.log(
    `  ${regionNames.length} régions, France ${kb(JSON.stringify(france))} Ko, vignette ${kb(JSON.stringify(franceMini))} Ko`
  );
  console.log(
    `  outre-mer : ${outreMer.map((f) => f.properties.code).join(", ")}, cartouches ${kb(JSON.stringify(insets))} Ko`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
