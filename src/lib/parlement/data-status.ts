/**
 * Statut de complétude d'une donnée parlementaire.
 *
 * Quatre états, jamais déduits d'une valeur : « 0 député » est un fait, « non importé »
 * est une absence. Un état d'attente ne se confond pas avec une assemblée vide.
 */
export const DATA_STATUSES = ["complete", "partial", "unverified", "pending"] as const;

export type DataStatusKind = (typeof DATA_STATUSES)[number];

export const DATA_STATUS_LABELS: Record<DataStatusKind, string> = {
  complete: "Complet",
  partial: "Partiel",
  unverified: "Non vérifié",
  pending: "En attente",
};

export const DATA_STATUS_DESCRIPTIONS: Record<DataStatusKind, string> = {
  complete: "Donnée documentée et vérifiée pour toute la période.",
  partial: "Donnée documentée pour une partie de la période ou des personnes.",
  unverified: "Donnée présente mais pas encore recoupée avec une source officielle.",
  pending: "Donnée pas encore importée. Ce n'est pas une absence de résultat.",
};

// Du plus fiable au moins fiable : sert à résumer plusieurs statuts en un seul.
const RELIABILITY_ORDER: Record<DataStatusKind, number> = {
  complete: 0,
  partial: 1,
  unverified: 2,
  pending: 3,
};

/** Statut d'un ensemble : celui de l'élément le moins fiable. Vide : « en attente ». */
export function worstDataStatus(statuses: readonly DataStatusKind[]): DataStatusKind {
  if (statuses.length === 0) return "pending";
  return statuses.reduce((worst, current) =>
    RELIABILITY_ORDER[current] > RELIABILITY_ORDER[worst] ? current : worst
  );
}

export function isDataStatusKind(value: unknown): value is DataStatusKind {
  return typeof value === "string" && (DATA_STATUSES as readonly string[]).includes(value);
}
