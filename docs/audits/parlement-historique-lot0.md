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
