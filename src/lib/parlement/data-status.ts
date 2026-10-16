/**
 * Statut de complétude d'un JEU DE DONNÉES parlementaire.
 *
 * Un statut s'applique toujours à un périmètre nommé (`scope` : « Composition », « Dates
 * officielles », « Votes individuels »…). Il n'existe pas de statut « de la législature » :
 * un jeu complet ne rend pas les autres complets, et aucun helper ne déduit l'un de l'autre.
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

// Du plus fiable au moins fiable.
const RELIABILITY_ORDER: Record<DataStatusKind, number> = {
  complete: 0,
  partial: 1,
  unverified: 2,
  pending: 3,
};

/**
 * Statut du moins fiable de plusieurs statuts d'UN MÊME périmètre (par exemple plusieurs
 * sources d'une même composition). Ne sert pas à résumer des jeux de données différents en
 * un statut de législature. Vide : « en attente ».
 */
export function worstDataStatus(statuses: readonly DataStatusKind[]): DataStatusKind {
  if (statuses.length === 0) return "pending";
  return statuses.reduce((worst, current) =>
    RELIABILITY_ORDER[current] > RELIABILITY_ORDER[worst] ? current : worst
  );
}

export function isDataStatusKind(value: unknown): value is DataStatusKind {
  return typeof value === "string" && (DATA_STATUSES as readonly string[]).includes(value);
}
