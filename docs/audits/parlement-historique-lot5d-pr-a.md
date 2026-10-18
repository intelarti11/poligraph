# Lot 5D, PR A : rôles dédiés, RLS, memberHash et positions internes

Statut : migration écrite et vérifiée sur un PostgreSQL 17 local jetable. **Rien n'est appliqué** en
préproduction ni en production. Aucune surface publique n'est touchée.

Cette PR prépare le terrain de la PR B (import, résolution, positions historiques internes). Elle ne
contient aucun code d'import ni de résolution.

## Ce que la migration ajoute

Fichier : `prisma/migrations/manual/2026-10-20-historical-groups-roles-positions.sql`, au-dessus des
lots 5B et 5C-0. Retour arrière : `...-rollback.sql`.

1. **`memberHash`** (TEXT, NOT NULL, CHECK hexadécimal de 64 caractères, sans valeur par défaut) sur
   `OfficialActor`, `OfficialOrganRecord`, `GroupMembershipRecord` et `SeatMandateRecord`. Les trois
   autres tables de versions l'avaient déjà. Si l'une des quatre tables contient une ligne et n'a pas la
   colonne, le script refuse : un remplissage serait une migration distincte.
2. **Trois rôles** (créés à la main, jamais par le script) et leurs **politiques RLS** :
   - `hg_importer` : écrit les preuves officielles (artefacts, snapshots, décisions en quarantaine,
     versions d'enregistrements). Ne publie rien, ne supprime rien, ne touche ni aux runs ni aux
     journaux d'identité et de continuité.
   - `hg_runner` : écrit les runs, leurs épingles, leurs exclusions et les positions. Lit les preuves et
     les journaux. N'écrit aucune preuve.
   - `hg_reader` : lecture seule, pour la vérification. Ne lit pas les journaux.
3. **`ScrutinOrganPosition`** : une ligne par run, scrutin et organe officiel (clé indépendante de toute
   fiche `Politician`). Décomptes pour, contre, abstention, non-votants, nombre d'exclus et exclus par
   motif, `publishable` et son motif. **Aucune position majoritaire n'est calculée ni stockée.**
4. **`historical_position_guard`** : la garde de publication (F1), dans PostgreSQL.

## Matrice des droits

Aucun rôle n'a DELETE, TRUNCATE, REFERENCES, TRIGGER ni DDL. Aucun n'a BYPASSRLS, aucun ne possède une
table. Chaque commande autorisée passe par une politique. `anon`, `authenticated` et `PUBLIC` n'ont rien.

| Table                                                                                                                   | importer                                                  | runner                                                                           | reader |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------- | ------ |
| `SourceArtifact`                                                                                                        | SELECT, INSERT, UPDATE(`lastVerifiedAt`)                  |                                                                                  | SELECT |
| `OfficialSourceSnapshot`                                                                                                | SELECT, INSERT                                            | SELECT                                                                           | SELECT |
| `SnapshotDecision`                                                                                                      | SELECT, INSERT (QUARANTINED, SCRIPT seulement)            | SELECT                                                                           | SELECT |
| 7 tables de versions (acteurs, organes, mandats de groupe, mandats de siège, attestations, deux contrôles de décomptes) | SELECT, INSERT, UPDATE(`toSeq`) sur les versions ouvertes | SELECT                                                                           | SELECT |
| `HistoricalResolutionRun`                                                                                               |                                                           | SELECT, INSERT, UPDATE(statut, hash de sortie, compteurs, fin) d'un run en cours | SELECT |
| `HistoricalRunSnapshotPin`, `RunExclusion`                                                                              |                                                           | SELECT, INSERT                                                                   | SELECT |
| `ScrutinOrganPosition`                                                                                                  |                                                           | SELECT, INSERT                                                                   | SELECT |
| `OfficialActorLinkDecision`, `OrganContinuityDecision`                                                                  |                                                           | SELECT                                                                           |        |

Une décision `RELEASED` reste un geste humain du propriétaire des tables : la politique du rôle
d'import regarde le statut inséré, pas la mention `HUMAN` ou `SCRIPT` que l'appelant déclare.

Les trois rôles reçoivent aussi `USAGE` sur le schéma `public` (sans quoi ils ne voient aucune table).
Ce droit est retiré par le retour arrière.

## La garde de publication

Une ligne `publishable = true` est refusée (code `restrict_violation`, le trigger est `ENABLE ALWAYS`,
donc même `session_replication_role = replica` ne la contourne pas) si :

- le run n'est pas `RUNNING` (valable aussi pour une ligne non publiable) ;
- l'organe est un organe de remplissage de la configuration du run (`PO0`) ;
- les exclus de l'organe dépassent `maxExcludedPerGroup` de la configuration du run (un run sans seuil
  ne publie rien) ;
- les décomptes officiels du scrutin ne sont pas `COHERENT` **dans le snapshot que le run a épinglé**
  (pas dans le dernier). Aucun contrôle en base, ou plusieurs, ne vaut pas un feu vert.

Des CHECK complètent : un organe publiable est un `GROUP` avec au moins un vote attesté, une ligne
publiable n'a pas de motif, une ligne non publiable en a un. Les lignes non publiables sont toujours
permises : elles gardent la preuve du refus.

Limites assumées : la base ne sait pas recompter les votes d'un organe (le seau d'une position est
l'organe résolu, qui peut différer de l'organe publié après continuité), ni recalculer le type
d'organe (`GROUP` ou `NON_INSCRIT` n'est pas stocké). Ces deux contrôles restent au niveau du code de
la PR B, qui recalcule la classification.

## Méthode

Même méthode que 5B et 5C-0 : une transaction, SQL simple (ni bloc DO, ni SQL dynamique, ni
SECURITY DEFINER, ni création de rôle), précheck avant d'écrire, aucune réparation. Le même texte est
exécuté dans un schéma de référence (avec des coquilles vides des tables existantes) puis dans le
schéma réel, et les catalogues sont comparés avant et après : colonnes `memberHash` et contrainte,
table des positions, fonction, politiques, droits (table, colonne, séquence, fonction).

Prérequis vérifiés avant tout : les 15 tables, les 9 fonctions de garde, `btree_gist`, les trois rôles
(existants, sans SUPERUSER, BYPASSRLS, CREATEROLE ni CREATEDB, propriétaires d'aucune table).

## Résultats sur le conteneur jetable

PostgreSQL 17.11, `127.0.0.1:55486`, base `hg_schema_test` (marqueur `hg.disposable`).

- Application, puis deuxième application : sans effet et sans écart.
- Dommages injectés, tous détectés avant écriture avec la liste des écarts : politique supprimée, DELETE
  ajouté, droit de colonne ajouté, SELECT ajouté sur un journal, contrainte `memberHash` retirée,
  colonne retirée, trigger désactivé, rôle passé en BYPASSRLS.
- Refus sur table non vide : `memberHash` n'est pas ajouté, rien n'est modifié.
- 32 tests d'intégration propres à cette PR, dont : privilèges comparés à une matrice écrite à la main
  (hors du générateur), rôle importateur non propriétaire (insère, ne publie pas, ne supprime pas, ne
  tronque pas, ne modifie ni triggers ni RLS, ne lit pas les journaux, n'écrit pas les runs), garde de
  publication (scrutin discordant, invérifiable ou inconnu, organe de remplissage, seuil, snapshot
  épinglé, run terminé, mise à jour et suppression refusées).
- Les tests peuvent échouer : trois mutations du SQL (garde de cohérence neutralisée, politique de
  quarantaine retirée, seuil neutralisé) font échouer respectivement 3, 1 et 1 tests.
- Un défaut trouvé par ces tests et corrigé : une ligne publiable avec `organKind` NULL passait le
  CHECK (NULL est vrai pour un CHECK). Le CHECK utilise maintenant `COALESCE(... , false)`.
- Parité Prisma : `prisma migrate diff` contre le conteneur ne mentionne aucune des 16 tables.
- Suites 5B et 5C-0 inchangées : 179 tests d'intégration verts au total.
- Gardes sources hors ligne SEC-03 et SEC-06 : passées.

## Pour appliquer plus tard (jamais sans accord)

1. Créer les trois rôles à la main, sans attribut particulier. La manière de le faire sur Supabase est
   à confirmer dans le dashboard : ce rapport ne la décrit pas.
2. `npx prisma db execute --file prisma/migrations/manual/2026-10-20-historical-groups-roles-positions.sql`
   (utilise `DIRECT_URL`). Jamais `db:push`.

## Suivis consignés

- Benchmark comparatif des index `active_key` et d'exclusion (reporté depuis 5B).
- Connexion applicative par rôle : l'import et le run se connectent avec les identifiants de leur rôle,
  à définir avec l'hébergeur, pas dans cette PR.
