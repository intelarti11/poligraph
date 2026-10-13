/**
 * Open-data sources of council deliberations read by the SCDL adapter (#1052, lot 2).
 *
 * The authority of a row comes from this table, never from the SIRET of the file: that column
 * is often blank or corrupted. A `COLL_NOM` absent from `authorities` is reported, not imported.
 */

export interface ScdlAuthority {
  /** Exact `COLL_NOM` as published. */
  name: string;
  /** Council this name stands for; `null` for a body outside the notice model (CCAS, syndicat). */
  institution: { kind: "CONSEIL_MUNICIPAL"; communeId: string } | null;
}

export interface ScdlSource {
  key: string;
  label: string;
  /** data.gouv.fr dataset id; the resource URLs are resolved at each run. */
  datasetId: string;
  /** Only the resources whose title contains this text (case-insensitive). */
  resourceTitleContains?: string;
  authorities: ScdlAuthority[];
}

export const SCDL_SOURCES: readonly ScdlSource[] = [
  {
    key: "la-possession",
    label: "La Possession (974)",
    datasetId: "6287432ae7c0208ca54287b0",
    authorities: [
      {
        name: "Ville de La Possession",
        institution: { kind: "CONSEIL_MUNICIPAL", communeId: "97408" },
      },
    ],
  },
  {
    key: "taugon",
    label: "Taugon (17)",
    datasetId: "69b91846a8f736c95eca2f7b",
    authorities: [
      {
        name: "Commune de Taugon",
        institution: { kind: "CONSEIL_MUNICIPAL", communeId: "17439" },
      },
    ],
  },
  {
    key: "brest-ccas",
    label: "Brest (29), CCAS",
    datasetId: "641836dcb17182c9a1ee6fc6",
    // A CCAS is not a council of the notice model: reported, never imported.
    authorities: [
      { name: "CCAS de Brest", institution: null },
      { name: "CCAS Brest", institution: null },
    ],
  },
  {
    key: "brest",
    label: "Brest (29), actes de la ville et de la métropole",
    datasetId: "642adf35abc66f0c6e497485",
    authorities: [],
  },
];
