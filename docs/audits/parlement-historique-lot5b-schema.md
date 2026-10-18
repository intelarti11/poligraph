# Lot 5B : schéma des affiliations historiques, rapport et plan de vérification

Statut : **SQL et modèles Prisma écrits, rien n'a été exécuté, sur aucune base.** Ni production, ni
préproduction, ni base locale jetable. Les validations ci-dessous sont statiques. Aucune migration ne
sera lancée sans votre accord sur le plan de la section 6.

Référence : `docs/audits/parlement-historique-lot5-architecture-v2.md` (section 4), phase 5A fusionnée
(PR #1129 et #1130).

## 1. Ce que la PR contient

| Fichier                                                                     | Rôle                                                                                                                                          |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma/migrations/manual/2026-10-18-historical-groups-schema.sql`          | Le schéma : 13 tables, 10 fonctions, 37 déclencheurs, 5 contraintes d'exclusion, 104 contraintes `CHECK`, 15 clés étrangères. Une transaction |
| `prisma/migrations/manual/2026-10-18-historical-groups-schema-rollback.sql` | Retour arrière, refusé dès qu'une table contient une ligne                                                                                    |
| `prisma/schema.prisma`                                                      | 13 modèles ajoutés à la fin, 255 lignes ajoutées, aucune modifiée                                                                             |
| `__tests__/schema-conformance.test.ts`                                      | 16 tests statiques, dont 8 qui abîment le SQL pour vérifier que le contrôle échoue                                                            |
| `__tests__/schema.integration.test.ts`                                      | 49 tests sur une base jetable. **Non exécutés**, ignorés sans variable d'environnement, hors CI                                               |

Aucune table, synchronisation, route ou statistique existante n'est touchée. Aucune activation.

## 2. Les tables

| Table                       | Rôle                                                                            | Versionnée               |
| --------------------------- | ------------------------------------------------------------------------------- | ------------------------ |
| `SourceArtifact`            | Octets d'origine, adressés par leur SHA-256. Seul `lastVerifiedAt` peut avancer | non                      |
| `OfficialSourceSnapshot`    | Un instantané par flux, numéroté sans trou                                      | non, immuable            |
| `SnapshotDecision`          | Journal : `QUARANTINED`, `RELEASED`, `REVOKED`                                  | non, ajout seul          |
| `OfficialActor`             | Existence d'un acteur dans AMO30                                                | oui                      |
| `OfficialOrganRecord`       | Organes de type `GP` d'AMO30                                                    | oui                      |
| `GroupMembershipRecord`     | Mandats de groupe                                                               | oui                      |
| `SeatMandateRecord`         | Mandats de siège (`ASSEMBLEE`), pour le lien vote et siège                      | oui                      |
| `ScrutinVoterAttestation`   | Un votant tel que listé dans un scrutin                                         | oui                      |
| `OfficialActorLinkDecision` | Lien entre un acteur officiel et une fiche                                      | non, ajout seul          |
| `OrganContinuityDecision`   | Continuité entre deux organes                                                   | non, ajout seul          |
| `HistoricalResolutionRun`   | Un calcul épinglé                                                               | non, se termine une fois |
| `HistoricalRunSnapshotPin`  | Les instantanés qu'un run a lus                                                 | non, ajout seul          |
| `RunExclusion`              | Les votes qu'un run a écartés, avec le motif                                    | non, ajout seul          |

Aucune table ne porte de clé vers `Politician`, `ParliamentaryGroup`, `AnOrgan`, `Mandate`, `Vote` ou
`Scrutin`. Un test le vérifie dans le SQL et dans les modèles Prisma.

### Écarts avec la V2.1, et pourquoi

| Écart                                                                                              | Raison                                                                                                                         |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Colonne `source` retirée des tables de versions                                                    | `stream` la détermine, et une contrainte relie `chamber` et `stream`                                                           |
| Statuts et genres en `TEXT` avec `CHECK`, pas en énumérations PostgreSQL                           | Pas d'`ALTER TYPE` à gérer, vérification de catalogue uniforme. Le typage reste porté par `types.ts`                           |
| `snapshotPins` et `snapshotStateHashes` du run deviennent les lignes de `HistoricalRunSnapshotPin` | PostgreSQL peut vérifier qu'un instantané épinglé existe et que son `stateHash` est le sien. Du JSON ne le peut pas            |
| `OfficialActor` sans nom ni prénom                                                                 | Les noms ne servent qu'au contrôle transitoire (décision D7 de la PR 5A-2). Une colonne s'ajoutera plus tard si 5D en a besoin |
| `SeatMandateRecord` ajoutée                                                                        | Le parseur de la 5A-2 lit les mandats de siège, le lien vote et siège en a besoin                                              |
| `scrutinDate` et `legislature` ajoutés à `ScrutinVoterAttestation`                                 | Le résolveur date chaque vote : la preuve ne doit pas aller chercher la date dans `Scrutin`                                    |
| `sourceMember` sur toutes les tables de versions                                                   | Provenance au niveau de la ligne : le fichier de l'archive d'où elle vient                                                     |
| `decidedByKind` (`HUMAN`, `SCRIPT`) sur les trois journaux                                         | Rend vérifiable par la base la règle « un programme ne valide rien »                                                           |
| `startedBy`, `storedBy`, `importedBy`                                                              | Provenance obligatoire de chaque écriture                                                                                      |
| `ScrutinOrganPosition` non créée                                                                   | C'est la table de la phase 5F, qui active les positions. Aucune statistique historique n'est préparée ici                      |

## 3. Ce que PostgreSQL impose réellement

Chaque ligne a un mécanisme précis. La colonne de droite dit où l'invariant est testé.

| Invariant                                                                                                             | Mécanisme                                                                                                     | Test                  |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------- |
| Deux versions actives d'une même identité n'existent pas                                                              | Index unique partiel `(stream, identité) WHERE toSeq IS NULL`, et contrainte d'exclusion                      | statique, intégration |
| Deux versions d'une identité ne se recouvrent à aucun snapshot                                                        | `EXCLUDE USING gist (stream =, identité =, int4range(fromSeq, toSeq, '[)') &&)`, intervalles ouverts à droite | statique, intégration |
| Une version existe pour un snapshot qui existe                                                                        | Clés étrangères composites `(stream, fromSeq)` et `(stream, toSeq)` vers `(stream, seq)`                      | statique, intégration |
| Un snapshot a une clé qui s'ordonne sans trou                                                                         | Déclencheur : `seq` = dernier + 1 par flux                                                                    | intégration           |
| Un instantané ne reçoit d'enregistrements que s'il est le dernier du flux, `VERIFIED`, jamais `RELEASED` ni `REVOKED` | `historical_assert_snapshot_writable`, appelé par chaque garde de version                                     | intégration           |
| Une version s'insère ouverte                                                                                          | Garde d'insertion                                                                                             | intégration           |
| Seul `toSeq` change, une fois, vers le dernier instantané                                                             | Garde de mise à jour : le reste de la ligne, comparé en JSON, doit être identique                             | intégration           |
| Aucun `DELETE`, aucun `TRUNCATE` sur aucune table du lot                                                              | Déclencheurs ligne et instruction, tous `ENABLE ALWAYS`                                                       | statique, intégration |
| Les journaux de décisions et les instantanés ne se modifient pas                                                      | Déclencheur `BEFORE UPDATE OR DELETE`                                                                         | statique, intégration |
| Un instantané `FAILED` ne sera jamais `RELEASED`, un instantané révoqué ne reçoit plus de décision                    | `historical_snapshot_decision_guard`                                                                          | intégration           |
| Seul un humain publie, révoque ou valide                                                                              | `CHECK (status = 'QUARANTINED' OR decidedByKind = 'HUMAN')` et ses équivalents                                | statique, intégration |
| Un lien d'identité manuel ou par identifiant externe n'est jamais écrit par un programme                              | `CHECK` sur `decidedByKind`                                                                                   | intégration           |
| Un lien d'identité est cohérent avec son statut                                                                       | `CHECK` : fiche renseignée pour `LINKED_*`, vide pour `AMBIGUOUS` et `NONE`                                   | intégration           |
| Empreintes bien formées, URL en `https`, référence de stockage qui n'est pas une URL                                  | `CHECK` par expression régulière                                                                              | statique, intégration |
| Dates ordonnées, états de date cohérents avec les dates (`DATED` si et seulement si une date)                         | `CHECK`                                                                                                       | intégration           |
| Un run démarre `RUNNING`, se termine une fois, sans toucher à ses entrées                                             | Garde de run, plus `CHECK` de cycle de vie (`COMPLETED` exige `outputHash`)                                   | intégration           |
| Un run ne reçoit des épingles et des exclusions que tant qu'il est `RUNNING`                                          | Gardes de lignes filles                                                                                       | intégration           |
| Un run n'épingle qu'un instantané dont la dernière décision est `RELEASED`                                            | `historical_pin_guard`                                                                                        | intégration           |
| Le `stateHash` épinglé est celui de l'instantané                                                                      | Clé étrangère `(stream, seq, stateHash)`, adossée à une contrainte `UNIQUE`                                   | statique, intégration |
| Les mêmes entrées ne donnent pas deux runs                                                                            | `UNIQUE (inputHash)`                                                                                          | statique, intégration |
| Tables fermées à `anon` et `authenticated`                                                                            | RLS sans politique, `REVOKE` explicites                                                                       | intégration           |
| Aucun identifiant ne dépasse 63 octets                                                                                | Contrôle à la génération, et test statique. PostgreSQL les tronquerait en silence                             | statique              |

### Compatibilité des clés étrangères et des contraintes UNIQUE

PostgreSQL refuse une clé étrangère dont la cible n'est pas couverte par une contrainte `PRIMARY KEY`
ou `UNIQUE` portant exactement les colonnes référencées. Ce que cela a décidé :

1. **Les clés étrangères vers un snapshot visent `(stream, seq)`**, pas `id`. Elles exigent
   `UNIQUE (stream, seq)` sur `OfficialSourceSnapshot`, qui existe. Un test statique vérifie, pour
   chacune des 15 clés étrangères, que la cible est adossée à une contrainte de ces colonnes, que les
   types concordent et que l'action est `RESTRICT`.
2. **L'épingle d'un run exige une contrainte redondante.** `(stream, seq, stateHash)` n'est pas une
   clé naturelle (`(stream, seq)` suffit à identifier un instantané), mais la clé étrangère de l'épingle
   en a besoin pour que PostgreSQL vérifie le hachage. D'où `UNIQUE (stream, seq, stateHash)`.
3. **`MATCH SIMPLE` est obligatoire sur `toSeq`.** Une version ouverte a `toSeq` nul. Avec
   `MATCH FULL`, `(stream, NULL)` serait refusé. Le comportement par défaut ne vérifie rien quand une
   colonne est nulle, ce qui est voulu.
4. **Une clé étrangère ne peut pas viser un index partiel.** La version active d'une identité est un
   index unique partiel : on ne peut donc pas y référer.
5. **Une table de versions ne peut pas être la cible d'une clé étrangère par clé métier.** Sa clé
   primaire se termine par `fromSeq`, donc `(stream, officialId)` n'y est pas unique. Une attestation
   ne peut pas référencer un acteur, un organe ou un mandat de siège par clé étrangère. Ces
   références sont sous la responsabilité de l'importeur (section 4). Un registre d'identités
   immuable le permettrait, mais il ajouterait des tables pour un contrôle que la comparaison
   d'ensemble de l'importeur fait déjà.
6. **L'exclusion demande `btree_gist`** : égalité sur du texte combinée à un recouvrement d'intervalles.
   C'est la seule dépendance du lot hors des tables neuves. Elle est à vérifier avant tout (plan,
   étape 1).
7. **L'index partiel et l'exclusion se recouvrent volontairement.** L'exclusion interdit déjà deux
   versions ouvertes. L'index partiel donne une erreur plus lisible et sert la recherche de l'état
   courant. PostgreSQL ne garantit pas laquelle des deux contraintes se plaint en premier : les tests
   acceptent l'une ou l'autre, et vérifient chacune isolément.
8. **L'ordre des vérifications compte.** Les déclencheurs `BEFORE` s'exécutent avant les contraintes
   `CHECK` et les index. Une insertion refusée par une garde l'est donc avant toute violation de clé.
   Les tests de contraintes écartent les gardes (`DISABLE TRIGGER USER`) pour atteindre la couche
   en dessous.

Prisma accepte les modèles (`prisma validate`, `prisma format --check`), y compris la relation
facultative sur la clé composite `(stream, toSeq)`. Le DDL que `prisma migrate diff --from-empty`
produit pour les 13 tables (colonnes, types, défauts, index simples, clés étrangères avec leurs
actions, contraintes uniques) est identique à celui du SQL, table par table : 0 différence.

## 4. Ce qui reste sous la responsabilité de l'importeur

PostgreSQL ne peut pas l'imposer, par construction.

| Responsabilité                                                                                     | Pourquoi la base ne peut pas                                                                         | Contrôle prévu                                                  |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Une attestation désigne un acteur, un organe et un mandat de siège qui existent au même instantané | Les clés cibles sont versionnées, pas de clé étrangère possible (3.5)                                | Requêtes d'orphelins avant `RELEASED`, seuil zéro               |
| Un mandat de groupe désigne un organe du même instantané                                           | Idem                                                                                                 | Idem, blocage de 8.2                                            |
| Un import couvre le flux complet                                                                   | La base ne connaît pas l'étendue du flux                                                             | `recordCounts` et `stateHash` comparés au fichier               |
| `rawHash` est le haché du contenu de la ligne                                                      | La base vérifie la forme, pas le contenu                                                             | Recalcul de l'empreinte d'état avant `RELEASED`                 |
| `stateHash` égale l'empreinte recalculée depuis les tables                                         | Calcul applicatif (`canonical.ts`)                                                                   | Vérifié par l'importeur, puis par le run au démarrage           |
| Fermer (`toSeq`) avant d'insérer la version corrigée                                               | L'ordre est une affaire de séquence                                                                  | Garde-fou à 1 % de retraits (4.7), transaction par flux         |
| `OPEN_AT_SNAPSHOT` valable jusqu'à la date de la source                                            | Sémantique de date, pas de structure                                                                 | `date-semantics.ts`                                             |
| `decidedBy` désigne bien la personne                                                               | Texte libre                                                                                          | Identité de la session administrateur                           |
| Le script d'import n'écrit une décision de continuité qu'à l'état `PROPOSED`                       | La base refuse `VALIDATED` par un script, mais ne peut pas empêcher un script de se déclarer `HUMAN` | Revue du code d'import, aucune décision écrite par un programme |
| Les décisions plafonnées d'un run sont celles de `decisionsHash`                                   | Calcul applicatif                                                                                    | `executeRun`, contrat d'entrée (PR #1129)                       |
| Un instantané n'est pas utilisé s'il est mis en quarantaine après un run                           | Statut dérivé, relu à chaque lecture                                                                 | Section 6.5 de l'architecture                                   |

### Ce qu'une garde ne résiste pas à

Le propriétaire des tables peut tout défaire : `DROP TRIGGER`, `ALTER TABLE ... DISABLE TRIGGER`,
`DROP TABLE`. `ENABLE ALWAYS` résiste à `session_replication_role = replica`, pas à un propriétaire
qui supprime la garde. L'application se connecte avec ce rôle. Les gardes protègent contre une
erreur de code, pas contre un opérateur qui contourne volontairement. Le script de comparaison
détecte l'absence ou la désactivation d'un déclencheur à la prochaine exécution (il le rétablit,
voir 5), ce qui n'est pas une protection en continu.

## 5. L'idempotence, et ce que `IF NOT EXISTS` ne garantit pas

`CREATE TABLE IF NOT EXISTS` garde une table existante telle quelle, même différente. Le script ne
s'y fie donc pas : il construit le même schéma dans un schéma de référence jetable (`hg_reference`),
avec le même texte, puis compare les catalogues du schéma réel et du schéma de référence. Le texte
n'est pas écrit deux fois : une variable le contient et l'exécute deux fois.

| Compare      | Détail                                             |
| ------------ | -------------------------------------------------- |
| Colonnes     | nom, type, nullité, défaut                         |
| Contraintes  | nom, genre, définition (`pg_get_constraintdef`)    |
| Index        | nom, définition                                    |
| Déclencheurs | nom, état (`ENABLE ALWAYS`), définition            |
| Fonctions    | nom, arguments, haché du corps, `search_path`      |
| RLS          | activée ou non                                     |
| Droits       | pour `PUBLIC`, `anon` et `authenticated` seulement |

Les droits des autres rôles ne sont pas comparés : sur Supabase, `service_role` reçoit les siens par
les droits par défaut du schéma `public`, que le schéma de référence n'a pas. Les comparer ferait
échouer le contrôle sans raison.

**Jamais réparé, erreur et annulation** : table, colonne (ajoutée, retirée, type changé),
contrainte (absente ou différente), index de même nom mais de définition différente, déclencheur ou
index en trop.

**Ré-appliqué à chaque exécution**, parce que cela ne porte aucune donnée et ne peut que resserrer :
les fonctions et déclencheurs (`CREATE OR REPLACE`, `ENABLE ALWAYS`), la RLS, les `REVOKE`, un index
autonome absent. Si les données empêchent de recréer un index unique partiel, l'exécution échoue.

C'est un choix, pas un oubli : un déclencheur désactivé à la main est rétabli par une ré-exécution
au lieu de bloquer, alors qu'une colonne en trop bloque. Si vous préférez que toute divergence
bloque, y compris pour le code, la comparaison pourrait précéder les `CREATE OR REPLACE` (décision B).

Tout est dans une transaction : si la comparaison échoue, rien n'est posé, le schéma de référence
non plus.

## 6. Plan de vérification, à valider avant toute exécution

Aucune étape n'est lancée. Chacune dit ce qu'elle touche, ce qu'elle attend et quand on s'arrête.

### Étape 0. Fait : validations statiques

Voir la section 7. Aucune base.

### Étape 1. Base jetable locale

Un conteneur dédié, jamais une base partagée. Le test d'intégration refuse toute autre URL.

```
docker run --rm -d --name hg-schema-test -p 127.0.0.1:55486:5432 \
  -e POSTGRES_USER=hg_schema_test -e POSTGRES_PASSWORD=hg_schema_test -e POSTGRES_DB=hg_schema_test \
  postgres:17
```

Contrôle : `SELECT name FROM pg_available_extensions WHERE name = 'btree_gist'` doit répondre.
Arrêt si l'extension manque.

### Étape 2. Application, deux fois

`psql -v ON_ERROR_STOP=1 -f prisma/migrations/manual/2026-10-18-historical-groups-schema.sql`, puis
la même commande. Attendu : aucune erreur, 13 tables, aucun schéma `hg_reference` restant, le
second passage ne change rien. Arrêt à la première erreur : une erreur de syntaxe ou de logique de
la comparaison se corrige dans le générateur, pas à la main.

### Étape 3. Tests d'intégration

`npx vitest run src/lib/parlement/historical-groups/__tests__/schema.integration.test.ts` avec la
variable d'URL. Attendu : 49 tests passent. **Aucun de ces tests n'a jamais tourné** : un échec peut
venir du test autant du SQL. On corrige l'un ou l'autre, jamais l'assertion pour la faire passer.

### Étape 4. Parité Prisma

`prisma migrate diff --from-url <base jetable> --to-schema prisma/schema.prisma --script`, sans
l'appliquer. Hypothèse à confirmer : rien pour les colonnes et les index simples, et au plus la
suppression d'objets que Prisma ne sait pas déclarer (exclusions, index partiels, déclencheurs). Si
cette hypothèse se vérifie, la sortie justifie l'interdiction de `db push`. Dans tous les cas, ne
jamais l'appliquer.

### Étape 5. Contrats de sécurité

Appliquer le SQL dans les conteneurs de `scripts/test-sec-0{2,3}-*.sh` et du contrat SEC-06 puis relancer
leurs contrats. Attendu : inchangés. Point d'attention : `btree_gist` ajoute des routines dans `public`
(ou dans `extensions` sur Supabase), et les droits par défaut du créateur leur retirent `EXECUTE`
pour `PUBLIC`. Vérifier qu'une insertion avec contrainte d'exclusion réussit avec le rôle applicatif.

### Étape 6. Volume et durée

Insérer 2 399 520 attestations synthétiques dans une base jetable, avec les déclencheurs actifs, puis
mesurer le temps, la taille de la table et des index, et le plan des requêtes de lecture. Pas de
seuil de réussite : cela répond à l'arbitrage A1 et dimensionne l'import (5C). Si le temps dépasse
l'acceptable, on étudie une garde par instruction plutôt que par ligne.

### Étape 7. Retour arrière

Le script de retour arrière sur une base vide (tout disparaît), puis sur une base contenant une
ligne (refus, rien n'est touché). Couvert par un test d'intégration, à confirmer à la main.

### Étape 8. Préproduction (`.env.staging`, base séparée), seulement après accord

Mêmes étapes 2 et 3 **moins** la remise à zéro : le test d'intégration supprime le schéma `public`,
il ne doit **jamais** viser autre chose que son conteneur. Sur la préproduction : appliquer le SQL,
le ré-appliquer, puis des requêtes de lecture seule : RLS activée sur les 13 tables, aucun droit pour
`anon` et `authenticated`, déclencheurs `ENABLE ALWAYS`, extension et son schéma, rôle de
l'application.

### Étape 9. Production

Non demandée. Condition : étapes 1 à 8 propres, décision explicite, geste manuel.
`prisma db execute` n'est jamais lancé sur la production par un agent. Le déploiement du code reste un
geste manuel depuis le dashboard Vercel, et ce lot ne contient aucun code applicatif.

## 7. Validations statiques faites

| Contrôle                                                                  | Résultat                                                                                                                      |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `prisma validate`                                                         | schéma valide                                                                                                                 |
| `prisma format --check`                                                   | formaté                                                                                                                       |
| `prisma migrate diff --from-empty`, comparaison avec le SQL, 13 tables    | 0 différence (colonnes, types, défauts, index, clés étrangères, uniques)                                                      |
| Analyse syntaxique PostgreSQL (`libpg-query`, grammaire de PostgreSQL 17) | 4 instructions de premier niveau et les 139 instructions du DDL passent ; 19 requêtes de la comparaison et des gardes passent |
| Corps PL/pgSQL                                                            | **non analysés** : l'analyseur disponible ne lit pas PL/pgSQL. Relus à la main                                                |
| Longueur des identifiants                                                 | tous inférieurs ou égaux à 63 octets (contrôle à la génération et test)                                                       |
| `vitest` du module                                                        | voir le message de la PR                                                                                                      |
| ESLint, TypeScript                                                        | voir le message de la PR                                                                                                      |

Ce que ces contrôles ne prouvent pas : que PostgreSQL exécute le SQL comme écrit. La syntaxe est
valide, la logique PL/pgSQL, l'ordre d'exécution des déclencheurs et la comparaison de catalogues
ne sont vérifiés par aucune exécution. Le risque est concentré dans la comparaison de catalogues
(section 5), qui est la partie la plus inhabituelle du script.

## 8. Décisions à prendre

| #   | Question                                                                                              | Position                                                                            |
| --- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| A   | Accepter la dépendance à `btree_gist` pour l'exclusion des intervalles                                | Oui. L'alternative (un déclencheur de recouvrement) est plus fragile en concurrence |
| B   | Les fonctions, déclencheurs, RLS et droits sont-ils ré-appliqués, ou toute divergence bloque-t-elle ? | Ré-appliqués : ils ne portent pas de données et ne font que resserrer               |
| C   | Noms et prénoms absents d'`OfficialActor`                                                             | Absents, à ajouter par `ALTER` additif si 5D en a besoin                            |
| D   | Épingles de run en lignes plutôt qu'en JSON                                                           | En lignes                                                                           |
| E   | Statuts en `TEXT` et `CHECK` plutôt qu'en énumérations                                                | `TEXT` et `CHECK`                                                                   |
| F   | `ScrutinOrganPosition` laissée à 5F                                                                   | Oui                                                                                 |
| G   | Garde par ligne pour les 2,4 millions d'attestations                                                  | À mesurer à l'étape 6                                                               |
