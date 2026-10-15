/**
 * Cohérence d'une composition parlementaire.
 *
 * Quatre notions distinctes (voir kit, « Comprendre les chiffres ») :
 * - `seats` : sièges de l'assemblée à la date (institutionnel, 577 à l'AN) ;
 * - `filled` : sièges pourvus à la date ;
 * - `vacant` : sièges vacants à la date ;
 * - la somme des effectifs de groupes, qui doit égaler `filled`.
 *
 * Une composition qui ne boucle pas n'est pas corrigée silencieusement : elle est signalée.
 */

export interface CompositionTotals {
  seats: number;
  filled: number;
  vacant: number;
}

export type CompositionIssue = "seats-mismatch" | "groups-sum-mismatch" | "negative-or-fractional";

export function checkCompositionTotals(
  totals: CompositionTotals,
  groupCounts: readonly number[]
): CompositionIssue[] {
  const issues: CompositionIssue[] = [];
  const values = [totals.seats, totals.filled, totals.vacant, ...groupCounts];
  if (values.some((value) => !Number.isInteger(value) || value < 0)) {
    issues.push("negative-or-fractional");
  }
  if (totals.filled + totals.vacant !== totals.seats) issues.push("seats-mismatch");
  const sum = groupCounts.reduce((acc, count) => acc + count, 0);
  if (sum !== totals.filled) issues.push("groups-sum-mismatch");
  return issues;
}

export const COMPOSITION_ISSUE_LABELS: Record<CompositionIssue, string> = {
  "seats-mismatch": "Les sièges pourvus et vacants ne font pas le total des sièges.",
  "groups-sum-mismatch": "La somme des groupes ne correspond pas aux sièges pourvus.",
  "negative-or-fractional": "Un effectif n'est pas un entier positif.",
};

/** Part en pourcentage d'un effectif sur les sièges pourvus, arrondie à 0,1. */
export function seatShare(count: number, filled: number): number | null {
  if (!Number.isInteger(count) || !Number.isInteger(filled) || filled <= 0 || count < 0) {
    return null;
  }
  return Math.round((count / filled) * 1000) / 10;
}
