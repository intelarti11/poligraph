/**
 * Règles de lecture de la provenance d'une page de scrutin : ce que l'institution a publié,
 * ce que PoliGraph a enregistré, ce que PoliGraph calcule.
 *
 * Fonctions pures. Elles ne lisent pas la base et ne décident jamais qu'un jeu de données est
 * « complet » : une égalité entre deux compteurs ne prouve pas que chaque vote est rattaché au
 * bon élu. Une donnée absente, douteuse ou contradictoire est masquée avec sa raison, jamais
 * remplacée par une valeur plausible.
 */

import type { Chamber } from "@/generated/prisma";
import type { DataStatusKind } from "@/lib/parlement/data-status";

// ---------------------------------------------------------------------------
// Source officielle du résultat
// ---------------------------------------------------------------------------

export interface OfficialSource {
  label: string;
  url: string;
}

/**
 * Source institutionnelle d'un scrutin, déduite de son URL. C'est un indice de provenance, pas
 * une garantie que chaque valeur affichée correspond à la publication : le texte de la page dit
 * « importés depuis la source indiquée ». Un lien qui ne pointe pas vers le site de l'Assemblée
 * nationale ou du Sénat (ancien import NosDéputés, lien absent) ne donne pas droit à l'intitulé
 * « officiel » : l'origine interne d'une donnée ne suffit pas.
 */
export function officialSourceOf(
  sourceUrl: string | null,
  chamber: Chamber
): OfficialSource | null {
  if (!sourceUrl) return null;
  let host: string;
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== "https:") return null;
    host = url.hostname;
  } catch {
    return null;
  }
  if (chamber === "AN" && host === "www.assemblee-nationale.fr") {
    return { label: "Assemblée nationale", url: sourceUrl };
  }
  if (chamber === "SENAT" && (host === "www.senat.fr" || host === "senat.fr")) {
    return { label: "Sénat", url: sourceUrl };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Votes individuels : couverture
// ---------------------------------------------------------------------------

export interface RecordedPositions {
  POUR: number;
  CONTRE: number;
  ABSTENTION: number;
  NON_VOTANT: number;
}

export interface OfficialTotals {
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
}

export interface VoteCoverageView {
  status: DataStatusKind;
  /** Libellé court du statut, plus précis que le libellé générique. */
  label: string;
  /** Ce que le statut dit et ne dit pas. */
  description: string;
  /** Phrase chiffrée affichée sous le statut. */
  summary: string;
}

const POSITION_NAMES = { POUR: "Pour", CONTRE: "Contre", ABSTENTION: "Abstention" } as const;

/**
 * Compare les votes individuels enregistrés au total officiel. Le meilleur résultat possible est
 * « compteurs concordants » : jamais « complet ».
 */
export function voteCoverageView(
  recorded: RecordedPositions,
  official: OfficialTotals
): VoteCoverageView {
  const rows = recorded.POUR + recorded.CONTRE + recorded.ABSTENTION + recorded.NON_VOTANT;
  if (rows === 0) {
    return {
      status: "pending",
      label: "Pas encore importé",
      description: "Aucun vote individuel n'est enregistré dans PoliGraph pour ce scrutin.",
      summary:
        "Aucun vote individuel n'est enregistré dans PoliGraph pour ce scrutin. Le résultat officiel ci-dessus reste valable : ce n'est pas une absence de votants.",
    };
  }

  const comparisons = (
    [
      ["POUR", official.votesFor],
      ["CONTRE", official.votesAgainst],
      ["ABSTENTION", official.votesAbstain],
    ] as const
  ).map(([position, officialCount]) => ({
    name: POSITION_NAMES[position],
    recorded: recorded[position],
    official: officialCount,
  }));

  const recordedTotal = recorded.POUR + recorded.CONTRE + recorded.ABSTENTION;
  const officialTotal = official.votesFor + official.votesAgainst + official.votesAbstain;

  const excess = comparisons.filter((c) => c.recorded > c.official);
  if (excess.length > 0) {
    const detail = excess.map((c) => `${c.name} : ${c.recorded} enregistrés pour ${c.official}`);
    return {
      status: "unverified",
      label: "Écart avec le total officiel",
      description: "Le nombre de votes enregistrés dépasse le total officiel.",
      summary: `Les votes enregistrés dépassent le total officiel (${detail.join(", ")}). Le détail par parlementaire est à prendre avec prudence.`,
    };
  }

  if (comparisons.some((c) => c.recorded < c.official)) {
    return {
      status: "partial",
      label: "Partiel",
      description: "Une partie seulement des votes du résultat officiel est enregistrée.",
      summary: `${recordedTotal} votes individuels enregistrés sur ${officialTotal} votants officiels. Les autres votes comptés dans le résultat officiel ne figurent pas dans cette liste.`,
    };
  }

  return {
    status: "unverified",
    label: "Compteurs concordants",
    description:
      "Le nombre de votes enregistrés égale le total officiel pour chaque position. Cela ne prouve pas que chaque vote est rattaché au bon élu.",
    summary: `${recordedTotal} votes individuels enregistrés, autant que le total officiel (pour, contre et abstentions).`,
  };
}

// ---------------------------------------------------------------------------
// Décomptes officiels par groupe
// ---------------------------------------------------------------------------

export interface OfficialGroupCountRow {
  organeRef: string | null;
  memberCount: number | null;
  forCount: number | null;
  againstCount: number | null;
  abstainCount: number | null;
  nonVoterCount: number | null;
  majorityPosition: string | null;
  /** Diagnostics du parseur pour cette ligne (JSON en base). */
  issues: unknown;
}

export interface OfficialGroupSnapshot {
  /** Faux tant que le décompte de ce scrutin n'a pas été importé. */
  imported: boolean;
  /** Diagnostics du parseur hors lignes (JSON en base). */
  issues: unknown;
  rows: OfficialGroupCountRow[];
}

export interface AnOrganLabel {
  organeRef: string;
  label: string;
  abbreviation: string | null;
  startDate: Date | null;
  endDate: Date | null;
}

export interface OfficialGroupDisplayRow {
  organeRef: string;
  label: string;
  abbreviation: string | null;
  memberCount: number | null;
  forCount: number;
  againstCount: number;
  abstainCount: number;
  nonVoterCount: number | null;
  majorityPosition: "POUR" | "CONTRE" | "ABSTENTION" | null;
}

/**
 * Pourquoi un décompte n'est pas affiché. « import » : un préalable que PoliGraph n'a pas encore
 * importé (établi). « unreliable » : les données disponibles ne permettent pas de l'afficher
 * fiablement, sans qu'on sache si la cause est la source, l'import ou l'interprétation. Cette
 * cause n'est jamais attribuée à la source officielle sans preuve.
 */
export type WithholdOrigin = "import" | "unreliable";

export type OfficialGroupCountsView =
  | { kind: "not-imported" }
  | { kind: "withheld"; origin: WithholdOrigin; reason: string; detail?: string }
  | { kind: "shown"; rows: OfficialGroupDisplayRow[] };

export const UNRELIABLE_REASON =
  "Le décompte par groupe ne peut pas être affiché de manière fiable avec les données actuellement disponibles dans PoliGraph.";

function unreliable(detail: string): OfficialGroupCountsView {
  return { kind: "withheld", origin: "unreliable", reason: UNRELIABLE_REASON, detail };
}

function hasIssues(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseMajority(value: string | null): OfficialGroupDisplayRow["majorityPosition"] {
  return value === "POUR" || value === "CONTRE" || value === "ABSTENTION" ? value : null;
}

/**
 * Décide si le décompte officiel par groupe d'un scrutin peut s'afficher, et sous quel nom.
 *
 * Le nom d'un groupe vient uniquement du référentiel officiel des organes (`AnOrgan`), jamais
 * d'un groupe actuel. Tout ou rien : un seul groupe douteux masque le tableau, parce qu'un
 * tableau auquel il manque une ligne ou dont une ligne est fausse se lit comme un tableau complet.
 *
 * `organes` vaut `null` quand le référentiel n'a pas pu être lu.
 */
export function officialGroupCountsView(input: {
  snapshot: OfficialGroupSnapshot;
  organes: AnOrganLabel[] | null;
  scrutin: OfficialTotals & { votingDate: Date };
}): OfficialGroupCountsView {
  const { snapshot, organes, scrutin } = input;

  if (!snapshot.imported) return { kind: "not-imported" };

  if (hasIssues(snapshot.issues) || snapshot.rows.length === 0) {
    return unreliable("Aucun décompte par groupe lisible n'a été importé pour ce scrutin.");
  }

  const counted = snapshot.rows.map((row) => ({
    row,
    unreadable:
      hasIssues(row.issues) ||
      row.forCount === null ||
      row.againstCount === null ||
      row.abstainCount === null,
  }));
  if (counted.some((entry) => entry.unreadable)) {
    return unreliable(
      "Au moins un groupe a des valeurs manquantes ou illisibles dans le décompte importé."
    );
  }

  if (organes === null || organes.length === 0) {
    return {
      kind: "withheld",
      origin: "import",
      reason: "Les noms des groupes ne sont pas encore importés dans PoliGraph.",
    };
  }

  const byRef = new Map(organes.map((organ) => [organ.organeRef, organ]));
  const day = isoDay(scrutin.votingDate);
  const display: OfficialGroupDisplayRow[] = [];
  let sumFor = 0;
  let sumAgainst = 0;
  let sumAbstain = 0;

  for (const { row } of counted) {
    const organ = row.organeRef ? byRef.get(row.organeRef) : undefined;
    if (!row.organeRef || !organ) {
      return unreliable(
        row.organeRef
          ? `La référence ${row.organeRef} ne figure pas dans le référentiel des organes importé.`
          : "Un groupe du décompte n'a pas de référence."
      );
    }
    const outsidePeriod =
      (organ.startDate !== null && day < isoDay(organ.startDate)) ||
      (organ.endDate !== null && day > isoDay(organ.endDate));
    if (outsidePeriod) {
      return unreliable(
        `Le référentiel importé ne place pas ce scrutin dans la période du groupe « ${organ.label} ».`
      );
    }

    // Les trois décomptes sont non nuls : vérifié plus haut.
    const forCount = row.forCount as number;
    const againstCount = row.againstCount as number;
    const abstainCount = row.abstainCount as number;
    sumFor += forCount;
    sumAgainst += againstCount;
    sumAbstain += abstainCount;
    display.push({
      organeRef: row.organeRef,
      label: organ.label,
      abbreviation: organ.abbreviation,
      memberCount: row.memberCount,
      forCount,
      againstCount,
      abstainCount,
      nonVoterCount: row.nonVoterCount,
      majorityPosition: parseMajority(row.majorityPosition),
    });
  }

  if (
    sumFor !== scrutin.votesFor ||
    sumAgainst !== scrutin.votesAgainst ||
    sumAbstain !== scrutin.votesAbstain
  ) {
    return unreliable("Les décomptes par groupe ne s'additionnent pas au total du scrutin.");
  }

  display.sort(
    (a, b) => (b.memberCount ?? -1) - (a.memberCount ?? -1) || a.label.localeCompare(b.label, "fr")
  );
  return { kind: "shown", rows: display };
}

// ---------------------------------------------------------------------------
// Positions calculées par PoliGraph
// ---------------------------------------------------------------------------

export const COMPUTED_POSITIONS_TITLE = "Positions calculées par PoliGraph";

/** Une ligne pour les cartes de listing, où la place manque. */
export const COMPUTED_POSITIONS_SHORT_NOTE =
  "Positions calculées par PoliGraph, d'après le groupe actuel des élus.";

/**
 * Pourquoi une position de groupe calculée n'est pas un vote de groupe publié. Le rattachement
 * des élus à un groupe n'est pas daté (lot 5) : la position suit le groupe actuel.
 */
export function computedPositionsNote(chamber: Chamber): string {
  const member = chamber === "SENAT" ? "sénateur" : "député";
  const institution = chamber === "SENAT" ? "le Sénat" : "l'Assemblée nationale";
  return `Calculées par PoliGraph à partir des votes individuels enregistrés et du groupe actuel de chaque ${member}. Ce ne sont pas des positions publiées par ${institution} : un ${member} qui a changé de groupe est compté dans son groupe actuel.`;
}
