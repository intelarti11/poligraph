# Lot 6 : consulter les positions historiques des groupes

Premier parcours public pour lire ce que les groupes de l'Assemblée nationale ont voté à la date
d'un scrutin, à partir des runs du lot 5D. Cette PR livre l'interface, la couche de lecture et les
tests. **Elle n'active rien** : l'interrupteur est éteint, le SQL n'est pas appliqué.

## 1. Audit de l'existant

**Page de scrutin** (`/parlement/votes/[slug]`). Elle compte déjà trois blocs : le résultat
officiel, les votes individuels, puis les groupes. Ce dernier montre le décompte officiel par groupe
(C1, tel que publié) et des « positions calculées » (une position majoritaire par groupe) fondées sur
le **groupe actuel** de chaque député. Pour une législature ancienne, ces positions sont masquées
avec une mention.

**Ce que la page ne sait pas faire** : dire dans quel groupe siégeait un député le jour du vote. Le
lot 5D le sait désormais, avec ses preuves et ses limites.

**Composants réutilisés tels quels** : `Card`, `MissingData`, `SourceLine`, `DataStatus` (quatre
états complet, partiel, non vérifié, en attente), `Badge`. Tableau et liste mobile suivent le motif
de `ScrutinOfficialGroups`.

**Couverture** : les `Scrutin` du site ne couvrent que les 16e et 17e législatures AN (12 982
scrutins). Les 4 417 scrutins de la 15e présents dans les runs n'ont pas de page : ils n'apparaissent
nulle part.

**Règles du dépôt qui comptent ici** : lecture par `src/lib/data/`, cache `synced` et tag, aucun
tiret long, accents, cibles de 44 px, une seule source de vérité par règle SEO (non modifiée ici).

## 2. Ce que le kit « Votes d'un député » apporte, et ce qu'il n'apporte pas

Le kit décrit l'onglet des **votes individuels** d'un député. Son périmètre est différent, et je ne
l'applique pas : ni filtres d'URL, ni pagination, ni présence, ni requêtes sur `Vote`. Aucune
statistique individuelle n'est dérivée des agrégats de groupe.

| Principe du kit                                                                    | Reprise                                                                          |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Quatre états de donnée (complet, partiel, non vérifié, en attente)                 | Oui : `DataStatus` existe déjà et porte ces états. Il n'est pas recopié.         |
| Une absence se dit, elle ne se déguise pas (« Ce n'est pas une absence de votes ») | Oui, par `MissingData`, dans chaque état sans donnée.                            |
| Position toujours en texte, jamais la couleur seule                                | Oui : les quatre décomptes sont écrits, la barre est décorative (`aria-hidden`). |
| Source visible sous le bloc, avec date de consultation                             | Oui : `SourceLine`, deux jeux de données nommés.                                 |
| Cibles de 44 px, focus visible, `details` sur mobile                               | Oui : le résumé « Comment lire ces chiffres » mesure 44 px.                      |
| Valeurs de couleur de la maquette (oklch en dur)                                   | **Non.** Contradiction signalée ci-dessous.                                      |
| `PositionBadge`                                                                    | Non : un groupe n'a pas une position, il a quatre décomptes.                     |

**Contradiction et arbitrage.** La maquette écrit ses couleurs en dur. Le dépôt a des jetons
(`--success`, `--warning`, `--vote-pour`, `--vote-contre`, `--vote-abstention`, avec valeur sombre).
Les jetons du dépôt gagnent. Seconde incohérence, déjà présente : `ScrutinResultCard` et
`GroupPositions` utilisent des classes Tailwind brutes (`green-700`, `red-700`) au lieu des jetons
`--vote-*`. Je n'y touche pas (hors périmètre), la nouvelle barre utilise les jetons.

**Composant mutualisable, sans refonte** : `PositionCountBar` (proportion pour, contre, abstention).
La future synthèse de votes d'un député pourrait la reprendre. Rien n'est branché de ce côté.

## 3. Parcours proposé

Un seul écran : la page de scrutin existante, section « Groupes parlementaires », sous le décompte
officiel. Pas de nouvelle route.

L'utilisateur lit, dans l'ordre : le résultat officiel, les votes individuels, le décompte officiel
par groupe, puis **« Vote de chaque groupe le {date} »**. Ce bloc dit trois choses distinctes :

1. **Vote individuel** : l'Assemblée publie le vote de chaque député, nom par nom.
2. **Agrégation par groupe** : ces votes additionnés selon le groupe de chaque député ce jour-là.
3. **Position majoritaire** : non calculée. Le bloc le dit, et n'en affiche jamais.

### États

| État                                               | Affichage                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| Totaux recoupés, tous les groupes présentables     | Tableau, statut « Complet »                                               |
| Totaux recoupés, certains groupes ou votes écartés | Tableau, statut « Partiel », raisons nommées groupe par groupe            |
| Décomptes discordants (35 scrutins)                | Aucun tableau, explication, source                                        |
| Totaux non vérifiables                             | Aucun tableau, explication distincte                                      |
| Totaux recoupés mais aucun groupe présentable      | Raisons, aucun tableau                                                    |
| Vote exclu pour conflit entre sources              | Mention du nombre de votes comptés dans aucun groupe                      |
| Non-inscrits                                       | Mention : ils ne forment pas un groupe, leurs votes ne sont pas regroupés |
| Aucun vote attesté pour un groupe                  | Groupe nommé dans « Groupes non présentés », avec sa raison               |
| Groupes renommés (même sigle, deux références)     | Deux lignes distinctes et une mise en garde : jamais fusionnés            |
| Pas de run publié pour ce scrutin                  | « Pas encore disponible. Ce n'est pas une absence de vote »               |
| Législature hors 15 à 17                           | « Pas encore documenté »                                                  |
| Lecture en échec                                   | Message neutre, le reste de la page reste affiché                         |

Quand le décompte daté est présenté ou retenu, l'ancien bloc « Positions calculées » (groupe actuel)
disparaît pour ce scrutin : deux tableaux de groupes qui disent des choses différentes du même vote
induiraient en erreur. Quand l'historique est indisponible, l'ancien bloc reste, avec sa mise en
garde.

## 4. Contrat de lecture sécurisé

Fichier : `prisma/migrations/manual/2026-10-21-historical-groups-public-read.sql` (retour arrière
fourni). Il ajoute **trois vues** et ne modifie aucune table.

- **Run lisible** : `COMPLETED`, et chaque snapshot épinglé est `VERIFIED`, porte l'empreinte
  épinglée, et a pour dernière décision `RELEASED`. Un run plus récent de la même législature
  remplace l'ancien. Une décision `REVOKED` retire le run de la lecture sans autre geste.
- **Position lue** : `publishable`, sans vote exclu, d'un groupe nommé. Aucun repli vers
  l'affiliation actuelle.
- **Rien d'interne** : ni empreinte, ni identifiant de run ou d'élu, ni preuve, ni décision. Des
  comptes et des noms de groupes.
- **Moindre privilège** : aucun `GRANT`. `PUBLIC`, `anon` et `authenticated` sont révoqués (Supabase
  accorde ces droits par défaut sur les objets neufs du schéma public). Les rôles `hg_*` ne lisent
  pas les vues. Le script **échoue de lui-même** si un droit subsiste ou si la RLS d'une table brute
  est coupée.
- **Bornes** : un scrutin à la fois, 40 lignes au plus, identifiant validé, SQL paramétré, schéma de
  sortie strict (liens limités à https et au site de données de l'Assemblée).
- **Lecteur unique** : `src/lib/data/historical-group-positions.ts`. Un test d'architecture interdit
  à tout autre code public de nommer les vues ou les tables brutes.

**`publishable` n'est pas l'activation.** Le premier est un statut technique du lot 5. L'activation
est une décision éditoriale : la constante `HISTORICAL_GROUP_POSITIONS_PUBLIC`
(`src/config/historical-positions.ts`), éteinte. Éteinte, la page est celle d'avant et la couche de
lecture n'est jamais appelée.

Mesure faite sur un conteneur jetable avec 156 000 positions synthétiques : lecture d'un scrutin en
0,3 ms (positions) et 1 ms (état), par l'index de clé primaire. Une première version de la vue d'état
matérialisait toutes les positions (102 ms) : réécrite avant livraison.

## 5. Tests

- Modèle de vue (états, garde en profondeur, accords au singulier, absence de tiret long et d'accent
  omis, aucune position majoritaire).
- Composant : tableau accessible (légende, en-têtes, région au clavier), tous les états.
- Couche de données : vues nommées, paramètres, bornes, rejet des lignes et des liens malformés.
- Page : interrupteur éteint (comportement d'avant) et allumé, chaque état, Sénat exclu.
- Architecture : frontière de lecture, aucun droit accordé, interrupteur éteint.
- **Intégration PostgreSQL** (conteneur jetable, non lancée par défaut) : 19 cas, sous les droits par
  défaut de Supabase, dont : run non libéré, révocation, run plus récent, rôles `anon`,
  `authenticated`, `hg_*` refusés, liste exacte des colonnes, aucune empreinte dans les valeurs. La
  révocation a été retirée du script pour vérifier que la garde interne échoue bien (48 droits).
- Rendu : stories pour chaque état, vérifiées sans violation `axe`, sans débordement horizontal à
  390 px, en clair et en sombre.

## 6. À valider avant une éventuelle activation

1. **Appliquer le SQL** sur la base partagée (geste du propriétaire, par `prisma db execute`, jamais
   `db:push`), puis relire les droits des trois vues.
2. **Méthodologie** : la page `/methodologie` ne décrit pas encore ces définitions (vote attesté,
   regroupement, non-votants, exclusions). Le bloc y renvoie : l'écrire d'abord.
3. **Définition des non-votants** : le texte dit « ils n'ont pas pris part au vote ». À confirmer
   contre la documentation de l'Assemblée.
4. **Relecture humaine d'un échantillon** : une trentaine de scrutins, dont des discordants, des
   groupes renommés de la 16e (sigle SOC) et des scrutins aux votes exclus.
5. **Redondance avec le décompte officiel par groupe** : pour les scrutins recoupés, les deux
   tableaux portent les mêmes chiffres. À arbitrer : garder les deux, ou replier l'un.
6. **Fraîcheur** : la lecture est mise en cache sous le tag `votes`. Un nouveau run n'invalide rien :
   pas de revalidation en masse (plafond de dépense). Décider de la procédure.
7. **Continuité des groupes renommés** (#1146) : reportée. Tant qu'elle ne l'est pas, la mise en
   garde reste affichée, et la vue détecte les doublons de sigle par structure, pas par décision.
8. **15e législature** : aucun `Scrutin` AN pour elle. Les 4 417 scrutins sont lus par personne.
9. **Mesure sur la base réelle** : relancer les deux requêtes de lecture avec `EXPLAIN` après
   application du SQL.

## 7. Hors périmètre, volontairement

Aucun déploiement, aucune activation, aucune écriture dans la base partagée, aucun run, aucune
modification des snapshots ou de la continuité, aucun recalcul de statistiques, aucun rattachement
aux fiches `Politician`, aucune statistique individuelle, aucune position majoritaire.
