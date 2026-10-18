import { hashOf } from "./canonical";
import { classifyGroupOrgans, type GroupOrganRecord } from "./parse-amo30";
import type {
  GroupMembershipRow,
  OfficialOrganRow,
  ScrutinAttestationRow,
  SeatMandateRow,
} from "./rows";
import type { EvidenceStore, RunVoteInput } from "./run-execution";
import type { RecordVersion } from "./versioning";
import {
  asGroupRef,
  asScrutinId,
  type GroupMembershipEvidence,
  type OrganEvidence,
  type VotePosition,
} from "./types";

/**
 * From stored rows to the inputs of a run (lot 5D, PR B). Pure: it reads nothing, it only turns rows
 * that the database layer has already read and verified into the shapes `executeRun` takes.
 *
 * What it adds, and what it refuses:
 * - The kind of an organ (`GROUP` or `NON_INSCRIT`) is not stored. It is recomputed here by the same
 *   classification the parsers use, from the organs and the memberships of the pinned snapshot. An
 *   organ the classification cannot place has no kind, so it is left out of the evidence: a vote that
 *   names it resolves as an unknown organ, never as a guess.
 * - The identity of a vote is the official actor of the attestation. No profile, no name: the run
 *   works on the evidence alone.
 * - A vote that points at a seat mandate which is not there, or belongs to another actor, stops the
 *   assembly: the architecture counts such a case as zero, so one appearing is a defect of the data
 *   or of the import, not something to absorb.
 *
 * The hash of a record in the store (`rawHash`) is the hash of the evidence value the resolver
 * reads. It is not the database `rawHash`, which hashes the stored row: that one is checked by the
 * verification of the snapshot, and the pin of the database state is declared by the caller.
 */

export interface AssembledEvidence {
  store: EvidenceStore;
  /** Organs the classification could not place (kept out of the store). */
  unclassifiedOrgans: string[];
}

export function buildEvidenceStore(input: {
  seq: number;
  organs: readonly OfficialOrganRow[];
  memberships: readonly GroupMembershipRow[];
}): AssembledEvidence {
  const evidence: GroupMembershipEvidence[] = input.memberships.map((m) => ({
    sourceRecordId: m.sourceRecordId,
    officialId: m.officialId as GroupMembershipEvidence["officialId"],
    chamber: m.chamber,
    groupRef: asGroupRef(m.groupRef),
    legislature: m.legislature,
    qualityCode: m.qualityCode,
    isPrincipal: m.isPrincipal,
    startDate: m.startDate,
    startState: m.startState,
    endDate: m.endDate,
    endState: m.endState,
  }));
  const records: GroupOrganRecord[] = input.organs.map((o) => ({
    groupRef: asGroupRef(o.organeRef),
    legislature: o.legislature,
    label: o.label,
    abbreviation: o.abbreviation,
    startDate: o.startDate,
    endDate: o.endDate,
  }));
  const organs: RecordVersion<OrganEvidence>[] = [];
  const unclassifiedOrgans: string[] = [];
  for (const classified of classifyGroupOrgans(records, evidence)) {
    if (classified.kind === null) {
      unclassifiedOrgans.push(classified.organ.groupRef);
      continue;
    }
    const value: OrganEvidence = {
      groupRef: classified.organ.groupRef,
      kind: classified.kind,
      legislature: classified.organ.legislature,
      label: classified.organ.label,
      startDate: classified.organ.startDate,
    };
    organs.push({
      key: value.groupRef,
      fromSeq: input.seq,
      toSeq: null,
      rawHash: hashOf(value),
      value,
    });
  }
  const memberships: RecordVersion<GroupMembershipEvidence>[] = evidence.map((value) => ({
    key: value.sourceRecordId,
    fromSeq: input.seq,
    toSeq: null,
    rawHash: hashOf(value),
    value,
  }));
  return {
    store: { memberships, organs, continuityJournal: [] },
    unclassifiedOrgans: unclassifiedOrgans.sort(),
  };
}

const POSITION: Record<ScrutinAttestationRow["publishedPosition"], VotePosition> = {
  pour: "POUR",
  contre: "CONTRE",
  abstention: "ABSTENTION",
  nonVotant: "NON_VOTANT",
};

export class SeatMandateRefError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`seat mandates: ${problems.length} attestation(s) point at no usable mandate`);
    this.name = "SeatMandateRefError";
  }
}

export function voteIdOf(scrutinExternalId: string, officialId: string): string {
  return `${scrutinExternalId}|${officialId}`;
}

/** One vote per attestation, in the order given. Stops on a seat mandate reference that does not hold. */
export function buildVote(
  attestation: ScrutinAttestationRow,
  seats: ReadonlyMap<string, SeatMandateRow>
): RunVoteInput {
  let seatMandate: {
    startDate: SeatMandateRow["startDate"];
    endDate: SeatMandateRow["endDate"];
  } | null = null;
  if (attestation.seatMandateRef !== null) {
    const seat = seats.get(attestation.seatMandateRef);
    if (!seat || seat.officialId !== attestation.officialId) {
      throw new SeatMandateRefError([
        `${attestation.scrutinExternalId}|${attestation.officialId}: ${attestation.seatMandateRef}`,
      ]);
    }
    seatMandate = { startDate: seat.startDate, endDate: seat.endDate };
  }
  return {
    voteId: voteIdOf(attestation.scrutinExternalId, attestation.officialId),
    identity: {
      status: "RESOLVED",
      officialId: attestation.officialId as GroupMembershipEvidence["officialId"],
    },
    scrutinId: asScrutinId(attestation.scrutinExternalId),
    civilDate: attestation.scrutinDate,
    legislature: attestation.legislature,
    position: POSITION[attestation.publishedPosition],
    attestation: { publishedOrganRef: asGroupRef(attestation.publishedOrganRef), seatMandate },
  };
}
