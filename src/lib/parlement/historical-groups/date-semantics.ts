import type { CivilDate, GroupMembershipEvidence, OpenBound } from "./types";

/**
 * How the dates of a membership record are read: interpretation `v1`.
 *
 * The source defines `dateDebut` ("start of the appointment") but gives no definition of
 * `dateFin`: whether it is included is NOT documented. `v1` reads the interval as closed at both
 * ends, `[startDate, endDate]`. That is a hypothesis, supported by measures and consigned in the
 * run configuration (`dateSemantics.version`), never an established fact. The days where the
 * hypothesis matters, the edge days, are handled by the resolver and are never settled by it
 * without a scrutin attestation.
 */

export const DATE_SEMANTICS_V1 = "v1" as const;

export type UncertainReason = "START_DATE_UNKNOWN" | "END_STATE_UNKNOWN" | "OPEN_BEYOND_SNAPSHOT";

export type Coverage =
  | { kind: "IN" }
  | { kind: "OUT" }
  | { kind: "UNCERTAIN"; reason: UncertainReason };

/** A record whose states and dates contradict each other is a bug upstream: refuse it loudly. */
export function assertConsistent(record: GroupMembershipEvidence): void {
  const startOk = (record.startState === "DATED") === (record.startDate !== null);
  const endOk = (record.endState === "DATED") === (record.endDate !== null);
  if (!startOk || !endOk) {
    throw new Error(
      `Inconsistent membership record ${record.sourceRecordId}: states and dates disagree`
    );
  }
  if (record.startDate !== null && record.endDate !== null && record.startDate > record.endDate) {
    throw new Error(`Inconsistent membership record ${record.sourceRecordId}: start after end`);
  }
}

/**
 * Whether a record holds on `date`, under `v1`.
 * - `IN`: certainly, start and end both allow it.
 * - `OUT`: certainly not (before a dated start, or after a dated end).
 * - `UNCERTAIN`: the source does not allow to say. Never read as `IN` and never as `OUT`.
 *
 * An end that is open at the snapshot holds up to the bound of that snapshot, not beyond.
 */
export function coverageAt(
  record: GroupMembershipEvidence,
  date: CivilDate,
  bound: OpenBound
): Coverage {
  assertConsistent(record);

  if (record.startDate !== null && date < record.startDate) return { kind: "OUT" };
  if (record.endState === "DATED" && record.endDate !== null && date > record.endDate) {
    return { kind: "OUT" };
  }

  if (record.startState === "UNKNOWN") {
    return { kind: "UNCERTAIN", reason: "START_DATE_UNKNOWN" };
  }
  switch (record.endState) {
    case "DATED":
      return { kind: "IN" };
    case "OPEN_AT_SNAPSHOT":
      return date <= bound.date
        ? { kind: "IN" }
        : { kind: "UNCERTAIN", reason: "OPEN_BEYOND_SNAPSHOT" };
    case "UNKNOWN":
      return { kind: "UNCERTAIN", reason: "END_STATE_UNKNOWN" };
  }
}

/**
 * An edge day is a day equal to the start or to the end of a record of the person. On such a day
 * the reading of the bounds decides the answer, so interval evidence alone is not trusted.
 */
export function isEdgeDay(
  records: readonly Pick<GroupMembershipEvidence, "startDate" | "endDate">[],
  date: CivilDate
): boolean {
  return records.some((record) => record.startDate === date || record.endDate === date);
}
