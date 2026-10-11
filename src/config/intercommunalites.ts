import type { IntercommunaliteNature } from "@/generated/prisma";

/**
 * Intercommunalités (#1052, lot 1.8).
 *
 * Source: the two yearly INSEE files "EPCI à fiscalité propre" and "EPT" at 1 January, built on
 * the Code officiel géographique, keyed by commune INSEE code, published under the Licence
 * Ouverte 2.0 (insee.fr legal notice, checked 2026-10-11). BANATIC (DGCL) holds the same
 * memberships keyed by commune SIREN only: on 2026-10-11 its national export listed, for each of
 * the 1,253 EPCI à fiscalité propre, exactly the commune count of the INSEE file at 1 January
 * 2026. INSEE was kept because it names communes by the code our base uses, with a published
 * situation date, and no name matching.
 *
 * Coverage: metropolitan France and the five DROM. Neither file lists the overseas collectivities
 * (975, 977, 978, 986, 987, 988) nor the territories without communes (984, 989): for those, an
 * intercommunality is "not established", never "none".
 */

export const INTERCOMMUNALITES_PAGE_URL = "https://www.insee.fr/fr/information/2510634";

export const intercommunalitesFileUrl = (kind: "epci" | "ept", year: number): string =>
  `https://www.insee.fr/fr/statistiques/fichier/2510634/${kind}_au_01-01-${year}.zip`;

/** `SyncMetadata.sourceKey` of the last import: its `lastSyncAt` is the date of last check. */
export const INTERCOMMUNALITES_SYNC_KEY = "insee-intercommunalites";

/**
 * SIREN of the Métropole de Lyon. INSEE files it under nature METRO and says in the same page that
 * it is a territorial collectivity with special status (loi du 27 janvier 2014); BANATIC codes it
 * MET69. It is stored as MET69 and never presented as an intercommunality.
 */
export const METROPOLE_DE_LYON_SIREN = "200046977";

/** Métropole du Grand Paris: its communes may also belong to an EPT. */
export const METROPOLE_DU_GRAND_PARIS_SIREN = "200054781";

/** Nature in words, lower case, for a label such as "Intercommunalité · communauté de communes". */
export const INTERCOMMUNALITE_NATURE_LABELS: Record<IntercommunaliteNature, string> = {
  CC: "communauté de communes",
  CA: "communauté d'agglomération",
  CU: "communauté urbaine",
  METRO: "métropole",
  MET69: "collectivité territoriale à statut particulier",
  EPT: "établissement public territorial",
};

export function intercommunaliteSourceLabel(kind: "epci" | "ept", situationYear: number): string {
  return kind === "epci"
    ? `INSEE, EPCI à fiscalité propre au 1er janvier ${situationYear}`
    : `INSEE, établissements publics territoriaux au 1er janvier ${situationYear}`;
}
