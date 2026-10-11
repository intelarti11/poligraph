/**
 * Fetches the outlines of the overseas territories from their official or open sources and
 * writes them, lightly simplified, to public/data/outremer.geojson, with the provenance of
 * every feature in public/data/outremer-provenance.json.
 *
 * Sources, one per territory (licences checked on the source pages, see public/data/README.md):
 * - 971, 972, 973, 974, 976, 975, 977, 978: IGN ADMIN EXPRESS COG CARTO PE, 2026 edition,
 *   through the Géoplateforme WFS. Licence Ouverte.
 * - 988: Gouvernement de la Nouvelle-Calédonie (DITTT), « Limites administratives
 *   terrestres », provinces layer, merged into one outline. Licence Ouverte.
 * - 987: Section Cadastre-Topographie de la Polynésie française, « Emprise des îles, atolls et
 *   bancs » (data.gouv.fr). CC-BY.
 * - 986: Natural Earth 10m (countries + minor islands, for Alofi), v5.1.2. Public domain.
 * TAAF (984) and Clipperton (989) are left out on purpose: they have no department page, and a
 * single frame for the TAAF would span from the Mozambique Channel to Antarctica.
 *
 * Network only, no new dependency: GeoJSON from the WFS and ArcGIS services, a minimal zip and
 * shapefile reader for the Polynesian archive. Run it again only to move to a new edition, then
 * run `npm run territoires:svg`.
 *
 * Usage : npm run territoires:outremer
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { format, resolveConfig } from "prettier";

const ROOT = join(__dirname, "..");
const OUTPUT = join(ROOT, "public/data/outremer.geojson");
const PROVENANCE = join(ROOT, "public/data/outremer-provenance.json");

type Position = [number, number];
type Ring = Position[];
type Polygon = Ring[];

const IGN_EDITION = "ADMINEXPRESS-COG-CARTO-PE.2026";
const IGN_WFS =
  "https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&outputFormat=application/json";
const NC_PROVINCES =
  "https://services1.arcgis.com/TZcrgU6CIbqWt9Qv/arcgis/rest/services/limites_terrestres/FeatureServer/1/query?where=1%3D1&outFields=nom&outSR=4326&f=geojson";
const PF_ISLANDS =
  "https://static.data.gouv.fr/resources/geographie-administrative-de-la-polynesie-francaise/20220228-205614/loc-ile.zip";
const NE_BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson";

const IGN_SOURCE = {
  producteur: "IGN",
  jeu: "ADMIN EXPRESS COG CARTO PE (petite échelle), édition 2026",
  licence: "Licence Ouverte (Etalab)",
  page: "https://cartes.gouv.fr/rechercher-une-donnee/dataset/IGNF_ADMIN-EXPRESS",
};

interface Source {
  producteur: string;
  jeu: string;
  licence: string;
  page: string;
  url?: string;
  couche?: string;
  note?: string;
}

interface Territory {
  code: string;
  nom: string;
  source: Source;
  /**
   * Polygons in groups: an island or a feature of the source per group. Simplification may
   * drop a polygon, never a whole group, so no island of an archipelago disappears.
   */
  load: () => Promise<Polygon[][]>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} sur ${url}`);
  return (await res.json()) as T;
}

interface GeoJsonFeature {
  properties: Record<string, unknown>;
  geometry:
    | { type: "Polygon"; coordinates: Polygon }
    | { type: "MultiPolygon"; coordinates: Polygon[] };
}

function polygonsOf(feature: GeoJsonFeature): Polygon[] {
  return feature.geometry.type === "Polygon"
    ? [feature.geometry.coordinates]
    : feature.geometry.coordinates;
}

function ignUrl(layer: string, filter: string): string {
  return `${IGN_WFS}&TYPENAMES=${IGN_EDITION}:${layer}&CQL_FILTER=${encodeURIComponent(filter)}`;
}

/** IGN features matching `filter`, all their polygons together. Fails if none comes back. */
async function ign(layer: string, filter: string, expected: number): Promise<Polygon[][]> {
  const { features } = await fetchJson<{ features: GeoJsonFeature[] }>(ignUrl(layer, filter));
  if (features.length !== expected) {
    throw new Error(`IGN ${layer} ${filter} : ${features.length} entités, ${expected} attendues`);
  }
  return features.map(polygonsOf);
}

function signedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i]![0] * ring[i + 1]![1] - ring[i + 1]![0] * ring[i]![1];
  }
  return sum / 2;
}

/**
 * Union of polygons that share their common borders vertex for vertex (the provinces of New
 * Caledonia): every edge present in both directions is an inner border and is dropped, the
 * remaining edges are chained back into rings. Outer rings and holes come back as separate
 * rings; with an even-odd fill that draws the same thing.
 */
function mergeSharedBorders(polygons: Polygon[]): Polygon[] {
  const key = ([x, y]: Position) => `${x},${y}`;
  const edges = new Map<string, { from: Position; to: Position; used: boolean }>();
  for (const polygon of polygons) {
    polygon.forEach((ring, index) => {
      const area = signedArea(ring);
      const oriented = (index === 0) === area > 0 ? ring : [...ring].reverse();
      for (let i = 0; i < oriented.length - 1; i++) {
        const from = oriented[i]!;
        const to = oriented[i + 1]!;
        const reverse = `${key(to)}>${key(from)}`;
        if (edges.has(reverse)) edges.delete(reverse);
        else edges.set(`${key(from)}>${key(to)}`, { from, to, used: false });
      }
    });
  }
  const byStart = new Map<string, { from: Position; to: Position; used: boolean }[]>();
  for (const edge of edges.values()) {
    const list = byStart.get(key(edge.from)) ?? [];
    list.push(edge);
    byStart.set(key(edge.from), list);
  }
  const rings: Ring[] = [];
  for (const start of edges.values()) {
    if (start.used) continue;
    const ring: Ring = [start.from];
    let edge: typeof start | undefined = start;
    while (edge) {
      edge.used = true;
      ring.push(edge.to);
      edge = byStart.get(key(edge.to))?.find((e) => !e.used);
    }
    if (key(ring[0]!) !== key(ring[ring.length - 1]!)) {
      throw new Error("Fusion des provinces : anneau ouvert");
    }
    rings.push(ring);
  }
  return rings.map((ring) => [ring]);
}

/** One entry of a zip archive, read through the central directory. */
function unzipEntry(zip: Buffer, suffix: string): Buffer {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("Archive zip illisible");
  const entries = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < entries; i++) {
    const method = zip.readUInt16LE(offset + 10);
    const size = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.toString("utf-8", offset + 46, offset + 46 + nameLength);
    if (name.endsWith(suffix)) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return method === 0 ? Buffer.from(data) : inflateRawSync(data);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`${suffix} absent de l'archive`);
}

/**
 * Polygons of an ESRI shapefile (type 5). Outer rings are clockwise, holes counter-clockwise
 * and follow their outer ring, per the format specification.
 */
function readShapefilePolygons(shp: Buffer): Polygon[][] {
  const records: Polygon[][] = [];
  let offset = 100;
  while (offset < shp.length) {
    const contentLength = shp.readInt32BE(offset + 4) * 2;
    const content = offset + 8;
    const type = shp.readInt32LE(content);
    if (type === 5) {
      const numParts = shp.readInt32LE(content + 36);
      const numPoints = shp.readInt32LE(content + 40);
      const parts: number[] = [];
      for (let i = 0; i < numParts; i++) parts.push(shp.readInt32LE(content + 44 + 4 * i));
      const pointsStart = content + 44 + 4 * numParts;
      const polygons: Polygon[] = [];
      parts.forEach((first, i) => {
        const end = i + 1 < numParts ? parts[i + 1]! : numPoints;
        const ring: Ring = [];
        for (let p = first; p < end; p++) {
          const at = pointsStart + 16 * p;
          ring.push([shp.readDoubleLE(at), shp.readDoubleLE(at + 8)]);
        }
        if (signedArea(ring) < 0 || polygons.length === 0) polygons.push([ring]);
        else polygons[polygons.length - 1]!.push(ring);
      });
      records.push(polygons);
    } else if (type !== 0) {
      throw new Error(`Type de forme ${type} inattendu`);
    }
    offset = content + contentLength;
  }
  return records;
}

async function polynesie(): Promise<Polygon[][]> {
  const res = await fetch(PF_ISLANDS);
  if (!res.ok) throw new Error(`${res.status} sur ${PF_ISLANDS}`);
  const zip = Buffer.from(await res.arrayBuffer());
  return readShapefilePolygons(unzipEntry(zip, "loc_ile.shp"));
}

/** Natural Earth polygons whose bounding box centre falls inside `[minLon, minLat, maxLon, maxLat]`. */
async function naturalEarth(
  file: string,
  bbox: [number, number, number, number],
  match: (properties: Record<string, unknown>) => boolean = () => true
): Promise<Polygon[][]> {
  const { features } = await fetchJson<{ features: GeoJsonFeature[] }>(`${NE_BASE}/${file}`);
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return features
    .filter((f) => match(f.properties))
    .flatMap(polygonsOf)
    .filter((polygon) => {
      const xs = polygon[0]!.map((p) => p[0]);
      const ys = polygon[0]!.map((p) => p[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      return cx >= minLon && cx <= maxLon && cy >= minLat && cy <= maxLat;
    })
    .map((polygon) => [polygon]);
}

const WALLIS_BBOX: [number, number, number, number] = [-178.5, -14.6, -175.8, -13.0];

const TERRITORIES: Territory[] = [
  ...(
    [
      ["971", "Guadeloupe"],
      ["972", "Martinique"],
      ["973", "Guyane"],
      ["974", "La Réunion"],
      ["976", "Mayotte"],
    ] as const
  ).map(([code, nom]) => ({
    code,
    nom,
    source: {
      ...IGN_SOURCE,
      couche: `${IGN_EDITION}:departement`,
      url: ignUrl("departement", `code_insee='${code}'`),
    },
    load: () => ign("departement", `code_insee='${code}'`, 1),
  })),
  {
    code: "975",
    nom: "Saint-Pierre-et-Miquelon",
    source: {
      ...IGN_SOURCE,
      couche: `${IGN_EDITION}:commune`,
      url: ignUrl("commune", "code_insee LIKE '975%'"),
      note: "Réunion des deux communes, Saint-Pierre (97502) et Miquelon-Langlade (97501).",
    },
    load: () => ign("commune", "code_insee LIKE '975%'", 2),
  },
  ...(
    [
      ["977", "Saint-Barthélemy"],
      ["978", "Saint-Martin"],
    ] as const
  ).map(([code, nom]) => ({
    code,
    nom,
    source: {
      ...IGN_SOURCE,
      couche: `${IGN_EDITION}:collectivite_territoriale`,
      url: ignUrl("collectivite_territoriale", `code_insee='${code}'`),
    },
    load: () => ign("collectivite_territoriale", `code_insee='${code}'`, 1),
  })),
  {
    code: "986",
    nom: "Wallis-et-Futuna",
    source: {
      producteur: "Natural Earth",
      jeu: "Natural Earth 1:10m, ne_10m_admin_0_countries (WLF) et ne_10m_minor_islands, version 5.1.2",
      licence: "Domaine public",
      page: "https://www.naturalearthdata.com/about/terms-of-use/",
      url: `${NE_BASE}/ne_10m_admin_0_countries.geojson`,
      note: "Aucune source publique de l'IGN ou du territoire trouvée. Alofi vient de la couche des petites îles. Tracé grossier à cette échelle.",
    },
    load: async () => [
      ...(await naturalEarth(
        "ne_10m_admin_0_countries.geojson",
        WALLIS_BBOX,
        (p) => p.ADM0_A3 === "WLF"
      )),
      ...(await naturalEarth("ne_10m_minor_islands.geojson", WALLIS_BBOX)),
    ],
  },
  {
    code: "987",
    nom: "Polynésie française",
    source: {
      producteur: "Section Cadastre-Topographie de la Polynésie française",
      jeu: "Géographie administrative de la Polynésie française, « Emprise des îles, atolls et bancs » (loc_ile), publiée le 28 février 2022",
      licence: "CC-BY",
      page: "https://www.data.gouv.fr/fr/datasets/geographie-administrative-de-la-polynesie-francaise/",
      url: PF_ISLANDS,
    },
    load: polynesie,
  },
  {
    code: "988",
    nom: "Nouvelle-Calédonie",
    source: {
      producteur: "Gouvernement de la Nouvelle-Calédonie (DITTT, service topographique)",
      jeu: "Limites administratives terrestres, couche Provinces (mise à jour du 28 octobre 2024)",
      licence: "Licence Ouverte",
      page: "https://georep-dtsi-sgt.opendata.arcgis.com/maps/e1d853903cc64d40af7fbb5ee57e3029/about",
      url: NC_PROVINCES,
      note: "Les trois provinces sont fusionnées en un seul contour. Les îles Chesterfield, Walpole, Matthew et Hunter ne figurent pas dans cette couche.",
    },
    load: async () => {
      const { features } = await fetchJson<{ features: GeoJsonFeature[] }>(NC_PROVINCES);
      if (features.length !== 3) throw new Error(`${features.length} provinces, 3 attendues`);
      return [mergeSharedBorders(features.flatMap(polygonsOf))];
    },
  },
];

/**
 * Light pre-simplification so the committed file stays small: Ramer-Douglas-Peucker on an
 * equirectangular plane (metres), tolerance a 1500th of the territory's extent, about three
 * times finer than what the 300-unit drawings keep.
 */
function simplifyTerritory(groups: Polygon[][]): { polygons: Polygon[]; toleranceM: number } {
  let [minLon, minLat, maxLon, maxLat] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const group of groups)
    for (const polygon of group)
      for (const [lon, lat] of polygon[0] ?? []) {
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
  const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const mPerDeg = 111_320;
  const extent = Math.max(
    (maxLon - minLon) * mPerDeg * Math.cos(midLat),
    (maxLat - minLat) * mPerDeg
  );
  const toleranceM = Math.round(extent / 1500);
  const toXY = ([lon, lat]: Position): Position => [
    lon * mPerDeg * Math.cos(midLat),
    lat * mPerDeg,
  ];
  const simplifyRing = (ring: Ring, tolerance: number): Ring => {
    const keep = rdpKeep(ring.map(toXY), tolerance);
    const out: Ring = [];
    ring.forEach(([lon, lat], i) => {
      if (!keep[i]) return;
      const p: Position = [round5(lon), round5(lat)];
      const last = out[out.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
    });
    return out;
  };
  // A polygon whose outer ring collapses is dropped with its holes.
  const simplifyPolygon = (polygon: Polygon, tolerance: number): Polygon | null => {
    const rings = polygon.map((ring) => simplifyRing(ring, tolerance));
    if (rings[0]!.length < 4) return null;
    return [rings[0]!, ...rings.slice(1).filter((ring) => ring.length >= 4)];
  };

  const polygons: Polygon[] = [];
  for (const group of groups) {
    const kept = group
      .map((polygon) => simplifyPolygon(polygon, toleranceM))
      .filter((p): p is Polygon => p !== null);
    if (kept.length === 0) {
      // A small island: keep its largest polygon, with a finer tolerance until it survives.
      const largest = [...group].sort(
        (a, b) => Math.abs(signedArea(b[0]!)) - Math.abs(signedArea(a[0]!))
      )[0]!;
      let tolerance = toleranceM / 4;
      let rescued = simplifyPolygon(largest, tolerance);
      while (!rescued && tolerance > 0.5) {
        tolerance /= 4;
        rescued = simplifyPolygon(largest, tolerance);
      }
      if (!rescued) throw new Error("Île impossible à conserver");
      kept.push(rescued);
    }
    polygons.push(...kept);
  }
  return { polygons, toleranceM };
}

function rdpKeep(points: Position[], tolerance: number): Uint8Array {
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
  return keep;
}

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

async function main() {
  const features = [];
  const provenance: Record<string, Source & { simplification: string; anneaux: number }> = {};
  for (const territory of TERRITORIES) {
    const raw = await territory.load();
    if (raw.length === 0) throw new Error(`${territory.code} : aucun polygone`);
    const { polygons, toleranceM } = simplifyTerritory(raw);
    const rings = polygons.reduce((n, p) => n + p.length, 0);
    const before = raw.reduce((n, group) => n + group.length, 0);
    console.log(
      `${territory.code} ${territory.nom} : ${raw.length} îles ou entités, ${before} → ${polygons.length} polygones, tolérance ${toleranceM} m`
    );
    features.push({
      type: "Feature",
      properties: { code: territory.code, nom: territory.nom },
      geometry: { type: "MultiPolygon", coordinates: polygons },
    });
    provenance[territory.code] = {
      ...territory.source,
      simplification: `Douglas-Peucker à ${toleranceM} m, coordonnées arrondies à 1e-5 degré`,
      anneaux: rings,
    };
  }
  const collection = { type: "FeatureCollection", features };
  const write = async (file: string, value: unknown) => {
    const config = await resolveConfig(file);
    writeFileSync(file, await format(JSON.stringify(value), { ...config, filepath: file }));
  };
  await write(OUTPUT, collection);
  await write(PROVENANCE, {
    genere: new Date().toISOString().slice(0, 10),
    script: "scripts/build-outremer-geojson.ts",
    territoires: provenance,
  });
  console.log(`Écrit ${OUTPUT} et ${PROVENANCE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
