# Lot 5B : rapport d'exécution sur base locale jetable

Périmètre : étapes 1 à 7 du plan, autorisées le 18 octobre, **exclusivement** sur un conteneur local
dédié (`postgres:17`, PostgreSQL 17.11, `127.0.0.1:55486`, `btree_gist` 1.7). Aucune connexion à la
préproduction ni à la production, aucune donnée officielle, aucun import, aucun recalcul.

## 0. Garde-fous de l'exécution

| Garde                         | Mise en œuvre                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pas de variable de production | La suite ne lit que `HISTORICAL_SCHEMA_TEST_DATABASE_URL`, jamais `DATABASE_URL` ni `DIRECT_URL`. Elle refuse une URL égale à l'une des deux. Lancée avec `env -u DATABASE_URL -u DIRECT_URL`                 |
| URL de la cible               | Épinglée sur `127.0.0.1:55486`, base et utilisateur `hg_schema_test`, refusée au chargement du fichier sinon                                                                                                  |
| Marqueur dans la base         | `hg.disposable = 'yes'` posé à la main sur le conteneur. Les tests le vérifient avant chaque remise à zéro (qui supprime le schéma `public`). Un tunnel vers un autre serveur sur ce port ne le porterait pas |
| Garde neutralisée             | Jamais pour faire passer un test. Les seuls cas : `DISABLE TRIGGER USER` pour atteindre la contrainte d'exclusion, dans un test dont c'est l'objet, et l'essai du propriétaire dans une transaction annulée   |
| Benchmark                     | Même marqueur, vérifié par le script lui-même avant la première écriture                                                                                                                                      |

## 1. Les 49 tests prévus

Premier passage, avant toute correction : **39 passés, 10 échoués**. Les 10 échecs :

| Test                                                                                                                   | Motif                                                                                                                                    | Nature                                                          |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 6 tests « converges over … » (déclencheur désactivé, supprimé, RLS, droit à `anon`, index autonome, corps de fonction) | Ils vérifiaient la réparation automatique, que votre arbitrage B supprime                                                                | Test obsolète, réécrit : le script refuse désormais ces six cas |
| Rollback « s'arrête sur une ligne et supprime tout si vide »                                                           | **Erreur SQL réelle** : voir 2                                                                                                           | Bug du SQL                                                      |
| 2 tests « second active version »                                                                                      | J'avais créé le snapshot 2 avant d'écrire au snapshot 1, et la garde refuse à raison d'écrire dans un snapshot qui n'est plus le dernier | Bug du test, la garde est correcte                              |
| « uses an index for the lookups »                                                                                      | Délai de 5 s par défaut dépassé par l'insertion de 30 000 lignes                                                                         | Configuration du test                                           |

État final : **78 tests, 78 passés**, trois exécutions successives identiques. Les 49 d'origine y sont
tous (20 divergences refusées, dont les 6 anciens cas de réparation), plus 29 tests ajoutés.

| Groupe                                                                                            | Tests |
| ------------------------------------------------------------------------------------------------- | ----- |
| Le script lui-même (application, deuxième application, 20 divergences, états de départ, rollback) | 25    |
| Snapshots et décisions                                                                            | 8     |
| Versions d'enregistrements (dont les cinq tables, une par une)                                    | 19    |
| Décisions en ajout seul                                                                           | 5     |
| Runs                                                                                              | 5     |
| Attestations                                                                                      | 1     |
| Concurrence                                                                                       | 8     |
| Privilèges                                                                                        | 7     |

## 2. Erreurs SQL ou PL/pgSQL découvertes

Toutes absentes de l'analyse statique, toutes corrigées dans la PR.

| #   | Erreur                                                                                                               | Où                                                                                                        | Correction                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | `operator is not unique: text \|\| "char"`                                                                           | Comparaison de catalogues (type `contype`, `tgenabled`, `relkind`)                                        | Conversions explicites en `text`                                                                            |
| 2   | `function acldefault(text, oid) does not exist`                                                                      | Comparaison des droits                                                                                    | Conversion du résultat du `CASE` en `"char"`                                                                |
| 3   | `CAST('…' AS integer)` replié en constante à la planification : le rollback aurait échoué **même sur une base vide** | Script de retour arrière                                                                                  | Le `CAST` porte sur un `string_agg` de la table, qui n'échoue que si une ligne existe                       |
| 4   | `permission denied for table OfficialSourceSnapshot`                                                                 | `SELECT … FOR SHARE` des gardes : un verrou de ligne exige un droit `UPDATE`, sur une table en ajout seul | Verrous consultatifs transactionnels (`pg_advisory_xact_lock[_shared]`), sans droit sur la table            |
| 5   | `permission denied for function historical_assert_snapshot_writable`                                                 | La garde appelait une fonction d'aide, dont `EXECUTE` est retiré à `PUBLIC`                               | Contrôle intégré à `historical_version_guard`, la fonction d'aide est supprimée (9 fonctions au lieu de 10) |

Constats du test, pas du SQL : un rôle importateur non propriétaire est refusé par la RLS (aucune
politique), et ses `UPDATE` ne touchent alors **aucune ligne sans erreur**. Voir 7.

### Courses non vues par l'analyse statique

En écrivant les tests de concurrence, j'ai trouvé trois trous réels dans les gardes d'origine, que
la lecture n'avait pas vus : à l'isolation `READ COMMITTED`, un enregistrement pouvait être écrit
**après** la publication du snapshot, ou après la création de son successeur, et une ligne pouvait
être ajoutée à un run qui venait de se terminer. Corrigé par des verrous consultatifs : écriture
d'enregistrement et épinglage (partagé), publication ou révocation, nouveau snapshot et fin de run
(exclusif). Chacun des cas a un test qui échoue sans le verrou.

## 3. Écarts entre le schéma attendu et les catalogues réels

- **Installation sur base vide** : comparaison avant et après la construction, **0 écart**
  (colonnes, contraintes, index, déclencheurs, fonctions, RLS, droits). 13 tables, 9 fonctions, 37
  déclencheurs tous `ENABLE ALWAYS`, aucun schéma `hg_reference` restant.
- **Divergences injectées** : 20, toutes refusées avant toute écriture avec la liste des écarts, et
  chacune encore présente après le refus (rien n'est réparé) : contrainte `CHECK` ou d'exclusion
  retirée, colonne en trop, type changé, défaut retiré, index de même nom autre définition, index
  retiré ou en trop, déclencheur en trop, désactivé, non `ENABLE ALWAYS` ou supprimé, RLS retirée,
  droit à `anon` sur une table, droit à `PUBLIC` sur une fonction, corps de fonction changé,
  `search_path` retiré, fonction supprimée ou en trop, table manquante (installation partielle).
- **Pas d'écart de format** : la crainte d'un format de `pg_get_constraintdef` ou de défaut de
  colonne différent de celui attendu ne s'est pas réalisée, parce que la référence est construite par
  le même texte sur le même serveur, au lieu d'être écrite à la main.
- **Installation neuve avec des fonctions déjà présentes** : acceptée si elles sont identiques,
  refusée si une diffère.

## 4. Seconde application

Sur le schéma complet : **sortie 0**, aucun changement. Une empreinte de 252 éléments de catalogue
(contraintes, index, déclencheurs avec leur état, corps des fonctions, droits, RLS) est
**identique** avant, après une deuxième et après une troisième application.

## 5. Concurrence

8 tests, tous passés.

| Cas                                                                       | Résultat                                                                                                                |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Huit écrivains se disputent les numéros de snapshot (5 chacun)            | Numéros 1 à 40, sans trou ni doublon. Les perdants reçoivent une violation d'unicité ou de contrôle, jamais autre chose |
| Deux écrivains, même numéro                                               | Le second attend le premier. Si le premier annule, le second réussit. S'il valide, le second échoue                     |
| Publication pendant qu'un écrivain tient le snapshot                      | La publication attend, l'enregistrement est conservé                                                                    |
| Enregistrement pendant qu'une publication se valide                       | L'enregistrement attend, puis est refusé                                                                                |
| Nouveau snapshot pendant qu'un écrivain tient le précédent                | Le nouveau attend, puis le précédent est gelé                                                                           |
| Enregistrement pour un snapshot remplacé pendant l'attente                | Refusé                                                                                                                  |
| Fin de run pendant qu'une exclusion s'ajoute, puis exclusion après la fin | La fin attend, l'ajout tardif est refusé                                                                                |
| Quatre écrivains de 2 000 lignes sur le même snapshot                     | Pas d'interblocage, 8 000 lignes                                                                                        |

Limite : ces tests prouvent l'ordre des attentes et l'absence d'écriture tardive sur les scénarios
écrits. Ils ne parcourent pas tous les entrelacements possibles.

## 6. Benchmark synthétique

Données entièrement fabriquées, volumes de la 15e, 16e et 17e législatures : **2 399 520
attestations**, 650 acteurs fictifs, une transaction par flux comme le ferait l'importeur. Script :
`parlement-historique-lot5b-benchmark.sql`. Conteneur sans réglage (`shared_buffers` à 128 Mo) : les
durées sont pessimistes pour une machine d'hébergement.

| Flux      | Lignes        | Durée           | Débit              |
| --------- | ------------- | --------------- | ------------------ |
| L15       | 472 631       | 1 min 35 s      | 4 960 lignes/s     |
| L16       | 602 911       | 3 min 31 s      | 2 860 lignes/s     |
| L17       | 1 323 978     | 9 min 04 s      | 2 430 lignes/s     |
| **Total** | **2 399 520** | **14 min 10 s** | **2 820 lignes/s** |

Le débit baisse quand les index dépassent le cache.

**Coût des gardes** (arbitrage G) : même insertion de 602 911 lignes, dans une transaction annulée,
sans les déclencheurs puis avec : **149,0 s sans, 143,5 s avec**. Les gardes ne coûtent rien de
mesurable, la différence est dans le bruit. Le coût est celui des index.

| Stockage après chargement | Taille       |
| ------------------------- | ------------ |
| Table                     | 625 Mo       |
| Index                     | 857 Mo       |
| **Total**                 | **1 481 Mo** |

| Index                           | Taille          |
| ------------------------------- | --------------- |
| `no_overlap` (exclusion `gist`) | 341 Mo          |
| clé primaire                    | 215 Mo          |
| `active_key` (unique partiel)   | 209 Mo          |
| les trois index de lecture      | 40, 29 et 23 Mo |

La taille finale de la table (1 981 Mo) inclut les lignes mortes des deux insertions annulées du test
de coût et l'étape C ; elle n'est pas représentative.

| Lecture                                   | Plan                                           | Durée   |
| ----------------------------------------- | ---------------------------------------------- | ------- |
| Un scrutin (150 votants)                  | index `(stream, scrutinExternalId)`            | 0,07 ms |
| Un acteur sur deux mois (1 200 lignes)    | index `(stream, officialId, scrutinDate)`      | 3,8 ms  |
| Un groupe depuis une date (43 900 lignes) | parcours d'index seul, 43 900 accès à la table | 87 ms   |
| Version active d'une identité             | index d'exclusion                              | 0,28 ms |
| État à un snapshot donné                  | index `(stream, scrutinExternalId)` et filtre  | 0,09 ms |

**Correction rétroactive** de 1 % de la L17 (13 350 lignes) : 5,8 s pour fermer les versions, 6,4 s
pour insérer les nouvelles.

**Ce que cela dit de l'arbitrage G** : garder les gardes par ligne, elles ne coûtent pas. Le choix à
faire est ailleurs : l'index unique partiel `active_key` des attestations pèse 209 Mo (14 % du total)
et double ce que l'exclusion garantit déjà, qui sert aussi la lecture de la version active. Je ne l'ai
pas retiré : l'erreur qu'il donne est plus lisible et le choix est le vôtre. Le retirer sur cette seule
table économiserait ces 209 Mo et une partie du temps d'écriture.

## 7. Limites des privilèges du rôle applicatif

L'application se connecte avec le propriétaire des tables (le rôle `postgres` de Supabase). La
connexion de test est un superutilisateur, plus fort encore : le rôle `postgres` de Supabase, qui n'est
pas superutilisateur, n'a pas été reproduit.

- **Le propriétaire peut défaire une garde** (`DROP TRIGGER`, `DISABLE TRIGGER`, `DROP TABLE`) :
  vérifié, dans une transaction annulée. Les gardes protègent contre une erreur de code, pas contre
  un opérateur qui est le propriétaire. La divergence est détectée et bloque à la prochaine
  exécution du script.
- **`session_replication_role = replica` ne contourne pas les gardes** (`ENABLE ALWAYS`). Un rôle
  non propriétaire n'a même pas le droit de le positionner.
- **Un importateur non propriétaire est possible**, avec `SELECT` et `INSERT` sur les tables qu'il
  alimente, `UPDATE ("toSeq")` sur les tables de versions et l'usage de la séquence des décisions.
  Il mène un import complet (artefact, snapshot, enregistrements, publication). Il n'a pas besoin
  d'`EXECUTE` sur les fonctions de garde, ni d'`UPDATE` sur les tables en ajout seul.
- **Il lui faut `BYPASSRLS`**, car les tables ont la RLS sans politique. Sans cela, ses `INSERT` sont
  refusés et ses `UPDATE` **ne modifient aucune ligne sans signaler d'erreur** : un importateur doit
  vérifier le nombre de lignes touchées.
- Les gardes lisent `OfficialSourceSnapshot`, `SnapshotDecision` et `HistoricalResolutionRun` avec
  les droits de l'écrivain : un rôle qui écrit doit pouvoir les lire.
- Refusés à cet importateur (`42501`) : changer une autre colonne, `DELETE`, `TRUNCATE`, supprimer ou
  désactiver un déclencheur, lire les journaux d'identité, écrire les tables de runs. La colonne qu'il
  peut modifier (`toSeq`) reste encadrée par la garde.
- `anon` et `authenticated` n'ont aucun accès, même avec l'usage du schéma, et un `GRANT` ajouté par
  erreur n'ouvre rien : la RLS les laisse sans ligne. Aucune fonction du lot n'est exécutable par
  `PUBLIC`, `anon` ou `authenticated`.

## 8. Contrats de sécurité existants

| Contrôle                                                                                                           | Résultat                                         |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `test:security:data-path` (SEC-02)                                                                                 | passe                                            |
| `test:security:least-privilege` (SEC-03)                                                                           | passe                                            |
| `test:security:function-privileges` (SEC-06)                                                                       | passe                                            |
| Gardes sources SEC-03 et SEC-06 sur les deux fichiers SQL                                                          | passent                                          |
| Contrat de catalogue SEC-06 **avec le schéma du lot appliqué** sur l'état durci (migration SEC-06 appliquée avant) | satisfait avant et après l'application du schéma |
| Seconde application, puis retour arrière sur ce même état                                                          | passent, 0 table restante                        |
| Rollback avec une ligne présente                                                                                   | refusé, rien n'est supprimé (test d'intégration) |

Les trois scripts SEC du dépôt n'appliquent pas le schéma du lot : j'ai donc rejoué le contrat de
catalogue SEC-06 sur un conteneur où le schéma est appliqué après leur migration, avec leurs
fonctions de préparation.

## 9. Corrections apportées à la PR

1. Arbitrage B : la comparaison de catalogues précède désormais toute écriture dans le schéma réel
   et un état partiel est refusé. Une seconde comparaison suit la construction.
2. Trois erreurs SQL (opérateur ambigu, type de `acldefault`, contrôle du rollback replié en
   constante).
3. Verrous consultatifs pour les courses (écrivain contre publication, contre nouveau snapshot,
   contre fin de run), et suppression de la fonction d'aide qui exigeait un droit de plus.
4. Suite d'intégration : 78 tests, garde-fou de marqueur, isolation des variables de production,
   tests de concurrence et de privilèges.
5. Rapport et plan mis à jour, benchmark ajouté.

## 10. Ce qui n'a pas été fait

- Aucune exécution sur la préproduction ni la production, aucun import officiel, aucun recalcul.
- Le rôle `postgres` de Supabase (non superutilisateur) n'a pas été reproduit, ni le pooleur de
  connexions. Les verrous consultatifs sont transactionnels, donc compatibles avec un pooleur en mode
  transaction, mais ce point reste à vérifier sur la préproduction.
- Les durées sont celles d'un conteneur sans réglage. Elles ne se transposent pas telles quelles.
- La couverture des corps PL/pgSQL n'est pas mesurée : chacune des 9 fonctions est exercée par au
  moins un test, pas chacune de leurs branches.
