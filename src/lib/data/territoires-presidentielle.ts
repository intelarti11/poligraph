import "server-only";

import { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import {
  PRESIDENTIELLE_COMMUNES_SOURCE_LABEL,
  PRESIDENTIELLE_COMMUNES_SOURCES,
  presidentielleCommunesSyncKey,
} from "@/config/presidentielle-communes";

/**
 * Presidential results of one commune (#1052, lot 1.9), read for the commune dossier. Not cached
 * here: the caller's "use cache" boundary (readCommuneDossier) carries the tags.
 *
 * Only what the ministry published for the commune is returned: no share is shown without the
 * commune's valid votes, and a territory published as one aggregate gets a note, never a figure.
 */

export interface PresidentielleSource {
  round: 1 | 2;
  label: string;
  url: string;
  publishedAt: string;
}

export interface PresidentielleCandidatCommune {
  name: string;
  votes: number;
  /** Share of the commune's valid votes, null when they are unknown or zero. */
  pct: number | null;
}

export interface PresidentielleTourCommune {
  round: 1 | 2;
  date: string | null;
  registeredVoters: number | null;
  actualVoters: number | null;
  participationRate: number | null;
  blankVotes: number | null;
  nullVotes: number | null;
  validVotes: number | null;
  /** Sorted by votes, descending. At most a few dozen rows. */
  candidats: PresidentielleCandidatCommune[];
}

export interface PresidentielleCommuneBlock {
  electionSlug: string;
  title: string;
  round1Date: string | null;
  /** Round 1 then round 2, only the rounds published for the commune. */
  tours: PresidentielleTourCommune[];
  sources: PresidentielleSource[];
  /** Date of the import into Poligraph, null when unknown. */
  importedAt: string | null;
}

export interface CommunePresidentielles {
  /** Most recent election first. Empty when nothing is published for the commune. */
  blocks: PresidentielleCommuneBlock[];
  /** Set when the territory's results exist only as one aggregate for the whole territory. */
  agregatTerritoire: { territoire: string; electionTitle: string } | null;
}

/** Two presidential elections at most on a page: the latest and the previous one. */
const MAX_ELECTIONS = 2;

function pct(votes: number, valid: number | null): number | null {
  if (valid == null || valid === 0) return null;
  return Math.round((votes / valid) * 10_000) / 100;
}

function sourcesOf(slug: string): PresidentielleSource[] {
  const config = PRESIDENTIELLE_COMMUNES_SOURCES[slug];
  if (!config) return [];
  return ([1, 2] as const).flatMap((round) => {
    const r = config.rounds[round];
    return r
      ? [
          {
            round,
            label: PRESIDENTIELLE_COMMUNES_SOURCE_LABEL,
            url: r.datasetUrl,
            publishedAt: r.publishedAt,
          },
        ]
      : [];
  });
}

interface PresidentielleRow {
  electionId: string;
  slug: string;
  title: string;
  shortTitle: string | null;
  round1Date: Date | null;
  round2Date: Date | null;
  round: number;
  registeredVoters: number | null;
  actualVoters: number | null;
  participationRate: Prisma.Decimal | number | string | null;
  blankVotes: number | null;
  nullVotes: number | null;
  validVotes: number | null;
  lastSyncAt: Date | null;
  candidats: Array<{ name: string; votes: number }> | null;
}

/** PostgreSQL "undefined_table": the manual SQL creating CommuneCandidacyResult not yet applied. */
function isMissingResultTable(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${JSON.stringify(error)}` : "";
  return text.includes("42P01") && text.includes("CommuneCandidacyResult");
}

/**
 * One round trip: participation rows of the commune's presidential elections, with each round's
 * candidate votes aggregated in a lateral subquery and the import date joined from SyncMetadata.
 */
async function queryRows(inseeCode: string): Promise<PresidentielleRow[]> {
  return db.$queryRaw<PresidentielleRow[]>(Prisma.sql`
    SELECT e.id AS "electionId", e.slug, e.title, e."shortTitle", e."round1Date", e."round2Date",
           r.round, r."registeredVoters", r."actualVoters", r."participationRate",
           r."blankVotes", r."nullVotes", r."validVotes",
           s."lastSyncAt", x.candidats
    FROM "CommuneElectionRound" r
    JOIN "Election" e ON e.id = r."electionId" AND e.type = 'PRESIDENTIELLE'
    LEFT JOIN "SyncMetadata" s ON s."sourceKey" = ${SYNC_KEY_PREFIX} || e.slug
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('name', k."candidateName", 'votes', v.votes)) AS candidats
      FROM "CommuneCandidacyResult" v
      JOIN "Candidacy" k ON k.id = v."candidacyId"
      WHERE v."communeId" = r."communeId" AND v.round = r.round AND k."electionId" = e.id
    ) x ON true
    WHERE r."communeId" = ${inseeCode}
    ORDER BY e."round1Date" DESC NULLS LAST, r.round ASC
    LIMIT ${MAX_ELECTIONS * 2}
  `);
}

const SYNC_KEY_PREFIX = presidentielleCommunesSyncKey("");

export async function readCommunePresidentielles(
  inseeCode: string,
  departmentCode: string
): Promise<CommunePresidentielles> {
  let rows: PresidentielleRow[];
  try {
    rows = await queryRows(inseeCode);
  } catch (error) {
    // Before the manual SQL is applied no presidential participation exists either: the page
    // shows nothing rather than failing.
    if (!isMissingResultTable(error)) throw error;
    rows = [];
  }

  if (rows.length === 0) {
    return { blocks: [], agregatTerritoire: await readAgregat(departmentCode) };
  }

  const electionIds = [...new Set(rows.map((r) => r.electionId))];
  const blocks = electionIds.map((electionId): PresidentielleCommuneBlock => {
    const electionRows = rows.filter(
      (r) => r.electionId === electionId && (r.round === 1 || r.round === 2)
    );
    const election = electionRows[0] ?? rows.find((r) => r.electionId === electionId)!;
    const tours = electionRows.map((r): PresidentielleTourCommune => {
      const round = r.round as 1 | 2;
      const date = round === 1 ? r.round1Date : r.round2Date;
      return {
        round,
        date: date ? date.toISOString() : null,
        registeredVoters: r.registeredVoters,
        actualVoters: r.actualVoters,
        participationRate: r.participationRate != null ? Number(r.participationRate) : null,
        blankVotes: r.blankVotes,
        nullVotes: r.nullVotes,
        validVotes: r.validVotes,
        candidats: (r.candidats ?? [])
          .map((c) => ({ name: c.name, votes: c.votes, pct: pct(c.votes, r.validVotes) }))
          .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, "fr")),
      };
    });
    return {
      electionSlug: election.slug,
      title: election.shortTitle ?? election.title,
      round1Date: election.round1Date ? election.round1Date.toISOString() : null,
      tours,
      sources: sourcesOf(election.slug).filter((s) => tours.some((t) => t.round === s.round)),
      importedAt: election.lastSyncAt ? election.lastSyncAt.toISOString() : null,
    };
  });

  return { blocks, agregatTerritoire: null };
}

/**
 * Note for a territory published as one aggregate (Wallis-et-Futuna in 2022), shown only once
 * the election has actually been imported.
 */
async function readAgregat(
  departmentCode: string
): Promise<CommunePresidentielles["agregatTerritoire"]> {
  const slugs = Object.entries(PRESIDENTIELLE_COMMUNES_SOURCES)
    .filter(([, config]) => config.aggregatedTerritories[departmentCode])
    .map(([slug]) => slug);
  if (slugs.length === 0) return null;

  const imported = await db.syncMetadata.findMany({
    where: { sourceKey: { in: slugs.map(presidentielleCommunesSyncKey) } },
    select: { sourceKey: true },
    take: slugs.length,
  });
  const slug = slugs.find((s) =>
    imported.some((i) => i.sourceKey === presidentielleCommunesSyncKey(s))
  );
  if (!slug) return null;
  const election = await db.election.findUnique({
    where: { slug },
    select: { title: true, shortTitle: true },
  });
  if (!election) return null;
  return {
    territoire: PRESIDENTIELLE_COMMUNES_SOURCES[slug]!.aggregatedTerritories[departmentCode]!,
    electionTitle: election.shortTitle ?? election.title,
  };
}
