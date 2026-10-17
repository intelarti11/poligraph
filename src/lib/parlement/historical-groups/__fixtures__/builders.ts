/**
 * Builders and reference data of the synthetic scenario (see `scenario.ts` for the scenario).
 *
 * Everything here is invented: identifiers (`PA_T01`, `PO_G1`), dates and groups. No real person,
 * no real record.
 */
import { civilDate } from "../civil-date";
import {
  asGroupRef,
  asOfficialActorId,
  type ContinuityEvidence,
  type GroupMembershipEvidence,
  type GroupRef,
  type IdentityOutcome,
  type OpenBound,
  type OrganEvidence,
} from "../types";

export const d = civilDate;
export const ref = asGroupRef;
export const actor = asOfficialActorId;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** `end`: a date, `"OPEN"` (no end date in the file) or `"UNKNOWN"`. `start`: a date or `null`. */
export function membership(
  sourceRecordId: string,
  officialId: string,
  groupRef: string,
  start: string | null,
  end: string,
  overrides: Partial<GroupMembershipEvidence> = {}
): GroupMembershipEvidence {
  return {
    sourceRecordId,
    officialId: actor(officialId),
    chamber: "AN",
    groupRef: ref(groupRef),
    legislature: 16,
    qualityCode: "Membre",
    isPrincipal: true,
    startDate: start === null ? null : d(start),
    startState: start === null ? "UNKNOWN" : "DATED",
    endDate: end === "OPEN" || end === "UNKNOWN" ? null : d(end),
    endState: end === "OPEN" ? "OPEN_AT_SNAPSHOT" : end === "UNKNOWN" ? "UNKNOWN" : "DATED",
    ...overrides,
  };
}

export function organ(
  groupRef: string,
  kind: OrganEvidence["kind"],
  legislature: number | null,
  startDate: string | null,
  label = groupRef
): OrganEvidence {
  return {
    groupRef: ref(groupRef),
    kind,
    legislature,
    label,
    startDate: startDate === null ? null : d(startDate),
  };
}

export const resolved = (id: string): IdentityOutcome => ({
  status: "RESOLVED",
  officialId: actor(id),
});

export const OPEN_BOUND: OpenBound = { date: d("2026-10-17"), source: "SOURCE_AS_OF" };

export function organMap(organs: readonly OrganEvidence[]): Map<GroupRef, OrganEvidence> {
  return new Map(organs.map((o) => [o.groupRef, o]));
}

export const ORGANS: OrganEvidence[] = [
  organ("PO_NI", "NON_INSCRIT", 16, "2022-06-22", "Non-inscrits"),
  organ("PO_G1", "GROUP", 16, "2022-06-28", "Groupe un"),
  organ("PO_G2", "GROUP", 16, "2022-06-28", "Groupe deux"),
  // The reference the scrutins use for the second group after a renaming.
  organ("PO_G2B", "GROUP", 16, "2023-10-19", "Groupe deux"),
  organ("PO_G3", "GROUP", 16, "2022-06-28", "Groupe trois"),
  // Same label as PO_G1, another legislature: a homonym, not the same group.
  organ("PO_X1", "GROUP", 17, "2024-07-18", "Groupe un"),
];

/** The decision that makes the two references of the second group the same group. */
export const CONTINUITY_DECISION: ContinuityEvidence = {
  fromOrganRef: ref("PO_G2"),
  toOrganRef: ref("PO_G2B"),
  relation: "RENAMED_SAME_GROUP",
  status: "VALIDATED",
};
