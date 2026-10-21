-- Lot 5D, PR A : retour arrière des rôles, politiques, memberHash et positions. NON EXÉCUTÉ en préproduction ni en production.
--
-- Ne défait que ce lot, et seulement si la table des positions et les quatre tables à memberHash sont vides :
-- dès qu'une ligne existe, une requête échoue avant tout DROP, la transaction est annulée et rien n'est
-- touché (on n'efface jamais une preuve). Les trois rôles ne sont pas supprimés (cluster, hors script) : leurs
-- droits sur les tables du lot sont retirés. SQL simple, sans bloc DO ni SQL dynamique (contrat SEC-06).
--   npx prisma db execute --file prisma/migrations/manual/2026-10-20-historical-groups-roles-positions-rollback.sql

BEGIN;

SELECT CAST(string_agg('ScrutinOrganPosition holds rows: no rollback, nothing was dropped. Revoke the run instead.', '') AS integer)
FROM "ScrutinOrganPosition";
SELECT CAST(string_agg('OfficialActor holds rows: no rollback, its memberHash would be lost.', '') AS integer)
FROM "OfficialActor";
SELECT CAST(string_agg('OfficialOrganRecord holds rows: no rollback, its memberHash would be lost.', '') AS integer)
FROM "OfficialOrganRecord";
SELECT CAST(string_agg('GroupMembershipRecord holds rows: no rollback, its memberHash would be lost.', '') AS integer)
FROM "GroupMembershipRecord";
SELECT CAST(string_agg('SeatMandateRecord holds rows: no rollback, its memberHash would be lost.', '') AS integer)
FROM "SeatMandateRecord";

DROP TABLE "ScrutinOrganPosition";
DROP FUNCTION historical_position_guard();

DROP POLICY IF EXISTS "hg_importer_select" ON "SourceArtifact";
DROP POLICY IF EXISTS "hg_importer_select" ON "OfficialSourceSnapshot";
DROP POLICY IF EXISTS "hg_importer_select" ON "SnapshotDecision";
DROP POLICY IF EXISTS "hg_importer_select" ON "OfficialActor";
DROP POLICY IF EXISTS "hg_importer_select" ON "OfficialOrganRecord";
DROP POLICY IF EXISTS "hg_importer_select" ON "GroupMembershipRecord";
DROP POLICY IF EXISTS "hg_importer_select" ON "SeatMandateRecord";
DROP POLICY IF EXISTS "hg_importer_select" ON "ScrutinVoterAttestation";
DROP POLICY IF EXISTS "hg_importer_select" ON "ScrutinCountCheck";
DROP POLICY IF EXISTS "hg_importer_select" ON "ScrutinGroupCountCheck";
DROP POLICY IF EXISTS "hg_importer_insert" ON "SourceArtifact";
DROP POLICY IF EXISTS "hg_importer_insert" ON "OfficialSourceSnapshot";
DROP POLICY IF EXISTS "hg_importer_insert" ON "SnapshotDecision";
DROP POLICY IF EXISTS "hg_importer_insert" ON "OfficialActor";
DROP POLICY IF EXISTS "hg_importer_insert" ON "OfficialOrganRecord";
DROP POLICY IF EXISTS "hg_importer_insert" ON "GroupMembershipRecord";
DROP POLICY IF EXISTS "hg_importer_insert" ON "SeatMandateRecord";
DROP POLICY IF EXISTS "hg_importer_insert" ON "ScrutinVoterAttestation";
DROP POLICY IF EXISTS "hg_importer_insert" ON "ScrutinCountCheck";
DROP POLICY IF EXISTS "hg_importer_insert" ON "ScrutinGroupCountCheck";
DROP POLICY IF EXISTS "hg_importer_update" ON "SourceArtifact";
DROP POLICY IF EXISTS "hg_importer_update" ON "OfficialActor";
DROP POLICY IF EXISTS "hg_importer_update" ON "OfficialOrganRecord";
DROP POLICY IF EXISTS "hg_importer_update" ON "GroupMembershipRecord";
DROP POLICY IF EXISTS "hg_importer_update" ON "SeatMandateRecord";
DROP POLICY IF EXISTS "hg_importer_update" ON "ScrutinVoterAttestation";
DROP POLICY IF EXISTS "hg_importer_update" ON "ScrutinCountCheck";
DROP POLICY IF EXISTS "hg_importer_update" ON "ScrutinGroupCountCheck";
DROP POLICY IF EXISTS "hg_runner_select" ON "OfficialSourceSnapshot";
DROP POLICY IF EXISTS "hg_runner_select" ON "SnapshotDecision";
DROP POLICY IF EXISTS "hg_runner_select" ON "OfficialActor";
DROP POLICY IF EXISTS "hg_runner_select" ON "OfficialOrganRecord";
DROP POLICY IF EXISTS "hg_runner_select" ON "GroupMembershipRecord";
DROP POLICY IF EXISTS "hg_runner_select" ON "SeatMandateRecord";
DROP POLICY IF EXISTS "hg_runner_select" ON "ScrutinVoterAttestation";
DROP POLICY IF EXISTS "hg_runner_select" ON "ScrutinCountCheck";
DROP POLICY IF EXISTS "hg_runner_select" ON "ScrutinGroupCountCheck";
DROP POLICY IF EXISTS "hg_runner_select" ON "HistoricalResolutionRun";
DROP POLICY IF EXISTS "hg_runner_select" ON "HistoricalRunSnapshotPin";
DROP POLICY IF EXISTS "hg_runner_select" ON "RunExclusion";
DROP POLICY IF EXISTS "hg_runner_select" ON "OfficialActorLinkDecision";
DROP POLICY IF EXISTS "hg_runner_select" ON "OrganContinuityDecision";
DROP POLICY IF EXISTS "hg_runner_insert" ON "HistoricalResolutionRun";
DROP POLICY IF EXISTS "hg_runner_insert" ON "HistoricalRunSnapshotPin";
DROP POLICY IF EXISTS "hg_runner_insert" ON "RunExclusion";
DROP POLICY IF EXISTS "hg_runner_update" ON "HistoricalResolutionRun";
DROP POLICY IF EXISTS "hg_reader_select" ON "SourceArtifact";
DROP POLICY IF EXISTS "hg_reader_select" ON "OfficialSourceSnapshot";
DROP POLICY IF EXISTS "hg_reader_select" ON "SnapshotDecision";
DROP POLICY IF EXISTS "hg_reader_select" ON "OfficialActor";
DROP POLICY IF EXISTS "hg_reader_select" ON "OfficialOrganRecord";
DROP POLICY IF EXISTS "hg_reader_select" ON "GroupMembershipRecord";
DROP POLICY IF EXISTS "hg_reader_select" ON "SeatMandateRecord";
DROP POLICY IF EXISTS "hg_reader_select" ON "ScrutinVoterAttestation";
DROP POLICY IF EXISTS "hg_reader_select" ON "ScrutinCountCheck";
DROP POLICY IF EXISTS "hg_reader_select" ON "ScrutinGroupCountCheck";
DROP POLICY IF EXISTS "hg_reader_select" ON "HistoricalResolutionRun";
DROP POLICY IF EXISTS "hg_reader_select" ON "HistoricalRunSnapshotPin";
DROP POLICY IF EXISTS "hg_reader_select" ON "RunExclusion";

REVOKE ALL ON TABLE "SourceArtifact", "OfficialSourceSnapshot", "SnapshotDecision", "OfficialActor", "OfficialOrganRecord", "GroupMembershipRecord", "SeatMandateRecord", "ScrutinVoterAttestation", "OfficialActorLinkDecision", "OrganContinuityDecision", "HistoricalResolutionRun", "HistoricalRunSnapshotPin", "RunExclusion", "ScrutinCountCheck", "ScrutinGroupCountCheck" FROM hg_importer, hg_runner, hg_reader;
REVOKE ALL ON SEQUENCE "SnapshotDecision_decisionNo_seq" FROM hg_importer, hg_runner, hg_reader;
REVOKE USAGE ON SCHEMA public FROM hg_importer, hg_runner, hg_reader;

ALTER TABLE "OfficialActor" DROP COLUMN "memberHash";
ALTER TABLE "OfficialOrganRecord" DROP COLUMN "memberHash";
ALTER TABLE "GroupMembershipRecord" DROP COLUMN "memberHash";
ALTER TABLE "SeatMandateRecord" DROP COLUMN "memberHash";

COMMIT;
