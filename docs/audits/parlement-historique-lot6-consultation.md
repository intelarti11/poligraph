# Lot 6 : consulter les positions historiques des groupes

Premier parcours public pour lire ce que les groupes de l'Assemblée nationale ont voté à la date
d'un scrutin, à partir des runs du lot 5D. Le lot livre l'interface, la couche de lecture et les
tests. Le SQL des vues est appliqué sur la base partagée, et l'interrupteur passe à `true` dans la PR
d'activation. Le déploiement reste un geste manuel depuis le dashboard Vercel. La section 6 est le
relevé de préparation de l'activation (audit, recette, cache, GO / NO-GO).

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

**Mise à jour (section 6.2).** Le décompte daté est le repli du décompte officiel : quand le tableau
officiel est affiché, il n'est ni lu ni montré, et l'ancien bloc disparaît aussi. Le tableau de
cette section n'apparaît donc que sur 862 pages de 16e et 17e législatures, plus 12 pages où il explique
pourquoi aucun groupe n'est présentable.

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
- **Moindre privilège** : aucun `GRANT`. `PUBLIC`, `anon`, `authenticated` et `readonly` sont révoqués
  (les droits par défaut du schéma public les accordent aux objets neufs, avec `service_role`). Les
  rôles `hg_*` ne lisent pas les vues. Le script **échoue de lui-même** si un rôle autre que le
  propriétaire et `service_role` garde un droit, qu'il soit nommé ou non dans le `REVOKE`, ou si la
  RLS d'une table brute est coupée.
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
- **Intégration PostgreSQL** (conteneur jetable, non lancée par défaut) : 26 cas, sous les droits par
  défaut de Supabase, dont : run non libéré, révocation, run plus récent, rôles `anon`,
  `authenticated`, `hg_*` refusés, liste exacte des colonnes, aucune empreinte dans les valeurs. La
  révocation a été retirée du script pour vérifier que la garde interne échoue bien (48 droits). Les
  droits par défaut de Supabase sont reproduits en entier (`service_role`, `readonly`, et
  `poligraph_bot` qui en hérite avec `BYPASSRLS`) : la première version du script passait ces tests
  alors que `readonly` lisait les vues en production, parce que le jeu d'essai ne connaissait que
  `anon` et `authenticated`.
- Rendu : stories pour chaque état, vérifiées sans violation `axe`, sans débordement horizontal à
  390 px, en clair et en sombre.

## 6. Préparation de l'activation (relevé du 2026-10-19)

Les mesures ci-dessous ont été prises sur la base partagée **en lecture seule** (SELECT, transaction
`READ ONLY`), sans toucher aux snapshots, aux runs ni aux statistiques. Avant l'application du SQL,
les vues n'existaient pas : la logique du fichier a été rejouée en la composant en requête (le texte
exact du fichier, avec les trois `SELECT` en sous-requêtes). **Le SQL a ensuite été appliqué** le
2026-10-19 à 14:51Z, puis `readonly` a été révoqué sur les trois vues à 15:02Z : voir 6.1.

### 6.1 Audit du SQL fusionné et du contrat de permissions

| Contrôle                     | Constat                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Preuve                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Vues en base                 | Appliquées le 2026-10-19 à 14:51Z, avec le fichier fusionné (empreinte identique à celle de `origin/main`), en une transaction. Aucune table touchée : 126 tables, 13 séquences, 517 index et droits des autres relations identiques avant et après.                                                                                                                                                                                                                                                                                                                                                                     | Catalogue, empreinte des droits avant et après.                                                                                                |
| Runs publiables              | Trois runs `COMPLETED` (15e, 16e, 17e). Leurs snapshots épinglés sont `VERIFIED` et leur dernière décision est `RELEASED`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `hg-AN_AMO30-1` (partagé par les trois), `hg-AN_SCRUTINS_L15-1`, `-L16-1`, `-L17-1`.                                                           |
| Rôle applicatif              | `postgres`, `BYPASSRLS`, propriétaire des tables. **La RLS ne retient pas le code de l'application** : la frontière de lecture est le test d'architecture, pas la base. Risque résiduel accepté. Un rôle applicatif dédié serait un chantier d'architecture.                                                                                                                                                                                                                                                                                                                                                             | `pg_roles`, `current_user`.                                                                                                                    |
| `anon`, `authenticated`      | Aucun droit sur les tables brutes, RLS active sans politique. Les vues sont révoquées pour eux, et le script échoue de lui-même s'il reste un droit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ACL des tables brutes ; test d'intégration (refus `42501`).                                                                                    |
| `hg_*`, `readonly`           | `hg_*` : `NOLOGIN`, aucun droit sur les vues. **`readonly` : écart trouvé après l'application.** Les droits par défaut de Supabase lui donnaient `SELECT` sur les trois vues, et comme une vue ordinaire s'exécute avec les droits de son propriétaire, il les lisait malgré la RLS. `poligraph_bot` en héritait. Révoqué le 2026-10-19 à 15:02Z, dans une transaction limitée à ce `REVOKE` : rôles, appartenances et droits des autres relations identiques avant et après. Le script porte désormais `readonly` dans son `REVOKE`, et s'arrête si un autre rôle que le propriétaire et `service_role` garde un droit. | Lecture des droits effectifs avant et après ; test d'intégration avec les droits par défaut reproduits, qui échoue contre la première version. |
| `service_role`               | Garde `ALL` par les droits par défaut de Supabase et `BYPASSRLS`, comme sur chaque table du schéma. Hors périmètre du script, accessible seulement avec la clé de service.                                                                                                                                                                                                                                                                                                                                                                                                                                               | ACL des tables brutes.                                                                                                                         |
| `poligraph_bot`              | Rôle de connexion avec `BYPASSRLS`, qui hérite de `readonly`. Par le droit par défaut de `readonly` sur les tables, il lit l'ensemble du schéma public, tables brutes du lot 5 comprises. Antérieur au lot 6, inchangé ici (hors du périmètre autorisé), à traiter avec #1154.                                                                                                                                                                                                                                                                                                                                           | `has_table_privilege` effectif, appartenances.                                                                                                 |
| Lecture sur données réelles  | 17 399 scrutins (4 417 en 15e, 4 105 en 16e, 8 877 en 17e) et 161 592 lignes de groupe. Les 12 982 scrutins du site (16e et 17e) ont tous un état.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Script de lecture seule, recette ci-dessous.                                                                                                   |
| **Défaut trouvé et corrigé** | Pour les 35 scrutins discordants, la vue d'état listait `COUNT_MISMATCH` parmi les groupes écartés. Le lecteur refuse cette raison : la page aurait affiché « momentanément indisponible » et un avertissement Sentry, au lieu de l'explication prévue.                                                                                                                                                                                                                                                                                                                                                                  | 35 lignes refusées avant, 0 après, positions inchangées. Test d'intégration et garde en CI.                                                    |
| Hypothèse écartée            | Un run `COMPLETED` sans `finishedAt` passerait devant les autres dans `ORDER BY finishedAt DESC`. Impossible : la contrainte `HistoricalResolutionRun_lifecycle_consistent` l'interdit (essayé sur la base jetable).                                                                                                                                                                                                                                                                                                                                                                                                     | Test écrit puis retiré, la base refuse l'insertion.                                                                                            |
| Performance                  | Plan par index. État d'un scrutin : 2,1 ms (3 ms de planification). Lignes de groupes : 0,43 ms. Budget : 500 ms.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `EXPLAIN (ANALYZE)` sur la base réelle, SELECT seul.                                                                                           |
| Vues non `security_invoker`  | Choix voulu : la définition des vues porte toute la politique de lecture. Je crois que le contrôle de sécurité de Supabase signale ce genre de vue, à confirmer dans le dashboard après application. Les droits restent révoqués pour `anon` et `authenticated`.                                                                                                                                                                                                                                                                                                                                                         | À vérifier après application.                                                                                                                  |

**Ce que le script garantit, et ce qu'il ne garantit pas.** Il garantit qu'aucun rôle API
(`anon`, `authenticated`), aucun rôle `hg_*` et pas `readonly` ne lit les vues, que le script
s'arrête si un autre rôle que le propriétaire et `service_role` garde un droit, et qu'une
révocation de snapshot retire le run de la lecture. Il ne ferme pas les tables brutes aux rôles qui
contournent la RLS (`postgres`, `service_role`, `poligraph_bot`) : cela relève des rôles, voir #1154.
Ce que l'application ne lit pas, elle ne le lit que parce que le code ne le demande pas.

### 6.2 Redondance entre décompte officiel et décompte daté

Mesure sur les 12 982 scrutins du site, avec les vraies fonctions de décision de la page :

| Décompte officiel (publié par l'Assemblée) | Décompte daté (calculé par PoliGraph) | Pages  |
| ------------------------------------------ | ------------------------------------- | ------ |
| affiché                                    | positions (complet ou partiel)        | 12 103 |
| affiché                                    | écarté, décomptes discordants         | 5      |
| non importé ou non fiable                  | positions (complet ou partiel)        | 862    |
| non fiable                                 | aucun groupe présentable              | 12     |

Sur les groupes présents des deux côtés, **aucune différence de chiffres sur 125 775 lignes**. Le
tableau daté est donc, là où le décompte officiel existe, une copie de ce dernier moins la ligne
des non-inscrits et les groupes à zéro. Le document du lot en faisait l'hypothèse (ancien point 5) : la mesure la confirme.

**Règle retenue.** Le décompte daté est le repli du décompte officiel. Quand le tableau officiel est
affiché, le décompte daté n'est ni lu ni affiché, et l'ancien bloc « positions calculées » (groupe
actuel) disparaît aussi, comme prévu par le lot. Le tableau daté ne paraît donc plus que sur 874
pages (6,7 %), celles où il apporte quelque chose. Deux effets de bord utiles : les pages qui
affichent le tableau officiel ne dépendent plus des nouvelles vues (si elles cassaient, 93 % des
pages ne bougeraient pas), et le bruit des états « pas encore disponible » disparaît là où le
décompte officiel suffit.

**Avis « sigle partagé » resserré.** Il s'affichait sur 10 705 pages sur 12 982, sans désigner
aucune ligne visible (jamais deux lignes de même sigle dans un même scrutin). Il ne s'affiche plus
que lorsque deux lignes, ou une ligne et un groupe écarté, partagent un sigle sur la page : cas
décrit par le lot, et qui ne se présente dans aucun scrutin actuel.

### 6.3 Textes relus

- Titre du bloc : « Votes par groupe le … ». L'ancien « Vote de chaque groupe » laissait entendre
  que le groupe vote en bloc, ce que la méthodologie nie.
- Introduction : dit que le chiffre est **calculé par PoliGraph**, puis l'aide explique d'où vient
  le groupe de chaque député. Les deux disaient la même chose l'une sous l'autre.
- Non-votants : l'Assemblée range dans cette catégorie, sur ses pages de scrutin, des membres du
  Gouvernement (mention « Membre du gouvernement ») et la personne qui préside la séance (mention
  « Présidente de séance » ou « Présidente de l'Assemblée nationale »). Vérifié sur la page d'un
  scrutin de la 17e législature. Le texte le dit, sans prétendre en donner la définition complète,
  que je n'ai pas trouvée dans un texte de l'Assemblée.
- « Députés non inscrits » : terme de l'Assemblée, repris tel quel.
- Noms des jeux de données : « Scrutins » (intitulé relevé sur le portail de données ouvertes) et
  « acteurs, mandats et organes » (fichier AMO). L'ancien « votes nominatifs » n'est pas un
  intitulé de l'Assemblée.
- Date d'arrêt des groupes : sous le tableau, « Groupes et mandats arrêtés au … », car le fichier des
  groupes et celui des scrutins n'ont pas la même date. Rien n'est affiché si le fichier n'en porte pas.
- Méthodologie : la 15e législature n'est plus citée (aucun scrutin du site). La cause d'un écart
  de totaux n'est plus affirmée (« périmètre différent » n'était étayé par rien). Le rôle de repli du
  tableau est dit en première phrase. Un accord grammatical corrigé (« pour ces députés »).

### 6.4 Recette : 30 scrutins sur la base réelle

Choisis pour couvrir chaque état réel des deux blocs et les deux législatures, dans l'ordre : résultats
cohérents, scrutins discordants, conflits, non-inscrits, groupes écartés, données absentes, bornes
de période. Lien de lecture : `/parlement/votes/<identifiant>` (la page accepte l'identifiant externe
et redirige vers l'adresse canonique).

| Cas                                                 | Identifiant      | Date             | Ce que la page montre (vérifié au rendu)                                                                                                                                           |
| --------------------------------------------------- | ---------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 officiel affiché, 16e                            | `VTANR5L16V923`  | 9 février 2023   | Tableau officiel seul. Ni bloc daté, ni « positions calculées », ni mention « non affichées ».                                                                                     |
| A1 officiel affiché, 16e                            | `VTANR5L16V2661` | 5 octobre 2023   | Tableau officiel seul. Ni bloc daté, ni « positions calculées », ni mention « non affichées ».                                                                                     |
| A2 officiel affiché, 17e                            | `VTANR5L17V2116` | 27 mai 2025      | Tableau officiel seul. Ni bloc daté, ni « positions calculées », ni mention « non affichées ».                                                                                     |
| A2 officiel affiché, 17e                            | `VTANR5L17V6543` | 12 mai 2026      | Tableau officiel seul. Ni bloc daté, ni « positions calculées », ni mention « non affichées ».                                                                                     |
| A3 vote clé, officiel affiché                       | `VTANR5L17V5397` | 12 février 2026  | Tableau officiel seul. Ni bloc daté, ni « positions calculées », ni mention « non affichées ».                                                                                     |
| A3 vote clé, officiel affiché                       | `VTANR5L17V7404` | 16 juin 2026     | Tableau officiel seul. Ni bloc daté, ni « positions calculées », ni mention « non affichées ».                                                                                     |
| B officiel affiché, daté partiel (masqué)           | `VTANR5L16V2284` | 13 juillet 2023  | Tableau officiel seul. Ni bloc daté, ni « positions calculées », ni mention « non affichées ».                                                                                     |
| B officiel affiché, daté partiel (masqué)           | `VTANR5L17V4126` | 21 novembre 2025 | Tableau officiel seul. Ni bloc daté, ni « positions calculées », ni mention « non affichées ».                                                                                     |
| C décomptes discordants, officiel affiché           | `VTANR5L16V1927` | 21 juin 2023     | Tableau officiel seul. Ni bloc daté, ni « positions calculées », ni mention « non affichées ».                                                                                     |
| C décomptes discordants, officiel affiché           | `VTANR5L16V1929` | 21 juin 2023     | Tableau officiel seul. Ni bloc daté, ni « positions calculées », ni mention « non affichées ».                                                                                     |
| C décomptes discordants, officiel affiché           | `VTANR5L16V1930` | 21 juin 2023     | Tableau officiel seul. Ni bloc daté, ni « positions calculées », ni mention « non affichées ».                                                                                     |
| C décomptes discordants, officiel affiché           | `VTANR5L16V1948` | 21 juin 2023     | Tableau officiel seul. Ni bloc daté, ni « positions calculées », ni mention « non affichées ».                                                                                     |
| C décomptes discordants, officiel affiché           | `VTANR5L17V1`    | 8 octobre 2024   | Tableau officiel seul. Ni bloc daté, ni « positions calculées », ni mention « non affichées ».                                                                                     |
| D officiel non importé, daté complet                | `VTANR5L17V8612` | 8 octobre 2026   | Encadré « Décompte officiel pas encore importé », puis « Votes par groupe » (complet), source et date d'arrêt des groupes.                                                         |
| D officiel non importé, daté complet                | `VTANR5L17V8743` | 15 octobre 2026  | Encadré « Décompte officiel pas encore importé », puis « Votes par groupe » (complet), source et date d'arrêt des groupes.                                                         |
| D officiel non importé, daté complet                | `VTANR5L17V8833` | 16 octobre 2026  | Encadré « Décompte officiel pas encore importé », puis « Votes par groupe » (complet), source et date d'arrêt des groupes.                                                         |
| E officiel non importé, daté partiel                | `VTANR5L17V8619` | 8 octobre 2026   | Encadré « Décompte officiel pas encore importé », puis « Votes par groupe » (partiel, avec « Groupes non présentés »), source et date d'arrêt des groupes.                         |
| E officiel non importé, daté partiel                | `VTANR5L17V8819` | 16 octobre 2026  | Encadré « Décompte officiel pas encore importé », puis « Votes par groupe » (partiel, avec « Groupes non présentés »), source et date d'arrêt des groupes.                         |
| F1 officiel non fiable, daté partiel, conflit       | `VTANR5L16V3062` | 29 novembre 2023 | Encadré « Décompte officiel par groupe non affiché » avec sa raison, puis « Votes par groupe » (partiel) : votes écartés pour conflit, groupe non présenté.                        |
| F1 officiel non fiable, daté partiel, conflit       | `VTANR5L16V3352` | 13 février 2024  | Encadré « Décompte officiel par groupe non affiché » avec sa raison, puis « Votes par groupe » (partiel) : votes écartés pour conflit, avis des non-inscrits, groupe non présenté. |
| F2 officiel non fiable, daté partiel, groupe écarté | `VTANR5L16V3485` | 13 mars 2024     | Encadré « Décompte officiel par groupe non affiché » avec sa raison, puis « Votes par groupe » (partiel) : avis des non-inscrits, groupe non présenté.                             |
| F3 non-inscrits                                     | `VTANR5L16V3248` | 24 janvier 2024  | Encadré « Décompte officiel par groupe non affiché » avec sa raison, puis « Votes par groupe » (partiel) : votes écartés pour conflit, avis des non-inscrits, groupe non présenté. |
| G officiel non fiable, daté complet                 | `VTANR5L16V2922` | 7 novembre 2023  | Encadré « Décompte officiel par groupe non affiché » avec sa raison, puis « Votes par groupe » (complet).                                                                          |
| G officiel non fiable, daté complet                 | `VTANR5L16V3208` | 13 décembre 2023 | Encadré « Décompte officiel par groupe non affiché » avec sa raison, puis « Votes par groupe » (complet).                                                                          |
| H aucun groupe présentable                          | `VTANR5L17V492`  | 2 décembre 2024  | Deux encadrés, aucun tableau : décompte officiel non affiché, puis « Aucun groupe présentable » avec le nombre de votes sans groupe.                                               |
| H aucun groupe présentable                          | `VTANR5L17V496`  | 2 décembre 2024  | Deux encadrés, aucun tableau : décompte officiel non affiché, puis « Aucun groupe présentable » avec le nombre de votes sans groupe.                                               |
| H aucun groupe présentable                          | `VTANR5L17V500`  | 2 décembre 2024  | Deux encadrés, aucun tableau : décompte officiel non affiché, puis « Aucun groupe présentable » avec le nombre de votes sans groupe.                                               |
| I groupe inconnu                                    | `VTANR5L17V493`  | 2 décembre 2024  | Deux encadrés, aucun tableau : décompte officiel non affiché, puis « Aucun groupe présentable » avec le nombre de votes sans groupe.                                               |
| K1 premier scrutin de la 16e                        | `VTANR5L16V1`    | 11 juillet 2022  | Tableau officiel seul. Ni bloc daté, ni « positions calculées », ni mention « non affichées ».                                                                                     |
| K2 scrutin le plus récent de la 17e                 | `VTANR5L17V8877` | 16 octobre 2026  | Encadré « Décompte officiel pas encore importé », puis « Votes par groupe » (complet), source et date d'arrêt des groupes.                                                         |

**Contrôle de rendu.** Les 30 scrutins ont été chargés dans un vrai navigateur (interrupteur allumé
en local seulement, lecture par les corps de vues du fichier SQL, serveur de développement sans
Sentry) en quatre variantes : ordinateur 1400 px et mobile 390 px, en clair et en sombre.

- 120 chargements, 120 réponses 200, le thème demandé est bien celui appliqué.
- Aucun débordement horizontal de la page ni de la section, aucune cible « Comment lire ces
  chiffres » sous 44 px.
- `axe` (règles WCAG 2 A et AA, 2.1 AA, bonnes pratiques) : 0 violation. Contrôlé capable d'échouer :
  sur la même section, trois violations injectées (nom de bouton, alternative d'image, contraste)
  sont toutes détectées.
- Défaut trouvé et corrigé : sur mobile, « Non-votants » se coupait au tiret. Mesuré après correction :
  106 occurrences sur 12 pages, aucune sur deux lignes.
- Lecture humaine toujours nécessaire : un contrôle automatique ne juge ni le ton ni la justesse
  d'une phrase. Les cas F1 et H sont les plus utiles à relire.

### 6.5 Cache et invalidation ciblée

**Ce que fait déjà le site.** La lecture historique portait le tag `votes`, que la synchronisation
quotidienne (`scripts/sync-daily.ts`, étape « Votes cache revalidation ») purge chaque jour. Contrairement
à ce que disait la première version de ce document, un nouveau run ne reste donc pas invisible :
il apparaît à la prochaine synchronisation, sans geste. **Aucune revalidation manuelle n'est
nécessaire pour un fonctionnement normal.**

**Ce qui manquait : retirer vite sans purger `votes`.** Purger `votes` régénère tout le site et a
fait atteindre le plafond de dépense de Vercel le 2026-07-29. La lecture porte désormais aussi le
tag étroit `historical-group-positions`, ajouté aux tags sélectionnables et à ceux que la route
`/api/cron/revalidate` sait expirer sur-le-champ (`expireNow`), donc sans servir une seule fois de
plus l'entrée périmée.

Retrait d'urgence, à lancer par le mainteneur avec `CRON_SECRET` (aucune autre donnée n'est touchée) :

```
POST /api/cron/revalidate
Authorization: Bearer $CRON_SECRET
{"tags": ["historical-group-positions"], "expireNow": true}
```

Il n'invalide que les pages qui ont lu cette lecture (scrutins de l'Assemblée nationale), à la
demande et paresseusement : une page est régénérée à sa prochaine visite. **Ne jamais y ajouter
`votes`.** Au plus 12 982 pages sont concernées, et seulement celles que quelqu'un visite.

### 6.6 Activation et retour arrière

L'activation se fait en deux gestes séparés, chacun à autoriser :

1. **Appliquer le SQL** (geste du propriétaire). Fait le 2026-10-19 à 14:51Z, puis `REVOKE` de
   `readonly` à 15:02Z, droits, comptes et plan relus. Le fichier du dépôt porte la version
   corrigée : la base lui correspond, sans nouvelle exécution. Sans effet visible tant que
   l'interrupteur est éteint.
2. **Passer `HISTORICAL_GROUP_POSITIONS_PUBLIC` à `true`** dans une PR d'une ligne, la fusionner,
   puis déploiement manuel depuis le dashboard Vercel. Rien n'est déployé par une fusion.

L'ouverture est progressive par construction : seules 874 pages changent de contenu, les autres
affichent le tableau officiel comme aujourd'hui.

**Retour arrière, du plus étroit au plus large :**

| Niveau | Geste                                                                                                                                                  | Effet                                                                                           | Déploiement |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------- |
| R1     | Insérer une décision `REVOKED` sur un snapshot, puis expirer le tag étroit (6.5).                                                                      | Le run quitte la lecture : « pas encore disponible » sur les pages concernées.                  | Non         |
| R2     | PR qui remet l'interrupteur à `false`, puis déploiement manuel (ou redéploiement de la version précédente depuis le dashboard, à confirmer sur place). | Le bloc, la section de méthodologie et son lien disparaissent. La page redevient celle d'avant. | Oui         |
| R3     | Script de retrait (`…-rollback.sql`) : supprime les trois vues, aucune donnée touchée.                                                                 | Les lectures échouent : « momentanément indisponible », avertissement Sentry. À suivre de R2.   | Non         |

R1, retrait par législature : `hg-AN_SCRUTINS_L16-1`, `hg-AN_SCRUTINS_L17-1` (ou `-L15-1`). Révoquer
`hg-AN_AMO30-1`, partagé, retire les trois législatures. Il n'existe **pas** de commande `revoke`
dans `scripts/historical-groups.ts` (seulement `fingerprint`, `import`, `verify`, `release`, `run`,
`verify-run`) : c'est une insertion dans `SnapshotDecision`, validée sur la base jetable :

```sql
INSERT INTO "SnapshotDecision"("snapshotId", "status", "reason", "decidedBy", "decidedByKind")
VALUES ('hg-AN_SCRUTINS_L16-1', 'REVOKED', '<raison>', '<nom>', 'HUMAN');
```

R1 n'efface rien : insérer une décision `RELEASED` plus récente remet le run en lecture.

### 6.7 GO / NO-GO

Seuls les risques bloquants. Chaque ligne a sa preuve.

| #   | Condition                                                                                           | État au 2026-10-19            | Preuve                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | Le SQL est appliqué, droits relus : rien pour `PUBLIC`, `anon`, `authenticated`, `readonly`, `hg_*` | Fait le 2026-10-19            | Application à 14:51Z, `REVOKE` de `readonly` à 15:02Z, relecture des droits effectifs et refus par rôle. |
| 2   | Les trois vues rendent 17 399 états et 161 592 lignes sur la base réelle                            | Vérifié sur les vues          | Égalité exacte avec le rejeu, avant et après la révocation.                                              |
| 3   | Aucun scrutin du site ne tombe en « lecture en échec »                                              | Vérifié, après correction     | 35 lignes refusées avant, 0 après ; test d'intégration ; garde en CI.                                    |
| 4   | Plan de lecture sous 500 ms                                                                         | Vérifié                       | 2,1 ms et 0,43 ms.                                                                                       |
| 5   | Aucune page ne montre deux tableaux de groupes                                                      | Vérifié                       | Test de page ; rendu réel de 30 scrutins.                                                                |
| 6   | Rendu correct sur mobile et ordinateur, en clair et en sombre, sans violation `axe`                 | Vérifié                       | 120 chargements, 0 violation `axe` (6.4).                                                                |
| 7   | Retour arrière R1 et R2 répétés avant l'activation                                                  | À faire                       | R1 sur une base jetable est couvert par les tests ; R2 se fait sur le dashboard.                         |
| 8   | Plafond de dépense Vercel et alerte en place                                                        | À confirmer par le mainteneur | Dashboard Vercel.                                                                                        |
| 9   | Relecture humaine des textes (6.3) et de la méthodologie                                            | À faire                       | Cette PR.                                                                                                |
| 10  | Chemins d'accès serveur et rôle applicatif examinés (#1154)                                         | À faire avant l'activation    | Issue #1154.                                                                                             |

NO-GO si : une ligne 1 à 6 est fausse, ou si Sentry montre l'empreinte
`historical-group-positions-unreadable` après application du SQL.

## 7. Hors périmètre, volontairement

Aucun déploiement, aucune activation, aucune écriture dans la base partagée, aucun run, aucune
modification des snapshots ou de la continuité, aucun recalcul de statistiques, aucun rattachement
aux fiches `Politician`, aucune statistique individuelle, aucune position majoritaire.
