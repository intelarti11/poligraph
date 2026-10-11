// Public URLs of the Territoires section (#1052). Departments keep their historical
// /departements/[slug] route: it is enriched, never duplicated under /territoires.

export const TERRITOIRES_PATH = "/territoires";
export const TERRITOIRES_REGIONS_ANCHOR = "/territoires#regions";

export function territoireCommunePath(inseeCode: string): string {
  return `/territoires/communes/${encodeURIComponent(inseeCode)}`;
}

export function territoireRegionPath(slug: string): string {
  return `/territoires/regions/${encodeURIComponent(slug)}`;
}
