import "server-only";
import { db } from "@/lib/db";
import { Prisma, type IntercommunaliteNature } from "@/generated/prisma";
import {
  INTERCOMMUNALITE_NATURE_LABELS,
  INTERCOMMUNALITES_PAGE_URL,
  INTERCOMMUNALITES_SYNC_KEY,
} from "@/config/intercommunalites";
import type { SourceRef } from "@/lib/data/territoires";

/**
 * Intercommunality block of the commune dossier (#1052, lot 1.8). Uncached on its own: it is read
 * inside `readCommuneDossier`, whose cache boundary and tags it shares.
 *
 * States:
 * - DISPONIBLE: the source lists the commune in one body or more (an EPCI à fiscalité propre or
 *   the Métropole de Lyon, plus an EPT inside the Métropole du Grand Paris).
 * - AUCUNE: the source lists the commune with no EPCI à fiscalité propre ("Sans objet").
 * - NON_ETABLI: the source does not list the commune (overseas collectivities, territories
 *   without communes). Never presented as "none".
 * Null before the first import: the page then shows no block at all.
 */

export type IntercommunaliteState = "DISPONIBLE" | "AUCUNE" | "NON_ETABLI";

export interface IntercommunaliteRef {
  siren: string;
  name: string;
  nature: IntercommunaliteNature;
  natureLabel: string;
  /** The EPCI file or the EPT file. */
  source: SourceRef;
}

export interface IntercommunaliteBlock {
  state: IntercommunaliteState;
  /** EPCI à fiscalité propre (or Métropole de Lyon) first, then the EPT. Empty unless DISPONIBLE. */
  intercommunalites: IntercommunaliteRef[];
  /** ISO date of the source's situation ("au 1er janvier"), null when NON_ETABLI. */
  situationDate: string | null;
  source: SourceRef;
  /** ISO date of the last import that checked the source. */
  lastCheckedAt: string | null;
}

const NATURE_ORDER: Record<IntercommunaliteNature, number> = {
  MET69: 0,
  METRO: 1,
  CU: 1,
  CA: 1,
  CC: 1,
  EPT: 2,
};

export async function readIntercommunalites(
  inseeCode: string
): Promise<IntercommunaliteBlock | null> {
  // Read first: it exists only once an import has run, so the tables are there.
  const meta = await db.syncMetadata.findUnique({
    where: { sourceKey: INTERCOMMUNALITES_SYNC_KEY },
    select: { lastSyncAt: true },
  });
  if (!meta) return null;

  // One round trip: open memberships of the commune with their body, if any (null siren is
  // "Sans objet"). Served by the unique index (communeId, siren, validFrom).
  const raw = await db.$queryRaw<
    {
      situationDate: Date;
      sourceLabel: string;
      sourceUrl: string;
      siren: string | null;
      name: string | null;
      nature: IntercommunaliteNature | null;
    }[]
  >(Prisma.sql`
    SELECT ci."situationDate", ci."sourceLabel", ci."sourceUrl",
           i."siren", i."name", i."nature"::text AS "nature"
    FROM "CommuneIntercommunalite" ci
    LEFT JOIN "Intercommunalite" i ON i."siren" = ci."siren"
    WHERE ci."communeId" = ${inseeCode} AND ci."validTo" IS NULL
    LIMIT 5`);
  const rows = raw.map((r) => ({
    situationDate: r.situationDate,
    sourceLabel: r.sourceLabel,
    sourceUrl: r.sourceUrl,
    intercommunalite:
      r.siren && r.name && r.nature ? { siren: r.siren, name: r.name, nature: r.nature } : null,
  }));
  const lastCheckedAt = meta.lastSyncAt?.toISOString() ?? null;

  if (rows.length === 0) {
    return {
      state: "NON_ETABLI",
      intercommunalites: [],
      situationDate: null,
      source: { label: "INSEE, intercommunalités au 1er janvier", url: INTERCOMMUNALITES_PAGE_URL },
      lastCheckedAt,
    };
  }

  const bodies: IntercommunaliteRef[] = rows
    .flatMap((r) =>
      r.intercommunalite
        ? [
            {
              ...r.intercommunalite,
              natureLabel: INTERCOMMUNALITE_NATURE_LABELS[r.intercommunalite.nature],
              source: { label: r.sourceLabel, url: r.sourceUrl },
            },
          ]
        : []
    )
    .sort((a, b) => NATURE_ORDER[a.nature] - NATURE_ORDER[b.nature]);
  // The EPCI file is the reference: its row says "member of X" or "Sans objet".
  const reference =
    rows.find((r) => r.intercommunalite === null || r.intercommunalite.nature !== "EPT") ??
    rows[0]!;

  return {
    state: bodies.length > 0 ? "DISPONIBLE" : "AUCUNE",
    intercommunalites: bodies,
    situationDate: reference.situationDate.toISOString(),
    source: { label: reference.sourceLabel, url: reference.sourceUrl },
    lastCheckedAt,
  };
}
