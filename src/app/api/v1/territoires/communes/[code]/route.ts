import { NextResponse } from "next/server";
import { getCommuneDossier, normalizeInseeCode } from "@/lib/data/territoires";
import { withCache } from "@/lib/cache";
import { withPublicRoute } from "@/lib/api/with-public-route";

/**
 * @openapi
 * /api/v1/territoires/communes/{code}:
 *   get:
 *     summary: Dossier d'une commune
 *     description: >
 *       Mêmes faits, réserves et dates que la page commune de la rubrique Territoires :
 *       identité (département, région ou statut d'outre-mer, collectivité à statut
 *       particulier), maire (`state` ETABLI, NON_ETABLI ou ABSENT ; aucun nom n'est donné
 *       hors ETABLI), maires d'arrondissement ou de secteur, population (source et date
 *       d'import, millésime non publié par la source), parlementaires, résultats des
 *       municipales 2026, résultats de la présidentielle dans la commune
 *       (`elections.presidentielles` : participation et voix par candidat et par tour, avec la
 *       source du ministère de l'Intérieur et la date d'import ; vide quand rien n'est publié
 *       pour la commune ; `agregatTerritoire` quand le territoire n'est publié qu'en un seul
 *       agrégat, comme Wallis-et-Futuna), intercommunalité (`intercommunalite` : null avant le
 *       premier import ; `state` DISPONIBLE, AUCUNE quand l'INSEE indique qu'aucune
 *       intercommunalité à fiscalité propre ne regroupe la commune, NON_ETABLI quand la source
 *       ne couvre pas la commune, comme les collectivités d'outre-mer ; date de situation et
 *       source ; aucune compétence) et matrice de couverture par bloc. Seules les fiches
 *       publiques sont nommées. La composition du conseil municipal n'est pas établie.
 *     tags: [Territoires]
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: Code INSEE de la commune (ex. "35238", "2A004")
 *     responses:
 *       200:
 *         description: Dossier de la commune
 *       400:
 *         description: Code INSEE invalide
 *       404:
 *         description: Commune non trouvée
 *       500:
 *         description: Erreur serveur
 */
export const GET = withPublicRoute(async (_request, context) => {
  const params = await context.params;
  const code = normalizeInseeCode(params["code"] ?? "");
  if (!code) {
    return NextResponse.json(
      { error: "Code INSEE invalide (format attendu : 5 caractères, ex. 35238 ou 2A004)" },
      { status: 400 }
    );
  }

  const dossier = await getCommuneDossier(code);
  if (!dossier) {
    return NextResponse.json({ error: "Commune non trouvée" }, { status: 404 });
  }

  return withCache(NextResponse.json(dossier), "daily");
});
