/**
 * Types de la configuration institutionnelle des législatures de l'Assemblée nationale.
 *
 * Deux structures strictement séparées :
 * - `LegislatureFacts` : faits institutionnels sourcés (dates, événements, sièges légaux) ;
 * - `LegislatureCoverage` : état des jeux de données dans PoliGraph, mesuré, daté, sans
 *   rapport avec les faits ci-dessus. Une législature peut être institutionnellement
 *   certaine et très mal couverte, et inversement.
 */

export type IsoDate = `${number}-${number}-${number}`;

export type SourceKind =
  | "constitution"
  | "loi-organique"
  | "decret"
  | "compte-rendu"
  | "archive-an"
  | "page-an"
  | "donnee-poligraph";

export interface InstitutionalSource {
  id: string;
  kind: SourceKind;
  publisher: string;
  label: string;
  url: string;
  /** Date de lecture par l'équipe, pas de publication. */
  consultedAt: IsoDate;
  /** Extrait exact sur lequel s'appuie une date, quand la source en donne un. */
  quote?: string;
  /** Vrai quand la source n'a pas pu être relue directement (donnée relayée). */
  unverifiedDirectly?: boolean;
}

/**
 * Nature d'une date. Aucune n'est interchangeable avec une autre :
 * - `election-first-round`, `election-second-round` : scrutins (métropole) ;
 * - `previous-powers-expiry` : expiration des pouvoirs de l'Assemblée précédente ;
 * - `mandate-start` : début du mandat des députés élus ;
 * - `archive-start` : début tel que l'Assemblée l'écrit dans ses archives ;
 * - `opening-sitting` : première séance, déclaration d'ouverture de la législature ;
 * - `dissolution-decree` : date de signature du décret de dissolution ;
 * - `dissolution-publication` : publication au Journal officiel ;
 * - `dissolution-entry-into-force` : entrée en vigueur selon la version consolidée ;
 * - `previous-election-second-round` : second tour de l'élection de l'Assemblée précédente ;
 * - `powers-expiry` : expiration des pouvoirs (LO 121) ;
 * - `archive-end` : fin telle que l'Assemblée l'écrit dans ses archives.
 */
export type DateKind =
  | "election-first-round"
  | "election-second-round"
  | "previous-powers-expiry"
  | "mandate-start"
  | "archive-start"
  | "opening-sitting"
  | "dissolution-decree"
  | "dissolution-publication"
  | "dissolution-entry-into-force"
  | "previous-election-second-round"
  | "powers-expiry"
  | "archive-end";

export type DateBasis = "sourced" | "derived" | "observed";

export interface InstitutionalDate {
  kind: DateKind;
  date: IsoDate;
  basis: DateBasis;
  /** Au moins une source, y compris pour une date déduite (la règle appliquée). */
  sourceIds: string[];
  /** Obligatoire pour `derived` (règle et calcul) et `observed` (d'où vient l'observation). */
  explanation?: string;
  /**
   * `internal-only` : jamais affichée au public. Obligatoire pour toute date `observed` :
   * un relevé sur des mandats importés n'est pas un fait institutionnel généralisable.
   */
  display?: "public" | "internal-only";
  /** Condition de validité. Obligatoire pour une échéance théorique (`powers-expiry` en cours). */
  conditional?: string;
}

export interface DateContradiction {
  /** Ce qui est en question, en une phrase : « début de la législature ». */
  topic: string;
  /** Dates en tension, avec leur nature et leur source. */
  claims: Array<{ kind: DateKind; date: IsoDate; sourceId: string }>;
  /** Lecture proposée, jamais présentée comme tranchée tant qu'`arbitrated` est faux. */
  proposedReading: string;
  arbitrated: boolean;
  /** Arbitrage éditorial retenu. Obligatoire quand `arbitrated` est vrai. */
  resolution?: string;
  /** Précision affichable au public, sans vocabulaire de configuration. */
  publicNote?: string;
}

export type LegislatureStatus = "ended" | "ongoing";
export type EndCause = "powers-expiry" | "dissolution";

export interface LegislatureFacts {
  number: number;
  /** Intitulé tel que prononcé à l'ouverture : « XVe législature de l'Assemblée nationale ». */
  officialTitle: string;
  status: LegislatureStatus;
  /** `null` si la législature est en cours. */
  endCause: EndCause | null;
  dates: InstitutionalDate[];
  seats: {
    legalCount: number;
    /** Texte juridique applicable à la période. */
    legalBasisSourceIds: string[];
    note: string;
  };
  contradictions: DateContradiction[];
}

export type CoverageLevel = "complete" | "partial" | "unverified" | "absent" | "withheld";

export type DatasetKey =
  | "scrutins"
  | "individual-votes"
  | "official-group-counts"
  | "deputy-mandates"
  | "referenced-groups"
  | "dated-group-membership"
  | "computed-group-positions";

export interface DatasetCoverage {
  dataset: DatasetKey;
  level: CoverageLevel;
  /** Périmètre exact de la mesure, en une phrase. */
  perimeter: string;
  /**
   * Valeurs mesurées. `outOf` est un dénominateur de NOTRE base (précisé dans `method`).
   * `expected` n'existe que pour un total officiellement attesté, avec `expectedSourceId`.
   */
  measured: { count: number; outOf?: number; expected?: number; expectedSourceId?: string };
  measuredAt: IsoDate;
  /** Comment la mesure a été faite (requête, comparaison à une source). */
  method: string;
  /** Obligatoire pour `complete` : pourquoi ce périmètre est entièrement couvert. */
  completeJustification?: string;
  note?: string;
  /** Précision affichable au public, sans vocabulaire interne. */
  publicNote?: string;
}

export interface LegislatureCoverage {
  number: number;
  /**
   * Chaque jeu a son niveau. Il n'existe volontairement aucun niveau global de complétude
   * d'une législature.
   */
  datasets: DatasetCoverage[];
  navigation: {
    listed: boolean;
    /**
     * Obligatoire dès qu'un jeu est absent : l'absence d'import n'est pas une absence
     * d'activité parlementaire.
     */
    absenceNotice?: string;
  };
  /** Les mesures sont à relancer à la création des pages et au-delà de `maxAgeDays`. */
  refresh: { onPageCreation: true; maxAgeDays: number };
}
