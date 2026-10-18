-- Lot 5D, PR A : rôles dédiés et RLS, memberHash des quatre tables restantes, positions historiques internes.
--
-- Additif, au-dessus des lots 5B et 5C-0 (qui doivent être appliqués avant). Rapport :
-- docs/audits/parlement-historique-lot5d-pr-a.md.
--
-- NON EXÉCUTÉ en préproduction ni en production. À lancer à la main, jamais avant accord explicite :
--   npx prisma db execute --file prisma/migrations/manual/2026-10-20-historical-groups-roles-positions.sql
-- (utilise DIRECT_URL). Ne jamais `db:push` : le diff supprimerait les contraintes, déclencheurs et
-- politiques que le modèle Prisma ne peut pas déclarer.
--
-- Prérequis hors script : les trois rôles hg_importer, hg_runner, hg_reader doivent exister (à créer à la main, sans
-- SUPERUSER, BYPASSRLS, CREATEROLE ni CREATEDB, et sans posséder de table du lot). Ce script ne crée aucun
-- rôle : un CREATE ROLE conditionnel exigerait un bloc DO, interdit par le contrat SEC-06. Il vérifie
-- ces propriétés et échoue sinon.
--
-- Garanties, même méthode que les lots 5B et 5C-0 :
--  - Une seule transaction. SQL simple : aucun bloc DO, aucun SQL dynamique, aucun SECURITY DEFINER.
--  - Aucune ligne existante n'est modifiée. Les quatre colonnes memberHash sont NOT NULL sans valeur
--    par défaut : si l'une des quatre tables contient une ligne et n'a pas la colonne, le script
--    refuse (rien n'est réparé, un remplissage serait une migration distincte).
--  - Un état partiel est une divergence. Un état complet doit être identique à la référence : le
--    même texte est exécuté dans un schéma de référence jetable (hg_reference, avec des coquilles
--    vides des tables existantes), puis dans le schéma réel, et les catalogues sont comparés avant et
--    après (colonnes memberHash, table des positions, fonction, politiques RLS, droits).
--  - Droits : chaque rôle reçoit USAGE sur le schéma public (sans quoi il ne voit aucune table), puis exactement ce que la matrice du rapport lui donne, aucun DELETE,
--    TRUNCATE ni DDL. Aucun rôle n'a BYPASSRLS : chaque commande passe par une politique. Le rôle
--    d'import ne peut insérer une décision de snapshot que QUARANTINED, par SCRIPT. Une décision
--    RELEASED reste un geste humain du propriétaire des tables.
--  - La garde de publication (historical_position_guard) refuse une ligne publiable si le run n'est
--    pas en cours, si l'organe est un organe de remplissage, si les exclus dépassent le seuil du run,
--    ou si les décomptes officiels du scrutin ne sont pas COHERENT dans le snapshot épinglé.
--
-- Les deux copies du texte de construction sont identiques (un test le vérifie).

BEGIN;

-- hg:prerequisites
SELECT CAST(
  'The prerequisites of the roles and positions schema are missing. Nothing was changed.'
  || E'\n' || string_agg(problem, E'\n' ORDER BY problem)
  AS integer)
FROM (
  SELECT 'the lot 5B and 5C-0 schema is missing or partial: ' || count(*) || ' of 15 tables' AS problem
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  WHERE c.relkind = 'r' AND c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion', 'ScrutinCountCheck', 'ScrutinGroupCountCheck']::text[])
  HAVING count(*) <> 15
  UNION ALL
  SELECT 'the lot 5B guard functions are missing: ' || count(DISTINCT p.proname) || ' of 9'
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
  WHERE p.proname = ANY (ARRAY['historical_refuse_mutation', 'historical_refuse_truncate', 'historical_version_guard', 'historical_artifact_guard', 'historical_snapshot_insert_guard', 'historical_snapshot_decision_guard', 'historical_run_guard', 'historical_run_child_guard', 'historical_pin_guard']::text[])
  HAVING count(DISTINCT p.proname) <> 9
  UNION ALL
  SELECT 'the btree_gist extension is not installed'
  WHERE NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist')
  UNION ALL
  SELECT 'the role ' || r || ' does not exist: create it first, without any special attribute'
  FROM unnest(ARRAY['hg_importer', 'hg_runner', 'hg_reader']::text[]) r
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
  UNION ALL
  SELECT 'the role ' || rolname || ' must not be SUPERUSER, BYPASSRLS, CREATEROLE or CREATEDB'
  FROM pg_roles
  WHERE rolname = ANY (ARRAY['hg_importer', 'hg_runner', 'hg_reader']::text[]) AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)
  UNION ALL
  SELECT 'the role ' || r.rolname || ' owns ' || c.relname || ': a role of the lot never owns a table'
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN pg_roles r ON r.oid = c.relowner
  WHERE r.rolname = ANY (ARRAY['hg_importer', 'hg_runner', 'hg_reader']::text[]) AND c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion', 'ScrutinCountCheck', 'ScrutinGroupCountCheck']::text[])
) problems;

-- hg:no-backfill
SELECT CAST(
  'memberHash cannot be added to a table that already holds rows. Nothing was changed.'
  || E'\n' || string_agg(problem, E'\n' ORDER BY problem)
  AS integer)
FROM (
  SELECT 'OfficialActor holds rows and has no memberHash column: refused, nothing is repaired' AS problem
  FROM (SELECT 1 FROM "OfficialActor" LIMIT 1) t
  WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
                    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
                    WHERE c.relname = 'OfficialActor' AND a.attname = 'memberHash' AND NOT a.attisdropped)
  UNION ALL
  SELECT 'OfficialOrganRecord holds rows and has no memberHash column: refused, nothing is repaired' AS problem
  FROM (SELECT 1 FROM "OfficialOrganRecord" LIMIT 1) t
  WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
                    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
                    WHERE c.relname = 'OfficialOrganRecord' AND a.attname = 'memberHash' AND NOT a.attisdropped)
  UNION ALL
  SELECT 'GroupMembershipRecord holds rows and has no memberHash column: refused, nothing is repaired' AS problem
  FROM (SELECT 1 FROM "GroupMembershipRecord" LIMIT 1) t
  WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
                    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
                    WHERE c.relname = 'GroupMembershipRecord' AND a.attname = 'memberHash' AND NOT a.attisdropped)
  UNION ALL
  SELECT 'SeatMandateRecord holds rows and has no memberHash column: refused, nothing is repaired' AS problem
  FROM (SELECT 1 FROM "SeatMandateRecord" LIMIT 1) t
  WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
                    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
                    WHERE c.relname = 'SeatMandateRecord' AND a.attname = 'memberHash' AND NOT a.attisdropped)
) problems;

DROP SCHEMA IF EXISTS hg_reference CASCADE;
CREATE SCHEMA hg_reference;

-- hg:reference-build
-- Coquilles vides des tables existantes : elles reçoivent les mêmes colonnes, politiques et droits que
-- les tables réelles, pour que la comparaison porte sur le même texte.
SET LOCAL search_path TO hg_reference, public, pg_catalog;

CREATE TABLE "SourceArtifact" (LIKE public."SourceArtifact" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE "OfficialSourceSnapshot" (LIKE public."OfficialSourceSnapshot" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE "SnapshotDecision" (LIKE public."SnapshotDecision" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE "OfficialActor" (LIKE public."OfficialActor" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE "OfficialOrganRecord" (LIKE public."OfficialOrganRecord" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE "GroupMembershipRecord" (LIKE public."GroupMembershipRecord" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE "SeatMandateRecord" (LIKE public."SeatMandateRecord" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE "ScrutinVoterAttestation" (LIKE public."ScrutinVoterAttestation" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE "OfficialActorLinkDecision" (LIKE public."OfficialActorLinkDecision" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE "OrganContinuityDecision" (LIKE public."OrganContinuityDecision" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE "HistoricalResolutionRun" (LIKE public."HistoricalResolutionRun" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE "HistoricalRunSnapshotPin" (LIKE public."HistoricalRunSnapshotPin" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE "RunExclusion" (LIKE public."RunExclusion" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE "ScrutinCountCheck" (LIKE public."ScrutinCountCheck" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE "ScrutinGroupCountCheck" (LIKE public."ScrutinGroupCountCheck" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
ALTER TABLE "OfficialActor" DROP COLUMN IF EXISTS "memberHash";
ALTER TABLE "OfficialOrganRecord" DROP COLUMN IF EXISTS "memberHash";
ALTER TABLE "GroupMembershipRecord" DROP COLUMN IF EXISTS "memberHash";
ALTER TABLE "SeatMandateRecord" DROP COLUMN IF EXISTS "memberHash";
CREATE SEQUENCE "SnapshotDecision_decisionNo_seq";

CREATE OR REPLACE FUNCTION historical_position_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_status text;
  v_config jsonb;
  v_checks integer;
  v_coherent integer;
BEGIN
  -- Shared lock on the run: finishing it (exclusive lock, in the run guard) waits for rows being added.
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('run:' || NEW."runId", 0));
  SELECT "status", "config" INTO v_status, v_config FROM "HistoricalResolutionRun" WHERE "id" = NEW."runId";
  IF v_status IS DISTINCT FROM 'RUNNING' THEN
    RAISE EXCEPTION 'positions are added to a run only while it is RUNNING' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT NEW."publishable" THEN
    RETURN NEW;
  END IF;

  -- Publication gate, enforced here so that no client can bypass it. A row written as publishable
  -- must satisfy what the database itself can verify. Anything else is refused, never corrected.

  -- A filler organ (the published organ is a placeholder, not a group).
  IF COALESCE(v_config #> '{evidence,placeholderOrganRefs}', '[]'::jsonb) ? NEW."organRef" THEN
    RAISE EXCEPTION 'organ % is a placeholder: its position is never publishable', NEW."organRef"
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- The excluded votes of the group must be within the threshold of the run configuration. A run
  -- without a threshold publishes nothing.
  IF NEW."excludedCount" > COALESCE((v_config #>> '{publication,maxExcludedPerGroup}')::integer, -1) THEN
    RAISE EXCEPTION 'organ % of scrutin %: % excluded votes exceed the threshold of the run', NEW."organRef", NEW."scrutinExternalId", NEW."excludedCount"
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- The official counts of the scrutin must be COHERENT in the snapshot the run pinned. No count
  -- check on record is not a pass. Several rows (the scrutin found in two pinned streams) are not a
  -- pass either.
  SELECT count(*), count(*) FILTER (WHERE c."countCoherence" = 'COHERENT') INTO v_checks, v_coherent
  FROM "HistoricalRunSnapshotPin" p
  JOIN "ScrutinCountCheck" c
    ON c."stream" = p."stream" AND c."scrutinExternalId" = NEW."scrutinExternalId"
   AND c."fromSeq" <= p."seq" AND (c."toSeq" IS NULL OR c."toSeq" > p."seq")
  WHERE p."runId" = NEW."runId";
  IF v_checks <> 1 OR v_coherent <> 1 THEN
    RAISE EXCEPTION 'scrutin % is not COHERENT in the pinned snapshots (% count checks, % coherent): its positions are not publishable', NEW."scrutinExternalId", v_checks, v_coherent
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TABLE IF NOT EXISTS "ScrutinOrganPosition" (
    "runId" TEXT NOT NULL,
    "scrutinExternalId" TEXT NOT NULL,
    "organRef" TEXT NOT NULL,
    "organKind" TEXT,
    "forCount" INTEGER NOT NULL,
    "againstCount" INTEGER NOT NULL,
    "abstainCount" INTEGER NOT NULL,
    "nonVoterCount" INTEGER NOT NULL,
    "excludedCount" INTEGER NOT NULL,
    "excludedByReason" JSONB NOT NULL,
    "publishable" BOOLEAN NOT NULL,
    "reason" TEXT,

    CONSTRAINT "ScrutinOrganPosition_pkey" PRIMARY KEY ("runId", "scrutinExternalId", "organRef"),
    CONSTRAINT "ScrutinOrganPosition_runId_fkey" FOREIGN KEY ("runId") REFERENCES "HistoricalResolutionRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ScrutinOrganPosition_keys_present" CHECK ("scrutinExternalId" <> '' AND "organRef" <> ''),
    CONSTRAINT "ScrutinOrganPosition_organKind_known" CHECK ("organKind" IS NULL OR "organKind" IN ('GROUP', 'NON_INSCRIT')),
    CONSTRAINT "ScrutinOrganPosition_counts_not_negative" CHECK ("forCount" >= 0 AND "againstCount" >= 0 AND "abstainCount" >= 0 AND "nonVoterCount" >= 0 AND "excludedCount" >= 0),
    CONSTRAINT "ScrutinOrganPosition_excludedByReason_object" CHECK (jsonb_typeof("excludedByReason") = 'object'),
    CONSTRAINT "ScrutinOrganPosition_reason_known" CHECK ("reason" IS NULL OR "reason" IN ('COUNT_MISMATCH', 'COUNT_UNVERIFIABLE', 'COUNT_COHERENCE_UNKNOWN', 'EXCLUDED_VOTES_PRESENT', 'NO_ATTESTED_VOTE', 'NON_INSCRIT_IS_NOT_A_GROUP', 'PLACEHOLDER_ORGAN')),
    CONSTRAINT "ScrutinOrganPosition_publishable_has_no_reason" CHECK (("publishable" AND "reason" IS NULL) OR (NOT "publishable" AND "reason" IS NOT NULL)),
    CONSTRAINT "ScrutinOrganPosition_publishable_is_a_group" CHECK (NOT "publishable" OR (COALESCE("organKind" = 'GROUP', false) AND "forCount" + "againstCount" + "abstainCount" > 0))
);
CREATE INDEX IF NOT EXISTS "ScrutinOrganPosition_runId_publishable_idx" ON "ScrutinOrganPosition"("runId", "publishable");
CREATE INDEX IF NOT EXISTS "ScrutinOrganPosition_scrutinExternalId_idx" ON "ScrutinOrganPosition"("scrutinExternalId");

CREATE OR REPLACE TRIGGER "ScrutinOrganPosition_no_update_delete" BEFORE UPDATE OR DELETE ON "ScrutinOrganPosition" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "ScrutinOrganPosition" ENABLE ALWAYS TRIGGER "ScrutinOrganPosition_no_update_delete";
CREATE OR REPLACE TRIGGER "ScrutinOrganPosition_insert_guard" BEFORE INSERT ON "ScrutinOrganPosition" FOR EACH ROW EXECUTE FUNCTION historical_position_guard();
ALTER TABLE "ScrutinOrganPosition" ENABLE ALWAYS TRIGGER "ScrutinOrganPosition_insert_guard";
CREATE OR REPLACE TRIGGER "ScrutinOrganPosition_no_truncate" BEFORE TRUNCATE ON "ScrutinOrganPosition" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "ScrutinOrganPosition" ENABLE ALWAYS TRIGGER "ScrutinOrganPosition_no_truncate";
ALTER TABLE "ScrutinOrganPosition" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "OfficialActor" ADD COLUMN IF NOT EXISTS "memberHash" TEXT NOT NULL CONSTRAINT "OfficialActor_memberHash_format" CHECK ("memberHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "OfficialOrganRecord" ADD COLUMN IF NOT EXISTS "memberHash" TEXT NOT NULL CONSTRAINT "OfficialOrganRecord_memberHash_format" CHECK ("memberHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "GroupMembershipRecord" ADD COLUMN IF NOT EXISTS "memberHash" TEXT NOT NULL CONSTRAINT "GroupMembershipRecord_memberHash_format" CHECK ("memberHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "SeatMandateRecord" ADD COLUMN IF NOT EXISTS "memberHash" TEXT NOT NULL CONSTRAINT "SeatMandateRecord_memberHash_format" CHECK ("memberHash" ~ '^[0-9a-f]{64}$');

REVOKE ALL ON TABLE "SourceArtifact", "OfficialSourceSnapshot", "SnapshotDecision", "OfficialActor", "OfficialOrganRecord", "GroupMembershipRecord", "SeatMandateRecord", "ScrutinVoterAttestation", "OfficialActorLinkDecision", "OrganContinuityDecision", "HistoricalResolutionRun", "HistoricalRunSnapshotPin", "RunExclusion", "ScrutinCountCheck", "ScrutinGroupCountCheck", "ScrutinOrganPosition" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION historical_position_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE "SourceArtifact", "OfficialSourceSnapshot", "SnapshotDecision", "OfficialActor", "OfficialOrganRecord", "GroupMembershipRecord", "SeatMandateRecord", "ScrutinVoterAttestation", "OfficialActorLinkDecision", "OrganContinuityDecision", "HistoricalResolutionRun", "HistoricalRunSnapshotPin", "RunExclusion", "ScrutinCountCheck", "ScrutinGroupCountCheck", "ScrutinOrganPosition" FROM hg_importer, hg_runner, hg_reader;
REVOKE ALL ON SEQUENCE "SnapshotDecision_decisionNo_seq" FROM hg_importer, hg_runner, hg_reader;

DROP POLICY IF EXISTS "hg_importer_select" ON "SourceArtifact";
CREATE POLICY "hg_importer_select" ON "SourceArtifact" FOR SELECT TO hg_importer USING (true);
DROP POLICY IF EXISTS "hg_importer_select" ON "OfficialSourceSnapshot";
CREATE POLICY "hg_importer_select" ON "OfficialSourceSnapshot" FOR SELECT TO hg_importer USING (true);
DROP POLICY IF EXISTS "hg_importer_select" ON "SnapshotDecision";
CREATE POLICY "hg_importer_select" ON "SnapshotDecision" FOR SELECT TO hg_importer USING (true);
DROP POLICY IF EXISTS "hg_importer_select" ON "OfficialActor";
CREATE POLICY "hg_importer_select" ON "OfficialActor" FOR SELECT TO hg_importer USING (true);
DROP POLICY IF EXISTS "hg_importer_select" ON "OfficialOrganRecord";
CREATE POLICY "hg_importer_select" ON "OfficialOrganRecord" FOR SELECT TO hg_importer USING (true);
DROP POLICY IF EXISTS "hg_importer_select" ON "GroupMembershipRecord";
CREATE POLICY "hg_importer_select" ON "GroupMembershipRecord" FOR SELECT TO hg_importer USING (true);
DROP POLICY IF EXISTS "hg_importer_select" ON "SeatMandateRecord";
CREATE POLICY "hg_importer_select" ON "SeatMandateRecord" FOR SELECT TO hg_importer USING (true);
DROP POLICY IF EXISTS "hg_importer_select" ON "ScrutinVoterAttestation";
CREATE POLICY "hg_importer_select" ON "ScrutinVoterAttestation" FOR SELECT TO hg_importer USING (true);
DROP POLICY IF EXISTS "hg_importer_select" ON "ScrutinCountCheck";
CREATE POLICY "hg_importer_select" ON "ScrutinCountCheck" FOR SELECT TO hg_importer USING (true);
DROP POLICY IF EXISTS "hg_importer_select" ON "ScrutinGroupCountCheck";
CREATE POLICY "hg_importer_select" ON "ScrutinGroupCountCheck" FOR SELECT TO hg_importer USING (true);
DROP POLICY IF EXISTS "hg_importer_insert" ON "SourceArtifact";
CREATE POLICY "hg_importer_insert" ON "SourceArtifact" FOR INSERT TO hg_importer WITH CHECK (true);
DROP POLICY IF EXISTS "hg_importer_insert" ON "OfficialSourceSnapshot";
CREATE POLICY "hg_importer_insert" ON "OfficialSourceSnapshot" FOR INSERT TO hg_importer WITH CHECK (true);
DROP POLICY IF EXISTS "hg_importer_insert" ON "SnapshotDecision";
CREATE POLICY "hg_importer_insert" ON "SnapshotDecision" FOR INSERT TO hg_importer WITH CHECK ("status" = 'QUARANTINED' AND "decidedByKind" = 'SCRIPT');
DROP POLICY IF EXISTS "hg_importer_insert" ON "OfficialActor";
CREATE POLICY "hg_importer_insert" ON "OfficialActor" FOR INSERT TO hg_importer WITH CHECK (true);
DROP POLICY IF EXISTS "hg_importer_insert" ON "OfficialOrganRecord";
CREATE POLICY "hg_importer_insert" ON "OfficialOrganRecord" FOR INSERT TO hg_importer WITH CHECK (true);
DROP POLICY IF EXISTS "hg_importer_insert" ON "GroupMembershipRecord";
CREATE POLICY "hg_importer_insert" ON "GroupMembershipRecord" FOR INSERT TO hg_importer WITH CHECK (true);
DROP POLICY IF EXISTS "hg_importer_insert" ON "SeatMandateRecord";
CREATE POLICY "hg_importer_insert" ON "SeatMandateRecord" FOR INSERT TO hg_importer WITH CHECK (true);
DROP POLICY IF EXISTS "hg_importer_insert" ON "ScrutinVoterAttestation";
CREATE POLICY "hg_importer_insert" ON "ScrutinVoterAttestation" FOR INSERT TO hg_importer WITH CHECK (true);
DROP POLICY IF EXISTS "hg_importer_insert" ON "ScrutinCountCheck";
CREATE POLICY "hg_importer_insert" ON "ScrutinCountCheck" FOR INSERT TO hg_importer WITH CHECK (true);
DROP POLICY IF EXISTS "hg_importer_insert" ON "ScrutinGroupCountCheck";
CREATE POLICY "hg_importer_insert" ON "ScrutinGroupCountCheck" FOR INSERT TO hg_importer WITH CHECK (true);
DROP POLICY IF EXISTS "hg_importer_update" ON "SourceArtifact";
CREATE POLICY "hg_importer_update" ON "SourceArtifact" FOR UPDATE TO hg_importer USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "hg_importer_update" ON "OfficialActor";
CREATE POLICY "hg_importer_update" ON "OfficialActor" FOR UPDATE TO hg_importer USING ("toSeq" IS NULL) WITH CHECK ("toSeq" IS NOT NULL);
DROP POLICY IF EXISTS "hg_importer_update" ON "OfficialOrganRecord";
CREATE POLICY "hg_importer_update" ON "OfficialOrganRecord" FOR UPDATE TO hg_importer USING ("toSeq" IS NULL) WITH CHECK ("toSeq" IS NOT NULL);
DROP POLICY IF EXISTS "hg_importer_update" ON "GroupMembershipRecord";
CREATE POLICY "hg_importer_update" ON "GroupMembershipRecord" FOR UPDATE TO hg_importer USING ("toSeq" IS NULL) WITH CHECK ("toSeq" IS NOT NULL);
DROP POLICY IF EXISTS "hg_importer_update" ON "SeatMandateRecord";
CREATE POLICY "hg_importer_update" ON "SeatMandateRecord" FOR UPDATE TO hg_importer USING ("toSeq" IS NULL) WITH CHECK ("toSeq" IS NOT NULL);
DROP POLICY IF EXISTS "hg_importer_update" ON "ScrutinVoterAttestation";
CREATE POLICY "hg_importer_update" ON "ScrutinVoterAttestation" FOR UPDATE TO hg_importer USING ("toSeq" IS NULL) WITH CHECK ("toSeq" IS NOT NULL);
DROP POLICY IF EXISTS "hg_importer_update" ON "ScrutinCountCheck";
CREATE POLICY "hg_importer_update" ON "ScrutinCountCheck" FOR UPDATE TO hg_importer USING ("toSeq" IS NULL) WITH CHECK ("toSeq" IS NOT NULL);
DROP POLICY IF EXISTS "hg_importer_update" ON "ScrutinGroupCountCheck";
CREATE POLICY "hg_importer_update" ON "ScrutinGroupCountCheck" FOR UPDATE TO hg_importer USING ("toSeq" IS NULL) WITH CHECK ("toSeq" IS NOT NULL);
DROP POLICY IF EXISTS "hg_runner_select" ON "OfficialSourceSnapshot";
CREATE POLICY "hg_runner_select" ON "OfficialSourceSnapshot" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "SnapshotDecision";
CREATE POLICY "hg_runner_select" ON "SnapshotDecision" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "OfficialActor";
CREATE POLICY "hg_runner_select" ON "OfficialActor" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "OfficialOrganRecord";
CREATE POLICY "hg_runner_select" ON "OfficialOrganRecord" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "GroupMembershipRecord";
CREATE POLICY "hg_runner_select" ON "GroupMembershipRecord" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "SeatMandateRecord";
CREATE POLICY "hg_runner_select" ON "SeatMandateRecord" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "ScrutinVoterAttestation";
CREATE POLICY "hg_runner_select" ON "ScrutinVoterAttestation" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "ScrutinCountCheck";
CREATE POLICY "hg_runner_select" ON "ScrutinCountCheck" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "ScrutinGroupCountCheck";
CREATE POLICY "hg_runner_select" ON "ScrutinGroupCountCheck" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "HistoricalResolutionRun";
CREATE POLICY "hg_runner_select" ON "HistoricalResolutionRun" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "HistoricalRunSnapshotPin";
CREATE POLICY "hg_runner_select" ON "HistoricalRunSnapshotPin" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "RunExclusion";
CREATE POLICY "hg_runner_select" ON "RunExclusion" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "ScrutinOrganPosition";
CREATE POLICY "hg_runner_select" ON "ScrutinOrganPosition" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "OfficialActorLinkDecision";
CREATE POLICY "hg_runner_select" ON "OfficialActorLinkDecision" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "OrganContinuityDecision";
CREATE POLICY "hg_runner_select" ON "OrganContinuityDecision" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_insert" ON "HistoricalResolutionRun";
CREATE POLICY "hg_runner_insert" ON "HistoricalResolutionRun" FOR INSERT TO hg_runner WITH CHECK (true);
DROP POLICY IF EXISTS "hg_runner_insert" ON "HistoricalRunSnapshotPin";
CREATE POLICY "hg_runner_insert" ON "HistoricalRunSnapshotPin" FOR INSERT TO hg_runner WITH CHECK (true);
DROP POLICY IF EXISTS "hg_runner_insert" ON "RunExclusion";
CREATE POLICY "hg_runner_insert" ON "RunExclusion" FOR INSERT TO hg_runner WITH CHECK (true);
DROP POLICY IF EXISTS "hg_runner_insert" ON "ScrutinOrganPosition";
CREATE POLICY "hg_runner_insert" ON "ScrutinOrganPosition" FOR INSERT TO hg_runner WITH CHECK (true);
DROP POLICY IF EXISTS "hg_runner_update" ON "HistoricalResolutionRun";
CREATE POLICY "hg_runner_update" ON "HistoricalResolutionRun" FOR UPDATE TO hg_runner USING ("status" = 'RUNNING') WITH CHECK ("status" IN ('COMPLETED', 'FAILED'));
DROP POLICY IF EXISTS "hg_reader_select" ON "SourceArtifact";
CREATE POLICY "hg_reader_select" ON "SourceArtifact" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "OfficialSourceSnapshot";
CREATE POLICY "hg_reader_select" ON "OfficialSourceSnapshot" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "SnapshotDecision";
CREATE POLICY "hg_reader_select" ON "SnapshotDecision" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "OfficialActor";
CREATE POLICY "hg_reader_select" ON "OfficialActor" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "OfficialOrganRecord";
CREATE POLICY "hg_reader_select" ON "OfficialOrganRecord" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "GroupMembershipRecord";
CREATE POLICY "hg_reader_select" ON "GroupMembershipRecord" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "SeatMandateRecord";
CREATE POLICY "hg_reader_select" ON "SeatMandateRecord" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "ScrutinVoterAttestation";
CREATE POLICY "hg_reader_select" ON "ScrutinVoterAttestation" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "ScrutinCountCheck";
CREATE POLICY "hg_reader_select" ON "ScrutinCountCheck" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "ScrutinGroupCountCheck";
CREATE POLICY "hg_reader_select" ON "ScrutinGroupCountCheck" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "HistoricalResolutionRun";
CREATE POLICY "hg_reader_select" ON "HistoricalResolutionRun" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "HistoricalRunSnapshotPin";
CREATE POLICY "hg_reader_select" ON "HistoricalRunSnapshotPin" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "RunExclusion";
CREATE POLICY "hg_reader_select" ON "RunExclusion" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "ScrutinOrganPosition";
CREATE POLICY "hg_reader_select" ON "ScrutinOrganPosition" FOR SELECT TO hg_reader USING (true);

GRANT USAGE ON SCHEMA public TO hg_importer, hg_runner, hg_reader;

GRANT SELECT ON TABLE "SourceArtifact" TO hg_importer;
GRANT SELECT ON TABLE "OfficialSourceSnapshot" TO hg_importer;
GRANT SELECT ON TABLE "SnapshotDecision" TO hg_importer;
GRANT SELECT ON TABLE "OfficialActor" TO hg_importer;
GRANT SELECT ON TABLE "OfficialOrganRecord" TO hg_importer;
GRANT SELECT ON TABLE "GroupMembershipRecord" TO hg_importer;
GRANT SELECT ON TABLE "SeatMandateRecord" TO hg_importer;
GRANT SELECT ON TABLE "ScrutinVoterAttestation" TO hg_importer;
GRANT SELECT ON TABLE "ScrutinCountCheck" TO hg_importer;
GRANT SELECT ON TABLE "ScrutinGroupCountCheck" TO hg_importer;
GRANT INSERT ON TABLE "SourceArtifact" TO hg_importer;
GRANT INSERT ON TABLE "OfficialSourceSnapshot" TO hg_importer;
GRANT INSERT ON TABLE "SnapshotDecision" TO hg_importer;
GRANT INSERT ON TABLE "OfficialActor" TO hg_importer;
GRANT INSERT ON TABLE "OfficialOrganRecord" TO hg_importer;
GRANT INSERT ON TABLE "GroupMembershipRecord" TO hg_importer;
GRANT INSERT ON TABLE "SeatMandateRecord" TO hg_importer;
GRANT INSERT ON TABLE "ScrutinVoterAttestation" TO hg_importer;
GRANT INSERT ON TABLE "ScrutinCountCheck" TO hg_importer;
GRANT INSERT ON TABLE "ScrutinGroupCountCheck" TO hg_importer;
GRANT UPDATE ("lastVerifiedAt") ON TABLE "SourceArtifact" TO hg_importer;
GRANT UPDATE ("toSeq") ON TABLE "OfficialActor" TO hg_importer;
GRANT UPDATE ("toSeq") ON TABLE "OfficialOrganRecord" TO hg_importer;
GRANT UPDATE ("toSeq") ON TABLE "GroupMembershipRecord" TO hg_importer;
GRANT UPDATE ("toSeq") ON TABLE "SeatMandateRecord" TO hg_importer;
GRANT UPDATE ("toSeq") ON TABLE "ScrutinVoterAttestation" TO hg_importer;
GRANT UPDATE ("toSeq") ON TABLE "ScrutinCountCheck" TO hg_importer;
GRANT UPDATE ("toSeq") ON TABLE "ScrutinGroupCountCheck" TO hg_importer;
GRANT SELECT ON TABLE "OfficialSourceSnapshot" TO hg_runner;
GRANT SELECT ON TABLE "SnapshotDecision" TO hg_runner;
GRANT SELECT ON TABLE "OfficialActor" TO hg_runner;
GRANT SELECT ON TABLE "OfficialOrganRecord" TO hg_runner;
GRANT SELECT ON TABLE "GroupMembershipRecord" TO hg_runner;
GRANT SELECT ON TABLE "SeatMandateRecord" TO hg_runner;
GRANT SELECT ON TABLE "ScrutinVoterAttestation" TO hg_runner;
GRANT SELECT ON TABLE "ScrutinCountCheck" TO hg_runner;
GRANT SELECT ON TABLE "ScrutinGroupCountCheck" TO hg_runner;
GRANT SELECT ON TABLE "HistoricalResolutionRun" TO hg_runner;
GRANT SELECT ON TABLE "HistoricalRunSnapshotPin" TO hg_runner;
GRANT SELECT ON TABLE "RunExclusion" TO hg_runner;
GRANT SELECT ON TABLE "ScrutinOrganPosition" TO hg_runner;
GRANT SELECT ON TABLE "OfficialActorLinkDecision" TO hg_runner;
GRANT SELECT ON TABLE "OrganContinuityDecision" TO hg_runner;
GRANT INSERT ON TABLE "HistoricalResolutionRun" TO hg_runner;
GRANT INSERT ON TABLE "HistoricalRunSnapshotPin" TO hg_runner;
GRANT INSERT ON TABLE "RunExclusion" TO hg_runner;
GRANT INSERT ON TABLE "ScrutinOrganPosition" TO hg_runner;
GRANT UPDATE ("status", "outputHash", "statusCounts", "finishedAt") ON TABLE "HistoricalResolutionRun" TO hg_runner;
GRANT SELECT ON TABLE "SourceArtifact" TO hg_reader;
GRANT SELECT ON TABLE "OfficialSourceSnapshot" TO hg_reader;
GRANT SELECT ON TABLE "SnapshotDecision" TO hg_reader;
GRANT SELECT ON TABLE "OfficialActor" TO hg_reader;
GRANT SELECT ON TABLE "OfficialOrganRecord" TO hg_reader;
GRANT SELECT ON TABLE "GroupMembershipRecord" TO hg_reader;
GRANT SELECT ON TABLE "SeatMandateRecord" TO hg_reader;
GRANT SELECT ON TABLE "ScrutinVoterAttestation" TO hg_reader;
GRANT SELECT ON TABLE "ScrutinCountCheck" TO hg_reader;
GRANT SELECT ON TABLE "ScrutinGroupCountCheck" TO hg_reader;
GRANT SELECT ON TABLE "HistoricalResolutionRun" TO hg_reader;
GRANT SELECT ON TABLE "HistoricalRunSnapshotPin" TO hg_reader;
GRANT SELECT ON TABLE "RunExclusion" TO hg_reader;
GRANT SELECT ON TABLE "ScrutinOrganPosition" TO hg_reader;
GRANT USAGE ON SEQUENCE "SnapshotDecision_decisionNo_seq" TO hg_importer;

-- hg:precheck
SET LOCAL search_path TO pg_catalog;

CREATE TEMP TABLE hg_catalog_dump (side text NOT NULL, kind text NOT NULL, item text NOT NULL) ON COMMIT DROP;

INSERT INTO hg_catalog_dump
SELECT 'hg_reference', 'column', c.relname || '|' || a.attname || '|' || format_type(a.atttypid, a.atttypmod)
       || '|' || a.attnotnull::text || '|' || COALESCE(regexp_replace(pg_get_expr(d.adbin, d.adrelid), '(hg_reference|public)\.', '', 'g'), '')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'hg_reference'
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE c.relkind = 'r' AND (c.relname = 'ScrutinOrganPosition' OR (c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion', 'ScrutinCountCheck', 'ScrutinGroupCountCheck', 'ScrutinOrganPosition']::text[]) AND a.attname = 'memberHash'));

INSERT INTO hg_catalog_dump
SELECT 'hg_reference', 'constraint', c.relname || '|' || k.conname || '|' || k.contype::text || '|'
       || regexp_replace(pg_get_constraintdef(k.oid), '(hg_reference|public)\.', '', 'g')
FROM pg_constraint k
JOIN pg_class c ON c.oid = k.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'hg_reference'
WHERE c.relname = 'ScrutinOrganPosition' OR (c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion', 'ScrutinCountCheck', 'ScrutinGroupCountCheck', 'ScrutinOrganPosition']::text[]) AND k.conname LIKE '%\_memberHash\_format');

INSERT INTO hg_catalog_dump
SELECT 'hg_reference', 'index', i.tablename || '|' || i.indexname || '|' || regexp_replace(i.indexdef, '(hg_reference|public)\.', '', 'g')
FROM pg_indexes i
WHERE i.schemaname = 'hg_reference' AND i.tablename = 'ScrutinOrganPosition';

INSERT INTO hg_catalog_dump
SELECT 'hg_reference', 'trigger', c.relname || '|' || t.tgname || '|' || t.tgenabled::text || '|'
       || regexp_replace(pg_get_triggerdef(t.oid), '(hg_reference|public)\.', '', 'g')
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'hg_reference'
WHERE NOT t.tgisinternal AND c.relname = 'ScrutinOrganPosition';

INSERT INTO hg_catalog_dump
SELECT 'hg_reference', 'table', c.relname || '|rls=' || c.relrowsecurity::text || '|force=' || c.relforcerowsecurity::text
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'hg_reference'
WHERE c.relkind = 'r' AND c.relname = 'ScrutinOrganPosition';

INSERT INTO hg_catalog_dump
SELECT 'hg_reference', 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|'
       || md5(p.prosrc) || '|' || COALESCE(p.proconfig::text, '') || '|' || p.prosecdef::text
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'hg_reference'
WHERE p.proname = 'historical_position_guard';

-- Row level security policies of every table of the lot, by role and command.
INSERT INTO hg_catalog_dump
SELECT 'hg_reference', 'policy', c.relname || '|' || pol.polname || '|' || pol.polcmd::text || '|' || pol.polpermissive::text || '|'
       || COALESCE((SELECT string_agg(COALESCE(r.rolname, 'PUBLIC'), ',' ORDER BY COALESCE(r.rolname, 'PUBLIC'))
                    FROM unnest(pol.polroles) u(oid) LEFT JOIN pg_roles r ON r.oid = u.oid), '')
       || '|' || COALESCE(regexp_replace(pg_get_expr(pol.polqual, pol.polrelid), '(hg_reference|public)\.', '', 'g'), '')
       || '|' || COALESCE(regexp_replace(pg_get_expr(pol.polwithcheck, pol.polrelid), '(hg_reference|public)\.', '', 'g'), '')
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'hg_reference'
WHERE c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion', 'ScrutinCountCheck', 'ScrutinGroupCountCheck', 'ScrutinOrganPosition']::text[]);

-- Table and sequence privileges of PUBLIC, anon, authenticated and the three roles of the lot.
INSERT INTO hg_catalog_dump
SELECT 'hg_reference', 'acl', c.relkind::text || '|' || c.relname || '|' || COALESCE(r.rolname, 'PUBLIC') || '|' || x.privilege_type
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'hg_reference'
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault((CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) x
LEFT JOIN pg_roles r ON r.oid = x.grantee
WHERE (c.relkind = 'r' AND c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion', 'ScrutinCountCheck', 'ScrutinGroupCountCheck', 'ScrutinOrganPosition']::text[]) OR c.relkind = 'S' AND c.relname = 'SnapshotDecision_decisionNo_seq')
  AND (x.grantee = 0 OR r.rolname IN ('anon', 'authenticated', 'hg_importer', 'hg_runner', 'hg_reader'));

INSERT INTO hg_catalog_dump
SELECT 'hg_reference', 'acl', 'col|' || c.relname || '|' || a.attname || '|' || r.rolname || '|' || x.privilege_type
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'hg_reference'
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
CROSS JOIN LATERAL aclexplode(a.attacl) x
JOIN pg_roles r ON r.oid = x.grantee
WHERE c.relkind = 'r' AND c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion', 'ScrutinCountCheck', 'ScrutinGroupCountCheck', 'ScrutinOrganPosition']::text[]) AND r.rolname IN ('anon', 'authenticated', 'hg_importer', 'hg_runner', 'hg_reader');

INSERT INTO hg_catalog_dump
SELECT 'hg_reference', 'acl', 'f|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|'
       || COALESCE(r.rolname, 'PUBLIC') || '|' || x.privilege_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'hg_reference'
CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
LEFT JOIN pg_roles r ON r.oid = x.grantee
WHERE p.proname = 'historical_position_guard' AND (x.grantee = 0 OR r.rolname IN ('anon', 'authenticated', 'hg_importer', 'hg_runner', 'hg_reader'));

INSERT INTO hg_catalog_dump
SELECT 'public_before', 'column', c.relname || '|' || a.attname || '|' || format_type(a.atttypid, a.atttypmod)
       || '|' || a.attnotnull::text || '|' || COALESCE(regexp_replace(pg_get_expr(d.adbin, d.adrelid), '(hg_reference|public)\.', '', 'g'), '')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE c.relkind = 'r' AND (c.relname = 'ScrutinOrganPosition' OR (c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion', 'ScrutinCountCheck', 'ScrutinGroupCountCheck', 'ScrutinOrganPosition']::text[]) AND a.attname = 'memberHash'));

INSERT INTO hg_catalog_dump
SELECT 'public_before', 'constraint', c.relname || '|' || k.conname || '|' || k.contype::text || '|'
       || regexp_replace(pg_get_constraintdef(k.oid), '(hg_reference|public)\.', '', 'g')
FROM pg_constraint k
JOIN pg_class c ON c.oid = k.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.relname = 'ScrutinOrganPosition' OR (c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion', 'ScrutinCountCheck', 'ScrutinGroupCountCheck', 'ScrutinOrganPosition']::text[]) AND k.conname LIKE '%\_memberHash\_format');

INSERT INTO hg_catalog_dump
SELECT 'public_before', 'index', i.tablename || '|' || i.indexname || '|' || regexp_replace(i.indexdef, '(hg_reference|public)\.', '', 'g')
FROM pg_indexes i
WHERE i.schemaname = 'public' AND i.tablename = 'ScrutinOrganPosition';

INSERT INTO hg_catalog_dump
SELECT 'public_before', 'trigger', c.relname || '|' || t.tgname || '|' || t.tgenabled::text || '|'
       || regexp_replace(pg_get_triggerdef(t.oid), '(hg_reference|public)\.', '', 'g')
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE NOT t.tgisinternal AND c.relname = 'ScrutinOrganPosition';

INSERT INTO hg_catalog_dump
SELECT 'public_before', 'table', c.relname || '|rls=' || c.relrowsecurity::text || '|force=' || c.relforcerowsecurity::text
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.relkind = 'r' AND c.relname = 'ScrutinOrganPosition';

INSERT INTO hg_catalog_dump
SELECT 'public_before', 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|'
       || md5(p.prosrc) || '|' || COALESCE(p.proconfig::text, '') || '|' || p.prosecdef::text
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
WHERE p.proname = 'historical_position_guard';

-- Row level security policies of every table of the lot, by role and command.
INSERT INTO hg_catalog_dump
SELECT 'public_before', 'policy', c.relname || '|' || pol.polname || '|' || pol.polcmd::text || '|' || pol.polpermissive::text || '|'
       || COALESCE((SELECT string_agg(COALESCE(r.rolname, 'PUBLIC'), ',' ORDER BY COALESCE(r.rolname, 'PUBLIC'))
                    FROM unnest(pol.polroles) u(oid) LEFT JOIN pg_roles r ON r.oid = u.oid), '')
       || '|' || COALESCE(regexp_replace(pg_get_expr(pol.polqual, pol.polrelid), '(hg_reference|public)\.', '', 'g'), '')
       || '|' || COALESCE(regexp_replace(pg_get_expr(pol.polwithcheck, pol.polrelid), '(hg_reference|public)\.', '', 'g'), '')
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion', 'ScrutinCountCheck', 'ScrutinGroupCountCheck', 'ScrutinOrganPosition']::text[]);

-- Table and sequence privileges of PUBLIC, anon, authenticated and the three roles of the lot.
INSERT INTO hg_catalog_dump
SELECT 'public_before', 'acl', c.relkind::text || '|' || c.relname || '|' || COALESCE(r.rolname, 'PUBLIC') || '|' || x.privilege_type
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault((CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) x
LEFT JOIN pg_roles r ON r.oid = x.grantee
WHERE (c.relkind = 'r' AND c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion', 'ScrutinCountCheck', 'ScrutinGroupCountCheck', 'ScrutinOrganPosition']::text[]) OR c.relkind = 'S' AND c.relname = 'SnapshotDecision_decisionNo_seq')
  AND (x.grantee = 0 OR r.rolname IN ('anon', 'authenticated', 'hg_importer', 'hg_runner', 'hg_reader'));

INSERT INTO hg_catalog_dump
SELECT 'public_before', 'acl', 'col|' || c.relname || '|' || a.attname || '|' || r.rolname || '|' || x.privilege_type
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
CROSS JOIN LATERAL aclexplode(a.attacl) x
JOIN pg_roles r ON r.oid = x.grantee
WHERE c.relkind = 'r' AND c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion', 'ScrutinCountCheck', 'ScrutinGroupCountCheck', 'ScrutinOrganPosition']::text[]) AND r.rolname IN ('anon', 'authenticated', 'hg_importer', 'hg_runner', 'hg_reader');

INSERT INTO hg_catalog_dump
SELECT 'public_before', 'acl', 'f|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|'
       || COALESCE(r.rolname, 'PUBLIC') || '|' || x.privilege_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
LEFT JOIN pg_roles r ON r.oid = x.grantee
WHERE p.proname = 'historical_position_guard' AND (x.grantee = 0 OR r.rolname IN ('anon', 'authenticated', 'hg_importer', 'hg_runner', 'hg_reader'));

-- Aucun état partiel. Si la table des positions existe, l'état réel doit être exactement la référence.
-- Sans écart, string_agg vaut NULL et le CAST ne fait rien : pas de bloc DO.
WITH existing AS (
  SELECT
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relkind = 'r' AND c.relname = 'ScrutinOrganPosition')::int AS has_table,
    (SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relname = ANY (ARRAY['OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord']::text[]) AND a.attname = 'memberHash' AND NOT a.attisdropped)::int AS member_hash_columns,
    (SELECT count(*) FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE pol.polname LIKE 'hg\_%')::int AS policies
),
diffs AS (
  (SELECT 'only in the reference build'::text AS side, kind, item FROM hg_catalog_dump WHERE side = 'hg_reference'
   EXCEPT SELECT 'only in the reference build', kind, item FROM hg_catalog_dump WHERE side = 'public_before')
  UNION ALL
  (SELECT 'only in the real schema', kind, item FROM hg_catalog_dump WHERE side = 'public_before'
   EXCEPT SELECT 'only in the real schema', kind, item FROM hg_catalog_dump WHERE side = 'hg_reference')
)
SELECT CAST(
  'The existing roles and positions schema differs from the expected definition. Nothing was changed.'
  || E'\n' || left(string_agg(problem, E'\n' ORDER BY problem), 4000)
  AS integer)
FROM (
  SELECT 'partial installation: ' || has_table || ' positions table, ' || member_hash_columns || ' of 4 memberHash columns, ' || policies || ' policies' AS problem
  FROM existing WHERE has_table = 0 AND (member_hash_columns <> 0 OR policies <> 0)
  UNION ALL
  SELECT side || ' ' || kind || ': ' || item FROM diffs, existing WHERE existing.has_table = 1
) problems;


-- hg:real-build
SET LOCAL search_path TO public, pg_catalog;

CREATE OR REPLACE FUNCTION historical_position_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_status text;
  v_config jsonb;
  v_checks integer;
  v_coherent integer;
BEGIN
  -- Shared lock on the run: finishing it (exclusive lock, in the run guard) waits for rows being added.
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('run:' || NEW."runId", 0));
  SELECT "status", "config" INTO v_status, v_config FROM "HistoricalResolutionRun" WHERE "id" = NEW."runId";
  IF v_status IS DISTINCT FROM 'RUNNING' THEN
    RAISE EXCEPTION 'positions are added to a run only while it is RUNNING' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT NEW."publishable" THEN
    RETURN NEW;
  END IF;

  -- Publication gate, enforced here so that no client can bypass it. A row written as publishable
  -- must satisfy what the database itself can verify. Anything else is refused, never corrected.

  -- A filler organ (the published organ is a placeholder, not a group).
  IF COALESCE(v_config #> '{evidence,placeholderOrganRefs}', '[]'::jsonb) ? NEW."organRef" THEN
    RAISE EXCEPTION 'organ % is a placeholder: its position is never publishable', NEW."organRef"
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- The excluded votes of the group must be within the threshold of the run configuration. A run
  -- without a threshold publishes nothing.
  IF NEW."excludedCount" > COALESCE((v_config #>> '{publication,maxExcludedPerGroup}')::integer, -1) THEN
    RAISE EXCEPTION 'organ % of scrutin %: % excluded votes exceed the threshold of the run', NEW."organRef", NEW."scrutinExternalId", NEW."excludedCount"
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- The official counts of the scrutin must be COHERENT in the snapshot the run pinned. No count
  -- check on record is not a pass. Several rows (the scrutin found in two pinned streams) are not a
  -- pass either.
  SELECT count(*), count(*) FILTER (WHERE c."countCoherence" = 'COHERENT') INTO v_checks, v_coherent
  FROM "HistoricalRunSnapshotPin" p
  JOIN "ScrutinCountCheck" c
    ON c."stream" = p."stream" AND c."scrutinExternalId" = NEW."scrutinExternalId"
   AND c."fromSeq" <= p."seq" AND (c."toSeq" IS NULL OR c."toSeq" > p."seq")
  WHERE p."runId" = NEW."runId";
  IF v_checks <> 1 OR v_coherent <> 1 THEN
    RAISE EXCEPTION 'scrutin % is not COHERENT in the pinned snapshots (% count checks, % coherent): its positions are not publishable', NEW."scrutinExternalId", v_checks, v_coherent
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TABLE IF NOT EXISTS "ScrutinOrganPosition" (
    "runId" TEXT NOT NULL,
    "scrutinExternalId" TEXT NOT NULL,
    "organRef" TEXT NOT NULL,
    "organKind" TEXT,
    "forCount" INTEGER NOT NULL,
    "againstCount" INTEGER NOT NULL,
    "abstainCount" INTEGER NOT NULL,
    "nonVoterCount" INTEGER NOT NULL,
    "excludedCount" INTEGER NOT NULL,
    "excludedByReason" JSONB NOT NULL,
    "publishable" BOOLEAN NOT NULL,
    "reason" TEXT,

    CONSTRAINT "ScrutinOrganPosition_pkey" PRIMARY KEY ("runId", "scrutinExternalId", "organRef"),
    CONSTRAINT "ScrutinOrganPosition_runId_fkey" FOREIGN KEY ("runId") REFERENCES "HistoricalResolutionRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ScrutinOrganPosition_keys_present" CHECK ("scrutinExternalId" <> '' AND "organRef" <> ''),
    CONSTRAINT "ScrutinOrganPosition_organKind_known" CHECK ("organKind" IS NULL OR "organKind" IN ('GROUP', 'NON_INSCRIT')),
    CONSTRAINT "ScrutinOrganPosition_counts_not_negative" CHECK ("forCount" >= 0 AND "againstCount" >= 0 AND "abstainCount" >= 0 AND "nonVoterCount" >= 0 AND "excludedCount" >= 0),
    CONSTRAINT "ScrutinOrganPosition_excludedByReason_object" CHECK (jsonb_typeof("excludedByReason") = 'object'),
    CONSTRAINT "ScrutinOrganPosition_reason_known" CHECK ("reason" IS NULL OR "reason" IN ('COUNT_MISMATCH', 'COUNT_UNVERIFIABLE', 'COUNT_COHERENCE_UNKNOWN', 'EXCLUDED_VOTES_PRESENT', 'NO_ATTESTED_VOTE', 'NON_INSCRIT_IS_NOT_A_GROUP', 'PLACEHOLDER_ORGAN')),
    CONSTRAINT "ScrutinOrganPosition_publishable_has_no_reason" CHECK (("publishable" AND "reason" IS NULL) OR (NOT "publishable" AND "reason" IS NOT NULL)),
    CONSTRAINT "ScrutinOrganPosition_publishable_is_a_group" CHECK (NOT "publishable" OR (COALESCE("organKind" = 'GROUP', false) AND "forCount" + "againstCount" + "abstainCount" > 0))
);
CREATE INDEX IF NOT EXISTS "ScrutinOrganPosition_runId_publishable_idx" ON "ScrutinOrganPosition"("runId", "publishable");
CREATE INDEX IF NOT EXISTS "ScrutinOrganPosition_scrutinExternalId_idx" ON "ScrutinOrganPosition"("scrutinExternalId");

CREATE OR REPLACE TRIGGER "ScrutinOrganPosition_no_update_delete" BEFORE UPDATE OR DELETE ON "ScrutinOrganPosition" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "ScrutinOrganPosition" ENABLE ALWAYS TRIGGER "ScrutinOrganPosition_no_update_delete";
CREATE OR REPLACE TRIGGER "ScrutinOrganPosition_insert_guard" BEFORE INSERT ON "ScrutinOrganPosition" FOR EACH ROW EXECUTE FUNCTION historical_position_guard();
ALTER TABLE "ScrutinOrganPosition" ENABLE ALWAYS TRIGGER "ScrutinOrganPosition_insert_guard";
CREATE OR REPLACE TRIGGER "ScrutinOrganPosition_no_truncate" BEFORE TRUNCATE ON "ScrutinOrganPosition" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "ScrutinOrganPosition" ENABLE ALWAYS TRIGGER "ScrutinOrganPosition_no_truncate";
ALTER TABLE "ScrutinOrganPosition" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "OfficialActor" ADD COLUMN IF NOT EXISTS "memberHash" TEXT NOT NULL CONSTRAINT "OfficialActor_memberHash_format" CHECK ("memberHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "OfficialOrganRecord" ADD COLUMN IF NOT EXISTS "memberHash" TEXT NOT NULL CONSTRAINT "OfficialOrganRecord_memberHash_format" CHECK ("memberHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "GroupMembershipRecord" ADD COLUMN IF NOT EXISTS "memberHash" TEXT NOT NULL CONSTRAINT "GroupMembershipRecord_memberHash_format" CHECK ("memberHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "SeatMandateRecord" ADD COLUMN IF NOT EXISTS "memberHash" TEXT NOT NULL CONSTRAINT "SeatMandateRecord_memberHash_format" CHECK ("memberHash" ~ '^[0-9a-f]{64}$');

REVOKE ALL ON TABLE "SourceArtifact", "OfficialSourceSnapshot", "SnapshotDecision", "OfficialActor", "OfficialOrganRecord", "GroupMembershipRecord", "SeatMandateRecord", "ScrutinVoterAttestation", "OfficialActorLinkDecision", "OrganContinuityDecision", "HistoricalResolutionRun", "HistoricalRunSnapshotPin", "RunExclusion", "ScrutinCountCheck", "ScrutinGroupCountCheck", "ScrutinOrganPosition" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION historical_position_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE "SourceArtifact", "OfficialSourceSnapshot", "SnapshotDecision", "OfficialActor", "OfficialOrganRecord", "GroupMembershipRecord", "SeatMandateRecord", "ScrutinVoterAttestation", "OfficialActorLinkDecision", "OrganContinuityDecision", "HistoricalResolutionRun", "HistoricalRunSnapshotPin", "RunExclusion", "ScrutinCountCheck", "ScrutinGroupCountCheck", "ScrutinOrganPosition" FROM hg_importer, hg_runner, hg_reader;
REVOKE ALL ON SEQUENCE "SnapshotDecision_decisionNo_seq" FROM hg_importer, hg_runner, hg_reader;

DROP POLICY IF EXISTS "hg_importer_select" ON "SourceArtifact";
CREATE POLICY "hg_importer_select" ON "SourceArtifact" FOR SELECT TO hg_importer USING (true);
DROP POLICY IF EXISTS "hg_importer_select" ON "OfficialSourceSnapshot";
CREATE POLICY "hg_importer_select" ON "OfficialSourceSnapshot" FOR SELECT TO hg_importer USING (true);
DROP POLICY IF EXISTS "hg_importer_select" ON "SnapshotDecision";
CREATE POLICY "hg_importer_select" ON "SnapshotDecision" FOR SELECT TO hg_importer USING (true);
DROP POLICY IF EXISTS "hg_importer_select" ON "OfficialActor";
CREATE POLICY "hg_importer_select" ON "OfficialActor" FOR SELECT TO hg_importer USING (true);
DROP POLICY IF EXISTS "hg_importer_select" ON "OfficialOrganRecord";
CREATE POLICY "hg_importer_select" ON "OfficialOrganRecord" FOR SELECT TO hg_importer USING (true);
DROP POLICY IF EXISTS "hg_importer_select" ON "GroupMembershipRecord";
CREATE POLICY "hg_importer_select" ON "GroupMembershipRecord" FOR SELECT TO hg_importer USING (true);
DROP POLICY IF EXISTS "hg_importer_select" ON "SeatMandateRecord";
CREATE POLICY "hg_importer_select" ON "SeatMandateRecord" FOR SELECT TO hg_importer USING (true);
DROP POLICY IF EXISTS "hg_importer_select" ON "ScrutinVoterAttestation";
CREATE POLICY "hg_importer_select" ON "ScrutinVoterAttestation" FOR SELECT TO hg_importer USING (true);
DROP POLICY IF EXISTS "hg_importer_select" ON "ScrutinCountCheck";
CREATE POLICY "hg_importer_select" ON "ScrutinCountCheck" FOR SELECT TO hg_importer USING (true);
DROP POLICY IF EXISTS "hg_importer_select" ON "ScrutinGroupCountCheck";
CREATE POLICY "hg_importer_select" ON "ScrutinGroupCountCheck" FOR SELECT TO hg_importer USING (true);
DROP POLICY IF EXISTS "hg_importer_insert" ON "SourceArtifact";
CREATE POLICY "hg_importer_insert" ON "SourceArtifact" FOR INSERT TO hg_importer WITH CHECK (true);
DROP POLICY IF EXISTS "hg_importer_insert" ON "OfficialSourceSnapshot";
CREATE POLICY "hg_importer_insert" ON "OfficialSourceSnapshot" FOR INSERT TO hg_importer WITH CHECK (true);
DROP POLICY IF EXISTS "hg_importer_insert" ON "SnapshotDecision";
CREATE POLICY "hg_importer_insert" ON "SnapshotDecision" FOR INSERT TO hg_importer WITH CHECK ("status" = 'QUARANTINED' AND "decidedByKind" = 'SCRIPT');
DROP POLICY IF EXISTS "hg_importer_insert" ON "OfficialActor";
CREATE POLICY "hg_importer_insert" ON "OfficialActor" FOR INSERT TO hg_importer WITH CHECK (true);
DROP POLICY IF EXISTS "hg_importer_insert" ON "OfficialOrganRecord";
CREATE POLICY "hg_importer_insert" ON "OfficialOrganRecord" FOR INSERT TO hg_importer WITH CHECK (true);
DROP POLICY IF EXISTS "hg_importer_insert" ON "GroupMembershipRecord";
CREATE POLICY "hg_importer_insert" ON "GroupMembershipRecord" FOR INSERT TO hg_importer WITH CHECK (true);
DROP POLICY IF EXISTS "hg_importer_insert" ON "SeatMandateRecord";
CREATE POLICY "hg_importer_insert" ON "SeatMandateRecord" FOR INSERT TO hg_importer WITH CHECK (true);
DROP POLICY IF EXISTS "hg_importer_insert" ON "ScrutinVoterAttestation";
CREATE POLICY "hg_importer_insert" ON "ScrutinVoterAttestation" FOR INSERT TO hg_importer WITH CHECK (true);
DROP POLICY IF EXISTS "hg_importer_insert" ON "ScrutinCountCheck";
CREATE POLICY "hg_importer_insert" ON "ScrutinCountCheck" FOR INSERT TO hg_importer WITH CHECK (true);
DROP POLICY IF EXISTS "hg_importer_insert" ON "ScrutinGroupCountCheck";
CREATE POLICY "hg_importer_insert" ON "ScrutinGroupCountCheck" FOR INSERT TO hg_importer WITH CHECK (true);
DROP POLICY IF EXISTS "hg_importer_update" ON "SourceArtifact";
CREATE POLICY "hg_importer_update" ON "SourceArtifact" FOR UPDATE TO hg_importer USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "hg_importer_update" ON "OfficialActor";
CREATE POLICY "hg_importer_update" ON "OfficialActor" FOR UPDATE TO hg_importer USING ("toSeq" IS NULL) WITH CHECK ("toSeq" IS NOT NULL);
DROP POLICY IF EXISTS "hg_importer_update" ON "OfficialOrganRecord";
CREATE POLICY "hg_importer_update" ON "OfficialOrganRecord" FOR UPDATE TO hg_importer USING ("toSeq" IS NULL) WITH CHECK ("toSeq" IS NOT NULL);
DROP POLICY IF EXISTS "hg_importer_update" ON "GroupMembershipRecord";
CREATE POLICY "hg_importer_update" ON "GroupMembershipRecord" FOR UPDATE TO hg_importer USING ("toSeq" IS NULL) WITH CHECK ("toSeq" IS NOT NULL);
DROP POLICY IF EXISTS "hg_importer_update" ON "SeatMandateRecord";
CREATE POLICY "hg_importer_update" ON "SeatMandateRecord" FOR UPDATE TO hg_importer USING ("toSeq" IS NULL) WITH CHECK ("toSeq" IS NOT NULL);
DROP POLICY IF EXISTS "hg_importer_update" ON "ScrutinVoterAttestation";
CREATE POLICY "hg_importer_update" ON "ScrutinVoterAttestation" FOR UPDATE TO hg_importer USING ("toSeq" IS NULL) WITH CHECK ("toSeq" IS NOT NULL);
DROP POLICY IF EXISTS "hg_importer_update" ON "ScrutinCountCheck";
CREATE POLICY "hg_importer_update" ON "ScrutinCountCheck" FOR UPDATE TO hg_importer USING ("toSeq" IS NULL) WITH CHECK ("toSeq" IS NOT NULL);
DROP POLICY IF EXISTS "hg_importer_update" ON "ScrutinGroupCountCheck";
CREATE POLICY "hg_importer_update" ON "ScrutinGroupCountCheck" FOR UPDATE TO hg_importer USING ("toSeq" IS NULL) WITH CHECK ("toSeq" IS NOT NULL);
DROP POLICY IF EXISTS "hg_runner_select" ON "OfficialSourceSnapshot";
CREATE POLICY "hg_runner_select" ON "OfficialSourceSnapshot" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "SnapshotDecision";
CREATE POLICY "hg_runner_select" ON "SnapshotDecision" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "OfficialActor";
CREATE POLICY "hg_runner_select" ON "OfficialActor" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "OfficialOrganRecord";
CREATE POLICY "hg_runner_select" ON "OfficialOrganRecord" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "GroupMembershipRecord";
CREATE POLICY "hg_runner_select" ON "GroupMembershipRecord" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "SeatMandateRecord";
CREATE POLICY "hg_runner_select" ON "SeatMandateRecord" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "ScrutinVoterAttestation";
CREATE POLICY "hg_runner_select" ON "ScrutinVoterAttestation" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "ScrutinCountCheck";
CREATE POLICY "hg_runner_select" ON "ScrutinCountCheck" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "ScrutinGroupCountCheck";
CREATE POLICY "hg_runner_select" ON "ScrutinGroupCountCheck" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "HistoricalResolutionRun";
CREATE POLICY "hg_runner_select" ON "HistoricalResolutionRun" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "HistoricalRunSnapshotPin";
CREATE POLICY "hg_runner_select" ON "HistoricalRunSnapshotPin" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "RunExclusion";
CREATE POLICY "hg_runner_select" ON "RunExclusion" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "ScrutinOrganPosition";
CREATE POLICY "hg_runner_select" ON "ScrutinOrganPosition" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "OfficialActorLinkDecision";
CREATE POLICY "hg_runner_select" ON "OfficialActorLinkDecision" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_select" ON "OrganContinuityDecision";
CREATE POLICY "hg_runner_select" ON "OrganContinuityDecision" FOR SELECT TO hg_runner USING (true);
DROP POLICY IF EXISTS "hg_runner_insert" ON "HistoricalResolutionRun";
CREATE POLICY "hg_runner_insert" ON "HistoricalResolutionRun" FOR INSERT TO hg_runner WITH CHECK (true);
DROP POLICY IF EXISTS "hg_runner_insert" ON "HistoricalRunSnapshotPin";
CREATE POLICY "hg_runner_insert" ON "HistoricalRunSnapshotPin" FOR INSERT TO hg_runner WITH CHECK (true);
DROP POLICY IF EXISTS "hg_runner_insert" ON "RunExclusion";
CREATE POLICY "hg_runner_insert" ON "RunExclusion" FOR INSERT TO hg_runner WITH CHECK (true);
DROP POLICY IF EXISTS "hg_runner_insert" ON "ScrutinOrganPosition";
CREATE POLICY "hg_runner_insert" ON "ScrutinOrganPosition" FOR INSERT TO hg_runner WITH CHECK (true);
DROP POLICY IF EXISTS "hg_runner_update" ON "HistoricalResolutionRun";
CREATE POLICY "hg_runner_update" ON "HistoricalResolutionRun" FOR UPDATE TO hg_runner USING ("status" = 'RUNNING') WITH CHECK ("status" IN ('COMPLETED', 'FAILED'));
DROP POLICY IF EXISTS "hg_reader_select" ON "SourceArtifact";
CREATE POLICY "hg_reader_select" ON "SourceArtifact" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "OfficialSourceSnapshot";
CREATE POLICY "hg_reader_select" ON "OfficialSourceSnapshot" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "SnapshotDecision";
CREATE POLICY "hg_reader_select" ON "SnapshotDecision" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "OfficialActor";
CREATE POLICY "hg_reader_select" ON "OfficialActor" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "OfficialOrganRecord";
CREATE POLICY "hg_reader_select" ON "OfficialOrganRecord" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "GroupMembershipRecord";
CREATE POLICY "hg_reader_select" ON "GroupMembershipRecord" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "SeatMandateRecord";
CREATE POLICY "hg_reader_select" ON "SeatMandateRecord" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "ScrutinVoterAttestation";
CREATE POLICY "hg_reader_select" ON "ScrutinVoterAttestation" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "ScrutinCountCheck";
CREATE POLICY "hg_reader_select" ON "ScrutinCountCheck" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "ScrutinGroupCountCheck";
CREATE POLICY "hg_reader_select" ON "ScrutinGroupCountCheck" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "HistoricalResolutionRun";
CREATE POLICY "hg_reader_select" ON "HistoricalResolutionRun" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "HistoricalRunSnapshotPin";
CREATE POLICY "hg_reader_select" ON "HistoricalRunSnapshotPin" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "RunExclusion";
CREATE POLICY "hg_reader_select" ON "RunExclusion" FOR SELECT TO hg_reader USING (true);
DROP POLICY IF EXISTS "hg_reader_select" ON "ScrutinOrganPosition";
CREATE POLICY "hg_reader_select" ON "ScrutinOrganPosition" FOR SELECT TO hg_reader USING (true);

GRANT USAGE ON SCHEMA public TO hg_importer, hg_runner, hg_reader;

GRANT SELECT ON TABLE "SourceArtifact" TO hg_importer;
GRANT SELECT ON TABLE "OfficialSourceSnapshot" TO hg_importer;
GRANT SELECT ON TABLE "SnapshotDecision" TO hg_importer;
GRANT SELECT ON TABLE "OfficialActor" TO hg_importer;
GRANT SELECT ON TABLE "OfficialOrganRecord" TO hg_importer;
GRANT SELECT ON TABLE "GroupMembershipRecord" TO hg_importer;
GRANT SELECT ON TABLE "SeatMandateRecord" TO hg_importer;
GRANT SELECT ON TABLE "ScrutinVoterAttestation" TO hg_importer;
GRANT SELECT ON TABLE "ScrutinCountCheck" TO hg_importer;
GRANT SELECT ON TABLE "ScrutinGroupCountCheck" TO hg_importer;
GRANT INSERT ON TABLE "SourceArtifact" TO hg_importer;
GRANT INSERT ON TABLE "OfficialSourceSnapshot" TO hg_importer;
GRANT INSERT ON TABLE "SnapshotDecision" TO hg_importer;
GRANT INSERT ON TABLE "OfficialActor" TO hg_importer;
GRANT INSERT ON TABLE "OfficialOrganRecord" TO hg_importer;
GRANT INSERT ON TABLE "GroupMembershipRecord" TO hg_importer;
GRANT INSERT ON TABLE "SeatMandateRecord" TO hg_importer;
GRANT INSERT ON TABLE "ScrutinVoterAttestation" TO hg_importer;
GRANT INSERT ON TABLE "ScrutinCountCheck" TO hg_importer;
GRANT INSERT ON TABLE "ScrutinGroupCountCheck" TO hg_importer;
GRANT UPDATE ("lastVerifiedAt") ON TABLE "SourceArtifact" TO hg_importer;
GRANT UPDATE ("toSeq") ON TABLE "OfficialActor" TO hg_importer;
GRANT UPDATE ("toSeq") ON TABLE "OfficialOrganRecord" TO hg_importer;
GRANT UPDATE ("toSeq") ON TABLE "GroupMembershipRecord" TO hg_importer;
GRANT UPDATE ("toSeq") ON TABLE "SeatMandateRecord" TO hg_importer;
GRANT UPDATE ("toSeq") ON TABLE "ScrutinVoterAttestation" TO hg_importer;
GRANT UPDATE ("toSeq") ON TABLE "ScrutinCountCheck" TO hg_importer;
GRANT UPDATE ("toSeq") ON TABLE "ScrutinGroupCountCheck" TO hg_importer;
GRANT SELECT ON TABLE "OfficialSourceSnapshot" TO hg_runner;
GRANT SELECT ON TABLE "SnapshotDecision" TO hg_runner;
GRANT SELECT ON TABLE "OfficialActor" TO hg_runner;
GRANT SELECT ON TABLE "OfficialOrganRecord" TO hg_runner;
GRANT SELECT ON TABLE "GroupMembershipRecord" TO hg_runner;
GRANT SELECT ON TABLE "SeatMandateRecord" TO hg_runner;
GRANT SELECT ON TABLE "ScrutinVoterAttestation" TO hg_runner;
GRANT SELECT ON TABLE "ScrutinCountCheck" TO hg_runner;
GRANT SELECT ON TABLE "ScrutinGroupCountCheck" TO hg_runner;
GRANT SELECT ON TABLE "HistoricalResolutionRun" TO hg_runner;
GRANT SELECT ON TABLE "HistoricalRunSnapshotPin" TO hg_runner;
GRANT SELECT ON TABLE "RunExclusion" TO hg_runner;
GRANT SELECT ON TABLE "ScrutinOrganPosition" TO hg_runner;
GRANT SELECT ON TABLE "OfficialActorLinkDecision" TO hg_runner;
GRANT SELECT ON TABLE "OrganContinuityDecision" TO hg_runner;
GRANT INSERT ON TABLE "HistoricalResolutionRun" TO hg_runner;
GRANT INSERT ON TABLE "HistoricalRunSnapshotPin" TO hg_runner;
GRANT INSERT ON TABLE "RunExclusion" TO hg_runner;
GRANT INSERT ON TABLE "ScrutinOrganPosition" TO hg_runner;
GRANT UPDATE ("status", "outputHash", "statusCounts", "finishedAt") ON TABLE "HistoricalResolutionRun" TO hg_runner;
GRANT SELECT ON TABLE "SourceArtifact" TO hg_reader;
GRANT SELECT ON TABLE "OfficialSourceSnapshot" TO hg_reader;
GRANT SELECT ON TABLE "SnapshotDecision" TO hg_reader;
GRANT SELECT ON TABLE "OfficialActor" TO hg_reader;
GRANT SELECT ON TABLE "OfficialOrganRecord" TO hg_reader;
GRANT SELECT ON TABLE "GroupMembershipRecord" TO hg_reader;
GRANT SELECT ON TABLE "SeatMandateRecord" TO hg_reader;
GRANT SELECT ON TABLE "ScrutinVoterAttestation" TO hg_reader;
GRANT SELECT ON TABLE "ScrutinCountCheck" TO hg_reader;
GRANT SELECT ON TABLE "ScrutinGroupCountCheck" TO hg_reader;
GRANT SELECT ON TABLE "HistoricalResolutionRun" TO hg_reader;
GRANT SELECT ON TABLE "HistoricalRunSnapshotPin" TO hg_reader;
GRANT SELECT ON TABLE "RunExclusion" TO hg_reader;
GRANT SELECT ON TABLE "ScrutinOrganPosition" TO hg_reader;
GRANT USAGE ON SEQUENCE "SnapshotDecision_decisionNo_seq" TO hg_importer;

-- hg:postcheck
SET LOCAL search_path TO pg_catalog;

INSERT INTO hg_catalog_dump
SELECT 'public_after', 'column', c.relname || '|' || a.attname || '|' || format_type(a.atttypid, a.atttypmod)
       || '|' || a.attnotnull::text || '|' || COALESCE(regexp_replace(pg_get_expr(d.adbin, d.adrelid), '(hg_reference|public)\.', '', 'g'), '')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE c.relkind = 'r' AND (c.relname = 'ScrutinOrganPosition' OR (c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion', 'ScrutinCountCheck', 'ScrutinGroupCountCheck', 'ScrutinOrganPosition']::text[]) AND a.attname = 'memberHash'));

INSERT INTO hg_catalog_dump
SELECT 'public_after', 'constraint', c.relname || '|' || k.conname || '|' || k.contype::text || '|'
       || regexp_replace(pg_get_constraintdef(k.oid), '(hg_reference|public)\.', '', 'g')
FROM pg_constraint k
JOIN pg_class c ON c.oid = k.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.relname = 'ScrutinOrganPosition' OR (c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion', 'ScrutinCountCheck', 'ScrutinGroupCountCheck', 'ScrutinOrganPosition']::text[]) AND k.conname LIKE '%\_memberHash\_format');

INSERT INTO hg_catalog_dump
SELECT 'public_after', 'index', i.tablename || '|' || i.indexname || '|' || regexp_replace(i.indexdef, '(hg_reference|public)\.', '', 'g')
FROM pg_indexes i
WHERE i.schemaname = 'public' AND i.tablename = 'ScrutinOrganPosition';

INSERT INTO hg_catalog_dump
SELECT 'public_after', 'trigger', c.relname || '|' || t.tgname || '|' || t.tgenabled::text || '|'
       || regexp_replace(pg_get_triggerdef(t.oid), '(hg_reference|public)\.', '', 'g')
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE NOT t.tgisinternal AND c.relname = 'ScrutinOrganPosition';

INSERT INTO hg_catalog_dump
SELECT 'public_after', 'table', c.relname || '|rls=' || c.relrowsecurity::text || '|force=' || c.relforcerowsecurity::text
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.relkind = 'r' AND c.relname = 'ScrutinOrganPosition';

INSERT INTO hg_catalog_dump
SELECT 'public_after', 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|'
       || md5(p.prosrc) || '|' || COALESCE(p.proconfig::text, '') || '|' || p.prosecdef::text
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
WHERE p.proname = 'historical_position_guard';

-- Row level security policies of every table of the lot, by role and command.
INSERT INTO hg_catalog_dump
SELECT 'public_after', 'policy', c.relname || '|' || pol.polname || '|' || pol.polcmd::text || '|' || pol.polpermissive::text || '|'
       || COALESCE((SELECT string_agg(COALESCE(r.rolname, 'PUBLIC'), ',' ORDER BY COALESCE(r.rolname, 'PUBLIC'))
                    FROM unnest(pol.polroles) u(oid) LEFT JOIN pg_roles r ON r.oid = u.oid), '')
       || '|' || COALESCE(regexp_replace(pg_get_expr(pol.polqual, pol.polrelid), '(hg_reference|public)\.', '', 'g'), '')
       || '|' || COALESCE(regexp_replace(pg_get_expr(pol.polwithcheck, pol.polrelid), '(hg_reference|public)\.', '', 'g'), '')
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion', 'ScrutinCountCheck', 'ScrutinGroupCountCheck', 'ScrutinOrganPosition']::text[]);

-- Table and sequence privileges of PUBLIC, anon, authenticated and the three roles of the lot.
INSERT INTO hg_catalog_dump
SELECT 'public_after', 'acl', c.relkind::text || '|' || c.relname || '|' || COALESCE(r.rolname, 'PUBLIC') || '|' || x.privilege_type
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault((CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) x
LEFT JOIN pg_roles r ON r.oid = x.grantee
WHERE (c.relkind = 'r' AND c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion', 'ScrutinCountCheck', 'ScrutinGroupCountCheck', 'ScrutinOrganPosition']::text[]) OR c.relkind = 'S' AND c.relname = 'SnapshotDecision_decisionNo_seq')
  AND (x.grantee = 0 OR r.rolname IN ('anon', 'authenticated', 'hg_importer', 'hg_runner', 'hg_reader'));

INSERT INTO hg_catalog_dump
SELECT 'public_after', 'acl', 'col|' || c.relname || '|' || a.attname || '|' || r.rolname || '|' || x.privilege_type
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
CROSS JOIN LATERAL aclexplode(a.attacl) x
JOIN pg_roles r ON r.oid = x.grantee
WHERE c.relkind = 'r' AND c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion', 'ScrutinCountCheck', 'ScrutinGroupCountCheck', 'ScrutinOrganPosition']::text[]) AND r.rolname IN ('anon', 'authenticated', 'hg_importer', 'hg_runner', 'hg_reader');

INSERT INTO hg_catalog_dump
SELECT 'public_after', 'acl', 'f|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|'
       || COALESCE(r.rolname, 'PUBLIC') || '|' || x.privilege_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
LEFT JOIN pg_roles r ON r.oid = x.grantee
WHERE p.proname = 'historical_position_guard' AND (x.grantee = 0 OR r.rolname IN ('anon', 'authenticated', 'hg_importer', 'hg_runner', 'hg_reader'));


SELECT CAST(
  'The roles and positions schema built here differs from the expected definition. Nothing was changed.'
  || E'\n' || left(string_agg(side || ' ' || kind || ': ' || item, E'\n' ORDER BY kind, item), 4000)
  AS integer)
FROM (
  (SELECT 'only in the reference build'::text AS side, kind, item FROM hg_catalog_dump WHERE side = 'hg_reference'
   EXCEPT SELECT 'only in the reference build', kind, item FROM hg_catalog_dump WHERE side = 'public_after')
  UNION ALL
  (SELECT 'only in the real schema', kind, item FROM hg_catalog_dump WHERE side = 'public_after'
   EXCEPT SELECT 'only in the real schema', kind, item FROM hg_catalog_dump WHERE side = 'hg_reference')
) differences;

DROP SCHEMA hg_reference CASCADE;

COMMIT;
