# Lot 5C-0 : fermer les écarts entre les phases 5A et 5B

Statut : SQL, modèles Prisma, code pur et tests écrits. Le SQL a tourné **uniquement sur le conteneur
local jetable** déjà autorisé pour les tests de schéma (aucune archive officielle importée dans une
base). Rien n'a été exécuté sur la préproduction ni la production, aucun stockage distant créé.

Contexte : le cadrage du lot 5C (PR #1135, en brouillon) a relevé sept écarts entre ce que le schéma
du lot 5B attend et ce que le code du lot 5A produit. Cette PR en ferme ceux qui doivent l'être avant
l'importeur et dit pourquoi les autres attendent.

## 1. Les trois questions restent séparées

| Question                                                              | Où elle vit                                                                               | Ce qu'elle ne fait pas                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Les décomptes officiels s'accordent-ils avec les listes nominatives ? | `count-check.ts` (calcul), `ScrutinCountCheck` et `ScrutinGroupCountCheck` (conservation) | Ne regarde aucun groupe d'appartenance, ne décide rien de public                  |
| À quel groupe appartient chaque vote (E1 contre E2) ?                 | `resolver.ts`, inchangé                                                                   | Ne lit ni les décomptes ni la cohérence                                           |
| Le résultat peut-il être montré ?                                     | `publication.ts`                                                                          | Ne change aucun résultat du résolveur, ne calcule pas la cohérence : il la reçoit |

`publication.ts` n'importe que `./types`, comme avant (le garde d'architecture le vérifie). La
cohérence est un **argument obligatoire** de `decidePositionPublication`, sans valeur par défaut :

| `countCoherence` reçu                | Décision, quel que soit le résultat du résolveur      |
| ------------------------------------ | ----------------------------------------------------- |
| `COHERENT`                           | Les seuils éditoriaux existants décident, comme avant |
| `COUNT_MISMATCH`                     | Refus, `COUNT_MISMATCH`                               |
| `UNVERIFIABLE`                       | Refus, `COUNT_UNVERIFIABLE`                           |
| `null` (aucune vérification en base) | Refus, `COUNT_COHERENCE_UNKNOWN`                      |
| Toute autre valeur                   | Refus, `COUNT_COHERENCE_UNKNOWN`                      |

L'absence de vérification n'est pas un passage. Appeler la fonction sans le troisième argument, ou avec
`undefined`, ne compile pas (deux `@ts-expect-error` le gardent : si l'erreur de type disparaît, `tsc`
échoue). Le test parcourt toute la grille (7 issues du résolveur, dont `PO0`, conflit E1/E2, date
incertaine, non-inscrits, par 4 états de cohérence) : seuls deux cas sont publiables, tous deux
`COHERENT`. Les 35 scrutins discordants des fichiers locaux n'en font donc passer aucun.

**Ce que cette PR ne peut pas garantir.** La table de positions publiables n'existe pas encore (phase
5F). La garantie est dans le code et dans une requête de lecture testée sur PostgreSQL
(section 4). Pour la 5F, la base devra elle-même refuser une position dont le scrutin n'est pas
`COHERENT` au snapshot épinglé : c'est une **exigence de la 5F**, notée dans les décisions ouvertes.

## 2. Les sept écarts

| #   | Écart                                                      | Décision                                                                                                       | Avant l'importeur ?        | Fait ici              |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------- |
| 1   | Rien ne calcule `rawHash`                                  | **Corrigé** : définition unique, projection des lignes, vecteurs de référence                                  | Oui                        | Oui                   |
| 2   | La cohérence des décomptes n'est stockée nulle part        | **Corrigé** : deux tables de versions                                                                          | Oui, c'est le P0           | Oui                   |
| 3   | `preseance`, `datePublication`, `parDelegation` jamais lus | **Corrigé** : lus, sans changer le reste                                                                       | Oui (colonnes vides sinon) | Oui                   |
| 4   | `memberHash` seulement sur les attestations                | **Peut attendre le code de l'importeur, pas le premier import.** Décision C2 ouverte                           | Avant le premier import    | Non                   |
| 5   | `parserVersion` hors du module                             | **Corrigé** : `parser-version.ts`, version `5C-0.1`. L'étiquette git ne peut être créée qu'au merge            | Oui                        | Oui, sauf l'étiquette |
| 6   | `sourceAsOf` non lisible                                   | **Attend le téléchargeur (5C-3)**. Le schéma accepte `NULL` ; une fin ouverte est alors bornée par `fetchedAt` | Non                        | Non                   |
| 7   | Contenu de `recordCounts` indéfini                         | **Corrigé** : type, construction, validation                                                                   | Oui                        | Oui                   |

Deux écarts de plus, trouvés en travaillant, sont traités ici :

- **8. `PO0` est listé plusieurs fois dans un même scrutin.** Les fichiers locaux montrent
  `VTANR5L17V501` avec deux groupes publiés `PO0`. Une clé `(scrutin, organe)` aurait refusé le second
  par une violation d'unicité : l'import aurait échoué sur une donnée réelle. L'identité d'un groupe
  est `(scrutin, organe, rang)`, le rang étant l'ordre du groupe parmi ceux qui nomment le même organe
  (0 pour un organe réel, toujours). Trouvé en passant les lignes sur les fichiers locaux, pas par un test.
- **9. Les deux implémentations de la règle de cohérence** (le parseur et l'arithmétique) doivent
  s'accorder : `recordsOfScrutin` s'arrête si elles divergent, et la commande de validation fait la
  même vérification sur chaque scrutin réel (17 399, aucun écart).

## 3. Choix de schéma

Deux tables neuves, **du même genre que celles du lot 5B** (versions par intervalles de snapshots,
mêmes gardes, mêmes fonctions de garde réutilisées, aucune fonction nouvelle) :

| Table                    | Une ligne par                  | Contenu                                                                                                                                                                                                                                       |
| ------------------------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ScrutinCountCheck`      | scrutin et version             | Statut de cohérence, nombre de groupes, groupes en désaccord, groupes non vérifiables, décomptes **nominaux** (somme des listes), décomptes **officiels** de synthèse, **différences**, votants listés en mise au point, empreinte du fichier |
| `ScrutinGroupCountCheck` | groupe d'un scrutin et version | Les mêmes décomptes pour un groupe, et son statut                                                                                                                                                                                             |

Les décomptes officiels **par groupe** sont conservés : sans eux, on saurait qu'un scrutin discorde
mais pas où, et les 17 groupes discordants de la 15e ne seraient plus auditables sans relire
l'archive. Les mises au point ne sont pas stockées : seul le nombre de votants listés l'est, elles ne
sont jamais appliquées.

**Le statut est dérivé des nombres par une contrainte `CHECK`.** Il ne peut pas dire ce que les nombres
ne disent pas :

- `COUNT_MISMATCH` si un groupe diffère, ou si la synthèse existe et diffère sur une position ;
- sinon `UNVERIFIABLE` si la synthèse est absente ou si un groupe n'a pas de décompte ;
- sinon `COHERENT`.

Un désaccord l'emporte sur un décompte non vérifiable. Autres contraintes : les quatre décomptes
officiels sont tous présents ou tous absents, chaque différence vaut nominal moins officiel (ou est
absente avec lui), les groupes en désaccord et non vérifiables tiennent dans le nombre de groupes,
empreintes bien formées. Un décompte officiel absent reste **absent** (jamais zéro).

Pas de colonne de nom, de clé de fiche ou de lien avec `Politician`, `ParliamentaryGroup`, `Mandate`
ou `Vote` : un test le vérifie dans le SQL.

Ce que la base ne peut pas vérifier : que la ligne de scrutin et ses lignes de groupe disent la même
chose (le nombre de groupes en désaccord égale le nombre de lignes de groupe en désaccord). Elle ne
relie pas deux tables versionnées. C'est un contrôle de `verify-snapshot` (cadrage, section 4).

Prisma : deux modèles ajoutés, et quatre champs de relation inverse ajoutés au modèle
`OfficialSourceSnapshot` du lot 5B (Prisma exige les deux côtés d'une relation). Aucune ligne
supprimée ni modifiée, 72 lignes ajoutées. Le DDL de Prisma pour les deux tables est identique au SQL
(colonnes, types, index, clés étrangères) : 0 différence.

## 4. La question que la publication posera, testée sur PostgreSQL

```sql
-- Quels scrutins s'accordent au snapshot S ?
SELECT c."scrutinExternalId" FROM "ScrutinCountCheck" c
WHERE c."stream" = $1 AND c."fromSeq" <= $2 AND (c."toSeq" IS NULL OR $2 < c."toSeq")
  AND c."countCoherence" = 'COHERENT';
```

Et depuis les votes : un scrutin qui a des attestations et **aucune ligne de cohérence** n'est pas
publiable (jointure externe, la condition porte sur la valeur lue). Les deux requêtes sont testées :
seuls les scrutins `COHERENT` passent, un scrutin sans vérification ne passe pas, et les votes d'un
scrutin discordant restent tous en base.

Correction rétroactive : la source corrige un décompte, la version ancienne est fermée (`toSeq`), la
nouvelle ouverte. La question posée au snapshot 1 donne l'ancienne réponse, posée au snapshot 2 la
nouvelle, et les deux lignes existent toujours.

## 5. Le `rawHash`

```
rawHash = sha256( canonicalJson( { kind, row } ) )
```

- `row` contient **toutes les colonnes de contenu** de la table, et rien d'autre. Un test compare ses
  clés aux colonnes du SQL, table par table, moins `stream`, `fromSeq`, `toSeq`, `sourceMember`,
  `memberHash` et `rawHash`.
- Ni `fromSeq` ni `toSeq` (où la version se place, pas ce qu'elle dit). Ni `sourceMember` (un fichier
  renommé au contenu identique n'est pas une correction). Ni `memberHash` : l'empreinte du fichier
  entier changerait pour les 150 votants d'un scrutin dès qu'une seule ligne y change.
- Toute colonne est présente, l'absence est `null`. Une valeur que la source se met à publier est un
  changement visible.
- `kind` est dans l'empreinte : deux tables ne partagent jamais une empreinte.
- Elle ne dépend pas de la `parserVersion`. Même octets et nouvel analyseur donnent un nouveau
  snapshot, dont les différences sont attribuées à l'analyseur.
- La sérialisation est `canonicalJson` : clés triées, sans espace, entiers sûrs seulement, `undefined`
  refusé. Un flottant ou un `undefined` ne se hache pas.

Tests : sept vecteurs de référence, dont **trois recalculés hors du code, en Python**, depuis la seule
définition ; indifférence à l'ordre des colonnes ; changer n'importe quelle colonne change
l'empreinte (une par une, sur les sept types) ; une valeur qui devient `null` change l'empreinte ;
identité en tableau JSON (un séparateur dans une valeur ne fusionne pas deux clés) ; empreinte d'état
indépendante de l'ordre de lecture, et qui ne change que pour l'enregistrement modifié.

## 6. Champs officiels lus en plus

`preseance` (rang du mandat), `datePublication` (jour de publication du mandat), `parDelegation`
(vote par délégation). Additif :

- le type de preuve du résolveur (`GroupMembershipEvidence`) **n'a pas changé** : les deux champs sont
  dans un type voisin, `GroupMembershipDetail` (un test compare les champs de la preuve à la liste
  d'avant) ;
- une valeur présente mais illisible devient `null` et est **comptée** (`optionalFieldIssues`), le
  mandat reste accepté : ni rejet nouveau, ni perte silencieuse ;
- `parDelegation` autre que `true` ou `false` donne `null`, sans rejeter le scrutin.

**Non-régression, sur les quatre archives locales** (lecture seule, aucune base) : la commande de
validation rend `PARSER_VERSION_CHANGED` pour l'AMO30 et les trois législatures, **octets identiques,
0 différence** sur tous les chiffres. La baseline n'a changé que d'une ligne, sa `parserVersion`
(`5A-2.1` vers `5C-0.1`), et redonne `STRICT_MATCH` sur les quatre.

## 7. Ce que donnent les lignes sur les fichiers locaux (lecture seule, sans base)

Population : les fichiers officiels de mon poste, projetés par le parseur et `rows.ts`. Le nombre de
lignes de groupe (192 094) diffère de celui de la mesure de coût de la section 10 (191 389, jeu
inventé à 11 groupes par scrutin) : l'écart de 705 lignes est expliqué en section 10 bis.

|                                                                    | AMO30                      | 15e                      | 16e                      | 17e                     |
| ------------------------------------------------------------------ | -------------------------- | ------------------------ | ------------------------ | ----------------------- |
| Acteurs / organes de groupe / mandats de groupe / mandats de siège | 3 175 / 63 / 7 772 / 3 960 |                          |                          |                         |
| Attestations                                                       |                            | 472 631                  | 602 911                  | 1 323 978               |
| Lignes de cohérence, scrutins                                      |                            | 4 417                    | 4 105                    | 8 877                   |
| Lignes de cohérence, groupes                                       |                            | 40 415                   | 45 155                   | 106 524                 |
| Scrutins `COHERENT` / `COUNT_MISMATCH` / `UNVERIFIABLE`            |                            | 4 387 / 30 / 0           | 4 101 / 4 / 0            | 8 876 / 1 / 0           |
| Attestations dans les scrutins non cohérents                       |                            | 6 105                    | 785                      | 218                     |
| Attestations sur `PO0`                                             |                            | 0                        | 0                        | 1 916                   |
| `parDelegation` vrai / faux / absent                               |                            | 52 110 / 412 554 / 7 967 | 51 737 / 547 183 / 3 991 | 200 594 / 1 123 384 / 0 |

Mandats de groupe avec `preseance` : 7 772 sur 7 772. Avec `datePublication` : 4 551. Valeurs
illisibles : 0. L'empreinte d'état est la même en lisant les enregistrements dans un ordre et dans
l'ordre inverse. Les 35 scrutins discordants sont les 35 de la baseline, les votes de ces scrutins
(7 108) sont tous conservés. Aucun écart entre le parseur et l'arithmétique sur les 17 399 scrutins.

## 8. Migration, non appliquée à distance

`2026-10-19-historical-groups-count-check.sql`, et son retour arrière. Même méthode que le lot 5B :
une transaction, SQL simple (aucun bloc `DO`, aucun SQL dynamique, gardes SEC-03 et SEC-06 passées),
aucune réparation, schéma de référence comparé avant puis après la construction. Différences avec le
script du lot 5B :

- **Prérequis vérifiés avant de construire quoi que ce soit**, avec la liste de ce qui manque : les 13
  tables du lot 5B, ses trois fonctions de garde, `btree_gist`. Sur une base sans le lot 5B, l'erreur
  dit `0 of 13 tables`, au lieu de tomber sur une clé étrangère sans cible (c'est ce qu'une première
  version faisait, constaté à l'exécution).
- **Aucune fonction n'est créée ni comparée** : elles appartiennent au script du lot 5B. Les
  déclencheurs des deux tables appellent les mêmes fonctions.
- Deux états acceptés : aucune des deux tables, ou les deux identiques à la référence.
- Le retour arrière ne supprime que les deux tables, seulement si elles sont vides, et laisse le lot
  5B entier. À lancer **avant** celui du lot 5B.
- Le script du lot 5B reste inchangé et passe toujours sur une base qui a reçu celui-ci.

## 9. Tests

| Famille                                               | Résultat                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Module et scripts, hors intégration                   | 624 passés (502 avant la PR), 147 ignorés (intégration)                                                                                                                                                                                                                             |
| Intégration PostgreSQL du lot 5B, rejouée             | 78 sur 78                                                                                                                                                                                                                                                                           |
| Intégration PostgreSQL du lot 5C-0                    | **69 sur 69** : script (prérequis, idempotence, 13 divergences refusées, rollback), statut dérivé des nombres (17 refus et 7 acceptations), groupes (rang du `PO0`), gardes du lot 5B sur les deux tables, correction rétroactive, requêtes de publication, privilèges, concurrence |
| Les deux fichiers d'intégration, ensemble, trois fois | 147 sur 147 à chaque fois                                                                                                                                                                                                                                                           |
| Mutations volontaires du code                         | 15 sur 15 détectées (règle de cohérence, porte de publication, empreintes, identité d'un groupe, champs lus, comptage des fichiers)                                                                                                                                                 |
| Mutation du SQL (contrainte de statut retirée)        | 8 tests d'intégration échouent                                                                                                                                                                                                                                                      |
| Gardes sources SEC-03 et SEC-06                       | passent                                                                                                                                                                                                                                                                             |

Ce que l'exécution a trouvé :

1. Un nom de contrainte en double (`organRef_present`) : le script échouait à la création. Corrigé.
2. `PO0` répété dans un scrutin (écart 8).
3. Une première version qui tombait sur une clé étrangère sans cible sur une base sans le lot 5B :
   prérequis déplacés avant la construction.
4. Mon propre lancement : les deux fichiers d'intégration, lancés ensemble, se supprimaient
   mutuellement le schéma (vitest parallélise les fichiers). Chaque fichier prend désormais un verrou
   consultatif pour toute sa durée ; ils font la queue.

## 10. Coût des deux tables, sur un jeu inventé de même ordre de grandeur

**Population : un jeu synthétique, pas les fichiers officiels.** 17 399 scrutins, chacun avec
exactement 11 groupes (une constante choisie pour la mesure), soit 17 399 × 11 = **191 389** lignes de
groupe, en une transaction, conteneur sans réglage : **25 s** (2 s pour les scrutins, 23 s pour les
groupes), **113 Mo** au total (10 Mo et 103 Mo). Un peu moins de 8 % du coût mesuré en 5B pour les
attestations. Les index partiels et d'exclusion de ces tables font partie du benchmark comparatif
séparé que vous avez demandé.

Ce nombre n'est donc **pas** celui de la section 7 (192 094 lignes de groupe, comptées sur les
fichiers officiels). L'écart de 705 lignes est expliqué exactement en section 10 bis. Les deux jeux
ont le même nombre de scrutins (17 399) ; seul le nombre de groupes par scrutin diffère.

### 10 bis. Les 705 lignes d'écart

| Population                                                  | Scrutins                       | Groupes par scrutin       | Lignes de groupe |
| ----------------------------------------------------------- | ------------------------------ | ------------------------- | ---------------- |
| Section 7 : fichiers officiels, parseur et projection réels | 17 399 (4 417 + 4 105 + 8 877) | variable, voir ci-dessous | **192 094**      |
| Section 10 : jeu synthétique de la mesure de coût           | 17 399                         | 11, constant              | **191 389**      |
| Écart                                                       | 0                              |                           | **705**          |

Le nombre de groupes publiés par scrutin, relevé sur les fichiers officiels :

| Législature | Scrutins | Groupes par scrutin                                        | Lignes de groupe | Si c'était 11 partout | Écart avec 11 |
| ----------- | -------- | ---------------------------------------------------------- | ---------------- | --------------------- | ------------- |
| 15e         | 4 417    | 7 : 3 scrutins, 8 : 1 241, 9 : 1 500, 10 : 1 437, 11 : 236 | 40 415           | 48 587                | **-8 172**    |
| 16e         | 4 105    | 11 pour les 4 105                                          | 45 155           | 45 155                | **0**         |
| 17e         | 8 877    | 12 pour les 8 877                                          | 106 524          | 97 647                | **+8 877**    |
| Total       | 17 399   |                                                            | **192 094**      | 191 389               | **+705**      |

`-8 172 + 0 + 8 877 = 705`. L'écart tient en entier à la différence entre la constante 11 du jeu de
mesure et le nombre réel de groupes de chaque législature : la 15e compte moins de groupes (certains
scrutins en listent 7 à 10), la 17e en compte 12 (une ligne de plus par scrutin que la constante ; je n'ai pas cherché quel organe fait ce douzième groupe, cela ne sert pas au rapprochement). Le détail de la 15e vérifie : 3 × 7 + 1 241 × 8 + 1 500 × 9 + 1 437 × 10 +
236 × 11 = 40 415.

Ni les données, ni une règle métier, n'ont été touchées pour rapprocher les deux nombres : la mesure
de coût est un jeu inventé, la section 7 un comptage. Pour mesurer le coût **au volume réel**, il
suffirait de refaire la mesure avec 12 groupes en 17e et 11 en 16e : 192 094 lignes au lieu de
191 389, soit 0,4 % de plus, sans effet sur la conclusion (le coût est dominé par les index, 113 Mo
pour 191 389 lignes donnent environ 114 Mo pour 192 094).

### 10 ter. `recordCounts` conserve le périmètre attendu

Construit (`buildRecordCounts`) puis validé (`validateRecordCounts`) à partir des fichiers officiels,
lecture seule, sans base. Aucune anomalie dans les quatre cas.

| Flux         | Fichiers | Acceptés                                    | Hors périmètre                                      | Rejetés | Lignes de scrutin | Lignes de groupe |
| ------------ | -------- | ------------------------------------------- | --------------------------------------------------- | ------- | ----------------- | ---------------- |
| AMO30        | 14 053   | 3 238 (63 organes de groupe, 3 175 acteurs) | 10 815 (10 756 organes d'un autre type, 59 déports) | 0       |                   |                  |
| Scrutins 15e | 4 417    | 4 417                                       | 0                                                   | 0       | 4 417             | 40 415           |
| Scrutins 16e | 4 106    | 4 105                                       | 1 (le Congrès)                                      | 0       | 4 105             | 45 155           |
| Scrutins 17e | 8 877    | 8 877                                       | 0                                                   | 0       | 8 877             | 106 524          |

Ce que cela démontre :

- **Conservation des fichiers** : acceptés + hors périmètre + rejetés = fichiers, dans les quatre flux
  (c'est l'une des invariantes de `validateRecordCounts`). Le fichier du Congrès est dans « hors
  périmètre » et non dans les scrutins de l'Assemblée : 4 106 fichiers, 4 105 scrutins, comme en 5A-2.
- **Une ligne de cohérence par scrutin accepté** : 4 417, 4 105 et 8 877, égales aux scrutins par
  statut de cohérence (4 387 + 30, 4 101 + 4, 8 876 + 1).
- **Les lignes de groupe de `recordCounts` sont celles de la section 7**, flux par flux, et leur somme
  est 192 094. Le compteur ne retient ni plus ni moins que la projection : il est construit depuis
  les enregistrements eux-mêmes, pas depuis un second comptage.
- **Les attestations** (472 631, 602 911, 1 323 978) et les 1 916 attestations sur `PO0` de la 17e
  figurent à l'identique.
- **Aucune ligne rejetée ni perdue** : 0 rejet, et les 7 772 mandats de groupe, 3 960 mandats de
  siège, 3 175 acteurs et 63 organes de l'AMO30 sont tous dans `rows`.

## 11. Décisions

### Retenues le 19 octobre, pour les phases suivantes

| #   | Décision                                                                                                                                   | Ce que cela engage                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C2  | `memberHash` ajouté sur `OfficialActor`, `OfficialOrganRecord`, `GroupMembershipRecord` et `SeatMandateRecord` **avant le premier import** | Migration additive distincte, avec son rapport et ses tests. Pas dans cette PR                                                                                                                                                                                                                                                      |
| C5  | **Politiques RLS** pour un rôle d'import dédié, **sans** `BYPASSRLS`                                                                       | Le rôle d'import n'a pas d'attribut de contournement, et le rôle applicatif habituel n'en reçoit pas. Une politique par table et par commande, dont `WITH CHECK (status = 'QUARANTINED')` sur `SnapshotDecision` : l'importeur ne peut techniquement pas publier. Création du rôle et des politiques : migration manuelle distincte |
| F1  | **Garde de publication au niveau PostgreSQL, obligatoire en 5F**                                                                           | La table de positions refuse, par un déclencheur qui lit `ScrutinCountCheck` au snapshot épinglé, toute position dont le scrutin n'est pas `COHERENT` ou n'a aucune ligne de cohérence. Pas de 5F sans elle                                                                                                                         |
| T1  | Étiquette git `historical-groups-parser/5C-0.1` au merge                                                                                   | Créée à la fusion de cette PR, sur le commit de fusion. Sans elle, « rejouer avec la `parserVersion` du snapshot » n'a pas de code à retrouver                                                                                                                                                                                      |
| P1  | Identité d'un groupe : **rang par occurrence du même `organeRef`**, avec déterminisme et traçabilité des changements                       | Voir ci-dessous                                                                                                                                                                                                                                                                                                                     |
| A9  | **Stockage privé avec copie indépendante**, fournisseur à confirmer                                                                        | Rien n'est créé. Le fournisseur se confirme dans les tableaux de bord avant tout adaptateur                                                                                                                                                                                                                                         |

**P1, ce que « déterminisme et traçabilité » veut dire dans ce schéma.**

- _Déterminisme_ : le rang est calculé par une règle sans choix. Pour chaque groupe, dans l'ordre du
  fichier, le rang est le nombre de groupes déjà vus qui portent le même `organeRef`. Les mêmes octets
  donnent donc toujours les mêmes rangs. Pour un organe réel, le rang est toujours 0 (un organe n'apparaît
  qu'une fois par scrutin) : seul `PO0` peut avoir un rang supérieur à 0, et seulement dans les
  scrutins où le fichier le liste plusieurs fois. Le rang est dans le `rawHash` et dans la clé, il ne
  dépend ni de l'horloge ni de l'ordre d'import des fichiers.
- _Traçabilité_ : si la source réordonne ou ajoute un groupe `PO0` dans un scrutin, les rangs se
  décalent, et les lignes concernées apparaissent comme des versions **corrigées** (version ancienne
  fermée par `toSeq`, nouvelle ouverte), jamais comme une réécriture. La différence entre deux snapshots
  les liste, et l'ancien classement reste lisible à son snapshot. Le rang ne s'applique qu'aux lignes de
  groupe de cohérence : les attestations sont identifiées par `(scrutin, acteur)`, sans rang, donc
  insensibles à ce réordonnancement.
- _Ce que le rang n'est pas_ : une identité de groupe au sens politique. Deux groupes `PO0` d'un même
  scrutin ne sont pas « le même groupe », ils sont deux entrées de remplissage que rien ne permet de
  distinguer autrement. Le résolveur continue de traiter `PO0` comme une valeur de remplissage, jamais
  comme un groupe.
- _À tester en 5C-1 ou 5C-2_ : un scrutin où l'ordre de deux groupes `PO0` est permuté entre deux
  snapshots donne exactement les corrections attendues, rien d'autre (cas de test à écrire avec
  l'importeur, pas dans cette PR).

### Toujours ouvertes

Aucune décision de cette PR. Les points précédemment ouverts (C2, C5, F1, T1, P1, A9) sont tous
tranchés ci-dessus ; leur mise en œuvre est renvoyée aux PR qui suivent, chacune soumise à votre
validation.

## 12. Limites

- La garantie que `COUNT_MISMATCH` et `UNVERIFIABLE` empêchent la publication est prouvée **dans le
  code** (type, grille complète, mutations) et par une requête testée. Elle n'est pas encore une
  contrainte de base, faute de table de positions : F1.
- Les mesures de coût viennent d'un conteneur sans réglage, avec des lignes inventées.
- Les chiffres de la section 7 viennent des archives de mon poste, lues sans base de données. Ils ne
  prouvent pas qu'un import réel les reproduira : c'est le rôle de `verify-snapshot` (5C-4).
- La couverture des branches PL/pgSQL n'est pas mesurée (les fonctions sont celles du lot 5B).
