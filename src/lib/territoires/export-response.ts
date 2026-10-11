import { createCSVResponse, toCSV } from "@/lib/csv";
import { withCache } from "@/lib/cache";
import { EXPORT_CACHE_TAGS, EXPORT_ROLLUP_TAG } from "@/lib/api/export-cache-tags";
import { POLIGRAPH_DATA_LICENCE } from "@/config/territoires-sources";
import { SITE_URL } from "@/config/site";
import { TERRITOIRES_DONNEES_PATH } from "@/lib/territoires/paths";

/**
 * CSV response of a Territoires export: UTF-8 with BOM, comma separator, formula-leading cells
 * neutralised, attachment named with the generation day, 24 h CDN cache purgeable by tag.
 * The `Link` header points to the licence and to the page documenting the columns.
 */
export function territoiresCsvResponse<T extends Record<string, unknown>>(
  rows: T[],
  columns: { key: keyof T; header: string }[],
  baseName: string,
  now: Date = new Date()
): Response {
  const csv = toCSV(rows, columns, { neutralizeFormulas: true });
  const response = createCSVResponse(csv, `${baseName}-${now.toISOString().slice(0, 10)}.csv`);
  response.headers.set(
    "Link",
    `<${POLIGRAPH_DATA_LICENCE.url}>; rel="license", <${SITE_URL}${TERRITOIRES_DONNEES_PATH}>; rel="describedby"`
  );
  return withCache(response, "export", [EXPORT_CACHE_TAGS.territories, EXPORT_ROLLUP_TAG]);
}
