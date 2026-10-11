import { NextResponse } from "next/server";
import { getRegionTerritoire } from "@/lib/data/territoires";
import { withCache } from "@/lib/cache";
import { withPublicRoute } from "@/lib/api/with-public-route";

/**
 * @openapi
 * /api/v1/territoires/regions/{slug}:
 *   get:
 *     summary: Région et ses départements
 *     description: >
 *       Mêmes faits que la page région de la rubrique Territoires : code INSEE, chef-lieu,
 *       départements avec leur nombre de communes, de députés et de sénateurs dont la fiche
 *       est publique, présidence si elle est établie, état du conseil régional et matrice de
 *       couverture. Les collectivités d'outre-mer n'appartiennent à aucune région.
 *     tags: [Territoires]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *         description: Slug de la région (ex. "bretagne", "ile-de-france")
 *     responses:
 *       200:
 *         description: Région
 *       400:
 *         description: Slug invalide
 *       404:
 *         description: Région non trouvée
 *       500:
 *         description: Erreur serveur
 */
export const GET = withPublicRoute(async (_request, context) => {
  const params = await context.params;
  const slug = params["slug"] ?? "";
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) {
    return NextResponse.json({ error: "Slug de région invalide" }, { status: 400 });
  }

  const region = await getRegionTerritoire(slug);
  if (!region) {
    return NextResponse.json({ error: "Région non trouvée" }, { status: 404 });
  }

  return withCache(NextResponse.json(region), "daily");
});
