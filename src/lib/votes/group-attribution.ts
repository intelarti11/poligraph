import type { Chamber } from "@/generated/prisma";

/**
 * Garde-fou d'attribution historique des positions de groupe.
 *
 * `ScrutinGroupPosition` est calculé en joignant les votes d'un scrutin aux mandats
 * `isCurrent`, donc au groupe d'AUJOURD'HUI du député (voir compute-group-positions.ts).
 * Pour un scrutin ancien, la ligne dit « le groupe X a voté Pour » alors que X est un
 * groupe de la 17e législature et que ces députés siégeaient peut-être ailleurs.
 *
 * Tant que l'appartenance n'est pas datée (lot 5), une position n'est publiable que si
 * le groupe appartient à la législature du scrutin. `ParliamentaryGroup` porte une seule
 * législature par ligne (@@unique code+chamber), donc un groupe AN ne peut attester que
 * les scrutins de sa propre législature.
 *
 * Sénat : les groupes n'ont pas de législature (renouvellements par séries) et le
 * rattachement par tranche est hors périmètre ici. Comportement inchangé.
 */

export interface AttributionScrutin {
  chamber: Chamber;
  legislature: number;
}

export interface AttributionGroup {
  chamber: Chamber;
  legislature: number | null;
}

export function isGroupAttributionReliable(
  scrutin: AttributionScrutin,
  group: AttributionGroup
): boolean {
  if (scrutin.chamber !== group.chamber) return false;
  if (scrutin.chamber === "SENAT") return true;
  return group.legislature !== null && group.legislature === scrutin.legislature;
}

/**
 * Garde les lignes dont l'attribution est cohérente. Les lignes écartées restent en
 * base : le garde-fou est une règle de lecture, réversible, pas une purge.
 */
export function filterReliableGroupPositions<
  T extends { scrutin: AttributionScrutin; group: AttributionGroup },
>(rows: T[]): T[] {
  return rows.filter((row) => isGroupAttributionReliable(row.scrutin, row.group));
}
