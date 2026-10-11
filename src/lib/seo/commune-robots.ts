import type { Metadata } from "next";

const NOINDEX_FOLLOW = { index: false, follow: true } as const;

/**
 * Communes below this population get noindex,follow on their municipales-2026
 * page (issue #385). The threshold was first justified by panachage under
 * 1000 inhabitants; that reason no longer holds, since the 2026 municipales
 * apply the list ballot below 1000 too. It stays as an editorial trade-off:
 * about 10k communes of 1000+ inhabitants carry the richest pages, the others
 * remain crawlable. Behaviour unchanged.
 */
export const COMMUNE_MIN_POPULATION = 1_000;

/**
 * Unknown population stays indexable (fail-open): never deindex a real page
 * because of missing data. Only 6 communes have a null population in prod.
 */
export function isIndexableCommune(population: number | null | undefined): boolean {
  if (population == null) return true;
  return population >= COMMUNE_MIN_POPULATION;
}

/**
 * `robots` metadata fragment for a municipales-2026 commune page: {} for
 * communes with list-based elections, noindex,follow for thin ones.
 */
export function communeRobotsMetadata(
  population: number | null | undefined
): Pick<Metadata, "robots"> {
  return isIndexableCommune(population) ? {} : { robots: NOINDEX_FOLLOW };
}
