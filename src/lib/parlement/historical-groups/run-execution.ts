import { computeStateHash, hashOf } from "./canonical";
import { excludedBy } from "./exclusion";
import { resolveGroupAtDate } from "./resolver";
import {
  assertValidRunConfig,
  hashDecisionsInForce,
  RESOLVER_VERSION,
  type RunPins,
} from "./run-contract";
import { effectiveDecisions, stateAt, type DecisionEntry, type RecordVersion } from "./versioning";
import type {
  AttestationLevel,
  CivilDate,
  ContinuityEvidence,
  Diagnostic,
  EvidenceItem,
  GroupMembershipEvidence,
  GroupRef,
  IdentityOutcome,
  OfficialActorId,
  OpenBound,
  OrganEvidence,
  OrganTally,
  Resolution,
  ResolutionStatus,
  RunConfig,
  ScrutinAttestationEvidence,
  ScrutinId,
  VotePosition,
} from "./types";

/**
 * Executes a run over in-memory evidence. Pure and deterministic: the same pins, the same
 * configuration and the same prepared inputs give the same output, whatever the order of the
 * inputs and whatever was imported after the pinned snapshots.
 *
 * There is no clock, no randomness and no other source: not the current group, not a profile, not
 * the database. It counts. Whether a count may be shown is `publication.ts`, applied by the caller.
 *
 * ## Trust boundary
 *
 * Two kinds of input reach `executeRun`, and they are not treated alike.
 *
 * 1. The evidence store (memberships, organs, continuity decisions) is read HERE, through the
 *    pins (`stateAt`, `effectiveDecisions`). It is verified: the records at the pinned snapshot
 *    must hash to what they claim, and together to the pinned state hash.
 *
 * 2. The votes, with their identities and attestations, are prepared by the layer that will
 *    assemble a run (phase 5F). This module cannot open a file, a journal or a table, so it cannot
 *    check where they come from. What it does instead:
 *    - the prepared inputs must come with a provenance declaration (`InputProvenance`): which
 *      snapshots the attestations were read from, and which identity decisions were in force;
 *    - the declaration must match the pins exactly (stream, snapshot number, state hash, cutoff),
 *      and the identity decisions it carries must hash, with the continuity decisions of the
 *      store, to the pinned `decisionsHash`;
 *    - the prepared inputs themselves (votes, identities, attestations, bound of open ends) must
 *      hash to the pinned `preparedInputsHash`.
 *
 *    A prepared vote that was changed after the pins were computed, an identity resolved with
 *    another decision, another bound: each makes `checkRunInputs` report a violation and
 *    `executeRun` refuse. A change made BEFORE the pins are computed gives a different
 *    `preparedInputsHash`, so a different run identity: it is a new run, never a replay.
 *
 * What stays trusted, and is the assembling layer's duty: that the declaration is true. The
 * provenance must be built from the very objects the votes were read with, never from constants,
 * and the pins must be computed from the prepared inputs after they are final
 * (`withPreparedInputsHash`). A layer that lies in its declaration cannot be caught here.
 */

export interface EvidenceStore {
  memberships: readonly RecordVersion<GroupMembershipEvidence>[];
  organs: readonly RecordVersion<OrganEvidence>[];
  /** Journal of continuity decisions. The value is the decision as the resolver reads it. */
  continuityJournal: readonly DecisionEntry<ContinuityEvidence>[];
}

export interface RunSpec {
  config: RunConfig;
  pins: RunPins;
  /** Stream of the memberships and organs, as named in `pins.snapshotPins`. */
  evidenceStream: string;
  /** Bound of the open end dates of the pinned evidence snapshot. */
  openBound: OpenBound;
}

export interface RunVoteInput {
  /** Unique within the run. */
  voteId: string;
  identity: IdentityOutcome;
  scrutinId: ScrutinId;
  civilDate: CivilDate;
  legislature: number;
  position: VotePosition;
  /** What the published vote says about this voter. `null` when it is not a published nominal vote. */
  attestation: {
    publishedOrganRef: GroupRef;
    seatMandate: ScrutinAttestationEvidence["seatMandate"];
  } | null;
}

/**
 * What the assembling layer declares it read to prepare the votes. `executeRun` checks it against
 * the pins. It cannot check that it is true (see the trust boundary above).
 */
export interface InputProvenance {
  /** The streams the attestations come from, with the snapshot number read in each. */
  snapshotPins: Readonly<Record<string, number>>;
  /** State hash of each of those snapshots, as recorded. */
  snapshotStateHashes: Readonly<Record<string, string>>;
  /** Highest identity decision number in force when identities were resolved. */
  linkDecisionCutoff: number;
  /** The identity decisions in force at that cutoff, as they were hashed into the pins. */
  linkDecisionsInForce: ReadonlyMap<string, unknown>;
}

export interface PreparedInputs {
  votes: readonly RunVoteInput[];
  provenance: InputProvenance;
}

/** Hash of the prepared votes and of the bound of open ends. Order of the votes does not matter. */
export function computePreparedInputsHash(
  votes: readonly RunVoteInput[],
  openBound: OpenBound
): string {
  const seen = new Set<string>();
  for (const vote of votes) {
    if (seen.has(vote.voteId)) throw new Error(`Duplicate voteId: ${vote.voteId}`);
    seen.add(vote.voteId);
  }
  const ordered = [...votes].sort((a, b) => byText(a.voteId, b.voteId));
  return hashOf({ votes: ordered, openBound });
}

/** The pins of a run, completed with the hash of the prepared inputs they must stay valid for. */
export function withPreparedInputsHash(
  pins: Omit<RunPins, "preparedInputsHash">,
  votes: readonly RunVoteInput[],
  openBound: OpenBound
): RunPins {
  return { ...pins, preparedInputsHash: computePreparedInputsHash(votes, openBound) };
}

/** State hash of the evidence store at a snapshot. The only way a store is compared to a pin. */
export function evidenceStateHash(store: EvidenceStore, seq: number): string {
  return computeStateHash([
    ...stateAt(store.memberships, seq).map((v) => ({
      kind: "membership",
      key: v.key,
      rawHash: v.rawHash,
    })),
    ...stateAt(store.organs, seq).map((v) => ({ kind: "organ", key: v.key, rawHash: v.rawHash })),
  ]);
}

/**
 * Violations of the input contract, as stable codes. Empty when the store and the prepared inputs
 * are the ones the pins designate (within what can be verified, see the trust boundary).
 */
export function checkRunInputs(
  spec: RunSpec,
  store: EvidenceStore,
  inputs: PreparedInputs
): string[] {
  const { pins } = spec;
  const violations: string[] = [];
  const seq = pins.snapshotPins[spec.evidenceStream];
  if (seq === undefined) return [`EVIDENCE_STREAM_NOT_PINNED:${spec.evidenceStream}`];

  if (pins.resolverVersion !== RESOLVER_VERSION) {
    violations.push(`RESOLVER_VERSION_MISMATCH:${pins.resolverVersion}!=${RESOLVER_VERSION}`);
  }

  // The store, at the pinned snapshot: every record is what its hash says, and together they are
  // what the pin says.
  for (const [kind, versions] of [
    ["membership", stateAt(store.memberships, seq)],
    ["organ", stateAt(store.organs, seq)],
  ] as const) {
    for (const version of versions) {
      if (hashOf(version.value) !== version.rawHash) {
        violations.push(`RECORD_HASH_MISMATCH:${kind}:${version.key}`);
      }
    }
  }
  if (evidenceStateHash(store, seq) !== pins.snapshotStateHashes[spec.evidenceStream]) {
    violations.push(`PINNED_STATE_HASH_MISMATCH:${spec.evidenceStream}`);
  }

  // The declaration of the assembling layer, against the pins.
  const { provenance } = inputs;
  const expected = Object.keys(pins.snapshotPins)
    .filter((stream) => stream !== spec.evidenceStream)
    .sort();
  for (const stream of expected) {
    if (provenance.snapshotPins[stream] === undefined) {
      violations.push(`PROVENANCE_STREAM_MISSING:${stream}`);
    }
  }
  for (const stream of Object.keys(provenance.snapshotPins).sort()) {
    if (pins.snapshotPins[stream] === undefined) {
      violations.push(`PROVENANCE_STREAM_NOT_PINNED:${stream}`);
    } else if (provenance.snapshotPins[stream] !== pins.snapshotPins[stream]) {
      violations.push(`PROVENANCE_SNAPSHOT_MISMATCH:${stream}`);
    } else if (provenance.snapshotStateHashes[stream] !== pins.snapshotStateHashes[stream]) {
      violations.push(`PROVENANCE_STATE_HASH_MISMATCH:${stream}`);
    }
  }
  if (provenance.linkDecisionCutoff !== pins.linkDecisionCutoff) {
    violations.push("LINK_CUTOFF_MISMATCH");
  }
  const continuityInForce = effectiveDecisions(
    store.continuityJournal,
    pins.continuityDecisionCutoff
  );
  if (
    hashDecisionsInForce(provenance.linkDecisionsInForce, continuityInForce) !== pins.decisionsHash
  ) {
    violations.push("DECISIONS_HASH_MISMATCH");
  }

  // The prepared inputs themselves.
  if (computePreparedInputsHash(inputs.votes, spec.openBound) !== pins.preparedInputsHash) {
    violations.push("PREPARED_INPUTS_HASH_MISMATCH");
  }
  return violations;
}

export class RunInputContractError extends Error {
  readonly violations: readonly string[];
  constructor(violations: readonly string[]) {
    super(`The run inputs are not the ones the pins designate: ${violations.join(", ")}`);
    this.name = "RunInputContractError";
    this.violations = violations;
  }
}

export interface VoteResult {
  voteId: string;
  scrutinId: string;
  status: ResolutionStatus;
  groupRef: string | null;
  level: AttestationLevel | null;
  reason: string | null;
  candidateRefs: string[];
  viaLink: string | null;
  transitional: boolean | null;
  evidenceKeys: string[];
  /** Flat, sorted description of the diagnostics left on the resolution. */
  diagnostics: string[];
  excludedBy: string | null;
}

export interface RunExclusion {
  voteId: string;
  ruleId: string;
  reason: string;
}

export interface RunOutput {
  results: VoteResult[];
  tallies: OrganTally[];
  exclusions: RunExclusion[];
  statusCounts: Partial<Record<ResolutionStatus, number>>;
  outputHash: string;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function describeDiagnostics(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics
    .flatMap((diagnostic) => [
      ...diagnostic.uncertain.map(
        (r) =>
          `${diagnostic.kind}:${r.sourceRecordId}:${r.groupRef}:${r.reason}:${
            r.couldContradict ? "threat" : "no-threat"
          }`
      ),
      ...diagnostic.withheldCorroboration.map((id) => `E2_CORROBORATION_WITHHELD:${id}`),
    ])
    .sort(byText);
}

function describe(
  vote: RunVoteInput,
  resolution: Resolution,
  excludedByRule: string | null
): VoteResult {
  const base = {
    voteId: vote.voteId,
    scrutinId: vote.scrutinId as string,
    status: resolution.status,
    excludedBy: excludedByRule,
    diagnostics:
      "diagnostics" in resolution ? describeDiagnostics(resolution.diagnostics) : ([] as string[]),
  };
  const keys = (evidence: readonly EvidenceItem[]): string[] =>
    evidence
      .map((e) =>
        e.kind === "MEMBERSHIP" ? `MEMBERSHIP:${e.sourceRecordId}` : `SCRUTIN:${e.scrutinId}`
      )
      .sort(byText);
  switch (resolution.status) {
    case "ATTESTED_GROUP":
      return {
        ...base,
        groupRef: resolution.groupRef,
        level: resolution.level,
        reason: null,
        candidateRefs: [],
        viaLink: resolution.viaLink
          ? `${resolution.viaLink.fromOrganRef}>${resolution.viaLink.toOrganRef}`
          : null,
        transitional: null,
        evidenceKeys: keys(resolution.evidence),
      };
    case "ATTESTED_NON_INSCRIT":
      return {
        ...base,
        groupRef: resolution.groupRef,
        level: resolution.level,
        reason: null,
        candidateRefs: [],
        viaLink: resolution.viaLink
          ? `${resolution.viaLink.fromOrganRef}>${resolution.viaLink.toOrganRef}`
          : null,
        transitional: resolution.transitional,
        evidenceKeys: keys(resolution.evidence),
      };
    case "UNKNOWN":
      return {
        ...base,
        groupRef: null,
        level: null,
        reason: resolution.reason,
        candidateRefs: [],
        viaLink: null,
        transitional: null,
        evidenceKeys: [],
      };
    case "CONFLICT":
      return {
        ...base,
        groupRef: null,
        level: null,
        reason: resolution.kind,
        candidateRefs: resolution.candidates.map((c) => `${c.origin}:${c.groupRef}`).sort(byText),
        viaLink: null,
        transitional: null,
        evidenceKeys: resolution.candidates.flatMap((c) => keys(c.evidence)).sort(byText),
      };
    case "INSUFFICIENT":
      return {
        ...base,
        groupRef: null,
        level: null,
        reason: resolution.reason,
        candidateRefs: [],
        viaLink: null,
        transitional: null,
        evidenceKeys: keys(resolution.evidence),
      };
    case "UNRESOLVED_IDENTITY":
      return {
        ...base,
        groupRef: null,
        level: null,
        reason: resolution.reason,
        candidateRefs: [],
        viaLink: null,
        transitional: null,
        evidenceKeys: [],
      };
  }
}

/** The day the first group organ of a legislature starts, used to qualify transitional `NI`. */
function groupsFormedOn(
  organs: ReadonlyMap<GroupRef, OrganEvidence>,
  legislature: number
): CivilDate | null {
  let formed: CivilDate | null = null;
  for (const organ of organs.values()) {
    if (organ.kind !== "GROUP" || organ.legislature !== legislature || organ.startDate === null) {
      continue;
    }
    if (formed === null || organ.startDate < formed) formed = organ.startDate;
  }
  return formed;
}

export function executeRun(spec: RunSpec, store: EvidenceStore, inputs: PreparedInputs): RunOutput {
  assertValidRunConfig(spec.config);
  const seq = spec.pins.snapshotPins[spec.evidenceStream];
  if (seq === undefined) {
    throw new Error(`The run pins no snapshot of the stream ${spec.evidenceStream}`);
  }
  const violations = checkRunInputs(spec, store, inputs);
  if (violations.length > 0) throw new RunInputContractError(violations);
  const votes = inputs.votes;
  const rules = spec.config.exclusion.rules;
  const resolverConfig = {
    dateSemantics: spec.config.dateSemantics,
    evidence: spec.config.evidence,
    continuity: spec.config.continuity,
  };

  const memberships = stateAt(store.memberships, seq).map((v) => v.value);
  const organs = new Map<GroupRef, OrganEvidence>(
    stateAt(store.organs, seq).map((v) => [v.value.groupRef, v.value])
  );
  const continuity = [
    ...effectiveDecisions(store.continuityJournal, spec.pins.continuityDecisionCutoff),
  ]
    .sort(([a], [b]) => byText(a, b))
    .map(([, value]) => value);

  const byActor = new Map<OfficialActorId, GroupMembershipEvidence[]>();
  for (const record of memberships) {
    const list = byActor.get(record.officialId) ?? [];
    list.push(record);
    byActor.set(record.officialId, list);
  }
  const formed = new Map<number, CivilDate | null>();

  const seen = new Set<string>();
  const ordered = [...votes].sort((a, b) => byText(a.voteId, b.voteId));
  const results: VoteResult[] = [];
  const exclusions: RunExclusion[] = [];
  const tallies = new Map<string, OrganTally>();
  const statusCounts: Partial<Record<ResolutionStatus, number>> = {};

  for (const vote of ordered) {
    if (seen.has(vote.voteId)) throw new Error(`Duplicate voteId: ${vote.voteId}`);
    seen.add(vote.voteId);

    const officialId = vote.identity.status === "RESOLVED" ? vote.identity.officialId : null;
    if (!formed.has(vote.legislature)) {
      formed.set(vote.legislature, groupsFormedOn(organs, vote.legislature));
    }
    const resolution = resolveGroupAtDate({
      chamber: "AN",
      identity: vote.identity,
      civilDate: vote.civilDate,
      legislature: vote.legislature,
      memberships: officialId === null ? [] : (byActor.get(officialId) ?? []),
      organs,
      scrutin:
        officialId !== null && vote.attestation !== null
          ? {
              scrutinId: vote.scrutinId,
              officialId,
              publishedOrganRef: vote.attestation.publishedOrganRef,
              seatMandate: vote.attestation.seatMandate,
            }
          : null,
      continuity,
      openBound: spec.openBound,
      legislatureGroupsFormedOn: formed.get(vote.legislature) ?? null,
      config: resolverConfig,
    });

    const exclusion = excludedBy(resolution, rules);
    results.push(describe(vote, resolution, exclusion?.ruleId ?? null));
    statusCounts[resolution.status] = (statusCounts[resolution.status] ?? 0) + 1;

    // The bucket of a vote: its attested organ, or the organ the scrutin listed it under.
    const groupRef: GroupRef | null =
      resolution.status === "ATTESTED_GROUP" || resolution.status === "ATTESTED_NON_INSCRIT"
        ? resolution.groupRef
        : (vote.attestation?.publishedOrganRef ?? null);
    const bucketKey = JSON.stringify([vote.scrutinId, groupRef]);
    let tally = tallies.get(bucketKey);
    if (!tally) {
      tally = {
        scrutinId: vote.scrutinId,
        groupRef,
        organKind: groupRef === null ? null : (organs.get(groupRef)?.kind ?? null),
        forCount: 0,
        againstCount: 0,
        abstainCount: 0,
        nonVoterCount: 0,
        excludedCount: 0,
        excludedByReason: {},
      };
      tallies.set(bucketKey, tally);
    }
    if (exclusion) {
      tally.excludedCount += 1;
      tally.excludedByReason[exclusion.reason] =
        (tally.excludedByReason[exclusion.reason] ?? 0) + 1;
      exclusions.push({ voteId: vote.voteId, ruleId: exclusion.ruleId, reason: exclusion.reason });
    } else if (vote.position === "POUR") tally.forCount += 1;
    else if (vote.position === "CONTRE") tally.againstCount += 1;
    else if (vote.position === "ABSTENTION") tally.abstainCount += 1;
    else tally.nonVoterCount += 1;
  }

  const sortedTallies = [...tallies.values()].sort((a, b) =>
    byText(`${a.scrutinId}|${a.groupRef ?? ""}`, `${b.scrutinId}|${b.groupRef ?? ""}`)
  );
  return {
    results,
    tallies: sortedTallies,
    exclusions,
    statusCounts,
    outputHash: hashOf({ results, tallies: sortedTallies, exclusions }),
  };
}
