import { NextResponse } from "next/server";
import { getDepartementTerritoire, normalizeDepartmentCode } from "@/lib/data/territoires";
import { withCache } from "@/lib/cache";
import { withPublicRoute } from "@/lib/api/with-public-route";
import { parseStrictPagination } from "@/lib/api/pagination";

/**
 * @openapi
 * /api/v1/territoires/departements/{code}:
 *   get:
 *     summary: Département et ses communes
 *     description: >
 *       Mêmes faits que la page département de la rubrique Territoires : région ou statut
 *       d'outre-mer, collectivité à statut particulier, nombre de communes, compteur exact
 *       par lettre initiale, communes paginées (50 par page, triées par nom) avec leur
 *       population et l'état de leur maire, présidence du département si elle est établie,
 *       nombre de députés et de sénateurs dont la fiche est publique.
 *     tags: [Territoires]
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: Code du département (ex. "35", "2A", "974")
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 40
 *       - in: query
 *         name: lettre
 *         schema:
 *           type: string
 *         description: Lettre initiale du nom de la commune, de A à Z (accents ignorés)
 *     responses:
 *       200:
 *         description: Département et page de communes
 *       400:
 *         description: Paramètre invalide
 *       404:
 *         description: Département non trouvé
 *       500:
 *         description: Erreur serveur
 */
export const GET = withPublicRoute(async (request, context) => {
  const params = await context.params;
  const code = normalizeDepartmentCode(params["code"] ?? "");
  if (!code) {
    return NextResponse.json({ error: "Code de département invalide" }, { status: 400 });
  }

  const searchParams = request.nextUrl.searchParams;
  const pagination = parseStrictPagination(searchParams, {
    defaultLimit: 50,
    maxLimit: 50,
    maxPage: 40,
  });
  if (!pagination) {
    return NextResponse.json({ error: "Page invalide (entier de 1 à 40)" }, { status: 400 });
  }
  const rawLetter = searchParams.get("lettre");
  if (rawLetter !== null && !/^[A-Za-z]$/.test(rawLetter)) {
    return NextResponse.json({ error: "Lettre invalide (une lettre de A à Z)" }, { status: 400 });
  }
  const result = await getDepartementTerritoire(code, {
    page: pagination.page,
    letter: rawLetter,
  });
  if (!result) {
    return NextResponse.json({ error: "Département non trouvé" }, { status: 404 });
  }

  return withCache(NextResponse.json(result), "daily");
});
