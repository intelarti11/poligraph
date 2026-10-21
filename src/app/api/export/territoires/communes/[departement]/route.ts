import { NextResponse } from "next/server";
import { withPublicRoute } from "@/lib/api/with-public-route";
import { getCommuneExportRows } from "@/lib/data/territoires-exports";
import { COMMUNE_COLUMNS, parseExportDepartmentCode } from "@/lib/territoires/exports";
import { territoiresCsvResponse } from "@/lib/territoires/export-response";

export const dynamic = "force-dynamic";

/**
 * @openapi
 * /api/export/territoires/communes/{departement}:
 *   get:
 *     summary: Export CSV des communes d'un département ou d'une collectivité d'outre-mer
 *     description: >
 *       Une ligne par commune : code INSEE, nom, département, région, population et sa source,
 *       état du maire (nommé seulement s'il est seul en fonction et que sa fiche est publique),
 *       circonscription enregistrée, date d'import des communes. Le fichier national est publié
 *       à part, en version datée, sur /territoires/donnees. Licence ODbL 1.0.
 *     tags: [Exports]
 *     parameters:
 *       - in: path
 *         name: departement
 *         required: true
 *         schema:
 *           type: string
 *         description: Code du département ou de la collectivité (ex. "35", "2A", "974", "987")
 *     responses:
 *       200:
 *         description: Fichier CSV UTF-8 avec BOM, séparateur virgule
 *       404:
 *         description: Code hors de la liste des départements et collectivités
 *       429:
 *         description: Trop de requêtes
 */
export const GET = withPublicRoute(async (_request, context) => {
  const params = await context.params;
  // Closed list: the code never reaches a query or a file name unless it is a known department.
  const code = parseExportDepartmentCode(params["departement"] ?? "");
  if (!code) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const rows = await getCommuneExportRows(code);
  return territoiresCsvResponse(rows, COMMUNE_COLUMNS, `communes-${code}`);
});
