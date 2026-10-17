/**
 * Synthetic scenario for the historical group tests.
 *
 * Everything here is invented: identifiers (`PA_T01`, `PO_G1`), dates and groups. No real person,
 * no real record. The patterns are the ones measured on the official files (a group that changes
 * reference, a missing non-registration interval, two lines for one organ, a filler reference),
 * so that the tests exercise the cases that matter without carrying any real data.
 *
 * The scenario has two snapshots of the evidence. Snapshot 2 corrects, adds and removes records
 * after a first run has been computed on snapshot 1: the retroactive correction the architecture
 * is built to survive.
 */
import { hashOf } from "../canonical";
import {
  defaultRunConfig,
  hashDecisionsInForce,
  RESOLVER_VERSION,
  type RunPins,
} from "../run-contract";
import {
  evidenceStateHash,
  withPreparedInputsHash,
  type EvidenceStore,
  type PreparedInputs,
  type RunSpec,
  type RunVoteInput,
} from "../run-execution";
import {
  applySnapshot,
  effectiveDecisions,
  type DecisionEntry,
  type IncomingRecord,
  type RecordVersion,
} from "../versioning";
import { CONTINUITY_DECISION, d, membership, OPEN_BOUND, ORGANS, ref, resolved } from "./builders";
import {
  asScrutinId,
  type CivilDate,
  type ContinuityEvidence,
  type GroupMembershipEvidence,
  type IdentityOutcome,
  type OrganEvidence,
  type VotePosition,
} from "../types";

export const STREAM = "AN_AMO30";
/** The stream the attestations of the votes come from. Opaque here: the assembling layer owns it. */
export const SCRUTIN_STREAM = "AN_SCRUTINS_L16";
export const SCRUTIN_STATE_HASH = "scrutins-l16-state-hash-1";

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/** Snapshot 1 of the memberships. */
export const MEMBERSHIPS_S1: GroupMembershipEvidence[] = [
  // PA_T01: non-registered at the start of the legislature, then a group.
  membership("m01", "PA_T01", "PO_NI", "2022-06-22", "2022-06-28"),
  membership("m02", "PA_T01", "PO_G1", "2022-06-29", "OPEN"),
  // PA_T02: one group, whose scrutins later publish another reference (renaming).
  membership("m03", "PA_T02", "PO_G2", "2022-06-29", "OPEN"),
  // PA_T03: changes group on 2023-03-10 / 2023-03-11. Corrected in snapshot 2.
  membership("m04", "PA_T03", "PO_G1", "2022-06-29", "2023-03-10"),
  membership("m05", "PA_T03", "PO_G3", "2023-03-11", "OPEN"),
  // PA_T04: two lines for one organ ("Membre" then "Président").
  membership("m06", "PA_T04", "PO_G1", "2022-06-29", "OPEN"),
  membership("m07", "PA_T04", "PO_G1", "2022-09-30", "OPEN", {
    qualityCode: "Président",
    isPrincipal: false,
  }),
  // PA_T05: leaves a group on 2022-12-01 and has no record afterwards. Removed in snapshot 2.
  membership("m08", "PA_T05", "PO_G3", "2022-06-29", "2022-12-01"),
  // PA_T06: the end of the membership is unknown.
  membership("m09", "PA_T06", "PO_G1", "2022-06-29", "UNKNOWN"),
  // PA_T07: the start of the membership is unknown.
  membership("m10", "PA_T07", "PO_G1", null, "2022-12-31"),
  // PA_T09: no non-registration interval before the group.
  membership("m11", "PA_T09", "PO_G1", "2022-07-23", "OPEN"),
  // PA_T11: untouched by the corrections.
  membership("m13", "PA_T11", "PO_G1", "2022-06-29", "OPEN"),
  // PA_T12: a record that points at an organ the referential does not have.
  membership("m14", "PA_T12", "PO_GHOST", "2022-06-29", "OPEN"),
  // PA_T13: two different organs from 2023-01-01.
  membership("m15", "PA_T13", "PO_G1", "2022-06-29", "OPEN"),
  membership("m16", "PA_T13", "PO_G3", "2023-01-01", "OPEN"),
  // PA_T14: non-registered for the whole legislature.
  membership("m17", "PA_T14", "PO_NI", "2022-06-22", "OPEN"),
  // PA_T15: a valid record of one group, and a record of another group whose end is unknown.
  membership("m18", "PA_T15", "PO_G1", "2022-06-29", "OPEN"),
  membership("m19", "PA_T15", "PO_G3", "2022-07-01", "UNKNOWN"),
];

/** Snapshot 2: c1 corrects two records, c2 adds one, c3 removes one. The rest is unchanged. */
export const MEMBERSHIPS_S2: GroupMembershipEvidence[] = [
  ...MEMBERSHIPS_S1.filter((m) => !["m04", "m05", "m08"].includes(m.sourceRecordId)),
  // c1: the change of group is moved back by eight days.
  membership("m04", "PA_T03", "PO_G1", "2022-06-29", "2023-03-02"),
  membership("m05", "PA_T03", "PO_G3", "2023-03-03", "OPEN"),
  // c2: a person who had no record in snapshot 1.
  membership("m12", "PA_T10", "PO_G1", "2022-06-29", "OPEN"),
  // c3: m08 is gone.
];

export const CONTINUITY_JOURNAL: DecisionEntry<ContinuityEvidence>[] = [
  { decisionNo: 1, key: "PO_G2|PO_G2B|RENAMED_SAME_GROUP", value: CONTINUITY_DECISION },
];

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function incoming<T extends object>(
  records: readonly T[],
  keyOf: (record: T) => string
): IncomingRecord<T>[] {
  return records.map((value) => ({ key: keyOf(value), rawHash: hashOf(value), value }));
}

export const membershipRecords = (records: readonly GroupMembershipEvidence[]) =>
  incoming(records, (m) => m.sourceRecordId);
export const organRecords = (records: readonly OrganEvidence[]) =>
  incoming(records, (o) => o.groupRef);

/** The evidence as imported after snapshot 1, then after snapshot 2. */
export function storeAfter(snapshots: 1 | 2): EvidenceStore {
  let memberships: RecordVersion<GroupMembershipEvidence>[] = [];
  let organs: RecordVersion<OrganEvidence>[] = [];
  memberships = applySnapshot(memberships, membershipRecords(MEMBERSHIPS_S1), 1).versions;
  organs = applySnapshot(organs, organRecords(ORGANS), 1).versions;
  if (snapshots === 2) {
    memberships = applySnapshot(memberships, membershipRecords(MEMBERSHIPS_S2), 2).versions;
    organs = applySnapshot(organs, organRecords(ORGANS), 2).versions;
  }
  return { memberships, organs, continuityJournal: CONTINUITY_JOURNAL };
}

/** State hash of a snapshot, rebuilt from the stored versions. */
export function stateHashAt(store: EvidenceStore, seq: number): string {
  return evidenceStateHash(store, seq);
}

/** The pins of a run, including the hash of the prepared inputs the run is given. */
export function pinsFor(
  store: EvidenceStore,
  seq: number,
  continuityCutoff: number,
  votes: readonly RunVoteInput[] = VOTES,
  parserVersion = "parser-1"
): RunPins {
  const continuity = effectiveDecisions(store.continuityJournal, continuityCutoff);
  return withPreparedInputsHash(
    {
      snapshotPins: { [STREAM]: seq, [SCRUTIN_STREAM]: 1 },
      snapshotStateHashes: {
        [STREAM]: stateHashAt(store, seq),
        [SCRUTIN_STREAM]: SCRUTIN_STATE_HASH,
      },
      linkDecisionCutoff: 0,
      continuityDecisionCutoff: continuityCutoff,
      decisionsHash: hashDecisionsInForce(new Map(), continuity),
      parserVersion,
      resolverVersion: RESOLVER_VERSION,
    },
    votes,
    OPEN_BOUND
  );
}

/** What an honest assembling layer hands to `executeRun`: the votes and where they come from. */
export function preparedFor(votes: readonly RunVoteInput[] = VOTES): PreparedInputs {
  return {
    votes,
    provenance: {
      snapshotPins: { [SCRUTIN_STREAM]: 1 },
      snapshotStateHashes: { [SCRUTIN_STREAM]: SCRUTIN_STATE_HASH },
      linkDecisionCutoff: 0,
      linkDecisionsInForce: new Map(),
    },
  };
}

export function specFor(pins: RunPins, config = defaultRunConfig([16])): RunSpec {
  return { config, pins, evidenceStream: STREAM, openBound: OPEN_BOUND };
}

// ---------------------------------------------------------------------------
// Votes
// ---------------------------------------------------------------------------

function vote(
  voteId: string,
  identity: IdentityOutcome,
  scrutin: string,
  date: string,
  position: VotePosition,
  published: string | null
): RunVoteInput {
  return {
    voteId,
    identity,
    scrutinId: asScrutinId(scrutin),
    civilDate: d(date) as CivilDate,
    legislature: 16,
    position,
    attestation:
      published === null ? null : { publishedOrganRef: ref(published), seatMandate: null },
  };
}

/** One vote per case of interest. The comment gives the expected answer in each run. */
export const VOTES: RunVoteInput[] = [
  // Non-registered before the groups exist: attested by interval only, transitional.
  vote("v01", resolved("PA_T01"), "S1", "2022-06-25", "POUR", null),
  // Both sources agree.
  vote("v02", resolved("PA_T01"), "S2", "2022-07-11", "CONTRE", "PO_G1"),
  // Last day of a record, no scrutin: edge day.
  vote("v03", resolved("PA_T01"), "S3", "2022-06-28", "POUR", null),
  // The scrutin publishes the renamed reference. Run 1: conflict. Run 2: same group via the link.
  vote("v04", resolved("PA_T02"), "S4", "2024-01-29", "POUR", "PO_G2B"),
  // Run 1: both agree on PO_G1. Run 2: the corrected interval says PO_G3, so conflict.
  vote("v05", resolved("PA_T03"), "S5", "2023-03-05", "CONTRE", "PO_G1"),
  // Run 1: interval only, PO_G3. Run 2: the record is gone, so unknown.
  vote("v06", resolved("PA_T05"), "S6", "2022-10-10", "POUR", null),
  // Run 1: unknown (no record). Run 2: interval only, PO_G1.
  vote("v07", resolved("PA_T10"), "S7", "2023-01-10", "ABSTENTION", null),
  // Two lines of one organ: one candidate, both lines as proof.
  vote("v08", resolved("PA_T04"), "S8", "2023-01-10", "POUR", "PO_G1"),
  // End of membership unknown, no scrutin: insufficient.
  vote("v09", resolved("PA_T06"), "S9", "2023-01-10", "POUR", null),
  // Same person, with a scrutin: the attestation stands alone.
  vote("v10", resolved("PA_T06"), "S10", "2023-01-10", "CONTRE", "PO_G1"),
  // Start of membership unknown, no scrutin: insufficient.
  vote("v11", resolved("PA_T07"), "S11", "2022-10-10", "POUR", null),
  // No official identifier: left out, counted under the organ the scrutin listed.
  vote(
    "v12",
    { status: "UNRESOLVED", reason: "NO_OFFICIAL_ID" },
    "S2",
    "2022-07-11",
    "POUR",
    "PO_G1"
  ),
  // The scrutin lists a non-registered person but a group record starts that day: conflict.
  vote("v13", resolved("PA_T09"), "S13", "2022-07-23", "POUR", "PO_NI"),
  // The record points at an organ the referential does not have: insufficient.
  vote("v14", resolved("PA_T12"), "S14", "2023-01-10", "POUR", null),
  // Two organs at once.
  vote("v15", resolved("PA_T13"), "S15", "2023-02-01", "POUR", null),
  // Filler reference published by the scrutin.
  vote("v16", resolved("PA_T01"), "S16", "2024-03-03", "POUR", "PO0"),
  // Non-registered for the whole legislature, not transitional.
  vote("v17", resolved("PA_T14"), "S17", "2023-05-05", "NON_VOTANT", null),
  // Untouched by every correction.
  vote("v18", resolved("PA_T11"), "S2", "2022-07-11", "POUR", "PO_G1"),
  // Open end, within the bound of the snapshot, then beyond it.
  vote("v19", resolved("PA_T02"), "S19", "2025-01-01", "POUR", null),
  vote("v20", resolved("PA_T02"), "S20", "2027-01-01", "POUR", null),
  // A valid interval agrees with the vote, but another record that cannot be placed names another
  // group: the vote stands alone, the corroboration is withheld, and the record is reported.
  vote("v21", resolved("PA_T15"), "S21", "2023-01-10", "POUR", "PO_G1"),
];
