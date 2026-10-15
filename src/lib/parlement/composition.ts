/**
 * Cohérence d'une composition parlementaire.
 *
 * Quatre notions distinctes (voir kit, « Comprendre les chiffres ») :
 * - `seats` : sièges de l'assemblée à la date (institutionnel, 577 à l'AN) ;
 * - `filled` : sièges pourvus à la date ;
 * - `vacant` : sièges vacants à la date ;
 * - les effectifs de groupes plus les députés non inscrits, dont la somme doit égaler `filled`.
 *
 * Les non-inscrits n'appartiennent à aucun groupe parlementaire : ils ne sont jamais comptés
 * comme un groupe. `unaffiliated` vaut `null` quand leur effectif n'est pas renseigné.
 *
 * Une composition qui ne boucle pas n'est pas corrigée silencieusement : elle est signalée.
 */

export interface CompositionTotals {
  seats: number;
  filled: number;
  vacant: number;
}

export type CompositionIssue =
  | "seats-mismatch"
  | "groups-sum-mismatch"
  | "unaffiliated-unknown"
  | "negative-or-fractional";

export interface CompositionOptions {
  /** Députés non inscrits. `null` ou absent : effectif non renseigné. */
  unaffiliated?: number | null;
}

export function checkCompositionTotals(
  totals: CompositionTotals,
  groupCounts: readonly number[],
  { unaffiliated = null }: CompositionOptions = {}
): CompositionIssue[] {
  const issues: CompositionIssue[] = [];
  const values = [totals.seats, totals.filled, totals.vacant, ...groupCounts];
  if (unaffiliated !== null) values.push(unaffiliated);
  if (values.some((value) => !Number.isInteger(value) || value < 0)) {
    issues.push("negative-or-fractional");
  }
  if (totals.filled + totals.vacant !== totals.seats) issues.push("seats-mismatch");
  const sum = groupCounts.reduce((acc, count) => acc + count, 0);
  if (unaffiliated !== null) {
    if (sum + unaffiliated !== totals.filled) issues.push("groups-sum-mismatch");
  } else if (sum > totals.filled) {
    issues.push("groups-sum-mismatch");
  } else if (sum < totals.filled) {
    // Écart possiblement dû aux non-inscrits : donnée incomplète, pas somme fausse.
    issues.push("unaffiliated-unknown");
  }
  return issues;
}

export const COMPOSITION_ISSUE_LABELS: Record<CompositionIssue, string> = {
  "seats-mismatch": "Les sièges pourvus et vacants ne font pas le total des sièges.",
  "groups-sum-mismatch":
    "La somme des groupes et des non-inscrits ne correspond pas aux sièges pourvus.",
  "unaffiliated-unknown":
    "Des sièges pourvus ne sont attribués à aucun groupe et l'effectif des non-inscrits n'est pas renseigné.",
  "negative-or-fractional": "Un effectif n'est pas un entier positif.",
};

/** Part en pourcentage d'un effectif sur les sièges pourvus, arrondie à 0,1. */
export function seatShare(count: number, filled: number): number | null {
  if (!Number.isInteger(count) || !Number.isInteger(filled) || filled <= 0 || count < 0) {
    return null;
  }
  return Math.round((count / filled) * 1000) / 10;
}
