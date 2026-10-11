# Territoires : plan d'implémentation

Date : 10 octobre 2026. Statut : proposition, à valider avant le lot 0.

Sources de conception : cadrage produit et UX du 8 octobre, revue du kit V2 du 9 octobre (Q1), canevas de
design « Poligraph Territoires » (privé, lien partagé dans l'issue de suivi). Toutes les données des
maquettes sont fictives.

## 1. Décisions prises pendant la conception

| N°  | Décision                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D13 | La rubrique s'appelle **Territoires**, sous-titre « Communes, départements, régions ». Remplace « Communes » (D1 du kit).                                        |
| D14 | Accroche de l'entrée : « Les élus et les décisions de votre territoire ». Les titres de page restent nominatifs (« Saint-Exemple : maire, élus et décisions »).  |
| D15 | URL : `/territoires`, `/territoires/regions/[slug]`, `/territoires/communes/[code]`. `/departements/[slug]` est conservé et enrichi, jamais dupliqué.            |
| D16 | Deux niveaux sur une même page : **socle national** (toutes les communes, sources officielles, sans rédaction) et **dossier curé** (pilote, validation humaine). |
| D17 | Pas de classement ni de comparaison entre territoires (D5 du kit maintenue).                                                                                     |
| D18 | Aucune affaire, aucun fact-check, aucun programme n'est rattaché à un territoire par proximité de personne ou de parti.                                          |
| D19 | Statistiques reste dans le menu principal. Fact-checks et Territoires y entrent. Programmes rejoint l'élection mise en avant.                                    |
| D20 | La mise en avant d'une élection reste une décision éditoriale : drapeau en base, jamais déclenchée par les seules dates.                                         |

## 2. Prérequis (avant tout écran)

1. **Mesurer la production**, en lecture seule : maires RNE en fonction et unicité par commune,
   `lastConfirmedAt`, part des communes avec population, communes multi-circonscriptions. Les seuils
   d'indexation se calibrent sur ces chiffres (doctrine SEO, §5 d'AGENTS.md).
2. **Corriger `getCommuneWithElus()`** (`src/lib/data/elus.ts`) : filtre `PUBLIC_POLITICIAN_WHERE`,
   gestion explicite de plusieurs maires en fonction (état « titulaire non établi »), restitution de
   `lastConfirmedAt`. L'API `/api/v1/communes/[codeInsee]` en hérite. Test de régression d'abord.
3. **Choisir la licence des données** (Licence Ouverte 2.0 ou ODbL) avant d'exposer de nouveaux exports.

## 3. Lots

Chaque PR vise moins de 400 lignes, avec ses tests. Les gardes d'architecture existantes s'appliquent :
`layering-guards`, `cachelife-profiles`, `profile-refresh-write-points`, `indexation-doctrine`,
`robots.test.ts`.

### Lot 0 : socle commune (objectif : en ligne avant la présidentielle d'avril 2027)

| PR  | Contenu                                                                                                                                                                                           | Fichiers principaux                                                                                             | Tests                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 0.1 | Prérequis 2 : correction de `getCommuneWithElus()`                                                                                                                                                | `src/lib/data/elus.ts`                                                                                          | Profil non public exclu, deux maires en fonction, fraîcheur  |
| 0.2 | Lecteur `getCommuneDossier(code)` : identité, maire, conseil, parlementaires par circonscription, intercommunalité si disponible, résultats électoraux, couverture                                | `src/lib/data/territoires.ts`                                                                                   | Unitaires, cas multi-circonscriptions, absences              |
| 0.3 | Page commune `/territoires/communes/[code]` : bandeau (contour du département, repère, faits clés), onglets, blocs maire, Parlement, élections, décisions (vide en lot 0), sources, réutilisation | `src/app/territoires/communes/[code]/`                                                                          | Rendu, `communeRobotsMetadata`, absence de carte côté client |
| 0.4 | Page d'entrée `/territoires` : bandeau, recherche, accès rapides, régions                                                                                                                         | `src/app/territoires/page.tsx`                                                                                  | Recherche code postal à plusieurs communes                   |
| 0.5 | SVG des contours générés au build depuis `public/data/departements.geojson` (France simplifiée en asset statique, tracés par département)                                                         | `scripts/build-territoires-svg.ts` (durable, entrée `package.json`)                                             | Taille maximale du SVG, présence des 96 départements         |
| 0.6 | Recherche : groupe « Communes » renommé « Territoires », lien vers la page commune, ordre des groupes selon la requête                                                                            | `src/components/search/search-results.tsx`, `CommandPalette.tsx`                                                | `search-results.test.ts`                                     |
| 0.7 | Liens P1 : mandat local sur la fiche personne, encart sur les résultats municipaux, « Mon député », recherche                                                                                     | `src/app/politiques/[slug]/`, `src/app/elections/municipales-2026/communes/[inseeCode]/`, `src/app/mon-depute/` | Lien présent seulement si la commune a un socle              |
| 0.8 | Image Open Graph commune (style `OgLayout`, contour réutilisant `og-department-shape`)                                                                                                            | `src/app/territoires/communes/[code]/opengraph-image.tsx`                                                       | Rendu Satori, `X-Robots-Tag`                                 |
| 0.9 | Sitemap et indexation : communes indexables selon `isIndexableCommune`, entrée et régions toujours indexables                                                                                     | `src/app/sitemap.ts`, `src/lib/seo/`                                                                            | `indexation-doctrine.test.ts`                                |

Cache : `"use cache"` + `cacheLife("synced")` + `cacheTag("territoire:<code>")`, invalidé par la
synchronisation RNE et l'import des résultats. Aucune liste non bornée ; liens en `prefetch={false}`.

### Lot 1 : régions, départements, menu (objectif : avant avril 2027)

| PR   | Contenu                                                                                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | Référentiel des régions (`src/config/regions.ts`, codes INSEE, liste des départements), page `/territoires/regions/[slug]`                                                                |
| 1.2  | Enrichissement de `/departements/[slug]` : bandeau, liste des communes paginée avec index A à Z, conseil départemental, compétences légales, bloc Parlement existant conservé             |
| 1.3  | Gestion des collectivités à statut particulier (Paris, Lyon, Corse, Alsace, Guyane, Martinique, Mayotte) : territoire et collectivité distincts (revue F1)                                |
| 1.4  | Menu desktop et mobile : Territoires (sous-entrées Ma commune, Départements, Régions, Mon député) et Fact-checks ajoutés, Statistiques conservé, Programmes sous l'élection mise en avant |
| 1.5  | Drapeau `ELECTION_SPOTLIGHT` (modèle `FeatureFlag` existant, `value` = slug de `NAV_ELECTIONS`) : pastille desktop, première ligne encadrée du bloc mobile                                |
| 1.6  | Écran de recherche mobile plein écran ouvert depuis le menu (réutilise `CommandPalette`)                                                                                                  |
| 1.7  | Population légale millésimée (série INSEE avec millésime et date d'entrée en vigueur)                                                                                                     |
| 1.8  | Intercommunalités : import BANATIC (`sync:banatic`), appartenance datée, sans déduction de compétences                                                                                    |
| 1.9  | Résultats de la présidentielle 2027 par commune reliés à la page commune                                                                                                                  |
| 1.10 | Projection API `/api/v1/territoires/...` : mêmes faits, réserves et dates que les pages                                                                                                   |

### Lot 2 : décisions curées (pilote, 12 communes)

1. Modèles : `Institution`, `Decision` (notice canonique : autorité, référence, dates d'adoption, de publication et d'effet, résultat, source et localisation), `TerritorialSource`, relation datée avec preuve et statut de validation. Migration et RLS.
2. Administration : saisie, revue, publication (`withAdminAuth`, `withValidation`, `auditLog`).
3. Page Décisions : périodes institutionnelles par maire puis par cycle (`details`/`summary`), bandeau compact, état « période institutionnelle non établie ».
4. Fiche personne : « Décisions du conseil pendant ce mandat », toujours présentées comme collectives.
5. Protocole de sélection publié avant collecte ; cas d'essai du cadrage §6.4.

### Lot 3 : Statistiques et réutilisation

1. Onglet `/statistiques/territoires` (entrée dans `STATS_SECTIONS`) : parité des fonctions locales, âge et profession déclarée des maires, renouvellement 2026, communes par taille, couverture Poligraph. Réutiliser les pages municipales 2026 existantes (parité, cumul, maires).
2. Exports CSV et releases datées, licence choisie au prérequis 3.
3. Offre de services pour réutilisateurs : hors code pour l'instant, à cadrer séparément.

## 4. Règles de conception à respecter

- Mobile : premier écran = où je suis, réponse principale, action suivante. Bandeau compact, sections secondaires repliées, cibles de 44 px, pas de carrousel horizontal.
- Pages d'entrée commune, département et région : grand bandeau marine, bande tricolore, silhouette du territoire, trois faits clés sourcés. Sous-pages : bandeau compact avec onglets.
- Toute forme cartographique est décorative (`aria-hidden`) ; l'information est toujours dans le texte.
- Chaque fait affiche sa source, sa période et sa dernière vérification. Une absence n'est jamais un zéro.
- Résultats électoraux en gris neutre, sans couleur de parti ni lecture politique.
- Aucun tiret cadratin ni demi-cadratin dans les textes.

## 5. Questions ouvertes

1. Fusion de « Mon député » dans Territoires : conserver l'URL `/mon-depute` comme raccourci ou rediriger ?
2. Régionales et départementales 2028 : `ElectoralList.communeId` obligatoire empêche de stocker une liste régionale (revue F2). Lot de modèle distinct à chiffrer.
3. Seuil d'indexation des communes : à recalibrer sur les mesures du prérequis 1.
4. Libellé « Territoires » : à valider par un test à cinq lecteurs (« Qu'attendez-vous dans cette rubrique ? »).

## 6. Définition de « terminé » pour chaque lot

- CI verte (statique, tests, build, gardes d'architecture, sécurité).
- Recette du kit (`03-recette-auditable.md`) cochée pour les planches concernées, avec preuve.
- Vérification clavier, lecteur d'écran et 320 px sur les nouvelles pages.
- Aucune donnée fictive en production.

## 7. État de livraison (11 octobre 2026)

Livré : lot 0 complet, lot 1 sauf 1.7, 1.8 et 1.9, lot 3.1, lot 3.2. La recette actualisée vit dans [`territoires-recette.md`](territoires-recette.md) et remplace `03-recette-auditable.md`.

Décisions prises pendant l'implémentation, après la revue du 10 octobre :

- **Socle publiable par bloc.** Chaque bloc du dossier porte un état : établi, non établi ou absent, avec sa source. Le conseil municipal reste « composition actuelle non établie » : la base ne contient que les maires. Pas de bloc intercommunalité ni superficie tant que BANATIC et l'IGN ne sont pas importés.
- **Maire.** Les maires courants sont comptés avant le filtre public. Plusieurs titulaires, ou un titulaire non public, donnent « titulaire non établi » sans nom ni motif.
- **Circonscriptions.** `Commune.constituencyNumber` est présenté comme la circonscription enregistrée, jamais comme la seule. Au-delà de 20 000 habitants, la page nomme le député avec une réserve et renvoie vers Mon député. Paris, Lyon et Marseille : plusieurs circonscriptions, aucun nom.
- **Élu au 1er tour.** Majorité absolue des exprimés et quart des inscrits (art. L. 262 du Code électoral). Les importeurs 2026 n'appliquent que la première condition : 83 listes sont marquées élues sans remplir la seconde.
- **Indexation.** `isIndexableTerritoireCommune` : population connue d'au moins 1 000 habitants et maire établi. C'est un arbitrage éditorial (pages au contenu le plus fourni), plus le panachage, aboli en 2026. Population inconnue : `noindex,follow`. Entrée et régions toujours indexables. Variantes paginées des départements en `noindex,follow` avec canonical.
- **Outre-mer.** `domtom.geojson` ne contient que des points : les DROM et les COM n'ont pas de silhouette, sur la page comme dans l'image Open Graph. On ne dessine jamais le contour d'un autre territoire.
- **Badges.** « Socle officiel » et « Dossier curé » restent internes ; le lecteur voit « Informations disponibles : ... ».
- **Décisions.** Pas d'onglet tant qu'aucune décision n'est documentée.
- **`/mon-depute`.** Conservé, sous-entrée de Territoires.
- **Exports et licence (lot 3.2).** Registre des licences dans `src/config/territoires-sources.ts`, rendu sur `/territoires/donnees` (indexable, au sitemap). Chaque licence a été lue sur la page du producteur le 11 octobre 2026 ; une licence introuvable reste « non établie » avec ce qui a été trouvé. La compilation Poligraph est publiée sous ODbL 1.0 (décision du 31 août 2026) ; la page dit seulement que chaque source garde sa licence, sans parler de cumul. Exports CSV sous `/api/export/territoires/` (palier `export`, 5 par minute ; cache CDN 24 h, tag `export:territories`) : communes par département (liste fermée, TAAF et Clipperton exclus), départements, régions. Le fichier national des communes pèse 10,3 Mo (34 963 lignes, mesuré le 11 octobre 2026), au-dessus des 4,5 Mo d'une réponse de fonction : il est publié en version datée par `npm run territoires:release` (Vercel Blob, nom daté jamais réécrit, ligne `SyncMetadata` avec lignes, taille et SHA-256). Maire nommé selon la règle des pages.
- **`ELECTION_SPOTLIGHT`.** Créé en base désactivé, `value.slug = "presidentielle-2027"`. La pastille n'apparaît que si le drapeau est actif, dans sa fenêtre de dates, que le slug figure dans `NAV_ELECTIONS`, que le drapeau propre de l'élection est actif et que l'élection existe.

Restent ouverts : 1.7 population millésimée, 1.8 BANATIC, 1.9 présidentielle par commune (après publication officielle), lot 2 (décisions curées), contours ultramarins, test du libellé à cinq lecteurs.
