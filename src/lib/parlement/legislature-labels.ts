import { AN_LEGISLATURE_COVERAGE, AN_LEGISLATURE_FACTS, AN_SOURCES } from "@/config/legislatures";
import type { DataStatusKind } from "./data-status";
import { publicDates } from "./legislature-config";
import type {
  CoverageLevel,
  DatasetKey,
  DateKind,
  InstitutionalDate,
  InstitutionalSource,
  LegislatureCoverage,
  LegislatureFacts,
} from "./legislature-types";

/** Dates affichables, dans l'ordre d'affichage. Les autres natures restent internes. */
export const PUBLIC_DATE_ORDER: DateKind[] = [
  "election-first-round",
  "election-second-round",
  "previous-powers-expiry",
  "archive-start",
  "opening-sitting",
  "dissolution-decree",
  "dissolution-publication",
  "dissolution-entry-into-force",
  "archive-end",
  "powers-expiry",
];

export const DATE_KIND_LABELS: Record<DateKind, string> = {
  "election-first-round": "Élection, premier tour (métropole)",
  "election-second-round": "Élection, second tour (métropole)",
  "previous-powers-expiry": "Expiration des pouvoirs de l'Assemblée précédente",
  "previous-election-second-round": "Élection précédente, second tour",
  "mandate-start": "Début d'un mandat de député",
  "archive-start": "Début indiqué par les archives de l'Assemblée",
  "opening-sitting": "Première séance de la législature",
  "dissolution-decree": "Signature du décret de dissolution",
  "dissolution-publication": "Publication du décret au Journal officiel",
  "dissolution-entry-into-force": "Entrée en vigueur de la dissolution",
  "archive-end": "Fin indiquée par les archives de l'Assemblée",
  "powers-expiry": "Expiration des pouvoirs",
};

export const DATASET_LABELS: Record<DatasetKey, string> = {
  scrutins: "Scrutins publics",
  "individual-votes": "Votes individuels",
  "official-group-counts": "Décompte officiel par groupe",
  "deputy-mandates": "Mandats de député",
  "referenced-groups": "Groupes parlementaires référencés",
  "dated-group-membership": "Appartenance datée à un groupe",
  "computed-group-positions": "Positions de groupe calculées",
};

export const COVERAGE_LEVEL_LABELS: Record<CoverageLevel, string> = {
  complete: "Complet",
  partial: "Partiel",
  unverified: "Non vérifié",
  absent: "Pas encore importé",
  withheld: "Non publié",
};

export function coverageToStatus(level: CoverageLevel): DataStatusKind {
  switch (level) {
    case "complete":
      return "complete";
    case "partial":
      return "partial";
    case "unverified":
      return "unverified";
    default:
      return "pending";
  }
}

export function ordinalLegislature(n: number): string {
  return n === 1 ? "1re" : `${n}e`;
}

const FACTS = new Map(AN_LEGISLATURE_FACTS.map((f) => [f.number, f]));
const COVERAGE = new Map(AN_LEGISLATURE_COVERAGE.map((c) => [c.number, c]));
const SOURCES = new Map(AN_SOURCES.map((s) => [s.id, s]));

export const LEGISLATURE_NUMBERS: number[] = AN_LEGISLATURE_FACTS.map((f) => f.number);

/** Valide un paramètre d'URL : entier décimal strict, présent dans la configuration. */
export function parseLegislatureParam(raw: string | undefined): number | null {
  if (!raw || !/^[1-9]\d{0,2}$/.test(raw)) return null;
  const n = Number(raw);
  return FACTS.has(n) ? n : null;
}

export interface LegislatureView {
  facts: LegislatureFacts;
  coverage: LegislatureCoverage;
  displayDates: InstitutionalDate[];
  period: string;
  sources: InstitutionalSource[];
}

function year(date: string): number {
  return Number(date.slice(0, 4));
}

/** « 2022-2024 » ou « depuis 2024 », de la première séance à la fin. */
export function legislaturePeriod(facts: LegislatureFacts): string {
  const opening = facts.dates.find((d) => d.kind === "opening-sitting");
  if (!opening) return "";
  if (facts.status === "ongoing") return `depuis ${year(opening.date)}`;
  const end =
    facts.dates.find((d) => d.kind === "archive-end") ??
    facts.dates.find((d) => d.kind === "dissolution-decree") ??
    facts.dates.find((d) => d.kind === "powers-expiry");
  return end ? `${year(opening.date)}-${year(end.date)}` : `depuis ${year(opening.date)}`;
}

export function getLegislatureView(n: number): LegislatureView | null {
  const facts = FACTS.get(n);
  const coverage = COVERAGE.get(n);
  if (!facts || !coverage) return null;
  const shown = publicDates(facts).filter((d) => PUBLIC_DATE_ORDER.includes(d.kind));
  const displayDates = [...shown].sort(
    (a, b) => PUBLIC_DATE_ORDER.indexOf(a.kind) - PUBLIC_DATE_ORDER.indexOf(b.kind)
  );
  const ids = new Set<string>();
  for (const d of displayDates) d.sourceIds.forEach((id) => ids.add(id));
  facts.seats.legalBasisSourceIds.forEach((id) => ids.add(id));
  const sources = [...ids]
    .map((id) => SOURCES.get(id))
    .filter((s): s is InstitutionalSource => !!s);
  return { facts, coverage, displayDates, period: legislaturePeriod(facts), sources };
}

export function datasetLevel(coverage: LegislatureCoverage, key: DatasetKey): CoverageLevel {
  return coverage.datasets.find((d) => d.dataset === key)?.level ?? "absent";
}

/** Vrai quand au moins un jeu de scrutins ou de votes est importé : la page a un contenu propre. */
export function hasVotesData(coverage: LegislatureCoverage): boolean {
  return (["scrutins", "individual-votes"] as const).some(
    (k) => datasetLevel(coverage, k) !== "absent"
  );
}
