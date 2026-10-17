/**
 * Business types of the historical group resolution (lot 5).
 *
 * Pure data shapes. Nothing here mirrors a table, a column or a storage key: how evidence is
 * stored is decided later (phase 5B). This module only states what a piece of evidence says, what
 * a resolution may answer, and what a run pins.
 *
 * Doctrine, in code form:
 * - A resolution never falls back on the current group of a person.
 * - An absence of record is `UNKNOWN`, never a non-registration.
 * - A resolution that cannot be trusted is `CONFLICT` or `INSUFFICIENT`, never a guess.
 *
 * Reference: docs/audits/parlement-historique-lot5-architecture-v2.md
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Official identifier of a person in the institution's data (AN `acteurRef`, Senate matricule). */
export type OfficialActorId = Brand<string, "OfficialActorId">;
/** Official reference of a group as published (AN `organeRef`, Senate group code). */
export type GroupRef = Brand<string, "GroupRef">;
export type ScrutinId = Brand<string, "ScrutinId">;
/** A calendar day, `YYYY-MM-DD`, no time, no time zone. Built by `civil-date.ts` only. */
export type CivilDate = Brand<string, "CivilDate">;

function nonEmpty<T extends string>(value: string, label: string): T {
  if (value.trim() === "" || value !== value.trim()) {
    throw new Error(`${label} must be a non-empty string without surrounding spaces`);
  }
  return value as T;
}

export const asOfficialActorId = (value: string): OfficialActorId =>
  nonEmpty<OfficialActorId>(value, "OfficialActorId");
export const asGroupRef = (value: string): GroupRef => nonEmpty<GroupRef>(value, "GroupRef");
export const asScrutinId = (value: string): ScrutinId => nonEmpty<ScrutinId>(value, "ScrutinId");

export type Chamber = "AN" | "SENAT";

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export type StartState = "DATED" | "UNKNOWN";
/**
 * - `DATED`: the source gives an end date.
 * - `OPEN_AT_SNAPSHOT`: the source gives no end date in the file that was read. Valid up to the
 *   date of that file (see `OpenBound`), unknown beyond. Not "current".
 * - `UNKNOWN`: the source does not allow to say whether the membership is open.
 */
export type EndState = "DATED" | "OPEN_AT_SNAPSHOT" | "UNKNOWN";

/** One membership record of a person in a group organ, as the source published it. */
export interface GroupMembershipEvidence {
  sourceRecordId: string;
  officialId: OfficialActorId;
  chamber: Chamber;
  groupRef: GroupRef;
  /** As published, never read from an identifier. */
  legislature: number | null;
  qualityCode: string | null;
  isPrincipal: boolean | null;
  startDate: CivilDate | null;
  startState: StartState;
  endDate: CivilDate | null;
  endState: EndState;
}

export type OrganKind = "GROUP" | "NON_INSCRIT";

/** An organ as the referential describes it. The kind is decided at parsing time, not here. */
export interface OrganEvidence {
  groupRef: GroupRef;
  kind: OrganKind;
  legislature: number | null;
  label: string;
  startDate: CivilDate | null;
}

/** What a published nominal vote says about the group its voter is listed under. */
export interface ScrutinAttestationEvidence {
  scrutinId: ScrutinId;
  officialId: OfficialActorId;
  /** As published, including placeholders. */
  publishedOrganRef: GroupRef;
  /** Dates of the seat mandate the voter voted under, when the source gives it. */
  seatMandate: { startDate: CivilDate | null; endDate: CivilDate | null } | null;
}

export const CONTINUITY_RELATIONS = [
  "RENAMED_SAME_GROUP",
  "SUCCESSOR",
  "SPLIT",
  "MERGED",
  "EDITORIAL_CONTINUITY",
  "NOT_RELATED",
] as const;
export type ContinuityRelation = (typeof CONTINUITY_RELATIONS)[number];

/** A manual decision about two organs, as it applies to a run (already filtered by cutoff). */
export interface ContinuityEvidence {
  fromOrganRef: GroupRef;
  toOrganRef: GroupRef;
  relation: ContinuityRelation;
  status: "PROPOSED" | "VALIDATED" | "REJECTED";
}

/** Where the "open" end date of a record stops being asserted. */
export interface OpenBound {
  date: CivilDate;
  /** `SOURCE_AS_OF`: last modification of the file on the server. `FETCHED_AT`: the day it was read. */
  source: "SOURCE_AS_OF" | "FETCHED_AT";
}

// ---------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------

export const INSUFFICIENT_REASONS = [
  "PO0",
  "UNKNOWN_ORGAN",
  "EDGE_DAY",
  "START_DATE_UNKNOWN",
  "END_STATE_UNKNOWN",
  "OPEN_BEYOND_SNAPSHOT",
] as const;
export type InsufficientReason = (typeof INSUFFICIENT_REASONS)[number];

export const IDENTITY_GAPS = ["NO_OFFICIAL_ID", "AMBIGUOUS_LINK", "NO_LINK"] as const;
export type IdentityGap = (typeof IDENTITY_GAPS)[number];

export type ConflictKind = "SOURCES_DISAGREE" | "MULTIPLE_ORGANS" | "SEAT_MISMATCH";

/** Every reason a vote can be left out of a computation. A run config must cover all of them. */
export const EXCLUSION_REASONS = [
  "NO_RECORD",
  "CONFLICT",
  ...INSUFFICIENT_REASONS,
  ...IDENTITY_GAPS,
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type EvidenceItem =
  | { kind: "SCRUTIN_ATTESTATION"; scrutinId: ScrutinId; publishedOrganRef: GroupRef }
  | {
      kind: "MEMBERSHIP";
      sourceRecordId: string;
      groupRef: GroupRef;
      startDate: CivilDate | null;
      endDate: CivilDate | null;
      endState: EndState;
    };

export interface Candidate {
  groupRef: GroupRef;
  origin: "SCRUTIN" | "INTERVAL";
  evidence: EvidenceItem[];
}

/** How strong the proof is. `BOTH` is the only level where two independent sources agree. */
export type AttestationLevel = "BOTH" | "SCRUTIN_ONLY" | "INTERVAL_ONLY";

/** A validated manual decision that let two organ references be read as the same group. */
export interface ViaLink {
  fromOrganRef: GroupRef;
  toOrganRef: GroupRef;
  relation: "RENAMED_SAME_GROUP";
}

export type IdentityOutcome =
  | { status: "RESOLVED"; officialId: OfficialActorId }
  | { status: "UNRESOLVED"; reason: IdentityGap };

export type Resolution =
  | {
      status: "ATTESTED_GROUP";
      groupRef: GroupRef;
      level: AttestationLevel;
      evidence: EvidenceItem[];
      viaLink: ViaLink | null;
    }
  | {
      status: "ATTESTED_NON_INSCRIT";
      groupRef: GroupRef;
      level: AttestationLevel;
      evidence: EvidenceItem[];
      viaLink: ViaLink | null;
      /**
       * `true`: the registration ended before the groups of the legislature were formed.
       * `false`: it did not. `null`: cannot be said (no registration record, or no formation date).
       */
      transitional: boolean | null;
    }
  | { status: "UNKNOWN"; reason: "NO_RECORD" }
  | { status: "CONFLICT"; kind: ConflictKind; candidates: Candidate[] }
  | { status: "INSUFFICIENT"; reason: InsufficientReason; evidence: EvidenceItem[] }
  | { status: "UNRESOLVED_IDENTITY"; reason: IdentityGap };

export type ResolutionStatus = Resolution["status"];

export function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
}

// ---------------------------------------------------------------------------
// Configuration of a run
// ---------------------------------------------------------------------------

export interface DateSemanticsConfig {
  version: "v1";
  interval: "closed";
  edgeDayWithoutScrutin: "INSUFFICIENT";
}

export interface EvidenceConfig {
  /** Published organ references that are fillers, not organs. Sorted, unique. */
  placeholderOrganRefs: readonly string[];
}

export interface ContinuityConfig {
  /** Which validated relations may reconcile two organ references. */
  relations: readonly "RENAMED_SAME_GROUP"[];
  sameLegislatureOnly: true;
}

export interface ExclusionRule {
  id: string;
  reasons: readonly ExclusionReason[];
  action: "EXCLUDE";
}

export interface ExclusionConfig {
  version: string;
  rules: readonly ExclusionRule[];
}

/** Editorial thresholds. Kept apart from the resolution: they never change what a vote resolves to. */
export interface PublicationConfig {
  maxExcludedPerGroup: number;
}

export interface RunConfig {
  dateSemantics: DateSemanticsConfig;
  evidence: EvidenceConfig;
  continuity: ContinuityConfig;
  exclusion: ExclusionConfig;
  /** Legislatures the run covers. Sorted, unique. */
  scope: { legislatures: readonly number[] };
  publication: PublicationConfig;
}

/** The part of the configuration the resolver reads. */
export type ResolverConfig = Pick<RunConfig, "dateSemantics" | "evidence" | "continuity">;

// ---------------------------------------------------------------------------
// Tallies
// ---------------------------------------------------------------------------

export type VotePosition = "POUR" | "CONTRE" | "ABSTENTION" | "NON_VOTANT";

/** What a run counted for one organ in one scrutin. Not a publication decision. */
export interface OrganTally {
  scrutinId: ScrutinId;
  /** Attested organ, or the published organ for votes left out. `null`: nothing was published. */
  groupRef: GroupRef | null;
  organKind: OrganKind | null;
  forCount: number;
  againstCount: number;
  abstainCount: number;
  nonVoterCount: number;
  excludedCount: number;
  excludedByReason: Partial<Record<ExclusionReason, number>>;
}
