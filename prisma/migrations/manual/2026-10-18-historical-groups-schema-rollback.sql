-- Lot 5B : retour arrière du schéma historique. NON EXÉCUTÉ.
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

-- Chaque requête échoue (CAST d'un texte en entier) si sa table contient une ligne.
SELECT CAST('SourceArtifact holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.' AS integer)
WHERE EXISTS (SELECT 1 FROM "SourceArtifact");
SELECT CAST('OfficialSourceSnapshot holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.' AS integer)
WHERE EXISTS (SELECT 1 FROM "OfficialSourceSnapshot");
SELECT CAST('SnapshotDecision holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.' AS integer)
WHERE EXISTS (SELECT 1 FROM "SnapshotDecision");
SELECT CAST('OfficialActor holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.' AS integer)
WHERE EXISTS (SELECT 1 FROM "OfficialActor");
SELECT CAST('OfficialOrganRecord holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.' AS integer)
WHERE EXISTS (SELECT 1 FROM "OfficialOrganRecord");
SELECT CAST('GroupMembershipRecord holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.' AS integer)
WHERE EXISTS (SELECT 1 FROM "GroupMembershipRecord");
SELECT CAST('SeatMandateRecord holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.' AS integer)
WHERE EXISTS (SELECT 1 FROM "SeatMandateRecord");
SELECT CAST('ScrutinVoterAttestation holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.' AS integer)
WHERE EXISTS (SELECT 1 FROM "ScrutinVoterAttestation");
SELECT CAST('OfficialActorLinkDecision holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.' AS integer)
WHERE EXISTS (SELECT 1 FROM "OfficialActorLinkDecision");
SELECT CAST('OrganContinuityDecision holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.' AS integer)
WHERE EXISTS (SELECT 1 FROM "OrganContinuityDecision");
SELECT CAST('HistoricalResolutionRun holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.' AS integer)
WHERE EXISTS (SELECT 1 FROM "HistoricalResolutionRun");
SELECT CAST('HistoricalRunSnapshotPin holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.' AS integer)
WHERE EXISTS (SELECT 1 FROM "HistoricalRunSnapshotPin");
SELECT CAST('RunExclusion holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.' AS integer)
WHERE EXISTS (SELECT 1 FROM "RunExclusion");

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
DROP FUNCTION historical_assert_snapshot_writable(text,integer);
DROP FUNCTION historical_refuse_truncate();
DROP FUNCTION historical_refuse_mutation();

COMMIT;
