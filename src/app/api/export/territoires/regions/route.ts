import { withPublicRoute } from "@/lib/api/with-public-route";
import { getRegionExportRows } from "@/lib/data/territoires-exports";
import { REGION_COLUMNS } from "@/lib/territoires/exports";
import { territoiresCsvResponse } from "@/lib/territoires/export-response";

export const dynamic = "force-dynamic";

/**
 * @openapi
 * /api/export/territoires/regions:
 *   get:
 *     summary: Export CSV des 18 régions
 *     description: >
 *       Une ligne par région : code INSEE, nom, outre-mer, départements, chef-lieu, nombre de
 *       communes en base. Les collectivités d'outre-mer ne relèvent d'aucune région et figurent
 *       dans l'export des départements. Licence ODbL 1.0.
 *     tags: [Exports]
 *     responses:
 *       200:
 *         description: Fichier CSV UTF-8 avec BOM, séparateur virgule
 *       429:
 *         description: Trop de requêtes
 */
export const GET = withPublicRoute(async () => {
  const rows = await getRegionExportRows();
  return territoiresCsvResponse(rows, REGION_COLUMNS, "regions");
});
