import "server-only";

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

export async function readCommunePresidentielles(
  inseeCode: string,
  departmentCode: string
): Promise<CommunePresidentielles> {
  const rounds = await db.communeElectionRound.findMany({
    where: { communeId: inseeCode, election: { type: "PRESIDENTIELLE" } },
    select: {
      round: true,
      registeredVoters: true,
      actualVoters: true,
      participationRate: true,
      blankVotes: true,
      nullVotes: true,
      validVotes: true,
      election: {
        select: {
          id: true,
          slug: true,
          title: true,
          shortTitle: true,
          round1Date: true,
          round2Date: true,
        },
      },
    },
    orderBy: [{ election: { round1Date: "desc" } }, { round: "asc" }],
    take: MAX_ELECTIONS * 2,
  });

  if (rounds.length === 0) {
    return { blocks: [], agregatTerritoire: await readAgregat(departmentCode) };
  }

  const elections = [...new Map(rounds.map((r) => [r.election.id, r.election])).values()];
  const results = await db.communeCandidacyResult.findMany({
    where: {
      communeId: inseeCode,
      candidacy: { electionId: { in: elections.map((e) => e.id) } },
    },
    select: {
      round: true,
      votes: true,
      candidacy: { select: { electionId: true, candidateName: true } },
    },
    // 12 candidates and 2 rounds in 2022: the bound leaves room without being open-ended.
    take: 200,
  });
  const syncs = await db.syncMetadata.findMany({
    where: { sourceKey: { in: elections.map((e) => presidentielleCommunesSyncKey(e.slug)) } },
    select: { sourceKey: true, lastSyncAt: true },
    take: MAX_ELECTIONS,
  });

  const blocks = elections.map((election): PresidentielleCommuneBlock => {
    const tours = rounds
      .filter((r) => r.election.id === election.id && (r.round === 1 || r.round === 2))
      .map((r): PresidentielleTourCommune => {
        const round = r.round as 1 | 2;
        const date = round === 1 ? election.round1Date : election.round2Date;
        return {
          round,
          date: date ? date.toISOString() : null,
          registeredVoters: r.registeredVoters,
          actualVoters: r.actualVoters,
          participationRate: r.participationRate != null ? Number(r.participationRate) : null,
          blankVotes: r.blankVotes,
          nullVotes: r.nullVotes,
          validVotes: r.validVotes,
          candidats: results
            .filter((x) => x.candidacy.electionId === election.id && x.round === round)
            .map((x) => ({
              name: x.candidacy.candidateName,
              votes: x.votes,
              pct: pct(x.votes, r.validVotes),
            }))
            .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, "fr")),
        };
      });
    const sync = syncs.find((s) => s.sourceKey === presidentielleCommunesSyncKey(election.slug));
    return {
      electionSlug: election.slug,
      title: election.shortTitle ?? election.title,
      round1Date: election.round1Date ? election.round1Date.toISOString() : null,
      tours,
      sources: sourcesOf(election.slug).filter((s) => tours.some((t) => t.round === s.round)),
      importedAt: sync?.lastSyncAt ? sync.lastSyncAt.toISOString() : null,
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
