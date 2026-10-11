import { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { PUBLIC_POLITICIAN_WHERE } from "@/lib/api/public-contract";
import { COMMUNE_DATA_SYNC_KEY } from "@/config/communes";
import { TERRITOIRES_SANS_COMMUNE } from "@/config/regions";
import {
  communeRow,
  departementRows,
  regionRows,
  RELEASE_KEY_PREFIX,
  type CommuneExportInput,
  type CommuneExportRow,
  type DepartementExportRow,
  type MaireHolder,
  type RegionExportRow,
} from "@/lib/territoires/exports";

/**
 * Readers behind the Territoires CSV exports. Not server-only on purpose: the release script
 * (`scripts/export-territoires-release.ts`) builds the national file with the same code as the
 * per-department route, so the two cannot drift. The cached wrappers live in
 * `src/lib/data/territoires-exports.ts`.
 */

/** Upper bound for one file: AGENTS.md caps CSV exports at 50,000 rows; France has ~35,000. */
export const MAX_EXPORT_ROWS = 50_000;

async function readImportDate(): Promise<Date | null> {
  const meta = await db.syncMetadata.findUnique({
    where: { sourceKey: COMMUNE_DATA_SYNC_KEY },
    select: { lastSyncAt: true },
  });
  return meta?.lastSyncAt ?? null;
}

/**
 * Communes of one department (closed list, validated by the caller), or of all France when
 * `departmentCode` is null. TAAF and Clipperton districts are never exported as communes.
 */
export async function queryCommuneExportRows(
  departmentCode: string | null
): Promise<CommuneExportRow[]> {
  const excluded = [...TERRITOIRES_SANS_COMMUNE];
  const communes = await db.$queryRaw<CommuneExportInput[]>(Prisma.sql`
    SELECT c."id", c."name", c."departmentCode", c."regionCode", c."regionName",
           c."population", c."constituencyNumber"
    FROM "Commune" c
    WHERE c."departmentCode" <> ALL(${excluded})
      ${departmentCode ? Prisma.sql`AND c."departmentCode" = ${departmentCode}` : Prisma.empty}
    ORDER BY c."id"
    LIMIT ${MAX_EXPORT_ROWS + 1}
  `);
  if (communes.length > MAX_EXPORT_ROWS) {
    throw new Error(`Export communes : plus de ${MAX_EXPORT_ROWS} lignes, fichier refusé`);
  }

  // Current mayors, counted BEFORE the public filter (same rule as getMaireStatus): the
  // publication status travels with each holder and only `resolveMaire` decides.
  const mayors = await db.$queryRaw<(MaireHolder & { communeId: string })[]>(Prisma.sql`
    SELECT ml."communeId", p."slug", p."fullName", p."publicId", p."publicationStatus"::text AS "publicationStatus",
           m."lastConfirmedAt", m."source"::text AS "source"
    FROM "Mandate" m
    JOIN "MandateLocal" ml ON ml."mandateId" = m."id"
    JOIN "Politician" p ON p."id" = m."politicianId"
    JOIN "Commune" c ON c."id" = ml."communeId"
    WHERE m."type" = 'MAIRE' AND m."isCurrent" = true AND ml."sectorLabel" IS NULL
      ${departmentCode ? Prisma.sql`AND c."departmentCode" = ${departmentCode}` : Prisma.empty}
  `);

  const byCommune = new Map<string, MaireHolder[]>();
  for (const { communeId, ...holder } of mayors) {
    byCommune.set(communeId, [...(byCommune.get(communeId) ?? []), holder]);
  }

  const importedAt = await readImportDate();
  return communes.map((c) => communeRow(c, byCommune.get(c.id) ?? [], importedAt));
}

async function countParlementaires(type: "DEPUTE" | "SENATEUR"): Promise<Map<string, number>> {
  const rows = await db.mandate.groupBy({
    by: ["departmentCode"],
    where: { type, isCurrent: true, politician: PUBLIC_POLITICIAN_WHERE },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.departmentCode ?? "", r._count._all]));
}

async function countCommunes(): Promise<Map<string, number>> {
  const rows = await db.commune.groupBy({ by: ["departmentCode"], _count: { _all: true } });
  return new Map(rows.map((r) => [r.departmentCode, r._count._all]));
}

export async function queryDepartementExportRows(): Promise<DepartementExportRow[]> {
  const communes = await countCommunes();
  const deputes = await countParlementaires("DEPUTE");
  const senateurs = await countParlementaires("SENATEUR");
  return departementRows({ communes, deputes, senateurs });
}

export async function queryRegionExportRows(): Promise<RegionExportRow[]> {
  return regionRows(await countCommunes());
}

export interface TerritoireRelease {
  day: string;
  url: string;
  byteSize: number;
  rowCount: number;
  sha256: string;
}

/** Published national releases, newest first. One `SyncMetadata` row per file. */
export async function queryTerritoireReleases(): Promise<TerritoireRelease[]> {
  const rows = await db.syncMetadata.findMany({
    where: { sourceKey: { startsWith: RELEASE_KEY_PREFIX } },
    select: { sourceKey: true, itemCount: true, contentHash: true, extra: true },
    orderBy: { sourceKey: "desc" },
    // One file a month for years stays far below this.
    take: 100,
  });
  return rows.flatMap((r) => {
    const extra = r.extra as { url?: unknown; byteSize?: unknown } | null;
    if (typeof extra?.url !== "string" || typeof extra.byteSize !== "number") return [];
    return [
      {
        day: r.sourceKey.slice(RELEASE_KEY_PREFIX.length),
        url: extra.url,
        byteSize: extra.byteSize,
        rowCount: r.itemCount ?? 0,
        sha256: r.contentHash ?? "",
      },
    ];
  });
}
