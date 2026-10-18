/**
 * Coherence between the nominal lists of a scrutin and the counts the Assemblée publishes.
 *
 * Three questions are kept apart on purpose, and this file answers only the first:
 * 1. Do the official counts agree with the nominal lists? (here)
 * 2. Which group does each vote belong to? (the resolver, E1 against E2)
 * 3. May a position be shown? (`publication.ts`, which reads the answer to 1 and never changes 2)
 *
 * The rule is a pure function of numbers. It is written a second time as a CHECK constraint of
 * `ScrutinCountCheck` (SQL), so that the stored status cannot say anything the stored numbers do
 * not say. The two are tested against each other and against the parser.
 */
import type { CountCoherence } from "./types";

export const COUNT_POSITIONS = ["pour", "contre", "abstention", "nonVotant"] as const;
export type CountPosition = (typeof COUNT_POSITIONS)[number];
export type PositionCounts = Record<CountPosition, number>;

export interface GroupCountInput {
  /** The group as published, `PO0` included. */
  organRef: string;
  /** Voters listed by name under this group, by position. */
  nominal: PositionCounts;
  /** The group's published count. `null`: absent, incomplete or not made of numbers. */
  official: PositionCounts | null;
}

export interface GroupCountCheck {
  organRef: string;
  nominal: PositionCounts;
  official: PositionCounts | null;
  /** Nominal minus official, per position. `null` when there is no official count. */
  diff: PositionCounts | null;
  coherence: CountCoherence;
}

export interface ScrutinCountCheck {
  groupCount: number;
  /** Groups whose nominal list differs from their official count. */
  mismatchedGroups: number;
  /** Groups with no usable official count. */
  unverifiableGroups: number;
  /** Sum of the nominal lists of all the groups. */
  nominal: PositionCounts;
  /** The scrutin-level summary as published. `null` when absent or unusable. */
  official: PositionCounts | null;
  diff: PositionCounts | null;
  coherence: CountCoherence;
  groups: GroupCountCheck[];
}

function assertCounts(counts: PositionCounts, label: string): void {
  for (const position of COUNT_POSITIONS) {
    const value = counts[position];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label}.${position} must be a non-negative integer, got ${String(value)}`);
    }
  }
}

export function diffOf(
  nominal: PositionCounts,
  official: PositionCounts | null
): PositionCounts | null {
  if (official === null) return null;
  return {
    pour: nominal.pour - official.pour,
    contre: nominal.contre - official.contre,
    abstention: nominal.abstention - official.abstention,
    nonVotant: nominal.nonVotant - official.nonVotant,
  };
}

const differs = (diff: PositionCounts | null): boolean =>
  diff !== null && COUNT_POSITIONS.some((position) => diff[position] !== 0);

/** A group: no official count means unverifiable, a difference means mismatch, else coherent. */
export function groupCoherence(
  official: PositionCounts | null,
  diff: PositionCounts | null
): CountCoherence {
  if (official === null) return "UNVERIFIABLE";
  return differs(diff) ? "COUNT_MISMATCH" : "COHERENT";
}

/**
 * A scrutin. A mismatch (a group, or the summary, differs from the nominal lists) outranks an
 * unverifiable count: a scrutin that is known to disagree is not merely "unchecked". Coherent means
 * a summary, no unverified group and no difference anywhere.
 */
export function scrutinCoherence(parts: {
  mismatchedGroups: number;
  unverifiableGroups: number;
  summaryPresent: boolean;
  summaryDiffers: boolean;
}): CountCoherence {
  if (parts.mismatchedGroups > 0 || (parts.summaryPresent && parts.summaryDiffers)) {
    return "COUNT_MISMATCH";
  }
  if (!parts.summaryPresent || parts.unverifiableGroups > 0) return "UNVERIFIABLE";
  return "COHERENT";
}

export function deriveCountCheck(input: {
  groups: readonly GroupCountInput[];
  synthese: PositionCounts | null;
}): ScrutinCountCheck {
  if (input.groups.length === 0) throw new Error("a scrutin has at least one group");
  const nominal: PositionCounts = { pour: 0, contre: 0, abstention: 0, nonVotant: 0 };
  const groups = input.groups.map((group): GroupCountCheck => {
    assertCounts(group.nominal, `group ${group.organRef} nominal`);
    if (group.official) assertCounts(group.official, `group ${group.organRef} official`);
    for (const position of COUNT_POSITIONS) nominal[position] += group.nominal[position];
    const diff = diffOf(group.nominal, group.official);
    return {
      organRef: group.organRef,
      nominal: { ...group.nominal },
      official: group.official ? { ...group.official } : null,
      diff,
      coherence: groupCoherence(group.official, diff),
    };
  });
  if (input.synthese) assertCounts(input.synthese, "synthese");
  const diff = diffOf(nominal, input.synthese);
  const mismatchedGroups = groups.filter((g) => g.coherence === "COUNT_MISMATCH").length;
  const unverifiableGroups = groups.filter((g) => g.coherence === "UNVERIFIABLE").length;
  return {
    groupCount: groups.length,
    mismatchedGroups,
    unverifiableGroups,
    nominal,
    official: input.synthese ? { ...input.synthese } : null,
    diff,
    coherence: scrutinCoherence({
      mismatchedGroups,
      unverifiableGroups,
      summaryPresent: input.synthese !== null,
      summaryDiffers: differs(diff),
    }),
    groups,
  };
}
