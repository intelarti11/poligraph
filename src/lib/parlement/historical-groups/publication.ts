import type { CountCoherence, OrganTally, PublicationConfig } from "./types";

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
      reason:
        | "COUNT_MISMATCH"
        | "COUNT_UNVERIFIABLE"
        | "COUNT_COHERENCE_UNKNOWN"
        | "EXCLUDED_VOTES_PRESENT"
        | "NO_ATTESTED_VOTE"
        | "NON_INSCRIT_IS_NOT_A_GROUP";
    };

/**
 * The gate on the official counts. It comes first and nothing after it can reopen it: a scrutin
 * whose nominal lists disagree with the published counts (`COUNT_MISMATCH`), or whose counts cannot
 * be checked (`UNVERIFIABLE`), publishes nothing automatically, however cleanly its votes resolved.
 * No coherence on record (`null`, or any value this function does not know) is refused too: the
 * absence of a check is not a pass.
 */
function countGate(coherence: CountCoherence | null): PublicationDecision {
  switch (coherence) {
    case "COHERENT":
      return { publishable: true };
    case "COUNT_MISMATCH":
      return { publishable: false, reason: "COUNT_MISMATCH" };
    case "UNVERIFIABLE":
      return { publishable: false, reason: "COUNT_UNVERIFIABLE" };
    default:
      return { publishable: false, reason: "COUNT_COHERENCE_UNKNOWN" };
  }
}

/**
 * `countCoherence` has no default and no `undefined`: a caller that has not looked it up cannot
 * call this function, and one that found nothing says `null` and is refused.
 */
export function decidePositionPublication(
  tally: OrganTally,
  config: PublicationConfig,
  countCoherence: CountCoherence | null
): PublicationDecision {
  const gate = countGate(countCoherence);
  if (!gate.publishable) return gate;
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
