import { coverageAt, DATE_SEMANTICS_V1, isEdgeDay } from "./date-semantics";
import type {
  AttestationLevel,
  Candidate,
  Chamber,
  CivilDate,
  ContinuityEvidence,
  EvidenceItem,
  GroupMembershipEvidence,
  GroupRef,
  IdentityOutcome,
  InsufficientReason,
  OpenBound,
  OrganEvidence,
  Resolution,
  ResolverConfig,
  ScrutinAttestationEvidence,
  ViaLink,
} from "./types";

/**
 * `resolveGroupAtDate`: which group a person sat in on a given day, with the proof.
 *
 * Pure: it receives the evidence already loaded and reads nothing else. There is no fallback of
 * any kind: no current group, no neighbouring interval, no group guessed from an acronym. When the
 * evidence does not settle the question, the answer says so (`UNKNOWN`, `CONFLICT`,
 * `INSUFFICIENT`) and gives the reason.
 *
 * Two independent kinds of evidence, in order of authority (architecture doc, section 5):
 * - E1, the scrutin attestation: the group the institution listed the voter under, for that vote.
 * - E2, the membership intervals: periods, corrected afterwards by the source, bounds not defined.
 *
 * This module never decides whether anything is published. That is `publication.ts`.
 */

export interface ResolveInput {
  chamber: Chamber;
  identity: IdentityOutcome;
  civilDate: CivilDate;
  /** Legislature of the day asked for. `null`: records are not filtered by legislature. */
  legislature: number | null;
  /** Records of any person: the resolver keeps those of the person, of the chamber. */
  memberships: readonly GroupMembershipEvidence[];
  organs: ReadonlyMap<GroupRef, OrganEvidence>;
  /** E1 for this person and this vote, when the vote is a published nominal vote. */
  scrutin: ScrutinAttestationEvidence | null;
  /** Decisions in force for the run (journal already cut at the run's cutoff). */
  continuity: readonly ContinuityEvidence[];
  openBound: OpenBound;
  /** Day the groups of the legislature were formed, when known. Only used to qualify `NI`. */
  legislatureGroupsFormedOn: CivilDate | null;
  config: ResolverConfig;
}

type UncertainReason = Exclude<InsufficientReason, "PO0" | "EDGE_DAY">;

/** When several records are undecidable, the reason reported is the first of this list. */
const UNCERTAIN_PRIORITY: readonly UncertainReason[] = [
  "UNKNOWN_ORGAN",
  "START_DATE_UNKNOWN",
  "END_STATE_UNKNOWN",
  "OPEN_BEYOND_SNAPSHOT",
];

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function membershipItem(record: GroupMembershipEvidence): EvidenceItem {
  return {
    kind: "MEMBERSHIP",
    sourceRecordId: record.sourceRecordId,
    groupRef: record.groupRef,
    startDate: record.startDate,
    endDate: record.endDate,
    endState: record.endState,
  };
}

function membershipItems(records: readonly GroupMembershipEvidence[]): EvidenceItem[] {
  return [...records]
    .sort((a, b) => byText(a.sourceRecordId, b.sourceRecordId))
    .map(membershipItem);
}

function scrutinItem(scrutin: ScrutinAttestationEvidence): EvidenceItem {
  return {
    kind: "SCRUTIN_ATTESTATION",
    scrutinId: scrutin.scrutinId,
    publishedOrganRef: scrutin.publishedOrganRef,
  };
}

/**
 * Two organ references can be read as the same group only through a VALIDATED
 * `RENAMED_SAME_GROUP` decision, inside one legislature, between two organs of the same kind. A
 * validated `NOT_RELATED` decision on the same pair always wins. A shared acronym proves nothing.
 */
function findReconciliation(a: GroupRef, b: GroupRef, input: ResolveInput): ViaLink | null {
  const pair = input.continuity.filter(
    (c) =>
      c.status === "VALIDATED" &&
      ((c.fromOrganRef === a && c.toOrganRef === b) || (c.fromOrganRef === b && c.toOrganRef === a))
  );
  if (pair.some((c) => c.relation === "NOT_RELATED")) return null;

  const organA = input.organs.get(a);
  const organB = input.organs.get(b);
  if (!organA || !organB || organA.kind !== organB.kind) return null;
  if (
    input.config.continuity.sameLegislatureOnly &&
    (organA.legislature === null || organA.legislature !== organB.legislature)
  ) {
    return null;
  }

  const allowed = new Set<string>(input.config.continuity.relations);
  const renamed = pair
    .filter((c) => c.relation === "RENAMED_SAME_GROUP" && allowed.has(c.relation))
    .sort((x, y) =>
      byText(`${x.fromOrganRef}|${x.toOrganRef}`, `${y.fromOrganRef}|${y.toOrganRef}`)
    )[0];
  if (!renamed) return null;
  return {
    fromOrganRef: renamed.fromOrganRef,
    toOrganRef: renamed.toOrganRef,
    relation: "RENAMED_SAME_GROUP",
  };
}

function transitionalFor(
  records: readonly GroupMembershipEvidence[],
  formedOn: CivilDate | null
): boolean | null {
  if (records.length === 0 || formedOn === null) return null;
  return records.every(
    (r) => r.endState === "DATED" && r.endDate !== null && r.endDate <= formedOn
  );
}

function attested(
  input: ResolveInput,
  groupRef: GroupRef,
  level: AttestationLevel,
  evidence: EvidenceItem[],
  viaLink: ViaLink | null,
  intervalRecords: readonly GroupMembershipEvidence[]
): Resolution {
  const organ = input.organs.get(groupRef);
  if (organ?.kind === "NON_INSCRIT") {
    return {
      status: "ATTESTED_NON_INSCRIT",
      groupRef,
      level,
      evidence,
      viaLink,
      transitional: transitionalFor(intervalRecords, input.legislatureGroupsFormedOn),
    };
  }
  return { status: "ATTESTED_GROUP", groupRef, level, evidence, viaLink };
}

export function resolveGroupAtDate(input: ResolveInput): Resolution {
  if (input.identity.status === "UNRESOLVED") {
    return { status: "UNRESOLVED_IDENTITY", reason: input.identity.reason };
  }
  const officialId = input.identity.officialId;

  if (input.config.dateSemantics.version !== DATE_SEMANTICS_V1) {
    throw new Error(`Unknown date semantics: ${String(input.config.dateSemantics.version)}`);
  }
  if (input.scrutin && input.scrutin.officialId !== officialId) {
    throw new Error("The scrutin attestation belongs to another person");
  }
  const date = input.civilDate;

  // The person's records, in the chamber and the legislature asked for. Nothing else is read.
  const relevant = input.memberships.filter(
    (m) =>
      m.officialId === officialId &&
      m.chamber === input.chamber &&
      (input.legislature === null || m.legislature === null || m.legislature === input.legislature)
  );

  const inRecords: GroupMembershipEvidence[] = [];
  const uncertain: { record: GroupMembershipEvidence; reason: UncertainReason }[] = [];
  for (const record of relevant) {
    const coverage = coverageAt(record, date, input.openBound);
    if (coverage.kind === "OUT") continue;
    if (!input.organs.has(record.groupRef)) {
      uncertain.push({ record, reason: "UNKNOWN_ORGAN" });
    } else if (coverage.kind === "IN") {
      inRecords.push(record);
    } else {
      uncertain.push({ record, reason: coverage.reason });
    }
  }

  const byRef = new Map<GroupRef, GroupMembershipEvidence[]>();
  for (const record of inRecords) {
    const list = byRef.get(record.groupRef) ?? [];
    list.push(record);
    byRef.set(record.groupRef, list);
  }
  const refs = [...byRef.keys()].sort(byText) as GroupRef[];
  const intervalCandidates: Candidate[] = refs.map((ref) => ({
    groupRef: ref,
    origin: "INTERVAL",
    evidence: membershipItems(byRef.get(ref) as GroupMembershipEvidence[]),
  }));

  if (input.scrutin) {
    const scrutin = input.scrutin;
    const published = scrutin.publishedOrganRef;
    const e1 = scrutinItem(scrutin);
    const e1Candidate: Candidate = { groupRef: published, origin: "SCRUTIN", evidence: [e1] };

    // A filler is not an organ: nothing else is used to settle the vote.
    if (input.config.evidence.placeholderOrganRefs.includes(published)) {
      return { status: "INSUFFICIENT", reason: "PO0", evidence: [e1] };
    }
    if (!input.organs.has(published)) {
      return { status: "INSUFFICIENT", reason: "UNKNOWN_ORGAN", evidence: [e1] };
    }

    const seat = scrutin.seatMandate;
    if (
      seat !== null &&
      ((seat.startDate !== null && date < seat.startDate) ||
        (seat.endDate !== null && date > seat.endDate))
    ) {
      return { status: "CONFLICT", kind: "SEAT_MISMATCH", candidates: [e1Candidate] };
    }

    if (refs.length >= 2) {
      return {
        status: "CONFLICT",
        kind: "MULTIPLE_ORGANS",
        candidates: [e1Candidate, ...intervalCandidates],
      };
    }
    if (refs.length === 1) {
      const ref = refs[0] as GroupRef;
      const records = byRef.get(ref) as GroupMembershipEvidence[];
      const evidence = [e1, ...membershipItems(records)];
      if (ref === published) return attested(input, published, "BOTH", evidence, null, records);
      const viaLink = findReconciliation(published, ref, input);
      if (viaLink) return attested(input, published, "BOTH", evidence, viaLink, records);
      return {
        status: "CONFLICT",
        kind: "SOURCES_DISAGREE",
        candidates: [e1Candidate, ...intervalCandidates],
      };
    }
    // No interval at all: the attestation stands alone, with its weaker level.
    return attested(input, published, "SCRUTIN_ONLY", [e1], null, []);
  }

  // No attestation: intervals only.
  if (uncertain.length > 0) {
    const reasons = new Set(uncertain.map((u) => u.reason));
    const reason = UNCERTAIN_PRIORITY.find((r) => reasons.has(r)) as UncertainReason;
    return {
      status: "INSUFFICIENT",
      reason,
      evidence: membershipItems([...inRecords, ...uncertain.map((u) => u.record)]),
    };
  }
  if (refs.length === 0) return { status: "UNKNOWN", reason: "NO_RECORD" };
  if (refs.length >= 2) {
    return { status: "CONFLICT", kind: "MULTIPLE_ORGANS", candidates: intervalCandidates };
  }
  const ref = refs[0] as GroupRef;
  const records = byRef.get(ref) as GroupMembershipEvidence[];
  if (isEdgeDay(relevant, date)) {
    return { status: "INSUFFICIENT", reason: "EDGE_DAY", evidence: membershipItems(records) };
  }
  return attested(input, ref, "INTERVAL_ONLY", membershipItems(records), null, records);
}
