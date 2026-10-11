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

## `domtom.geojson`

Un point par département d'outre-mer (971, 972, 973, 974, 976), sans contour. Ajouté dans le
même commit, origine non documentée : à traiter comme un repère approximatif.

## Usages

- Cartes interactives (`DepartmentMap`, `PartyMap`) et images Open Graph
  (`src/lib/og-department-shape.ts`), qui lisent le fichier à l'exécution.
- Contours de la rubrique Territoires : `npm run territoires:svg` les précalcule dans
  `src/config/territoires-shapes.ts`. À relancer après toute modification de ces fichiers.
  Aucun contour ultramarin n'existe tant que `domtom.geojson` ne contient que des points ;
  les pages concernées s'affichent alors sans silhouette.
