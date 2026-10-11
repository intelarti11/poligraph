/**
 * Official sources of the presidential results by commune (ministère de l'Intérieur, published on
 * data.gouv.fr). One entry per election: the importer refuses an election without one, and the
 * commune page cites the same URLs. Add the 2027 entry only once the definitive files are out.
 */

export interface PresidentielleCommunesRoundSource {
  /** Definitive results by commune ("resultats-par-niveau-subcom"), semicolon-separated text. */
  fileUrl: string;
  /** Dataset page shown to readers. */
  datasetUrl: string;
  /** Publication date of the file on data.gouv.fr (ISO date). */
  publishedAt: string;
}

export interface PresidentielleCommunesSource {
  rounds: Partial<Record<1 | 2, PresidentielleCommunesRoundSource>>;
  /**
   * Territories the ministry publishes as a single aggregate, with no breakdown by commune or
   * circonscription. Their communes get a note, never a result borrowed from the aggregate.
   */
  aggregatedTerritories: Record<string, string>;
}

export const PRESIDENTIELLE_COMMUNES_SOURCE_LABEL =
  "Ministère de l'Intérieur, résultats définitifs par commune (data.gouv.fr)";

export const PRESIDENTIELLE_COMMUNES_SOURCES: Record<string, PresidentielleCommunesSource> = {
  "presidentielle-2022": {
    rounds: {
      1: {
        fileUrl:
          "https://static.data.gouv.fr/resources/election-presidentielle-des-10-et-24-avril-2022-resultats-definitifs-du-1er-tour/20220414-152459/resultats-par-niveau-subcom-t1-france-entiere.txt",
        datasetUrl:
          "https://www.data.gouv.fr/datasets/election-presidentielle-des-10-et-24-avril-2022-resultats-definitifs-du-1er-tour",
        publishedAt: "2022-04-14",
      },
      2: {
        fileUrl:
          "https://static.data.gouv.fr/resources/election-presidentielle-des-10-et-24-avril-2022-resultats-definitifs-du-2nd-tour/20220428-142333/resultats-par-niveau-subcom-t2-france-entiere.txt",
        datasetUrl:
          "https://www.data.gouv.fr/datasets/election-presidentielle-des-10-et-24-avril-2022-resultats-definitifs-du-2nd-tour",
        publishedAt: "2022-04-28",
      },
    },
    // The 2022 files carry one line "ZW;001;Wallis-Et-Futuna" for the whole territory, while the
    // COG splits it into three circonscriptions (98611 to 98613).
    aggregatedTerritories: { "986": "Wallis-et-Futuna" },
  },
};

/** SyncMetadata key written by the importer, read by the commune page for the import date. */
export function presidentielleCommunesSyncKey(electionSlug: string): string {
  return `presidentielle-communes:${electionSlug}`;
}
