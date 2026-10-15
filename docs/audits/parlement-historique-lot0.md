# Parlement historique, lot 0 : audit et protections

Statut : fondation du chantier « histoire parlementaire » et « votes du député ».
Date des mesures : 2026-10-15, lecture seule, aucune écriture en base.

Références de conception : kit « histoire parlementaire » et kit « votes d'un député »
(maquettes et notes d'implémentation, valeurs fictives). Ce document tranche là où le kit
et le dépôt divergent.

## 1. Décisions d'architecture

- **La législature d'abord** (approche A). Pas de curseur temporel global. Une date n'est
  proposée qu'à l'intérieur de la composition, et seulement quand une composition datée est
  documentée (lot 6).
- **Routes à créer** (lot 2) : `/parlement/assemblee/legislatures`, `…/[n]`, `…/[n]/composition`,
  `…/[n]/groupes`. Les routes existantes de `/parlement` et `/politiques/[slug]` restent
  valides, aucune URL publique n'est cassée.
- **Périmètre** : Assemblée nationale, 16e et 17e législatures en priorité. La 15e peut figurer
  dans la navigation si ses dates sont sourcées, sans corpus de votes présenté comme disponible.
  Sénat et Parlement européen hors périmètre, comportement actuel préservé.
- **Une règle unique d'attribution** : `src/lib/votes/group-attribution.ts`. Une position de
  groupe n'est publiable que si le groupe appartient à la législature du scrutin.
- **Pas de purge.** Les lignes `ScrutinGroupPosition` existantes restent en base. Le garde-fou
  est une règle de lecture et de calcul, réversible en retirant le filtre.

## 2. Couverture mesurée (Assemblée nationale)

|                                            | 15e | 16e                              | 17e                              |
| ------------------------------------------ | --- | -------------------------------- | -------------------------------- |
| Scrutins en base                           | 0   | 4 105 (2022-07-11 au 2024-06-07) | 8 690 (2024-10-08 au 2026-10-14) |
| Scrutins avec votes individuels            | 0   | 3 954                            | 8 690                            |
| Votes individuels                          | 0   | 397 813 (414 députés)            | 1 281 955 (612 députés)          |
| Scrutins avec décompte officiel par groupe | 0   | 0                                | 8 606                            |
| Groupes référencés                         | 0   | 0                                | 12                               |
| Positions de groupe calculées              | 0   | 37 497                           | 94 819                           |
| Mandats de député avec groupe rattaché     | 0   | 0                                | 613                              |

Lectures utiles :

- Les 12 groupes de la base portent tous `legislature = 17` (contrainte
  `@@unique([code, chamber])` : un code ne peut exister qu'une fois).
- **37 497 positions de scrutins de la 16e sont reliées à des groupes de la 17e**, sur
  3 954 scrutins. Elles proviennent de la jointure sur `Mandate.isCurrent`.
- Sur les 414 députés ayant voté en 16e, 377 ont un mandat courant rattaché à un groupe 17e.
  Les 37 autres ne reçoivent aucun groupe.
- 467 mandats de député recouvrent la période de la 16e, mais un seul porte un identifiant
  de type `-leg16` : les mandats historiques importés d'autres sources n'ont pas de groupe.
- `ParliamentaryGroupStats` : 12 lignes en 17e, 11 en « 2023 » (tranche Sénat).

## 3. Matrice des dépendances de `ScrutinGroupPosition`

| Consommateur                                                | Usage                             | Risque avant correctif                         | Protection                                   |
| ----------------------------------------------------------- | --------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| `getScrutinGroupPositions` (page `/parlement/votes/[slug]`) | blocs de positions                | vote 16e sous groupe 17e                       | filtre de cohérence, note d'indisponibilité  |
| `getScrutinGroupPositionsBatch` (listing, cartes)           | pastilles de groupes              | idem                                           | filtre de cohérence                          |
| `getGroupKeyVotes` (`/parlement/groupes/[slug]`)            | « votes clés » du groupe          | votes 16e présentés comme ceux du groupe 17e   | requête bornée à la législature du groupe    |
| `compute-group-stats`                                       | cohésion, alignement gouvernement | moyennes polluées par la 16e                   | lecture bornée à la législature du groupe    |
| `scrutin-analysis`                                          | prompt de l'analyse IA            | commentaire d'un vote 16e avec des groupes 17e | positions filtrées avant le prompt           |
| `compute-group-positions`                                   | écriture                          | produit les lignes fautives                    | jointure sur `g.legislature = s.legislature` |
| `ScrutinOfficialGroupCount`                                 | décompte officiel d'un scrutin    | aucun, donnée source                           | non concerné                                 |

`ScrutinOfficialGroupCount` est la donnée officielle du scrutin (organe, effectifs, votes par
groupe tels que publiés). `ScrutinGroupPosition` est une agrégation interne recalculée à partir
des votes individuels et du groupe courant. Les deux ne se substituent pas.

## 4. Registre des risques

| #   | Risque                                                                                                                                  | Gravité | État                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| R1  | Position d'un groupe 17e affichée sur un scrutin 16e                                                                                    | élevée  | neutralisé en lecture et à l'écriture                                                        |
| R2  | Cohésion et alignement de groupe calculés avec des positions d'autres législatures                                                      | élevée  | neutralisé au prochain calcul planifié                                                       |
| R3  | Analyse IA d'un scrutin nourrie de groupes anachroniques                                                                                | moyenne | neutralisé (aucune analyse 16e en base à la date de mesure)                                  |
| R4  | Dérive intra-législature : un député qui change de groupe pendant la 17e est compté dans son groupe actuel pour les scrutins antérieurs | moyenne | **non traité**, nécessite l'appartenance datée (lot 5). Non quantifiable sans cet historique |
| R5  | Taux de présence historique sans dénominateur établi                                                                                    | élevée  | protection existante conservée (`participation-publication.ts`)                              |
| R6  | Groupes homonymes fusionnés entre législatures                                                                                          | élevée  | prévenu : aucune continuité supposée, lot 5 à valider                                        |
| R7  | 15e législature présentée comme couverte                                                                                                | moyenne | aucun scrutin en base, état « non importé »                                                  |

## 5. Plan de neutralisation

1. **Lecture** : toute position passe par `filterReliableGroupPositions`. Les lignes écartées
   disparaissent des pages, des cartes et des prompts. Rien n'est supprimé.
2. **Écriture** : `compute-group-positions` ne joint plus un vote qu'à un groupe de la
   législature du scrutin. Les lignes déjà en base ne sont pas recalculées par ce lot.
3. **Statistiques** : `compute-group-stats` ignore les positions hors législature du groupe.
   Les valeurs publiées changent au prochain passage du calcul planifié, pas avant.
4. **Interface** : sur un scrutin AN dont la législature n'est pas la 17e, un encart explique
   que les positions par groupe ne sont pas affichées et que le résultat officiel et les votes
   individuels restent disponibles.
5. **Purge éventuelle** : décision séparée, après le lot 5, jamais en production sans
   copie de test et journal.

## 6. Écarts entre le kit et le dépôt

| Kit                                                 | Dépôt réel                                                           | Conséquence                                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `?type=textes`                                      | valeurs actuelles `votes`, `amendements`, `tous` (défaut `votes`)    | `textes` devient un alias, `votes` reste valide                                                     |
| `Vote(deputyId, votingDate)`                        | colonne `politicianId`, index `[politicianId, votingDate]` existants | pas de nouvel index prévu                                                                           |
| Jointure sur `Scrutin.legislature`                  | `Vote` dénormalise `chamber` et `scrutinType`, pas la législature    | la sélection par législature passe par une jointure ou par les bornes de dates, à mesurer au lot 4B |
| `app/politiques/[slug]/votes/page.tsx`              | `src/app/politiques/[slug]/votes/page.tsx`                           | chemins à adapter                                                                                   |
| `getDeputyMandates`, `lib/data/deputy-votes`        | à créer, ou à rapprocher des helpers existants                       | recenser les consommateurs de statistiques avant de modifier                                        |
| Table des législatures en dur dans `legislature.ts` | idem, sans sources                                                   | configuration sourcée au lot 2                                                                      |

## 7. Ordre d'exécution ajusté

1. Lot 0 (ce document et les garde-fous).
2. Lot 1, composants partagés, sans donnée nouvelle.
3. Lot 2, pages des législatures, avec configuration institutionnelle sourcée.
4. Lot 3, contexte des scrutins (trois blocs : officiel, individuel, calculé).
5. Lots 4A et 4B, fiche du député et onglet votes. Le taux de présence reste masqué.
6. Lot 5 sur validation explicite uniquement, puis lot 6.

## 8. Limites de cet audit

- Mesures ponctuelles, à relancer avant chaque lot.
- Aucune vérification navigateur dans ce lot (changement de comportement limité à un encart).
- L'intégrité des 37 497 lignes n'est pas corrigée, seulement masquée.

## 9. Passe corrective (revue de la PR)

Mesures du 2026-10-15, lecture seule.

### Affichages de scrutins : attribution implicite

| Affichage                                                                                                            | Constat                                                                                                         | Traitement                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page scrutin, liste des votes individuels                                                                            | groupe via `mandates.isCurrent`, parti via `currentParty`, sans mention de date                                 | libellés « Groupe actuel : X » et « Parti actuel : X », info-bulle explicite, phrase d'explication au-dessus de la liste                                                                                                                            |
| Générateur social « votes clivants »                                                                                 | agrège par groupe actuel sur les 30 derniers jours                                                              | ignore un scrutin AN hors législature courante                                                                                                                                                                                                      |
| Dissidence d'un député (`politician-dissidence`)                                                                     | groupe actuel, mais votes bornés par les dates du mandat courant                                                | aucun changement : les votes de la 16e sont exclus par la borne de mandat                                                                                                                                                                           |
| `/api/politiques/[slug]/votes`                                                                                       | parti courant du député en en-tête, pas par vote                                                                | aucun changement, valeur présentée au niveau du profil                                                                                                                                                                                              |
| Récap hebdomadaire                                                                                                   | parti courant d'élus cités dans la presse, sans lien avec un vote                                               | hors sujet                                                                                                                                                                                                                                          |
| Comparateur de votes entre partis (`/comparer/votes?cat=partis` et section de concordance de `/comparer?cat=partis`) | agrège les votes de tous les élus dont `currentPartyId` est le parti, sur tous les scrutins, sans borne de date | **retiré** : la requête, la section et le mode de la page de détail sont supprimés, les anciens liens `cat=partis` redirigent vers `/comparer?cat=partis`. La comparaison entre députés ou sénateurs, fondée sur leurs propres votes, est conservée |

Reste vrai même après étiquetage : pour un scrutin de la 17e, le groupe actuel peut différer
du groupe au jour du vote pour un député qui a changé de groupe (R4).

### Analyses IA préexistantes

- 324 analyses en base, toutes sur des scrutins AN de la 17e (`STRUCTURED_DATA` 300,
  `DEBATE_TRANSCRIPT` 24), générées entre le 2026-03-25 et le 2026-06-11.
- 317 citent au moins un groupe par son nom ou son code. Aucune n'est reliée à une position
  hors législature (0).
- Le modèle `ScrutinAnalysis` ne conserve ni les entrées du prompt, ni un statut de
  vérification : on ne peut pas dire quelles analyses ont reçu un groupe non daté.
- Traitement sans schéma : `getScrutinAnalysis` ne publie une analyse que pour un scrutin
  de la législature courante (ou du Sénat), et la synthèse affiche « Les groupes cités
  reposent sur l'appartenance actuelle des députés, non datée au moment du vote ».
- Décision : pas de relecture manuelle des 317 analyses. Elles sont régénérées après le lot 5, quand l'appartenance datée permettra de reconstruire des entrées correctes. D'ici là, publication conditionnée et mention visible.

### Statistiques de groupe persistées

Les 12 lignes AN (`ParliamentaryGroupStats`) datent du 2026-03-25. Environ 30 % des positions
de chaque groupe viennent de scrutins de la 16e (par exemple DEM : 8 508 positions de 17e sur
12 346 en base). Recalcul à blanc, borné à la 17e (`npm run audit:group-stats`, lecture seule) :

| Groupe  | Cohésion    | Alignement gouvernement | Alignement vote final |
| ------- | ----------- | ----------------------- | --------------------- |
| DEM     | 94,5 → 93,5 | 93 → 91,3               | 96,9 → 96             |
| DR      | 92,7 → 93,4 | 69,4 → 71,1             | 82,3 → 87,7           |
| ECOS    | 96,8 → 96,9 | 43,4 → 46,5             | 49,9 → 54,2           |
| EPR     | 96,1 → 95   | 100 → 100               | 100 → 100             |
| GDR     | 97,7 → 97,5 | 40,9 → 44,4             | 49,2 → 53,5           |
| HOR     | 93,6 → 92   | 90,4 → 87,4             | 93,1 → 89,2           |
| LFI-NFP | 98,7 → 98,7 | 38 → 41,3               | 38,7 → 42,9           |
| LIOT    | 90,5 → 90,7 | 70,8 → 77,3             | 83 → 88,1             |
| NI      | 88,1 → 88,1 | 71,9 → 71,8             | 85,8 → 87,8           |
| RN      | 98,4 → 98,4 | 45,3 → 49,2             | 66 → 73               |
| SOC     | 94,1 → 95   | 50,9 → 53,7             | 64,3 → 68,1           |
| UDR     | 97,4 → 97,4 | 51 → 50                 | 77,7 → 76,2           |

Les écarts atteignent 7 points : les valeurs publiées étaient donc fausses, pas seulement
imprécises.

**Neutralisation temporaire** : `AN_GROUP_STATS_PUBLISHABLE = false`
(`src/lib/votes/group-attribution.ts`) masque ces statistiques dans la liste des groupes, la
fiche d'un groupe et la page des statistiques. Les groupes du Sénat ne changent pas. Aucune
ligne n'est modifiée.

**Recalcul contrôlé proposé** (non lancé) :

1. Fusionner la PR et déployer depuis le dashboard.
2. Relancer `npm run audit:group-stats` : les valeurs recalculées doivent égaler le tableau
   ci-dessus.
3. Exécuter le calcul `compute-group-stats` une fois, depuis un script ponctuel, après
   sauvegarde des 12 lignes.
4. Relancer l'audit : persisté == recalculé.
5. Passer `AN_GROUP_STATS_PUBLISHABLE` à `true` dans une PR séparée.

Précaution : `computedAt` n'est pas mis à jour par l'`upsert` (valeur de création), il ne
permet donc pas de distinguer une ligne recalculée d'une ligne ancienne.

### Tests ajoutés

- Libellés d'affiliation actuelle (`current-affiliation.test.ts`).
- Analyse retenue pour la 16e, publiée pour la 17e (`groupes-historical-attribution.test.ts`).
- Statistiques AN masquées dans la liste, le détail et `getGroupDynamicsStats`.
- Générateur social : scrutin hors législature courante ignoré (vérifié par mutation).
- Comparateur de partis : redirection des anciens liens, plus d'export `getPartyVoteComparison`.
