import { hashOf } from "./canonical";
import { validateExclusionRules } from "./exclusion";
import { DATE_SEMANTICS_V1 } from "./date-semantics";
import type { RunConfig } from "./types";

/**
 * What a run pins, and when a run may start.
 *
 * A run is a computation whose inputs are designated by snapshot number and decision cutoff,
 * never by "the current state". Two runs with the same pins and the same configuration must give
 * the same result. This file holds the identity of a run (`inputHash`), the checks before it
 * starts, and the status it derives afterwards. It stores nothing.
 */

/**
 * Version of the resolution logic. Bump it on ANY change of what a resolution can answer. The
 * reference test (`golden.ts`) fails when the logic changes without a new entry.
 */
export const RESOLVER_VERSION = "1";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** The configuration of the first runs, as written in the architecture document. */
export function defaultRunConfig(legislatures: readonly number[]): RunConfig {
  return {
    dateSemantics: { version: "v1", interval: "closed", edgeDayWithoutScrutin: "INSUFFICIENT" },
    evidence: { placeholderOrganRefs: ["PO0"] },
    continuity: { relations: ["RENAMED_SAME_GROUP"], sameLegislatureOnly: true },
    exclusion: {
      version: "1",
      rules: [
        {
          id: "PUBLISHED_ORGAN_UNKNOWN",
          reasons: ["PO0", "UNKNOWN_ORGAN"],
          action: "EXCLUDE",
        },
        { id: "SOURCES_DISAGREE", reasons: ["CONFLICT"], action: "EXCLUDE" },
        { id: "EDGE_DAY_NO_SCRUTIN", reasons: ["EDGE_DAY"], action: "EXCLUDE" },
        {
          id: "DATE_UNDETERMINED",
          reasons: ["START_DATE_UNKNOWN", "END_STATE_UNKNOWN"],
          action: "EXCLUDE",
        },
        { id: "OPEN_BEYOND_SNAPSHOT", reasons: ["OPEN_BEYOND_SNAPSHOT"], action: "EXCLUDE" },
        { id: "NO_RECORD", reasons: ["NO_RECORD"], action: "EXCLUDE" },
        {
          id: "IDENTITY_UNRESOLVED",
          reasons: ["NO_OFFICIAL_ID", "AMBIGUOUS_LINK", "NO_LINK"],
          action: "EXCLUDE",
        },
      ],
    },
    scope: { legislatures: [...legislatures].sort((a, b) => a - b) },
    publication: { maxExcludedPerGroup: 0 },
  };
}

function isSortedUnique<T extends string | number>(values: readonly T[]): boolean {
  return values.every((value, i) => i === 0 || (values[i - 1] as T) < value);
}

/** Problems of a configuration. Empty when it can be used for a run. */
export function validateRunConfig(config: RunConfig): string[] {
  const issues: string[] = [];
  const { dateSemantics, evidence, continuity, exclusion, scope, publication } = config;

  if (dateSemantics.version !== DATE_SEMANTICS_V1) issues.push("dateSemantics.version must be v1");
  if (dateSemantics.interval !== "closed") issues.push("dateSemantics.interval must be closed");
  if (dateSemantics.edgeDayWithoutScrutin !== "INSUFFICIENT") {
    issues.push("dateSemantics.edgeDayWithoutScrutin must be INSUFFICIENT");
  }

  if (
    evidence.placeholderOrganRefs.some((ref) => typeof ref !== "string" || ref.trim() === "") ||
    !isSortedUnique(evidence.placeholderOrganRefs)
  ) {
    issues.push("evidence.placeholderOrganRefs must be non-empty strings, sorted, unique");
  }

  if (continuity.sameLegislatureOnly !== true) {
    issues.push("continuity.sameLegislatureOnly must be true");
  }
  if (
    continuity.relations.some((relation) => relation !== "RENAMED_SAME_GROUP") ||
    new Set(continuity.relations).size !== continuity.relations.length
  ) {
    issues.push("continuity.relations may only contain RENAMED_SAME_GROUP, once");
  }

  if (typeof exclusion.version !== "string" || exclusion.version.trim() === "") {
    issues.push("exclusion.version is required");
  }
  issues.push(...validateExclusionRules(exclusion.rules));

  if (
    scope.legislatures.length === 0 ||
    scope.legislatures.some((n) => !Number.isInteger(n) || n < 1) ||
    !isSortedUnique(scope.legislatures)
  ) {
    issues.push("scope.legislatures must be positive integers, sorted, unique, not empty");
  }

  if (!Number.isInteger(publication.maxExcludedPerGroup) || publication.maxExcludedPerGroup < 0) {
    issues.push("publication.maxExcludedPerGroup must be an integer >= 0");
  }
  return issues;
}

export function assertValidRunConfig(config: RunConfig): void {
  const issues = validateRunConfig(config);
  if (issues.length > 0) throw new Error(`Invalid run configuration: ${issues.join("; ")}`);
}

export function configHash(config: RunConfig): string {
  assertValidRunConfig(config);
  return hashOf(config);
}

// ---------------------------------------------------------------------------
// Identity of a run
// ---------------------------------------------------------------------------

export interface RunPins {
  /** Snapshot sequence number to read, per stream. */
  snapshotPins: Readonly<Record<string, number>>;
  /** State hash of each pinned snapshot, as recorded. */
  snapshotStateHashes: Readonly<Record<string, string>>;
  /** Highest decision number in force for identity links. */
  linkDecisionCutoff: number;
  /** Highest decision number in force for continuity decisions. */
  continuityDecisionCutoff: number;
  /** Hash of the decisions in force at those cutoffs. */
  decisionsHash: string;
  parserVersion: string;
  resolverVersion: string;
}

/** Hash of the decisions in force: order of the entries does not matter. */
export function hashDecisionsInForce(
  links: ReadonlyMap<string, unknown>,
  continuity: ReadonlyMap<string, unknown>
): string {
  const entries = (map: ReadonlyMap<string, unknown>) =>
    [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return hashOf({ links: entries(links), continuity: entries(continuity) });
}

/**
 * Identity of a run. The git revision is NOT part of it: two commits that give the same result
 * must not make two runs. A change of logic without a new `resolverVersion` is caught by the
 * reference test instead.
 */
export function computeInputHash(pins: RunPins, config: RunConfig): string {
  const streams = Object.keys(pins.snapshotPins).sort().join(",");
  const hashed = Object.keys(pins.snapshotStateHashes).sort().join(",");
  if (streams !== hashed) {
    throw new Error("snapshotPins and snapshotStateHashes must cover the same streams");
  }
  return hashOf({ ...pins, configHash: configHash(config) });
}

// ---------------------------------------------------------------------------
// Snapshot status, and when a run may start
// ---------------------------------------------------------------------------

/**
 * - `QUARANTINED`: held, no judgement on the content. A snapshot with no decision is held.
 * - `RELEASED`: usable by a new run.
 * - `REVOKED`: judged wrong or withdrawn. Final.
 */
export type SnapshotStatus = "QUARANTINED" | "RELEASED" | "REVOKED";

export interface SnapshotDecisionEntry {
  decisionNo: number;
  status: SnapshotStatus;
}

/** The status in force: the last decision. No decision means quarantined: nothing is usable by default. */
export function snapshotStatusOf(decisions: readonly SnapshotDecisionEntry[]): SnapshotStatus {
  let last: SnapshotDecisionEntry | null = null;
  let revoked = false;
  for (const decision of decisions) {
    if (decision.status === "REVOKED") revoked = true;
    if (last === null || decision.decisionNo > last.decisionNo) last = decision;
  }
  // A revocation is final, whatever was decided after it.
  if (revoked) return "REVOKED";
  return last === null ? "QUARANTINED" : last.status;
}

export interface PinnedSnapshotState {
  stream: string;
  seq: number;
  status: SnapshotStatus;
  /** Hash recorded when the snapshot was imported. */
  recordedStateHash: string;
  /** Hash rebuilt from the stored records at that snapshot. */
  recomputedStateHash: string;
}

export type Refusal =
  | { stream: string; reason: "PIN_WITHOUT_SNAPSHOT" }
  | { stream: string; reason: "NOT_RELEASED"; status: SnapshotStatus }
  | { stream: string; reason: "STATE_HASH_MISMATCH" }
  | { stream: string; reason: "PINNED_HASH_MISMATCH" };

export type RunnableCheck = { ok: true } | { ok: false; refusals: Refusal[] };

/** A run starts only on released snapshots whose content still hashes to what was recorded. */
export function checkRunnable(
  pins: RunPins,
  states: readonly PinnedSnapshotState[]
): RunnableCheck {
  const refusals: Refusal[] = [];
  for (const stream of Object.keys(pins.snapshotPins).sort()) {
    const seq = pins.snapshotPins[stream] as number;
    const state = states.find((s) => s.stream === stream && s.seq === seq);
    if (!state) {
      refusals.push({ stream, reason: "PIN_WITHOUT_SNAPSHOT" });
      continue;
    }
    if (state.status !== "RELEASED") {
      refusals.push({ stream, reason: "NOT_RELEASED", status: state.status });
    }
    if (state.recordedStateHash !== state.recomputedStateHash) {
      refusals.push({ stream, reason: "STATE_HASH_MISMATCH" });
    }
    if (pins.snapshotStateHashes[stream] !== state.recordedStateHash) {
      refusals.push({ stream, reason: "PINNED_HASH_MISMATCH" });
    }
  }
  return refusals.length === 0 ? { ok: true } : { ok: false, refusals };
}

export type DerivedRunStatus = "OK" | "TO_REVIEW" | "INVALIDATED_BY_REVOCATION";

/** Status of a finished run, read from the status of the snapshots it pinned. Nothing is stored. */
export function derivedRunStatus(pinnedStatuses: readonly SnapshotStatus[]): DerivedRunStatus {
  if (pinnedStatuses.includes("REVOKED")) return "INVALIDATED_BY_REVOCATION";
  if (pinnedStatuses.includes("QUARANTINED")) return "TO_REVIEW";
  return "OK";
}
