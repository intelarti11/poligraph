/**
 * Affiliation affichée à côté d'un vote individuel.
 *
 * La base ne conserve que l'affiliation actuelle d'un député (mandat `isCurrent`, parti
 * courant). Elle n'est pas celle qu'il avait à la date du scrutin. L'étiquette le dit
 * explicitement tant qu'aucune appartenance datée n'existe (lot 5).
 */

export interface CurrentAffiliationInput {
  group?: { code: string; name: string } | null;
  party?: { shortName: string | null; name: string } | null;
}

export interface CurrentAffiliationLabel {
  text: string;
  title: string;
}

export function currentAffiliationLabel({
  group,
  party,
}: CurrentAffiliationInput): CurrentAffiliationLabel | null {
  if (group) {
    return {
      text: `Groupe actuel : ${group.code}`,
      title: `${group.name} (groupe actuel du député, pas nécessairement celui du jour du vote)`,
    };
  }
  if (party) {
    const short = party.shortName ?? party.name;
    return {
      text: `Parti actuel : ${short}`,
      title: `${party.name} (parti actuel du député, pas nécessairement celui du jour du vote)`,
    };
  }
  return null;
}
