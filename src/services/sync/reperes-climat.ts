/**
 * Import of the climate figures into `TerritoireRepere` ("Le territoire en chiffres", lot R3,
 * #1052). Source: the climatological sheets of Météo-France (data.gouv.fr, Licence Ouverte 2.0).
 * Station rule: src/lib/territoires/climat-station.ts; sheet reading: climat-fiche.ts.
 *
 * Writes a DRAFT batch and nothing else; a person reads it and publishes it from the admin page.
 * Each figure keeps the period its own station measured it over. The licence comes from the
 * registry.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/lib/db";
import { USER_AGENT } from "@/config/site";
import { CLIMAT_STATION_MAX_KM } from "@/config/territoire-reperes";
import { ficheDepartmentOf, parseFiche } from "@/lib/territoires/climat-fiche";
import {
  climatRows,
  pickReferenceStation,
  type ClimatRowInput,
  type ClimatStation,
} from "@/lib/territoires/climat-station";
import { licenceOfSource } from "./reperes-age";

const SOURCE_ID = "meteofrance-normales";
const DATASET_API = "https://www.data.gouv.fr/api/1/datasets/fiches-climatologiques/";
const FILES = "https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/REF_STATION";
const CHUNK = 5000;
const FETCH_PARALLEL = 16;
/** Thresholds shown next to the retained one in the preview, to calibrate it on real data. */
const COMPARED_KM = [20, 30, 40, 50];

export interface ClimatImportReport {
  producerLastModified: string;
  stationsListed: number;
  /** Sheets that could not be downloaded or whose header could not be read. */
  unreadable: string[];
  stations: ClimatStation[];
  withoutTemp: number;
  withoutPrecip: number;
  /** Stations whose figure covers fewer years than the 1991-2020 normals, by indicator. */
  shortTemp: number;
  shortPrecip: number;
  maxKm: number;
  rows: ClimatRowInput[];
  communes: number;
  /** Communes with no coordinates: no row is written for them. */
  communesWithoutCoordinates: number;
  established: number;
  /** NON_ETABLI rows by reason. */
  notEstablished: Record<string, number>;
  /** Communes with a reference station at each compared threshold (in km). */
  byThreshold: Record<number, number>;
  /** Distances to the reference station of the established communes, in km. */
  distances: number[];
  /** Communes by their first two digits (3 for overseas), established vs not. */
  overseas: { communes: number; established: number };
}

export interface ClimatImportResult {
  dryRun: boolean;
  report: ClimatImportReport;
  importId: string | null;
  rowsWritten: number;
}

async function datasetLastModified(): Promise<string> {
  const res = await fetch(DATASET_API, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`data.gouv.fr : HTTP ${res.status}`);
  const json = (await res.json()) as { last_modified: string };
  return json.last_modified;
}

/** One retry: the producer's storage drops the odd request when sixteen run at once. */
async function fetchText(url: string, attempts = 2): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status} : ${url}`);
    return await res.text();
  } catch (e) {
    if (attempts <= 1) throw e;
    return fetchText(url, attempts - 1);
  }
}

/**
 * The cache holds every sheet and the producer's modification date it was filled at: a newer
 * date on data.gouv.fr empties it, so a monthly update is never read through an old copy.
 */
function freshCache(dir: string, producerLastModified: string): boolean {
  const stamp = join(dir, ".last-modified");
  const fresh = existsSync(stamp) && readFileSync(stamp, "utf8").trim() === producerLastModified;
  if (!fresh) mkdirSync(dir, { recursive: true });
  return fresh;
}

async function sheetText(id: string, dir: string, useCache: boolean): Promise<string> {
  const file = join(dir, `${id}.data`);
  if (useCache && existsSync(file)) return readFileSync(file, "utf8");
  const text = await fetchText(`${FILES}/FICHECLIM_${id}.data`);
  writeFileSync(file, text);
  return text;
}

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

export async function syncReperesClimat(opts: {
  dryRun: boolean;
  cacheDir: string;
  maxKm?: number;
  onProgress?: (msg: string) => void;
}): Promise<ClimatImportResult> {
  const log = opts.onProgress ?? (() => {});
  const maxKm = opts.maxKm ?? CLIMAT_STATION_MAX_KM;
  const licence = licenceOfSource(SOURCE_ID);

  const producerLastModified = await datasetLastModified();
  const useCache = freshCache(opts.cacheDir, producerLastModified);
  log(`Jeu de données mis à jour le ${producerLastModified}${useCache ? " (cache valide)" : ""}`);

  const list = JSON.parse(await fetchText(`${FILES}/liste_fiches_clim.geojson`)) as {
    features: { properties: { num: string } }[];
  };
  const ids = list.features.map((f) => f.properties.num);
  log(`${ids.length} fiches à lire`);

  const stations: ClimatStation[] = [];
  const unreadable: string[] = [];
  await inBatches(ids, FETCH_PARALLEL, async (id) => {
    try {
      const fiche = parseFiche(await sheetText(id, opts.cacheDir, useCache));
      if (!fiche) {
        unreadable.push(id);
        return;
      }
      stations.push({
        id: fiche.id,
        name: fiche.name,
        departmentCode: fiche.departmentCode,
        lat: fiche.lat,
        lon: fiche.lon,
        tempMoyenne: fiche.tempMoyenne,
        precipitations: fiche.precipitations,
      });
    } catch {
      unreadable.push(id);
    }
  });
  writeFileSync(join(opts.cacheDir, ".last-modified"), producerLastModified);
  stations.sort((a, b) => a.id.localeCompare(b.id));
  unreadable.sort();

  const communes = await db.commune.findMany({
    select: { id: true, departmentCode: true, latitude: true, longitude: true },
  });
  const located = communes.filter((c) => c.latitude !== null && c.longitude !== null);

  const rows: ClimatRowInput[] = [];
  const notEstablished: Record<string, number> = {};
  const distances: number[] = [];
  const byThreshold: Record<number, number> = Object.fromEntries(COMPARED_KM.map((k) => [k, 0]));
  const overseas = { communes: 0, established: 0 };
  let established = 0;
  for (const c of located) {
    const place = {
      departmentCode: ficheDepartmentOf(c.departmentCode),
      lat: c.latitude as number,
      lon: c.longitude as number,
    };
    const ref = pickReferenceStation(place, stations, maxKm);
    const commune = climatRows(c.id, ref);
    rows.push(...commune);
    const isOverseas = c.departmentCode.length === 3;
    if (isOverseas) overseas.communes++;
    if (ref.state === "ETABLI") {
      established++;
      distances.push(ref.km);
      if (isOverseas) overseas.established++;
    }
    for (const k of COMPARED_KM) {
      if (pickReferenceStation(place, stations, k).state === "ETABLI") byThreshold[k]!++;
    }
  }
  for (const r of rows) {
    if (r.reason) notEstablished[r.reason] = (notEstablished[r.reason] ?? 0) + 1;
  }

  const years = (m: { startYear: number; endYear: number } | null) =>
    m ? m.endYear - m.startYear + 1 : 0;
  const report: ClimatImportReport = {
    producerLastModified,
    stationsListed: ids.length,
    unreadable,
    stations,
    withoutTemp: stations.filter((s) => !s.tempMoyenne).length,
    withoutPrecip: stations.filter((s) => !s.precipitations).length,
    shortTemp: stations.filter((s) => s.tempMoyenne && years(s.tempMoyenne) < 30).length,
    shortPrecip: stations.filter((s) => s.precipitations && years(s.precipitations) < 30).length,
    maxKm,
    rows,
    communes: located.length,
    communesWithoutCoordinates: communes.length - located.length,
    established,
    notEstablished,
    byThreshold,
    distances,
    overseas,
  };
  if (opts.dryRun) return { dryRun: true, report, importId: null, rowsWritten: 0 };

  const settled = await db.territoireRepere.count({
    where: {
      indicatorKey: { startsWith: "climat_" },
      import: { status: { in: ["IN_REVIEW", "PUBLISHED"] } },
    },
  });
  if (settled > 0) throw new Error("Un lot relu ou publié porte déjà du climat : arrêt.");

  const source =
    (await db.repereSource.findFirst({
      where: { resourceUrl: licence.source.url, methodSlug: "climat" },
    })) ??
    (await db.repereSource.create({
      data: {
        producer: licence.source.producer,
        resourceUrl: licence.source.url,
        licenceName: licence.licenceName,
        licenceUrl: licence.licenceUrl,
        attribution: licence.source.attribution ?? "Source : Météo-France",
        methodSlug: "climat",
      },
    }));

  // A rejected batch is a failed attempt: it goes with the drafts. A batch in review or
  // published is never touched.
  await db.repereImport.deleteMany({
    where: { sourceId: source.id, status: { in: ["DRAFT", "REJECTED"] } },
  });
  const batch = await db.repereImport.create({
    data: { sourceId: source.id, status: "DRAFT", rowCount: rows.length },
  });
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const res = await db.territoireRepere.createMany({
      data: rows.slice(i, i + CHUNK).map((r) => ({
        territoryType: "COM" as const,
        territoryCode: r.territoryCode,
        indicatorKey: r.indicatorKey,
        periodStart: new Date(r.periodStart),
        periodEnd: new Date(r.periodEnd),
        scopeKind: "STATION" as const,
        scopeId: r.scopeId,
        scopeLabel: r.scopeLabel,
        value: r.value,
        unit: r.unit,
        state: r.state,
        reason: r.reason,
        importId: batch.id,
      })),
    });
    written += res.count;
  }
  return { dryRun: false, report, importId: batch.id, rowsWritten: written };
}
