-- Lot 5B : retour arrière du schéma historique. NON EXÉCUTÉ.
--
-- Ne supprime que des tables NEUVES et seulement si elles sont toutes vides. Dès qu'une ligne existe,
-- le script s'arrête sans rien toucher : on n'efface jamais une preuve. Un snapshot jugé faux se
-- révoque (SnapshotDecision), il ne se supprime pas (document d'architecture, 4.7).
-- L'extension btree_gist n'est pas retirée : d'autres objets peuvent en dépendre.
--   npx prisma db execute --file prisma/migrations/manual/2026-10-18-historical-groups-schema-rollback.sql

BEGIN;

DO $rollback$
DECLARE
  v_table text;
  v_count bigint;
  v_tables text[] := ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion'];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass(format('public.%I', v_table)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_count;
      IF v_count > 0 THEN
        RAISE EXCEPTION '% holds % rows: no rollback, nothing was dropped. Revoke the snapshot instead.', v_table, v_count;
      END IF;
    END IF;
  END LOOP;
END
$rollback$;

-- Children first: no CASCADE, so a foreign key that was not expected stops the script.
DROP TABLE IF EXISTS "RunExclusion";
DROP TABLE IF EXISTS "HistoricalRunSnapshotPin";
DROP TABLE IF EXISTS "HistoricalResolutionRun";
DROP TABLE IF EXISTS "OrganContinuityDecision";
DROP TABLE IF EXISTS "OfficialActorLinkDecision";
DROP TABLE IF EXISTS "ScrutinVoterAttestation";
DROP TABLE IF EXISTS "SeatMandateRecord";
DROP TABLE IF EXISTS "GroupMembershipRecord";
DROP TABLE IF EXISTS "OfficialOrganRecord";
DROP TABLE IF EXISTS "OfficialActor";
DROP TABLE IF EXISTS "SnapshotDecision";
DROP TABLE IF EXISTS "OfficialSourceSnapshot";
DROP TABLE IF EXISTS "SourceArtifact";

DROP FUNCTION IF EXISTS historical_pin_guard();
DROP FUNCTION IF EXISTS historical_run_child_guard();
DROP FUNCTION IF EXISTS historical_run_guard();
DROP FUNCTION IF EXISTS historical_snapshot_decision_guard();
DROP FUNCTION IF EXISTS historical_snapshot_insert_guard();
DROP FUNCTION IF EXISTS historical_artifact_guard();
DROP FUNCTION IF EXISTS historical_version_guard();
DROP FUNCTION IF EXISTS historical_assert_snapshot_writable(text,integer);
DROP FUNCTION IF EXISTS historical_refuse_truncate();
DROP FUNCTION IF EXISTS historical_refuse_mutation();

COMMIT;
