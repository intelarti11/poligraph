import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { PUBLIC_POLITICIAN_PUBLICATION_STATUS } from "@/lib/api/public-contract";
import { COMMUNE_DATA_SYNC_KEY } from "@/config/communes";

/**
 * National figures of the « Territoires » statistics tab (#1052, lot 3.1). Real data only, two
 * bounded aggregate queries, cached and purged with the profiles and the section.
 *
 * The mayor population is the one the Territoires pages call « établi »: a commune with exactly
 * one current MAIRE mandate outside any PLM sector, on a public profile, counted before the public
 * filter (same rule as getMaireStatus in elus.ts). A commune with two current mayors therefore
 * counts in no figure rather than twice.
 *
 * Deliberately absent, because the base does not establish them (revue #1052 §5): profession
 * (the RNE parser keeps none), re-election or renewal (no cohort is built), department and region
 * presidencies (one current row each on 2026-10-11, far from the 101 and 18 that exist), council
 * members (the composition is not in the base), and any ranking between territories.
 */

export interface CountShare {
  key: string;
  label: string;
  count: number;
}

export interface TerritoiresStats {
  /** When the figures were computed (ISO). */
  computedAt: string;
  maires: {
    /** Communes whose mayor is established, one mayor each. */
    etablis: number;
    /** Of which the mandate comes from the Répertoire national des élus. */
    fromRne: number;
    civility: CountShare[];
    age: CountShare[];
    /** Median age of the mayors whose birth date is known, in whole years. Null when none is. */
    medianAge: number | null;
  };
  communes: {
    total: number;
    population: CountShare[];
    /** Date of the last population import from geo.api.gouv.fr (ISO), never a vintage. */
    populationImportedAt: string | null;
  };
}

type MaireRow = {
  etablis: number;
  from_rne: number;
  femmes: number;
  hommes: number;
  civ_inconnue: number;
  age_moins_40: number;
  age_40_49: number;
  age_50_59: number;
  age_60_69: number;
  age_70_plus: number;
  age_inconnu: number;
  median_age: number | null;
  computed_at: Date;
};

type CommuneRow = {
  total: number;
  pop_moins_500: number;
  pop_500_999: number;
  pop_1000_3499: number;
  pop_3500_9999: number;
  pop_10000_plus: number;
  pop_inconnue: number;
};

/** Share in percent, one decimal. Null when the base is empty: an absence is never a zero. */
export function sharePercent(count: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((count / total) * 1000) / 10;
}

/** Drops a "not recorded" category when it is empty, keeps every measured category. */
function withUnknown(rows: CountShare[], unknown: CountShare): CountShare[] {
  return unknown.count > 0 ? [...rows, unknown] : rows;
}

export function buildTerritoiresStats(
  maire: MaireRow,
  commune: CommuneRow,
  populationImportedAt: Date | null
): TerritoiresStats {
  return {
    computedAt: maire.computed_at.toISOString(),
    maires: {
      etablis: maire.etablis,
      fromRne: maire.from_rne,
      civility: withUnknown(
        [
          { key: "femmes", label: "Femmes", count: maire.femmes },
          { key: "hommes", label: "Hommes", count: maire.hommes },
        ],
        { key: "inconnu", label: "Civilité non renseignée", count: maire.civ_inconnue }
      ),
      age: withUnknown(
        [
          { key: "moins-40", label: "Moins de 40 ans", count: maire.age_moins_40 },
          { key: "40-49", label: "40 à 49 ans", count: maire.age_40_49 },
          { key: "50-59", label: "50 à 59 ans", count: maire.age_50_59 },
          { key: "60-69", label: "60 à 69 ans", count: maire.age_60_69 },
          { key: "70-plus", label: "70 ans et plus", count: maire.age_70_plus },
        ],
        { key: "inconnu", label: "Date de naissance non renseignée", count: maire.age_inconnu }
      ),
      medianAge: maire.median_age,
    },
    communes: {
      total: commune.total,
      population: withUnknown(
        [
          { key: "moins-500", label: "Moins de 500 habitants", count: commune.pop_moins_500 },
          { key: "500-999", label: "500 à 999 habitants", count: commune.pop_500_999 },
          { key: "1000-3499", label: "1 000 à 3 499 habitants", count: commune.pop_1000_3499 },
          { key: "3500-9999", label: "3 500 à 9 999 habitants", count: commune.pop_3500_9999 },
          { key: "10000-plus", label: "10 000 habitants et plus", count: commune.pop_10000_plus },
        ],
        { key: "inconnu", label: "Population non renseignée", count: commune.pop_inconnue }
      ),
      populationImportedAt: populationImportedAt?.toISOString() ?? null,
    },
  };
}

export async function getTerritoiresStats(): Promise<TerritoiresStats> {
  "use cache";
  cacheLife("synced");
  cacheTag("stats", "politicians", "territoires");

  const [maireRows, communeRows, importMeta] = await Promise.all([
    db.$queryRaw<MaireRow[]>(Prisma.sql`
      WITH maires AS (
        SELECT (array_agg(m."politicianId"))[1] AS "politicianId",
               (array_agg(m."source"::text))[1] AS "source"
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
      ),
      profils AS (
        SELECT mr."source", p."civility",
               date_part('year', age(CURRENT_DATE, p."birthDate"::date))::int AS "age"
        FROM maires mr
        JOIN "Politician" p ON p."id" = mr."politicianId"
      )
      SELECT
        COUNT(*)::int AS etablis,
        COUNT(*) FILTER (WHERE "source" = 'RNE')::int AS from_rne,
        COUNT(*) FILTER (WHERE "civility" = 'Mme')::int AS femmes,
        COUNT(*) FILTER (WHERE "civility" IN ('M.', 'M'))::int AS hommes,
        COUNT(*) FILTER (WHERE "civility" IS NULL OR "civility" NOT IN ('Mme', 'M.', 'M'))::int
          AS civ_inconnue,
        COUNT(*) FILTER (WHERE "age" < 40)::int AS age_moins_40,
        COUNT(*) FILTER (WHERE "age" BETWEEN 40 AND 49)::int AS age_40_49,
        COUNT(*) FILTER (WHERE "age" BETWEEN 50 AND 59)::int AS age_50_59,
        COUNT(*) FILTER (WHERE "age" BETWEEN 60 AND 69)::int AS age_60_69,
        COUNT(*) FILTER (WHERE "age" >= 70)::int AS age_70_plus,
        COUNT(*) FILTER (WHERE "age" IS NULL)::int AS age_inconnu,
        (percentile_disc(0.5) WITHIN GROUP (ORDER BY "age"))::int AS median_age,
        now() AS computed_at
      FROM profils
    `),
    db.$queryRaw<CommuneRow[]>(Prisma.sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE "population" < 500)::int AS pop_moins_500,
        COUNT(*) FILTER (WHERE "population" BETWEEN 500 AND 999)::int AS pop_500_999,
        COUNT(*) FILTER (WHERE "population" BETWEEN 1000 AND 3499)::int AS pop_1000_3499,
        COUNT(*) FILTER (WHERE "population" BETWEEN 3500 AND 9999)::int AS pop_3500_9999,
        COUNT(*) FILTER (WHERE "population" >= 10000)::int AS pop_10000_plus,
        COUNT(*) FILTER (WHERE "population" IS NULL)::int AS pop_inconnue
      FROM "Commune"
    `),
    db.syncMetadata.findUnique({
      where: { sourceKey: COMMUNE_DATA_SYNC_KEY },
      select: { lastSyncAt: true },
    }),
  ]);

  return buildTerritoiresStats(maireRows[0]!, communeRows[0]!, importMeta?.lastSyncAt ?? null);
}
