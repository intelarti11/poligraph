import { NextResponse } from "next/server";
import { getCommuneWithElus } from "@/lib/data/elus";
import { withCache } from "@/lib/cache";
import { withPublicRoute } from "@/lib/api/with-public-route";

/**
 * @openapi
 * /api/v1/communes/{codeInsee}:
 *   get:
 *     summary: Informations d'une commune et ses élus
 *     description: >
 *       Retourne les informations de la commune (nom, département, population,
 *       coordonnées) ainsi que ses élus en exercice dont la fiche est publique.
 *       `maireStatus` vaut ETABLI (un seul maire courant, fiche publique),
 *       NON_ETABLI (les données ne désignent pas un titulaire public unique :
 *       aucun nom n'est alors donné) ou ABSENT (aucun maire courant enregistré).
 *       Chaque élu porte `lastConfirmedAt`, la dernière date à laquelle la source
 *       a confirmé le mandat (null si jamais enregistrée).
 *     tags: [Communes]
 *     parameters:
 *       - in: path
 *         name: codeInsee
 *         required: true
 *         schema:
 *           type: string
 *         description: Code INSEE de la commune (ex. "75056")
 *     responses:
 *       200:
 *         description: Commune avec ses élus
 *       404:
 *         description: Commune non trouvée
 *       500:
 *         description: Erreur serveur
 */
export const GET = withPublicRoute(async (request, context) => {
  const params = await context.params;
  const codeInsee = params["codeInsee"]!;

  const result = await getCommuneWithElus(codeInsee);

  if (!result) {
    return NextResponse.json({ error: "Commune non trouvée" }, { status: 404 });
  }

  return withCache(NextResponse.json(result), "daily");
});
