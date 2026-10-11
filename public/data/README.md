# Données géographiques statiques

## `departements.geojson`

Contours des 96 départements métropolitains, en WGS 84 (longitude, latitude), propriétés
`code` et `nom`.

Ajouté le 2 février 2026 (commit `0ef1bacd`) sans mention de source. Vérifié le 11 octobre
2026 : chaque géométrie est identique à celle du fichier
`departements-version-simplifiee.geojson` du dépôt
[gregoiredavid/france-geojson](https://github.com/gregoiredavid/france-geojson) (seule la mise
en forme JSON diffère). Ce dépôt indique comme source des tracés
[IGN Admin Express COG](https://geoservices.ign.fr/adminexpress), édition 2018, simplifiés avec
Mapshaper, et renvoie pour la licence aux conditions d'Admin Express :
[Licence Ouverte Etalab](https://www.etalab.gouv.fr/licence-ouverte-open-licence/).

Les limites départementales n'ont pas bougé depuis 2018 ; les noms et codes affichés viennent de
`src/config/departments.ts`, pas de ce fichier.

## `outremer.geojson`

Contours des cinq DROM et des six COM habitées (971 à 978, 986, 987, 988), en WGS 84,
propriétés `code` et `nom`. Produit par `npm run territoires:outremer`
(`scripts/build-outremer-geojson.ts`), qui télécharge chaque source, applique un Douglas-Peucker
léger (tolérance d'un 1 500e de l'étendue du territoire) et arrondit les coordonnées au
cent-millième de degré. Le détail par territoire (URL, couche, licence, tolérance, nombre
d'anneaux, date de génération) est dans `outremer-provenance.json`. Licences vérifiées le
11 octobre 2026 sur la page de chaque source.

| Codes                   | Source                                                                                                                                                                                              | Version                                         | Licence                  | Attribution                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------ | ------------------------------------------------------ |
| 971, 972, 973, 974, 976 | [IGN ADMIN EXPRESS COG CARTO PE](https://cartes.gouv.fr/rechercher-une-donnee/dataset/IGNF_ADMIN-EXPRESS), couche `departement`, service WFS de la Géoplateforme                                    | édition 2026 (`ADMINEXPRESS-COG-CARTO-PE.2026`) | Licence Ouverte (Etalab) | IGN, ADMIN EXPRESS COG CARTO PE 2026                   |
| 975                     | idem, couche `commune` (Saint-Pierre et Miquelon-Langlade réunies)                                                                                                                                  | édition 2026                                    | Licence Ouverte (Etalab) | IGN, ADMIN EXPRESS COG CARTO PE 2026                   |
| 977, 978                | idem, couche `collectivite_territoriale`                                                                                                                                                            | édition 2026                                    | Licence Ouverte (Etalab) | IGN, ADMIN EXPRESS COG CARTO PE 2026                   |
| 987                     | [Géographie administrative de la Polynésie française](https://www.data.gouv.fr/fr/datasets/geographie-administrative-de-la-polynesie-francaise/), « Emprise des îles, atolls et bancs » (`loc_ile`) | publiée le 28 février 2022                      | CC-BY                    | Section Cadastre-Topographie de la Polynésie française |
| 988                     | [Limites administratives terrestres](https://georep-dtsi-sgt.opendata.arcgis.com/maps/e1d853903cc64d40af7fbb5ee57e3029/about), couche Provinces, les trois provinces fusionnées                     | mise à jour du 28 octobre 2024                  | Licence Ouverte          | Gouvernement de la Nouvelle-Calédonie                  |
| 986                     | [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) 1:10m, `ne_10m_admin_0_countries` (WLF) et `ne_10m_minor_islands` (Alofi)                                                     | 5.1.2                                           | Domaine public           | Made with Natural Earth                                |

Limites connues :

- Wallis-et-Futuna : aucune source de l'IGN ni du territoire n'a été trouvée en données
  ouvertes. Natural Earth donne un tracé grossier (une quinzaine de points par île), et Alofi
  n'y figure que dans la couche des petites îles. Les contours d'OpenStreetMap seraient plus
  fins mais imposent la licence ODbL et une attribution visible près de la carte.
- Nouvelle-Calédonie : la couche Provinces ne contient ni les îles Chesterfield, ni Walpole,
  ni Matthew et Hunter.
- Polynésie française : les 128 îles et atolls de la source sont tous conservés (au moins un
  anneau chacun). Le territoire s'étend sur environ 2 300 km : à l'échelle d'une vignette de
  300 unités, presque toutes les îles sont des points, ce qui montre les cinq archipels
  plutôt que le contour d'une île.
- TAAF (984) et Clipperton (989) n'ont ni page département ni contour : un seul cadre pour les
  TAAF irait du canal du Mozambique à l'Antarctique.

Les communes d'outre-mer sont placées sur ces contours à partir de leurs coordonnées en base
(geo.api.gouv.fr). Vérifié le 11 octobre 2026 sur les 217 communes des DROM et COM : toutes
tombent dans la vignette de leur territoire, 214 sur la terre ou à moins de 6 unités de la côte.
Les trois autres (Ouvéa et deux communes de Mayotte, dont Mtsamboro) ont leur point de
référence en mer ou sur un îlot effacé par la simplification, à 13 unités au plus.

## Usages

- Cartes interactives (`DepartmentMap`, `PartyMap`) et images Open Graph
  (`src/lib/og-department-shape.ts`), qui lisent le fichier à l'exécution.
- Contours de la rubrique Territoires : `npm run territoires:svg` les précalcule dans
  `src/config/territoires-shapes.ts` (métropole, outre-mer, cartouches des cinq DROM sous la
  carte de France). À relancer après toute modification de ces fichiers. Chaque territoire
  d'outre-mer a son propre cadre de projection.
- Images Open Graph d'un territoire d'outre-mer (département, commune, municipales) : elles
  reprennent le contour précalculé, `departements.geojson` ne couvrant que la métropole.
