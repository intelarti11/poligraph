import {
  assertNever,
  EXCLUSION_REASONS,
  type ExclusionReason,
  type ExclusionRule,
  type Resolution,
} from "./types";

/**
 * Which votes a run leaves out of its counts, and why.
 *
 * This is part of the analysis, not of the publication: a vote is left out when its group is not
 * established. The reasons are the ones of `Resolution`; the rules come from the run
 * configuration, so that a run records exactly what it excluded and under which rule.
 *
 * There is only one action, `EXCLUDE`. A vote that is not attested is never counted under a
 * substitute group.
 */

/** The reason a resolution is left out, or `null` when it is attested. */
export function exclusionReasonOf(resolution: Resolution): ExclusionReason | null {
  switch (resolution.status) {
    case "ATTESTED_GROUP":
    case "ATTESTED_NON_INSCRIT":
      return null;
    case "UNKNOWN":
      return resolution.reason;
    case "CONFLICT":
      return "CONFLICT";
    case "INSUFFICIENT":
      return resolution.reason;
    case "UNRESOLVED_IDENTITY":
      return resolution.reason;
    default:
      return assertNever(resolution);
  }
}

export interface Exclusion {
  ruleId: string;
  reason: ExclusionReason;
}

/** The rule that leaves the resolution out. Throws if a non-attested reason has no rule. */
export function excludedBy(
  resolution: Resolution,
  rules: readonly ExclusionRule[]
): Exclusion | null {
  const reason = exclusionReasonOf(resolution);
  if (reason === null) return null;
  const rule = rules.find((candidate) => candidate.reasons.includes(reason));
  if (!rule) {
    throw new Error(`No exclusion rule covers the reason ${reason}`);
  }
  return { ruleId: rule.id, reason };
}

/** Problems of a rule set. Empty when every reason is covered by exactly one rule. */
export function validateExclusionRules(rules: readonly ExclusionRule[]): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  const covered = new Map<string, string>();
  const known = new Set<string>(EXCLUSION_REASONS);
  for (const rule of rules) {
    if (typeof rule.id !== "string" || rule.id.trim() === "") issues.push("a rule has no id");
    if (ids.has(rule.id)) issues.push(`rule id used twice: ${rule.id}`);
    ids.add(rule.id);
    if ((rule.action as string) !== "EXCLUDE") {
      issues.push(`rule ${rule.id}: the only action is EXCLUDE`);
    }
    for (const reason of rule.reasons) {
      if (!known.has(reason)) issues.push(`rule ${rule.id}: unknown reason ${reason}`);
      const holder = covered.get(reason);
      if (holder !== undefined)
        issues.push(`reason ${reason} is covered by ${holder} and ${rule.id}`);
      else covered.set(reason, rule.id);
    }
  }
  for (const reason of EXCLUSION_REASONS) {
    if (!covered.has(reason)) issues.push(`reason ${reason} is covered by no rule`);
  }
  return issues;
}
