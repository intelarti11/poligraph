import type {
  DateKind,
  InstitutionalSource,
  IsoDate,
  LegislatureCoverage,
  LegislatureFacts,
} from "./legislature-types";

export function isIsoDate(value: string): value is IsoDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function datesOf(facts: LegislatureFacts, kind: DateKind): IsoDate[] {
  return facts.dates.filter((d) => d.kind === kind).map((d) => d.date);
}

/**
 * Contrôle de cohérence des faits. Renvoie la liste des problèmes (vide : cohérent).
 * Ne corrige rien et n'arbitre aucune contradiction.
 */
export function validateLegislatureFacts(
  facts: readonly LegislatureFacts[],
  sources: readonly InstitutionalSource[]
): string[] {
  const issues: string[] = [];
  const sourceIds = new Set(sources.map((s) => s.id));
  const seen = new Set<number>();

  for (const leg of facts) {
    const tag = `L${leg.number}`;
    if (seen.has(leg.number)) issues.push(`${tag}: numéro en double`);
    seen.add(leg.number);

    if (!leg.officialTitle.trim()) issues.push(`${tag}: intitulé vide`);
    if (!Number.isInteger(leg.seats.legalCount) || leg.seats.legalCount <= 0) {
      issues.push(`${tag}: nombre légal de sièges invalide`);
    }
    if (leg.seats.legalBasisSourceIds.length === 0) {
      issues.push(`${tag}: sièges sans source juridique`);
    }
    for (const id of leg.seats.legalBasisSourceIds) {
      if (!sourceIds.has(id)) issues.push(`${tag}: source de sièges inconnue ${id}`);
    }

    for (const d of leg.dates) {
      const dateTag = `${tag}/${d.kind}`;
      if (!isIsoDate(d.date)) issues.push(`${dateTag}: date invalide ${d.date}`);
      if (d.sourceIds.length === 0) issues.push(`${dateTag}: date sans source`);
      for (const id of d.sourceIds) {
        if (!sourceIds.has(id)) issues.push(`${dateTag}: source inconnue ${id}`);
      }
      if ((d.basis === "derived" || d.basis === "observed") && !d.explanation?.trim()) {
        issues.push(`${dateTag}: date ${d.basis} sans explication`);
      }
      if (d.basis === "observed" && d.display !== "internal-only") {
        issues.push(`${dateTag}: date observée affichable au public`);
      }
      if (d.kind === "mandate-start" && d.display !== "internal-only") {
        issues.push(`${dateTag}: début de mandat individuel affichable au public`);
      }
      if (d.kind === "powers-expiry" && leg.status === "ongoing" && !d.conditional?.trim()) {
        issues.push(`${dateTag}: échéance théorique sans condition`);
      }
    }

    const first = datesOf(leg, "election-first-round")[0];
    const second = datesOf(leg, "election-second-round")[0];
    const opening = datesOf(leg, "opening-sitting")[0];
    if (!first || !second || !opening) issues.push(`${tag}: élection ou ouverture manquante`);
    else {
      if (first >= second) issues.push(`${tag}: premier tour non antérieur au second`);
      if (opening <= second) issues.push(`${tag}: ouverture non postérieure au second tour`);
    }

    const decree = datesOf(leg, "dissolution-decree")[0];
    const publication = datesOf(leg, "dissolution-publication")[0];
    if (opening && decree && decree <= opening) issues.push(`${tag}: dissolution avant ouverture`);
    if (decree && publication && publication < decree) {
      issues.push(`${tag}: publication antérieure au décret`);
    }

    const entry = datesOf(leg, "dissolution-entry-into-force")[0];
    if (decree && entry && entry < decree)
      issues.push(`${tag}: entrée en vigueur antérieure au décret`);
    if (leg.endCause === "dissolution" && !entry)
      issues.push(`${tag}: dissolution sans entrée en vigueur`);

    if (leg.status === "ongoing") {
      if (leg.endCause !== null) issues.push(`${tag}: en cours mais cause de fin renseignée`);
      for (const kind of [
        "dissolution-decree",
        "dissolution-publication",
        "archive-end",
      ] as const) {
        if (datesOf(leg, kind).length > 0) issues.push(`${tag}: en cours mais ${kind} présent`);
      }
    } else {
      if (leg.endCause === null) issues.push(`${tag}: terminée sans cause de fin`);
      if (leg.endCause === "dissolution" && !decree) issues.push(`${tag}: dissolution sans décret`);
      if (leg.endCause === "powers-expiry" && datesOf(leg, "powers-expiry").length === 0) {
        issues.push(`${tag}: expiration sans date d'expiration`);
      }
    }

    for (const c of leg.contradictions) {
      if (c.arbitrated && !c.resolution?.trim()) {
        issues.push(`${tag}: contradiction « ${c.topic} » arbitrée sans résolution`);
      }
      if (c.claims.length < 2)
        issues.push(`${tag}: contradiction « ${c.topic} » à une seule thèse`);
      for (const claim of c.claims) {
        if (!sourceIds.has(claim.sourceId)) {
          issues.push(`${tag}: contradiction, source inconnue ${claim.sourceId}`);
        }
        const exists = leg.dates.some(
          (d) =>
            d.kind === claim.kind && d.date === claim.date && d.sourceIds.includes(claim.sourceId)
        );
        if (!exists) {
          issues.push(
            `${tag}: contradiction citant une date absente (${claim.kind} ${claim.date})`
          );
        }
      }
    }
  }
  return issues;
}

/** Contrôle de la couverture : un niveau `complete` exige une justification de périmètre. */
export function validateLegislatureCoverage(
  coverage: readonly LegislatureCoverage[],
  factNumbers: readonly number[]
): string[] {
  const issues: string[] = [];
  const known = new Set(factNumbers);
  for (const leg of coverage) {
    const tag = `L${leg.number}`;
    if (!known.has(leg.number)) issues.push(`${tag}: couverture d'une législature sans faits`);
    if (!leg.navigation.listed) issues.push(`${tag}: législature absente de la navigation`);
    const hasAbsent = leg.datasets.some((d) => d.level === "absent");
    if (hasAbsent && !leg.navigation.absenceNotice?.trim()) {
      issues.push(`${tag}: jeu absent sans mention « absence d'import »`);
    }
    if (leg.refresh.maxAgeDays <= 0) issues.push(`${tag}: délai d'actualisation invalide`);
    const keys = new Set<string>();
    for (const ds of leg.datasets) {
      const dsTag = `${tag}/${ds.dataset}`;
      if (keys.has(ds.dataset)) issues.push(`${dsTag}: jeu en double`);
      keys.add(ds.dataset);
      if (!isIsoDate(ds.measuredAt)) issues.push(`${dsTag}: date de mesure invalide`);
      if (!ds.method.trim() || !ds.perimeter.trim())
        issues.push(`${dsTag}: méthode ou périmètre vide`);
      if (ds.measured.count < 0 || !Number.isInteger(ds.measured.count)) {
        issues.push(`${dsTag}: effectif invalide`);
      }
      if (ds.measured.outOf !== undefined && ds.measured.count > ds.measured.outOf) {
        issues.push(`${dsTag}: effectif supérieur à son total`);
      }
      if (ds.measured.expected !== undefined && !ds.measured.expectedSourceId) {
        issues.push(`${dsTag}: valeur attendue sans source officielle`);
      }
      if (ds.level === "complete") {
        if (!ds.completeJustification?.trim()) issues.push(`${dsTag}: complet sans justification`);
        if (ds.measured.outOf === undefined && ds.measured.expected === undefined) {
          issues.push(`${dsTag}: complet sans référence de comparaison`);
        } else if (
          (ds.measured.outOf !== undefined && ds.measured.count !== ds.measured.outOf) ||
          (ds.measured.expected !== undefined && ds.measured.count !== ds.measured.expected)
        ) {
          issues.push(`${dsTag}: complet alors que la mesure ne boucle pas`);
        }
      }
      if (ds.level === "absent" && ds.measured.count !== 0) {
        issues.push(`${dsTag}: absent avec un effectif non nul`);
      }
    }
  }
  return issues;
}

/** Jeux dont la mesure est plus ancienne que `maxAgeDays` à la date donnée. */
export function staleDatasets(
  coverage: LegislatureCoverage,
  now: Date
): Array<{ dataset: string; ageDays: number }> {
  return coverage.datasets
    .map((ds) => ({
      dataset: ds.dataset as string,
      ageDays: Math.floor(
        (now.getTime() - new Date(`${ds.measuredAt}T00:00:00Z`).getTime()) / 86_400_000
      ),
    }))
    .filter((d) => d.ageDays > coverage.refresh.maxAgeDays);
}

/** Dates affichables : les relevés internes ne sortent jamais de la configuration. */
export function publicDates(facts: LegislatureFacts) {
  return facts.dates.filter((d) => d.display !== "internal-only");
}
