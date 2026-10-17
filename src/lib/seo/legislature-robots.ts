import type { Metadata } from "next";
import { AN_LEGISLATURE_COVERAGE } from "@/config/legislatures";
import type { LegislatureCoverage } from "@/lib/parlement/legislature-types";
import { hasVotesData } from "@/lib/parlement/legislature-labels";

/**
 * `robots` d'une page de législature. Sans scrutin ni vote importé, la page ne porte que
 * des dates et des sources : contenu mince, noindex,follow (doctrine d'indexation du
 * dépôt). Les liens restent suivis.
 */
export function legislatureRobotsMetadata(coverage: LegislatureCoverage): Pick<Metadata, "robots"> {
  return hasVotesData(coverage) ? {} : { robots: { index: false, follow: true } };
}

/** Une législature est dans le sitemap si sa page est indexable. */
export function isLegislatureIndexable(coverage: LegislatureCoverage): boolean {
  return hasVotesData(coverage);
}

/** Numéros de législatures dont la page est indexable, donc dans le sitemap. */
export function indexableLegislatureNumbers(
  coverages: readonly LegislatureCoverage[] = AN_LEGISLATURE_COVERAGE
): number[] {
  return coverages.filter(isLegislatureIndexable).map((c) => c.number);
}
