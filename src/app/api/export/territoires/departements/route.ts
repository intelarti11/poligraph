import { withPublicRoute } from "@/lib/api/with-public-route";
import { getDepartementExportRows } from "@/lib/data/territoires-exports";
import { DEPARTEMENT_COLUMNS } from "@/lib/territoires/exports";
import { territoiresCsvResponse } from "@/lib/territoires/export-response";

export const dynamic = "force-dynamic";

/**
 * @openapi
 * /api/export/territoires/departements:
 *   get:
 *     summary: Export CSV des départements et collectivités d'outre-mer
 *     description: >
 *       Une ligne par département ou collectivité d'outre-mer, TAAF et Clipperton compris :
 *       statut, région, nombre de communes en base, nombre de députés et de sénateurs en
 *       fonction dont la fiche est publique, lien vers le fichier des communes. Licence ODbL 1.0.
 *     tags: [Exports]
 *     responses:
 *       200:
 *         description: Fichier CSV UTF-8 avec BOM, séparateur virgule
 *       429:
 *         description: Trop de requêtes
 */
export const GET = withPublicRoute(async () => {
  const rows = await getDepartementExportRows();
  return territoiresCsvResponse(rows, DEPARTEMENT_COLUMNS, "departements");
});
