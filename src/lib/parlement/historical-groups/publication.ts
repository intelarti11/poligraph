import type { OrganTally, PublicationConfig } from "./types";

/**
 * Editorial decisions: may a computed position be shown?
 *
 * Deliberately separate from the resolution. The resolver says which group a vote belongs to and
 * with what proof. It never knows a threshold and never learns whether something is shown. These
 * rules only read the counts of a run and a configured threshold, and they cannot change what any
 * vote resolved to. Loosening a threshold later changes this file's input, not the analysis.
 */

export type PublicationDecision =
  | { publishable: true }
  | {
      publishable: false;
      reason: "EXCLUDED_VOTES_PRESENT" | "NO_ATTESTED_VOTE" | "NON_INSCRIT_IS_NOT_A_GROUP";
    };

export function decidePositionPublication(
  tally: OrganTally,
  config: PublicationConfig
): PublicationDecision {
  if (tally.organKind === "NON_INSCRIT") {
    return { publishable: false, reason: "NON_INSCRIT_IS_NOT_A_GROUP" };
  }
  if (tally.excludedCount > config.maxExcludedPerGroup) {
    return { publishable: false, reason: "EXCLUDED_VOTES_PRESENT" };
  }
  if (tally.forCount + tally.againstCount + tally.abstainCount === 0) {
    return { publishable: false, reason: "NO_ATTESTED_VOTE" };
  }
  return { publishable: true };
}
