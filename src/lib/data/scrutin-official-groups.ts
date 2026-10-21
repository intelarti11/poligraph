import { cacheTag, cacheLife } from "next/cache";
import { db } from "@/lib/db";
import type { AnOrganLabel, OfficialGroupSnapshot } from "@/lib/votes/scrutin-provenance";

export interface ScrutinOfficialGroups {
  snapshot: OfficialGroupSnapshot;
  /** `null` quand le référentiel des organes n'a pas pu être lu. */
  organes: AnOrganLabel[] | null;
  fetchedAt: Date | null;
}

/**
 * Décompte officiel par groupe d'un scrutin de l'Assemblée nationale, tel qu'importé, avec le
 * référentiel officiel des organes de sa législature pour nommer les groupes. Lecture seule : la
 * décision d'afficher ou de masquer est dans `officialGroupCountsView`.
 */
export async function getScrutinOfficialGroups(
  scrutinId: string,
  legislature: number
): Promise<ScrutinOfficialGroups> {
  "use cache";
  cacheTag("votes");
  cacheLife("synced");

  const scrutin = await db.scrutin.findUnique({
    where: { id: scrutinId },
    select: {
      officialGroupsHash: true,
      officialGroupsIssues: true,
      officialGroupsSourceFetchedAt: true,
      officialGroupCounts: {
        orderBy: { sourceIndex: "asc" },
        select: {
          organeRef: true,
          memberCount: true,
          forCount: true,
          againstCount: true,
          abstainCount: true,
          nonVoterCount: true,
          majorityPosition: true,
          issues: true,
        },
      },
    },
  });

  // Un référentiel illisible (table absente, base indisponible) masque le tableau avec la raison
  // « noms de groupes pas importés » au lieu de faire échouer toute la page du scrutin.
  let organes: AnOrganLabel[] | null = null;
  try {
    organes = await db.anOrgan.findMany({
      where: { legislature },
      select: { organeRef: true, label: true, abbreviation: true, startDate: true, endDate: true },
    });
  } catch (error) {
    void import("@sentry/nextjs")
      .then((Sentry) => {
        Sentry.captureException(error, {
          level: "warning",
          fingerprint: ["scrutin-an-organ-unreadable"],
        });
      })
      .catch(() => {});
  }

  return {
    snapshot: {
      imported: scrutin?.officialGroupsHash != null,
      issues: scrutin?.officialGroupsIssues ?? [],
      rows: scrutin?.officialGroupCounts ?? [],
    },
    organes,
    fetchedAt: scrutin?.officialGroupsSourceFetchedAt ?? null,
  };
}
