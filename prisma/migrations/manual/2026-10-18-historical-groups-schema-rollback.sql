-- Lot 5B : retour arrière du schéma historique. NON EXÉCUTÉ en production ni en préproduction.
--
-- Ne supprime que des tables NEUVES et seulement si elles sont toutes vides. Dès qu'une ligne existe,
-- une requête échoue avant tout DROP, la transaction est annulée et rien n'est touché : on n'efface
-- jamais une preuve. Un snapshot jugé faux se révoque (SnapshotDecision), il ne se supprime pas
-- (document d'architecture, 4.7). Si une table manque, le script échoue aussi : il n'y a rien à
-- défaire, ou le schéma n'est pas celui du lot.
-- L'extension btree_gist n'est pas retirée : d'autres objets peuvent en dépendre.
-- SQL simple, sans bloc DO ni SQL dynamique (contrat SEC-06 du dépôt).
--   npx prisma db execute --file prisma/migrations/manual/2026-10-18-historical-groups-schema-rollback.sql

BEGIN;

-- Chaque requête échoue (CAST d'un texte en entier) si sa table contient au moins une ligne.
SELECT CAST(string_agg('SourceArtifact holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.', '') AS integer)
FROM "SourceArtifact";
SELECT CAST(string_agg('OfficialSourceSnapshot holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.', '') AS integer)
FROM "OfficialSourceSnapshot";
SELECT CAST(string_agg('SnapshotDecision holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.', '') AS integer)
FROM "SnapshotDecision";
SELECT CAST(string_agg('OfficialActor holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.', '') AS integer)
FROM "OfficialActor";
SELECT CAST(string_agg('OfficialOrganRecord holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.', '') AS integer)
FROM "OfficialOrganRecord";
SELECT CAST(string_agg('GroupMembershipRecord holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.', '') AS integer)
FROM "GroupMembershipRecord";
SELECT CAST(string_agg('SeatMandateRecord holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.', '') AS integer)
FROM "SeatMandateRecord";
SELECT CAST(string_agg('ScrutinVoterAttestation holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.', '') AS integer)
FROM "ScrutinVoterAttestation";
SELECT CAST(string_agg('OfficialActorLinkDecision holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.', '') AS integer)
FROM "OfficialActorLinkDecision";
SELECT CAST(string_agg('OrganContinuityDecision holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.', '') AS integer)
FROM "OrganContinuityDecision";
SELECT CAST(string_agg('HistoricalResolutionRun holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.', '') AS integer)
FROM "HistoricalResolutionRun";
SELECT CAST(string_agg('HistoricalRunSnapshotPin holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.', '') AS integer)
FROM "HistoricalRunSnapshotPin";
SELECT CAST(string_agg('RunExclusion holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.', '') AS integer)
FROM "RunExclusion";

-- Les enfants d'abord, sans CASCADE : une clé étrangère inattendue arrête le script.
DROP TABLE "RunExclusion";
DROP TABLE "HistoricalRunSnapshotPin";
DROP TABLE "HistoricalResolutionRun";
DROP TABLE "OrganContinuityDecision";
DROP TABLE "OfficialActorLinkDecision";
DROP TABLE "ScrutinVoterAttestation";
DROP TABLE "SeatMandateRecord";
DROP TABLE "GroupMembershipRecord";
DROP TABLE "OfficialOrganRecord";
DROP TABLE "OfficialActor";
DROP TABLE "SnapshotDecision";
DROP TABLE "OfficialSourceSnapshot";
DROP TABLE "SourceArtifact";

DROP FUNCTION historical_pin_guard();
DROP FUNCTION historical_run_child_guard();
DROP FUNCTION historical_run_guard();
DROP FUNCTION historical_snapshot_decision_guard();
DROP FUNCTION historical_snapshot_insert_guard();
DROP FUNCTION historical_artifact_guard();
DROP FUNCTION historical_version_guard();
DROP FUNCTION historical_refuse_truncate();
DROP FUNCTION historical_refuse_mutation();

COMMIT;
