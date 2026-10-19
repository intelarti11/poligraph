/**
 * Reading rules for the historical group counts of a scrutin (lot 6).
 *
 * Pure functions: no database, no clock, no environment. The data module hands over what the public
 * views returned, and this module decides what the page may say. A state is never inferred from a
 * missing value: "no row" is "not available", never "no vote", and the current affiliation of a
 * deputy is never a fallback for a historical one.
 *
 * Nothing here computes a majority position. A group does not vote as one block, and the sources
 * hold no such decision.
 */
import { HISTORICAL_POSITIONS_LEGISLATURES } from "@/config/historical-positions";

export type CountCoherence =
  | "COHERENT"
  | "COUNT_MISMATCH"
  | "UNVERIFIABLE"
  | "COUNT_COHERENCE_UNKNOWN";

/** Why a group present in the run is not shown. */
export type WithheldGroupReason =
  | "EXCLUDED_VOTES_PRESENT"
  | "NO_ATTESTED_VOTE"
  | "UNLABELLED_GROUP";

export interface HistoricalGroupRow {
  organRef: string;
  label: string;
  abbreviation: string | null;
  forCount: number;
  againstCount: number;
  abstainCount: number;
  nonVoterCount: number;
  /** Another organ of the same legislature carries the same abbreviation. */
  sameAbbreviationElsewhere: boolean;
}

export interface WithheldGroup {
  label: string;
  abbreviation: string | null;
  reason: WithheldGroupReason;
}

export interface HistoricalScrutinStatus {
  legislature: number;
  countCoherence: CountCoherence;
  groupsShown: number;
  groupsWithheld: number;
  withheldGroups: WithheldGroup[];
  nonInscritVotes: number;
  excludedConflictVotes: number;
  excludedUnknownGroupVotes: number;
  affiliationsUrl: string | null;
  affiliationsFetchedAt: Date | null;
  affiliationsAsOf: Date | null;
  scrutinsUrl: string | null;
  scrutinsFetchedAt: Date | null;
}

/** What the data module returns for one scrutin. `unreadable` is a failed read, not an absence. */
export type HistoricalPositionsData =
  | { unreadable: true }
  | { unreadable?: false; status: HistoricalScrutinStatus | null; rows: HistoricalGroupRow[] };

export interface HistoricalNotice {
  kind: "non-inscrits" | "excluded-conflict" | "excluded-unknown-group" | "renamed-groups";
  text: string;
}

export interface HistoricalSource {
  affiliations: { url: string | null; asOf: Date | null; fetchedAt: Date | null };
  scrutins: { url: string | null; fetchedAt: Date | null };
}

export type UnavailableCause = "legislature-not-covered" | "no-published-run" | "read-error";
export type WithheldCause = "count-discordant" | "count-unverifiable" | "no-group-presentable";

export type HistoricalPositionsView =
  | {
      kind: "positions";
      legislature: number;
      rows: HistoricalGroupRow[];
      /** `complete`: every group of the scrutin is shown. `partial`: some are withheld. */
      completeness: "complete" | "partial";
      withheldGroups: WithheldGroup[];
      notices: HistoricalNotice[];
      source: HistoricalSource;
    }
  | {
      kind: "withheld";
      legislature: number;
      cause: WithheldCause;
      withheldGroups: WithheldGroup[];
      notices: HistoricalNotice[];
      source: HistoricalSource;
    }
  | { kind: "unavailable"; legislature: number; cause: UnavailableCause };

const COVERED = new Set<number>(HISTORICAL_POSITIONS_LEGISLATURES);

/** "1 vote", "3 votes". */
export function pluralVotes(n: number): string {
  return `${n} ${n > 1 ? "votes" : "vote"}`;
}

function noticesOf(
  status: HistoricalScrutinStatus,
  rows: HistoricalGroupRow[]
): HistoricalNotice[] {
  const notices: HistoricalNotice[] = [];
  if (status.nonInscritVotes > 0) {
    notices.push({
      kind: "non-inscrits",
      text: `Les députés non inscrits ne forment pas un groupe : ${pluralVotes(status.nonInscritVotes)} de non-inscrits ${status.nonInscritVotes > 1 ? "ne sont pas regroupés" : "n'est pas regroupé"}.`,
    });
  }
  if (status.excludedConflictVotes > 0) {
    notices.push({
      kind: "excluded-conflict",
      text: `${pluralVotes(status.excludedConflictVotes)} ${status.excludedConflictVotes > 1 ? "ne sont comptés" : "n'est compté"} dans aucun groupe : les deux jeux de données de l'Assemblée nationale donnent un groupe différent pour ce député à cette date.`,
    });
  }
  if (status.excludedUnknownGroupVotes > 0) {
    notices.push({
      kind: "excluded-unknown-group",
      text: `${pluralVotes(status.excludedUnknownGroupVotes)} ${status.excludedUnknownGroupVotes > 1 ? "ne sont comptés" : "n'est compté"} dans aucun groupe : l'Assemblée nationale n'indique pas de groupe pour ${status.excludedUnknownGroupVotes > 1 ? "ces députés" : "ce député"}.`,
    });
  }
  const shared = new Set(
    rows.filter((r) => r.sameAbbreviationElsewhere).map((r) => r.abbreviation)
  );
  if (shared.size > 0) {
    const sigles = [...shared].filter((s): s is string => s !== null);
    notices.push({
      kind: "renamed-groups",
      text: `${sigles.length > 1 ? "Les sigles" : "Le sigle"} ${sigles.join(", ")} correspond${sigles.length > 1 ? "ent" : ""} à plus d'un groupe dans cette législature (changement de nom ou de référence). Chaque ligne est celle du groupe référencé ce jour-là, et PoliGraph ne les relie pas entre eux tant que la continuité n'est pas établie.`,
    });
  }
  return notices;
}

function sourceOf(status: HistoricalScrutinStatus): HistoricalSource {
  return {
    affiliations: {
      url: status.affiliationsUrl,
      asOf: status.affiliationsAsOf,
      fetchedAt: status.affiliationsFetchedAt,
    },
    scrutins: { url: status.scrutinsUrl, fetchedAt: status.scrutinsFetchedAt },
  };
}

/**
 * The state the page shows for one AN scrutin.
 *
 * Defence in depth: the SQL views already hold back what is not publishable, and this function
 * refuses again. Rows are shown only when the totals of the scrutin agree with the published ones,
 * when the number of rows is the number the status announces, and when every count is a plain
 * non-negative integer. Anything else is "unavailable", never a partial guess.
 */
export function buildHistoricalPositionsView(input: {
  legislature: number;
  data: HistoricalPositionsData;
}): HistoricalPositionsView {
  const { legislature, data } = input;
  if (!COVERED.has(legislature)) {
    return { kind: "unavailable", legislature, cause: "legislature-not-covered" };
  }
  if (data.unreadable) {
    return { kind: "unavailable", legislature, cause: "read-error" };
  }
  const { status, rows } = data;
  if (status === null) {
    return { kind: "unavailable", legislature, cause: "no-published-run" };
  }
  if (status.legislature !== legislature) {
    return { kind: "unavailable", legislature, cause: "read-error" };
  }

  const source = sourceOf(status);
  if (status.countCoherence !== "COHERENT") {
    return {
      kind: "withheld",
      legislature,
      cause: status.countCoherence === "COUNT_MISMATCH" ? "count-discordant" : "count-unverifiable",
      withheldGroups: [],
      notices: [],
      source,
    };
  }

  const countsAreSound = rows.every((r) =>
    [r.forCount, r.againstCount, r.abstainCount, r.nonVoterCount].every(
      (n) => Number.isInteger(n) && n >= 0
    )
  );
  if (!countsAreSound || rows.length !== status.groupsShown) {
    return { kind: "unavailable", legislature, cause: "read-error" };
  }

  const notices = noticesOf(status, rows);
  if (rows.length === 0) {
    return {
      kind: "withheld",
      legislature,
      cause: "no-group-presentable",
      withheldGroups: status.withheldGroups,
      notices,
      source,
    };
  }
  const withheldSomething =
    status.groupsWithheld > 0 ||
    status.excludedConflictVotes > 0 ||
    status.excludedUnknownGroupVotes > 0;
  return {
    kind: "positions",
    legislature,
    rows,
    completeness: withheldSomething ? "partial" : "complete",
    withheldGroups: status.withheldGroups,
    notices,
    source,
  };
}

export const WITHHELD_GROUP_REASON_TEXT: Record<WithheldGroupReason, string> = {
  EXCLUDED_VOTES_PRESENT:
    "au moins un de ses votes n'a pas pu être rattaché avec certitude à ce groupe",
  NO_ATTESTED_VOTE: "aucun vote pour, contre ou abstention n'est attesté",
  UNLABELLED_GROUP: "le référentiel de l'Assemblée ne donne pas son nom",
};

/**
 * What the groups section of the scrutin page renders. One place for a rule that touches three
 * blocks, so that the old block (positions computed on the CURRENT group of each deputy) never sits
 * next to a dated count that says something else about the same scrutin.
 */
export function planGroupsSection(input: {
  enabled: boolean;
  chamber: "AN" | "SENAT";
  view: HistoricalPositionsView | null;
  hasComputedPositions: boolean;
}): { showHistorical: boolean; showCurrentAffiliationPositions: boolean } {
  const { enabled, chamber, view, hasComputedPositions } = input;
  if (!enabled || chamber !== "AN" || view === null) {
    return { showHistorical: false, showCurrentAffiliationPositions: hasComputedPositions };
  }
  const supersedes = view.kind === "positions" || view.kind === "withheld";
  return {
    showHistorical: true,
    showCurrentAffiliationPositions: hasComputedPositions && !supersedes,
  };
}
