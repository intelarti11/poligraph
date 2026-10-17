import { hashOf } from "./canonical";
import { excludedBy } from "./exclusion";
import { resolveGroupAtDate } from "./resolver";
import { assertValidRunConfig, type RunPins } from "./run-contract";
import { effectiveDecisions, stateAt, type DecisionEntry, type RecordVersion } from "./versioning";
import type {
  AttestationLevel,
  CivilDate,
  ContinuityEvidence,
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
 * configuration and the same votes give the same output, whatever the order of the inputs and
 * whatever was imported after the pinned snapshot.
 *
 * It reads the evidence only through the pins (`stateAt`, `effectiveDecisions`). There is no clock,
 * no randomness and no other source: not the current group, not a profile, not the database.
 *
 * It counts. Whether a count may be shown is `publication.ts`, applied by the caller.
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

export function executeRun(
  spec: RunSpec,
  store: EvidenceStore,
  votes: readonly RunVoteInput[]
): RunOutput {
  assertValidRunConfig(spec.config);
  const seq = spec.pins.snapshotPins[spec.evidenceStream];
  if (seq === undefined) {
    throw new Error(`The run pins no snapshot of the stream ${spec.evidenceStream}`);
  }
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
