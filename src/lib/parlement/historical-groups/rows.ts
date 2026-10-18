/**
 * The rows the import writes, and their hashes (lot 5C-0).
 *
 * A row is the projection of one official record onto the columns of its table. This file turns
 * what the parsers return into those rows and computes, for each, the hash that decides whether it
 * changed between two snapshots. It reads no file, writes nothing and knows no table: the columns
 * are the names of the SQL tables (architecture 4), and a test keeps the two in step.
 *
 * What `rawHash` is, exactly:
 *
 *   rawHash = sha256( canonicalJson( { kind, row } ) )
 *
 * - `row` holds every CONTENT column of the table and nothing else. Not in it: `stream`,
 *   `fromSeq`, `toSeq` (they say where a version sits, not what it says), `sourceMember` (a file
 *   renamed with the same content is not a correction), `memberHash` (the hash of the whole file:
 *   a correction elsewhere in a file shared by 150 voters must not rewrite 150 rows) and `rawHash`
 *   itself.
 * - Every column is present, an absent value is `null`, never missing: a field the source starts
 *   publishing later is a visible change.
 * - `kind` is in the hash: two tables never share a hash for the same payload.
 * - It does not depend on the parser version. The version decides what the projection contains;
 *   a new version is a new snapshot (same bytes, new parser), and its differences are reported as
 *   the parser's.
 *
 * `canonicalJson` fixes the serialization: sorted keys, no whitespace, safe integers only, no
 * `undefined`. A row with a float or an `undefined` cannot be hashed.
 */
import { canonicalJson, computeStateHash, hashOf, type StateEntry } from "./canonical";
import { deriveCountCheck, type PositionCounts } from "./count-check";
import type { ActorParse, GroupOrganRecord } from "./parse-amo30";
import type { ParsedAnScrutin } from "./parse-scrutin";
import type { CivilDate, CountCoherence } from "./types";

export const RECORD_KINDS = [
  "OFFICIAL_ACTOR",
  "OFFICIAL_ORGAN",
  "GROUP_MEMBERSHIP",
  "SEAT_MANDATE",
  "SCRUTIN_ATTESTATION",
  "SCRUTIN_COUNT_CHECK",
  "SCRUTIN_GROUP_COUNT_CHECK",
] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

type DateState = "DATED" | "UNKNOWN";
type EndDateState = "DATED" | "OPEN_AT_SNAPSHOT" | "UNKNOWN";

export interface OfficialActorRow {
  officialId: string;
}
export interface OfficialOrganRow {
  organeRef: string;
  codeType: "GP";
  legislature: number | null;
  label: string;
  abbreviation: string | null;
  startDate: CivilDate | null;
  endDate: CivilDate | null;
}
export interface GroupMembershipRow {
  sourceRecordId: string;
  officialId: string;
  chamber: "AN";
  groupRef: string;
  legislature: number | null;
  qualityCode: string | null;
  isPrincipal: boolean | null;
  precedence: number | null;
  startDate: CivilDate | null;
  startState: DateState;
  endDate: CivilDate | null;
  endState: EndDateState;
  publicationDate: CivilDate | null;
}
export interface SeatMandateRow {
  sourceRecordId: string;
  officialId: string;
  legislature: number | null;
  startDate: CivilDate | null;
  startState: DateState;
  endDate: CivilDate | null;
  endState: EndDateState;
}
export interface ScrutinAttestationRow {
  scrutinExternalId: string;
  officialId: string;
  scrutinDate: CivilDate;
  legislature: number;
  publishedOrganRef: string;
  publishedPosition: "pour" | "contre" | "abstention" | "nonVotant";
  byDelegation: boolean | null;
  seatMandateRef: string | null;
}

/** The three families of count columns of the two coherence tables, flat as in SQL. */
export interface CountColumns {
  nominalPour: number;
  nominalContre: number;
  nominalAbstention: number;
  nominalNonVotant: number;
  officialPour: number | null;
  officialContre: number | null;
  officialAbstention: number | null;
  officialNonVotant: number | null;
  diffPour: number | null;
  diffContre: number | null;
  diffAbstention: number | null;
  diffNonVotant: number | null;
}
export interface ScrutinCountCheckRow extends CountColumns {
  scrutinExternalId: string;
  scrutinDate: CivilDate;
  legislature: number;
  countCoherence: CountCoherence;
  groupCount: number;
  mismatchedGroups: number;
  unverifiableGroups: number;
  miseAuPointListedVotants: number;
  miseAuPointMalformedBlocks: number;
}
export interface ScrutinGroupCountCheckRow extends CountColumns {
  scrutinExternalId: string;
  organRef: string;
  /**
   * Rank of this group among the groups of the scrutin that name the same organ, in the order of
   * the file: 0 for the first. A scrutin can list the placeholder `PO0` several times (found on the
   * official files), so (scrutin, organ) is not an identity. For a real organ it is always 0.
   */
  organOrdinal: number;
  groupCoherence: CountCoherence;
}

export interface RowOf {
  OFFICIAL_ACTOR: OfficialActorRow;
  OFFICIAL_ORGAN: OfficialOrganRow;
  GROUP_MEMBERSHIP: GroupMembershipRow;
  SEAT_MANDATE: SeatMandateRow;
  SCRUTIN_ATTESTATION: ScrutinAttestationRow;
  SCRUTIN_COUNT_CHECK: ScrutinCountCheckRow;
  SCRUTIN_GROUP_COUNT_CHECK: ScrutinGroupCountCheckRow;
}

export interface HashedRecord<K extends RecordKind = RecordKind> {
  kind: K;
  /** The identity of the record inside its stream, as a JSON array. Stable, never ambiguous. */
  key: string;
  row: RowOf[K];
  rawHash: string;
}

const IDENTITY: { [K in RecordKind]: readonly (keyof RowOf[K])[] } = {
  OFFICIAL_ACTOR: ["officialId"],
  OFFICIAL_ORGAN: ["organeRef"],
  GROUP_MEMBERSHIP: ["sourceRecordId"],
  SEAT_MANDATE: ["sourceRecordId"],
  SCRUTIN_ATTESTATION: ["scrutinExternalId", "officialId"],
  SCRUTIN_COUNT_CHECK: ["scrutinExternalId"],
  SCRUTIN_GROUP_COUNT_CHECK: ["scrutinExternalId", "organRef", "organOrdinal"],
};

/** The identity of a record. A JSON array, so a separator inside a value cannot merge two keys. */
export function recordKeyOf<K extends RecordKind>(kind: K, row: RowOf[K]): string {
  return JSON.stringify(IDENTITY[kind].map((column) => row[column]));
}

export function rawHashOf<K extends RecordKind>(kind: K, row: RowOf[K]): string {
  return hashOf({ kind, row });
}

export function hashed<K extends RecordKind>(kind: K, row: RowOf[K]): HashedRecord<K> {
  return { kind, key: recordKeyOf(kind, row), row, rawHash: rawHashOf(kind, row) };
}

/** Throws when two records share an identity: a snapshot holds one version of each. */
export function stateHashOfRecords(records: readonly HashedRecord[]): string {
  const entries: StateEntry[] = records.map((r) => ({
    kind: r.kind,
    key: r.key,
    rawHash: r.rawHash,
  }));
  return computeStateHash(entries);
}

// ---------------------------------------------------------------------------
// From what the parsers return to rows
// ---------------------------------------------------------------------------

export function organRow(organ: GroupOrganRecord): HashedRecord<"OFFICIAL_ORGAN"> {
  return hashed("OFFICIAL_ORGAN", {
    organeRef: organ.groupRef,
    codeType: "GP",
    legislature: organ.legislature,
    label: organ.label,
    abbreviation: organ.abbreviation,
    startDate: organ.startDate,
    endDate: organ.endDate,
  });
}

export function recordsOfActor(actor: Extract<ActorParse, { status: "ACCEPTED" }>): HashedRecord[] {
  const out: HashedRecord[] = [hashed("OFFICIAL_ACTOR", { officialId: actor.officialId })];
  const details = new Map(actor.membershipDetails.map((d) => [d.sourceRecordId, d]));
  for (const m of actor.memberships) {
    const detail = details.get(m.sourceRecordId);
    if (!detail) throw new Error(`no detail for the membership ${m.sourceRecordId}`);
    out.push(
      hashed("GROUP_MEMBERSHIP", {
        sourceRecordId: m.sourceRecordId,
        officialId: m.officialId,
        chamber: "AN",
        groupRef: m.groupRef,
        legislature: m.legislature,
        qualityCode: m.qualityCode,
        isPrincipal: m.isPrincipal,
        precedence: detail.precedence,
        startDate: m.startDate,
        startState: m.startState,
        endDate: m.endDate,
        endState: m.endState,
        publicationDate: detail.publicationDate,
      })
    );
  }
  for (const seat of actor.seats) {
    out.push(
      hashed("SEAT_MANDATE", {
        sourceRecordId: seat.sourceRecordId,
        officialId: seat.officialId,
        legislature: seat.legislature,
        startDate: seat.startDate,
        startState: seat.startDate === null ? "UNKNOWN" : "DATED",
        endDate: seat.endDate,
        // The same convention as a group mandate: no end in the file is "open at the snapshot".
        endState: seat.endDate === null ? "OPEN_AT_SNAPSHOT" : "DATED",
      })
    );
  }
  return out;
}

const flat = (
  nominal: PositionCounts,
  official: PositionCounts | null,
  diff: PositionCounts | null
): CountColumns => ({
  nominalPour: nominal.pour,
  nominalContre: nominal.contre,
  nominalAbstention: nominal.abstention,
  nominalNonVotant: nominal.nonVotant,
  officialPour: official?.pour ?? null,
  officialContre: official?.contre ?? null,
  officialAbstention: official?.abstention ?? null,
  officialNonVotant: official?.nonVotant ?? null,
  diffPour: diff?.pour ?? null,
  diffContre: diff?.contre ?? null,
  diffAbstention: diff?.abstention ?? null,
  diffNonVotant: diff?.nonVotant ?? null,
});

/**
 * Every record of one AN scrutin: its attestations, one coherence row per group and one for the
 * scrutin. The coherence is recomputed here from the numbers and must be what the parser said:
 * two implementations of the same rule that disagree are a bug, and the import stops.
 */
export function recordsOfScrutin(scrutin: ParsedAnScrutin): HashedRecord[] {
  const check = deriveCountCheck({
    groups: scrutin.groups.map((g) => ({
      organRef: g.organRef,
      nominal: g.nominal,
      official: g.official,
    })),
    synthese: scrutin.synthese,
  });
  if (check.coherence !== scrutin.countCoherence) {
    throw new Error(
      `count coherence of ${scrutin.scrutinId}: the parser says ${scrutin.countCoherence}, the numbers say ${check.coherence}`
    );
  }
  const out: HashedRecord[] = scrutin.attestations.map((a) =>
    hashed("SCRUTIN_ATTESTATION", {
      scrutinExternalId: scrutin.scrutinId,
      officialId: a.officialId,
      scrutinDate: a.date,
      legislature: a.legislature,
      publishedOrganRef: a.publishedOrganRef,
      publishedPosition: a.position,
      byDelegation: a.byDelegation,
      seatMandateRef: a.seatMandateRef,
    })
  );
  out.push(
    hashed("SCRUTIN_COUNT_CHECK", {
      scrutinExternalId: scrutin.scrutinId,
      scrutinDate: scrutin.date,
      legislature: scrutin.legislature,
      countCoherence: check.coherence,
      groupCount: check.groupCount,
      mismatchedGroups: check.mismatchedGroups,
      unverifiableGroups: check.unverifiableGroups,
      ...flat(check.nominal, check.official, check.diff),
      miseAuPointListedVotants: scrutin.miseAuPoint.listedVotants,
      miseAuPointMalformedBlocks: scrutin.miseAuPoint.malformedBlocks,
    })
  );
  const seen = new Map<string, number>();
  for (const group of check.groups) {
    const organOrdinal = seen.get(group.organRef) ?? 0;
    seen.set(group.organRef, organOrdinal + 1);
    out.push(
      hashed("SCRUTIN_GROUP_COUNT_CHECK", {
        scrutinExternalId: scrutin.scrutinId,
        organRef: group.organRef,
        organOrdinal,
        groupCoherence: group.coherence,
        ...flat(group.nominal, group.official, group.diff),
      })
    );
  }
  return out;
}

/** Canonical text of a row, for tests and reports. */
export const rowText = (kind: RecordKind, row: unknown): string => canonicalJson({ kind, row });
