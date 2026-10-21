import type {
  CurationStatus,
  DatePrecision,
  DecisionOutcome,
  InstitutionKind,
  TerritorialSourceKind,
} from "@/generated/prisma";

// French labels of curated territorial decisions (#1052, lot 2).

export const CURATION_STATUS_LABELS: Record<CurationStatus, string> = {
  DRAFT: "Brouillon",
  IN_REVIEW: "En revue",
  PUBLISHED: "Publiée",
  REJECTED: "Rejetée",
};

export const INSTITUTION_KIND_LABELS: Record<InstitutionKind, string> = {
  CONSEIL_MUNICIPAL: "Conseil municipal",
  CONSEIL_COMMUNAUTAIRE: "Conseil communautaire",
};

export const TERRITORIAL_SOURCE_KIND_LABELS: Record<TerritorialSourceKind, string> = {
  DELIBERATION: "Délibération",
  PROCES_VERBAL: "Procès-verbal de séance",
  LISTE_DELIBERATIONS: "Liste des délibérations",
  RECUEIL_ACTES_ADMINISTRATIFS: "Recueil des actes administratifs",
};

export const DECISION_OUTCOME_LABELS: Record<DecisionOutcome, string> = {
  ADOPTEE: "Adoptée",
  REJETEE: "Rejetée",
};

export const DATE_PRECISION_LABELS: Record<DatePrecision, string> = {
  DAY: "Jour exact",
  MONTH: "Mois seulement",
  YEAR: "Année seulement",
};

export const DECISION_TRANSITION_LABELS = {
  SUBMIT: "Envoyer en revue",
  RETURN_TO_DRAFT: "Renvoyer en brouillon",
  PUBLISH: "Publier",
  REJECT: "Rejeter",
  UNPUBLISH: "Dépublier",
  REOPEN: "Rouvrir en brouillon",
} as const;
