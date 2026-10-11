/**
 * Pure part of the population import (lot 1.7 Territoires): parse the INSEE national file,
 * build one record per commune and vintage, match them to `Commune` by exact INSEE code, and
 * measure what the import would change. No I/O here, so every rule is unit-tested.
 *
 * Matching is by exact code only. A commune merged or created after the file's geography
 * (1 January 2025 for the 2023 vintage) is reported as unmatched, never guessed by name.
 */
import { parse } from "csv-parse/sync";
import {
  DEPUTE_UNIQUE_MAX_POPULATION,
  OVERSEAS_POPULATION_SERIES,
  PLM_ARRONDISSEMENT_PREFIXES,
  type PopulationSource,
} from "@/config/populations-reference";
import {
  isIndexableTerritoireCommune,
  TERRITOIRE_COMMUNE_MIN_POPULATION,
} from "@/lib/seo/territoire-robots";

export interface PopulationRecord {
  communeId: string;
  /** Department or overseas code the source files it under, for the report. */
  departmentCode: string;
  millesime: number;
  populationMunicipale: number;
  populationCompteeAPart: number | null;
  populationTotale: number | null;
  effectiveFrom: string;
  producer: string;
  sourceLabel: string;
  sourceUrl: string;
}

export interface ParsedNationalFile {
  /** Data lines read in donnees_communes.csv and donnees_collectivites.csv. */
  linesRead: number;
  /** Municipal arrondissements folded into Paris, Lyon and Marseille. */
  arrondissementsAggregated: number;
  records: PopulationRecord[];
}

function toInt(value: string | undefined): number | null {
  if (value == null) return null;
  const n = Number(value.replace(/\s/g, ""));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function rowsOf(csv: string, delimiter = ";"): Record<string, string>[] {
  return parse(csv, {
    delimiter,
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
}

function plmParentOf(code: string): string | null {
  for (const [parent, prefix] of Object.entries(PLM_ARRONDISSEMENT_PREFIXES)) {
    if (code.startsWith(prefix) && code !== parent) return parent;
  }
  return null;
}

function recordFrom(
  source: PopulationSource,
  communeId: string,
  departmentCode: string,
  pmun: number,
  pcap: number | null,
  ptot: number | null
): PopulationRecord {
  return {
    communeId,
    departmentCode,
    millesime: source.millesime,
    populationMunicipale: pmun,
    populationCompteeAPart: pcap,
    populationTotale: ptot,
    effectiveFrom: source.effectiveFrom,
    producer: source.producer,
    sourceLabel: source.label,
    sourceUrl: source.url,
  };
}

/**
 * Parse `donnees_communes.csv` (columns DEP, COM, PMUN, PCAP, PTOT) and
 * `donnees_collectivites.csv` (COL, COM, ...) from INSEE's `ensemble.zip`.
 * Throws on a missing column or an unreadable figure: a partial file must not be imported.
 */
export function parseInseeNationalFile(
  source: PopulationSource,
  communesCsv: string,
  collectivitesCsv: string
): ParsedNationalFile {
  const communes = rowsOf(communesCsv);
  const collectivites = rowsOf(collectivitesCsv);
  const records: PopulationRecord[] = [];
  const plm = new Map<string, { pmun: number; pcap: number; ptot: number }>();
  let arrondissementsAggregated = 0;

  const read = (row: Record<string, string>, deptKey: string) => {
    const code = row["COM"];
    const dept = row[deptKey];
    const pmun = toInt(row["PMUN"]);
    const pcap = toInt(row["PCAP"]);
    const ptot = toInt(row["PTOT"]);
    if (!code || !dept || pmun == null || pcap == null || ptot == null) {
      throw new Error(
        `Ligne illisible dans le fichier INSEE ${source.key} : ${JSON.stringify(row)}`
      );
    }
    return { code, dept, pmun, pcap, ptot };
  };

  for (const row of communes) {
    const r = read(row, "DEP");
    const parent = plmParentOf(r.code);
    if (parent) {
      const sum = plm.get(parent) ?? { pmun: 0, pcap: 0, ptot: 0 };
      plm.set(parent, {
        pmun: sum.pmun + r.pmun,
        pcap: sum.pcap + r.pcap,
        ptot: sum.ptot + r.ptot,
      });
      arrondissementsAggregated++;
      continue;
    }
    records.push(recordFrom(source, r.code, r.dept, r.pmun, r.pcap, r.ptot));
  }
  for (const row of collectivites) {
    const r = read(row, "COL");
    records.push(recordFrom(source, r.code, r.dept, r.pmun, r.pcap, r.ptot));
  }
  for (const [parent, sum] of plm) {
    records.push(recordFrom(source, parent, parent.slice(0, 2), sum.pmun, sum.pcap, sum.ptot));
  }

  return { linesRead: communes.length + collectivites.length, arrondissementsAggregated, records };
}

/**
 * Codes whose territory changed after `after` and up to `upTo` (ISO dates), read from the COG
 * movements file (`v_mvt_commune_*.csv`): every commune on either side of an event that links
 * two different codes (merger, restoration, change of chef-lieu code).
 */
export function territoryChangedCodes(
  movementsCsv: string,
  after: string,
  upTo: string
): Set<string> {
  const changed = new Set<string>();
  for (const row of rowsOf(movementsCsv, ",")) {
    const date = row["DATE_EFF"];
    if (!date || date <= after || date > upTo) continue;
    if (row["TYPECOM_AV"] !== "COM" || row["TYPECOM_AP"] !== "COM") continue;
    const av = row["COM_AV"];
    const ap = row["COM_AP"];
    if (!av || !ap || av === ap) continue;
    changed.add(av);
    changed.add(ap);
  }
  return changed;
}

/** Drop the records whose code designates a different territory than in their file. */
export function dropChangedTerritories(
  records: PopulationRecord[],
  changed: Set<string>
): { kept: PopulationRecord[]; dropped: PopulationRecord[] } {
  const kept: PopulationRecord[] = [];
  const dropped: PopulationRecord[] = [];
  for (const r of records) (changed.has(r.communeId) ? dropped : kept).push(r);
  return { kept, dropped };
}

/** Mayotte and the collectivities with their own census, from the transcribed decree tables. */
export function overseasRecords(): PopulationRecord[] {
  return OVERSEAS_POPULATION_SERIES.flatMap((series) =>
    series.rows.map(([code, , pmun, pcap, ptot]) =>
      recordFrom(series.source, code, series.departmentCode, pmun, pcap, ptot)
    )
  );
}

// ─── Plan ───────────────────────────────────────────────────────

export interface CommuneSnapshot {
  id: string;
  departmentCode: string;
  population: number | null;
  /** Exactly one current mayor on a public profile (same rule as the sitemap). */
  maireEtabli: boolean;
}

export interface DepartmentMatch {
  departmentCode: string;
  /** Source records filed under this code. */
  records: number;
  matched: number;
  /** Source codes with no commune in the base. */
  unmatchedCodes: string[];
  /** Communes of the base in this department that no source covers. */
  communesWithoutSeries: string[];
}

export interface ThresholdCrossing {
  communeId: string;
  before: number | null;
  after: number;
}

export interface PopulationPlan {
  matchedRecords: PopulationRecord[];
  byDepartment: DepartmentMatch[];
  /** In-force municipal population per commune on the reference date. */
  inForce: Map<string, PopulationRecord>;
  /** Communes whose `Commune.population` differs from the population in force. */
  differing: ThresholdCrossing[];
  crossesIndexFloor: ThresholdCrossing[];
  crossesDeputeThreshold: ThresholdCrossing[];
  indexationGained: string[];
  indexationLost: string[];
}

/** The record in force on `onDate`: latest effectiveFrom not after it. */
export function pickInForce(
  records: PopulationRecord[],
  onDate: string
): PopulationRecord | undefined {
  return records
    .filter((r) => r.effectiveFrom <= onDate)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}

function crosses(before: number | null, after: number, threshold: number): boolean {
  if (before == null) return after >= threshold;
  return before >= threshold !== after >= threshold;
}

export function planPopulationImport(
  records: PopulationRecord[],
  communes: CommuneSnapshot[],
  onDate: string
): PopulationPlan {
  const communeById = new Map(communes.map((c) => [c.id, c]));
  const depts = new Map<string, DepartmentMatch>();
  const dept = (code: string) => {
    let d = depts.get(code);
    if (!d) {
      d = {
        departmentCode: code,
        records: 0,
        matched: 0,
        unmatchedCodes: [],
        communesWithoutSeries: [],
      };
      depts.set(code, d);
    }
    return d;
  };

  const matchedRecords: PopulationRecord[] = [];
  const recordsByCommune = new Map<string, PopulationRecord[]>();
  for (const r of records) {
    const commune = communeById.get(r.communeId);
    // Report under the base's department when matched (PLM parents are filed by prefix).
    const d = dept(commune?.departmentCode ?? r.departmentCode);
    d.records++;
    if (!commune) {
      if (!d.unmatchedCodes.includes(r.communeId)) d.unmatchedCodes.push(r.communeId);
      continue;
    }
    d.matched++;
    matchedRecords.push(r);
    recordsByCommune.set(r.communeId, [...(recordsByCommune.get(r.communeId) ?? []), r]);
  }

  const inForce = new Map<string, PopulationRecord>();
  const differing: ThresholdCrossing[] = [];
  const crossesIndexFloor: ThresholdCrossing[] = [];
  const crossesDeputeThreshold: ThresholdCrossing[] = [];
  const indexationGained: string[] = [];
  const indexationLost: string[] = [];

  for (const c of communes) {
    const current = pickInForce(recordsByCommune.get(c.id) ?? [], onDate);
    if (!current) {
      dept(c.departmentCode).communesWithoutSeries.push(c.id);
      continue;
    }
    inForce.set(c.id, current);
    const after = current.populationMunicipale;
    if (c.population === after) continue;
    const crossing = { communeId: c.id, before: c.population, after };
    differing.push(crossing);
    if (crosses(c.population, after, TERRITOIRE_COMMUNE_MIN_POPULATION)) {
      crossesIndexFloor.push(crossing);
    }
    if (crosses(c.population, after, DEPUTE_UNIQUE_MAX_POPULATION)) {
      crossesDeputeThreshold.push(crossing);
    }
    const wasIndexable = isIndexableTerritoireCommune({
      population: c.population,
      maireEtabli: c.maireEtabli,
    });
    const isIndexable = isIndexableTerritoireCommune({
      population: after,
      maireEtabli: c.maireEtabli,
    });
    if (!wasIndexable && isIndexable) indexationGained.push(c.id);
    if (wasIndexable && !isIndexable) indexationLost.push(c.id);
  }

  return {
    matchedRecords,
    byDepartment: [...depts.values()].sort((a, b) =>
      a.departmentCode.localeCompare(b.departmentCode)
    ),
    inForce,
    differing,
    crossesIndexFloor,
    crossesDeputeThreshold,
    indexationGained,
    indexationLost,
  };
}
