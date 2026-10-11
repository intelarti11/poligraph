/**
 * Import of the official commune populations into `CommunePopulation` (lot 1.7 Territoires).
 * Sources and vintages: src/config/populations-reference.ts. Pure rules: ./populations-plan.ts.
 *
 * In real mode, and only then, the import also aligns `Commune.population` on the municipal
 * population in force, so that the indexing predicate, the deputy reservation and the figure
 * printed under its vintage all read the same number.
 */
import AdmZip from "adm-zip";
import { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { USER_AGENT } from "@/config/site";
import { PUBLIC_POLITICIAN_PUBLICATION_STATUS } from "@/lib/api/public-contract";
import { INSEE_COG_MOUVEMENTS_URL, INSEE_NATIONAL_SOURCES } from "@/config/populations-reference";
import {
  dropChangedTerritories,
  overseasRecords,
  territoryChangedCodes,
  parseInseeNationalFile,
  planPopulationImport,
  type CommuneSnapshot,
  type PopulationPlan,
  type PopulationRecord,
} from "./populations-plan";

export interface SourceReadStats {
  key: string;
  linesRead: number;
  arrondissementsAggregated: number;
  records: number;
  /** Codes whose territory changed since the file's geography: not imported. */
  droppedChangedTerritory: string[];
}

export interface PopulationSyncResult {
  dryRun: boolean;
  onDate: string;
  sources: SourceReadStats[];
  communesInBase: number;
  plan: PopulationPlan;
  written: { created: number; updated: number; communePopulationAligned: number } | null;
}

/** Fixed INSEE host: the URLs come from our config, never from input. */
async function download(url: string): Promise<Buffer> {
  if (!url.startsWith("https://www.insee.fr/")) throw new Error(`URL non autorisée : ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Téléchargement ${url} : HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function entryText(zip: AdmZip, name: string, url: string): string {
  const entry = zip.getEntry(name);
  if (!entry) throw new Error(`${name} absent de ${url}`);
  return entry.getData().toString("utf8");
}

async function loadCommunes(): Promise<CommuneSnapshot[]> {
  // Same rule as the Territoires sitemap: exactly one current mayor outside any PLM sector,
  // counted before the public filter, on a public profile.
  const rows = await db.$queryRaw<
    { id: string; departmentCode: string; population: number | null; maireEtabli: boolean }[]
  >(Prisma.sql`
    SELECT c."id", c."departmentCode", c."population", (maire."communeId" IS NOT NULL) AS "maireEtabli"
    FROM "Commune" c
    LEFT JOIN (
      SELECT ml."communeId"
      FROM "Mandate" m
      JOIN "MandateLocal" ml ON ml."mandateId" = m."id"
      JOIN "Politician" p ON p."id" = m."politicianId"
      WHERE m."type" = 'MAIRE'
        AND m."isCurrent" = true
        AND ml."sectorLabel" IS NULL
        AND ml."communeId" IS NOT NULL
      GROUP BY ml."communeId"
      HAVING COUNT(*) = 1
        AND bool_and(p."publicationStatus" = ${PUBLIC_POLITICIAN_PUBLICATION_STATUS})
    ) maire ON maire."communeId" = c."id"
  `);
  return rows;
}

function sameFigures(
  a: {
    populationMunicipale: number;
    populationCompteeAPart: number | null;
    populationTotale: number | null;
    effectiveFrom: Date;
    producer: string;
    sourceLabel: string;
    sourceUrl: string;
  },
  r: PopulationRecord
): boolean {
  return (
    a.populationMunicipale === r.populationMunicipale &&
    a.populationCompteeAPart === r.populationCompteeAPart &&
    a.populationTotale === r.populationTotale &&
    a.effectiveFrom.toISOString().slice(0, 10) === r.effectiveFrom &&
    a.producer === r.producer &&
    a.sourceLabel === r.sourceLabel &&
    a.sourceUrl === r.sourceUrl
  );
}

function rowData(r: PopulationRecord) {
  return {
    populationMunicipale: r.populationMunicipale,
    populationCompteeAPart: r.populationCompteeAPart,
    populationTotale: r.populationTotale,
    effectiveFrom: new Date(`${r.effectiveFrom}T00:00:00Z`),
    producer: r.producer,
    sourceLabel: r.sourceLabel,
    sourceUrl: r.sourceUrl,
  };
}

async function write(plan: PopulationPlan): Promise<NonNullable<PopulationSyncResult["written"]>> {
  const now = new Date();
  const existing = await db.communePopulation.findMany({
    select: {
      id: true,
      communeId: true,
      millesime: true,
      populationMunicipale: true,
      populationCompteeAPart: true,
      populationTotale: true,
      effectiveFrom: true,
      producer: true,
      sourceLabel: true,
      sourceUrl: true,
    },
  });
  const byKey = new Map(existing.map((e) => [`${e.communeId}|${e.millesime}`, e]));

  const toCreate: Prisma.CommunePopulationCreateManyInput[] = [];
  let updated = 0;
  for (const r of plan.matchedRecords) {
    const e = byKey.get(`${r.communeId}|${r.millesime}`);
    if (!e) {
      toCreate.push({
        communeId: r.communeId,
        millesime: r.millesime,
        importedAt: now,
        ...rowData(r),
      });
    } else if (!sameFigures(e, r)) {
      await db.communePopulation.update({
        where: { id: e.id },
        data: { ...rowData(r), importedAt: now },
      });
      updated++;
    }
  }
  for (let i = 0; i < toCreate.length; i += 1000) {
    await db.communePopulation.createMany({
      data: toCreate.slice(i, i + 1000),
      skipDuplicates: true,
    });
  }
  // Every row confirmed against its source on this run carries the date of the check.
  for (const sourceUrl of new Set(plan.matchedRecords.map((r) => r.sourceUrl))) {
    await db.communePopulation.updateMany({ where: { sourceUrl }, data: { importedAt: now } });
  }

  let aligned = 0;
  for (const d of plan.differing) {
    await db.commune.update({ where: { id: d.communeId }, data: { population: d.after } });
    aligned++;
  }
  return { created: toCreate.length, updated, communePopulationAligned: aligned };
}

export async function syncPopulations(options: {
  dryRun: boolean;
  /** Reference date for "in force", ISO yyyy-mm-dd. Defaults to today (UTC). */
  onDate?: string;
}): Promise<PopulationSyncResult> {
  const onDate = options.onDate ?? new Date().toISOString().slice(0, 10);
  const sources: SourceReadStats[] = [];
  const records: PopulationRecord[] = [];

  const movements = (await download(INSEE_COG_MOUVEMENTS_URL)).toString("utf8");
  const geography = INSEE_NATIONAL_SOURCES[0].geographyDate;

  for (const source of INSEE_NATIONAL_SOURCES) {
    const zip = new AdmZip(await download(source.fileUrl));
    const parsed = parseInseeNationalFile(
      source,
      entryText(zip, "donnees_communes.csv", source.fileUrl),
      entryText(zip, "donnees_collectivites.csv", source.fileUrl)
    );
    const { kept, dropped } = dropChangedTerritories(
      parsed.records,
      territoryChangedCodes(movements, source.geographyDate, geography)
    );
    sources.push({
      key: source.key,
      linesRead: parsed.linesRead,
      arrondissementsAggregated: parsed.arrondissementsAggregated,
      records: kept.length,
      droppedChangedTerritory: dropped.map((r) => r.communeId),
    });
    records.push(...kept);
  }
  const overseas = overseasRecords();
  sources.push({
    key: "outre-mer (976, 986, 987, 988)",
    linesRead: overseas.length,
    arrondissementsAggregated: 0,
    records: overseas.length,
    droppedChangedTerritory: [],
  });
  records.push(...overseas);

  const communes = await loadCommunes();
  const plan = planPopulationImport(records, communes, onDate);
  const written = options.dryRun ? null : await write(plan);

  return {
    dryRun: options.dryRun,
    onDate,
    sources,
    communesInBase: communes.length,
    plan,
    written,
  };
}
