-- Lot 5B : schéma des affiliations parlementaires historiques (additif, tables neuves seulement).
--
-- Référence : docs/audits/parlement-historique-lot5-architecture-v2.md (4), rapport :
-- docs/audits/parlement-historique-lot5b-schema.md.
--
-- NON EXÉCUTÉ. À lancer à la main, sur une base isolée d'abord (plan de vérification du rapport),
-- jamais avant accord explicite :
--   npx prisma db execute --file prisma/migrations/manual/2026-10-18-historical-groups-schema.sql
-- (utilise DIRECT_URL). Ne jamais `db:push` : le diff supprimerait les contraintes d'exclusion, les
-- index partiels et les déclencheurs que le modèle Prisma ne peut pas déclarer.
-- Les rôles anon et authenticated doivent exister (c'est le cas sur Supabase) : les REVOKE les nomment.
--
-- Garanties :
--  - Une seule transaction : tout est posé ou rien. SQL simple : aucun bloc DO, aucun SQL dynamique
--    (contrat SEC-06 du dépôt, scripts/guards/sec-06-security-definer-guard.mjs).
--  - Aucune table existante n'est lue, modifiée ou supprimée. Seule dépendance : l'extension
--    btree_gist (contrainte d'exclusion des intervalles de snapshots).
--  - Idempotent, mais `IF NOT EXISTS` ne prouve rien : un objet déjà présent mais différent serait
--    gardé tel quel. Le même texte est donc exécuté deux fois, d'abord dans un schéma de référence
--    jetable (hg_reference), puis dans le schéma réel, et les deux catalogues sont comparés
--    (colonnes, contraintes, index, déclencheurs, fonctions, RLS, droits). Toute différence fait
--    échouer la dernière requête avec la liste des écarts, et la transaction est annulée.
--    Ce qui n'est JAMAIS réparé : tables, colonnes, contraintes, index de même nom (une divergence
--    de structure est une erreur, la correction est une décision humaine, pas un effet de bord).
--    Ce qui est ré-appliqué à chaque exécution, parce que cela ne porte aucune donnée et ne peut
--    que resserrer : fonctions et déclencheurs (CREATE OR REPLACE, ENABLE ALWAYS), RLS, REVOKE,
--    index autonomes absents (un index unique partiel qui échoue sur des doublons échoue bruyamment).
--  - La RLS est posée explicitement, sans politique (fermé à anon et authenticated).
--  - Les deux copies du texte ci-dessous sont identiques (un test le vérifie). Seule la ligne
--    SET LOCAL search_path qui les précède les distingue.

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

DROP SCHEMA IF EXISTS hg_reference CASCADE;
CREATE SCHEMA hg_reference;

-- hg:reference-build
SET LOCAL search_path TO hg_reference, pg_catalog;

CREATE OR REPLACE FUNCTION historical_refuse_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RAISE EXCEPTION '% is append-only: % refused', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END;
$fn$;

CREATE OR REPLACE FUNCTION historical_refuse_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RAISE EXCEPTION '% is append-only: TRUNCATE refused', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$fn$;

CREATE OR REPLACE FUNCTION historical_assert_snapshot_writable(p_stream text, p_seq integer)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_latest integer;
  v_integrity text;
BEGIN
  SELECT max("seq") INTO v_latest FROM "OfficialSourceSnapshot" WHERE "stream" = p_stream;
  IF v_latest IS NULL OR p_seq <> v_latest THEN
    RAISE EXCEPTION 'only the latest snapshot of stream % accepts record writes (asked %, latest %)', p_stream, p_seq, v_latest
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT "integrity" INTO v_integrity FROM "OfficialSourceSnapshot" WHERE "stream" = p_stream AND "seq" = p_seq;
  IF v_integrity IS DISTINCT FROM 'VERIFIED' THEN
    RAISE EXCEPTION 'snapshot %/% is not VERIFIED: it accepts no record', p_stream, p_seq
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "SnapshotDecision" d
    JOIN "OfficialSourceSnapshot" s ON s."id" = d."snapshotId"
    WHERE s."stream" = p_stream AND s."seq" = p_seq AND d."status" IN ('RELEASED', 'REVOKED')
  ) THEN
    RAISE EXCEPTION 'snapshot %/% was released or revoked: its records are frozen', p_stream, p_seq
      USING ERRCODE = 'restrict_violation';
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION historical_version_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."toSeq" IS NOT NULL THEN
      RAISE EXCEPTION '% rows are inserted open (toSeq NULL)', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
    END IF;
    PERFORM historical_assert_snapshot_writable(NEW."stream", NEW."fromSeq");
    RETURN NEW;
  END IF;
  IF OLD."toSeq" IS NOT NULL THEN
    RAISE EXCEPTION 'a closed version of % never changes', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."toSeq" IS NULL OR (to_jsonb(NEW) - 'toSeq') IS DISTINCT FROM (to_jsonb(OLD) - 'toSeq') THEN
    RAISE EXCEPTION 'on %, only toSeq may change, and only to be set once', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
  END IF;
  PERFORM historical_assert_snapshot_writable(NEW."stream", NEW."toSeq");
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION historical_artifact_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF (to_jsonb(NEW) - 'lastVerifiedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'lastVerifiedAt') THEN
    RAISE EXCEPTION 'on SourceArtifact, only lastVerifiedAt may change' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."lastVerifiedAt" IS NULL OR (OLD."lastVerifiedAt" IS NOT NULL AND NEW."lastVerifiedAt" < OLD."lastVerifiedAt") THEN
    RAISE EXCEPTION 'SourceArtifact.lastVerifiedAt only moves forward' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION historical_snapshot_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_expected integer;
BEGIN
  SELECT COALESCE(max("seq"), 0) + 1 INTO v_expected FROM "OfficialSourceSnapshot" WHERE "stream" = NEW."stream";
  IF NEW."seq" <> v_expected THEN
    RAISE EXCEPTION 'snapshot seq of stream % must be % (no gap, no reuse), got %', NEW."stream", v_expected, NEW."seq"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION historical_snapshot_decision_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_last text;
  v_integrity text;
BEGIN
  SELECT "status" INTO v_last FROM "SnapshotDecision"
    WHERE "snapshotId" = NEW."snapshotId" ORDER BY "decisionNo" DESC LIMIT 1;
  IF v_last = 'REVOKED' THEN
    RAISE EXCEPTION 'a revoked snapshot takes no further decision' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."status" = 'RELEASED' THEN
    SELECT "integrity" INTO v_integrity FROM "OfficialSourceSnapshot" WHERE "id" = NEW."snapshotId";
    IF v_integrity IS DISTINCT FROM 'VERIFIED' THEN
      RAISE EXCEPTION 'a snapshot whose integrity is not VERIFIED can never be RELEASED' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION historical_run_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'RUNNING' THEN
      RAISE EXCEPTION 'a run is created RUNNING' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" <> 'RUNNING' THEN
    RAISE EXCEPTION 'a finished run never changes' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."status" = 'RUNNING' THEN
    RAISE EXCEPTION 'a running run changes only by finishing' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'outputHash', 'statusCounts', 'finishedAt'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'outputHash', 'statusCounts', 'finishedAt']) THEN
    RAISE EXCEPTION 'the inputs of a run never change' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION historical_run_child_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_status text;
BEGIN
  SELECT "status" INTO v_status FROM "HistoricalResolutionRun" WHERE "id" = NEW."runId";
  IF v_status IS DISTINCT FROM 'RUNNING' THEN
    RAISE EXCEPTION 'rows are added to a run only while it is RUNNING' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION historical_pin_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_status text;
  v_decision text;
BEGIN
  SELECT "status" INTO v_status FROM "HistoricalResolutionRun" WHERE "id" = NEW."runId";
  IF v_status IS DISTINCT FROM 'RUNNING' THEN
    RAISE EXCEPTION 'snapshots are pinned only while the run is RUNNING' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT d."status" INTO v_decision
    FROM "SnapshotDecision" d
    JOIN "OfficialSourceSnapshot" s ON s."id" = d."snapshotId"
    WHERE s."stream" = NEW."stream" AND s."seq" = NEW."seq"
    ORDER BY d."decisionNo" DESC LIMIT 1;
  IF v_decision IS DISTINCT FROM 'RELEASED' THEN
    RAISE EXCEPTION 'only a RELEASED snapshot can be pinned (latest decision: %)', COALESCE(v_decision, 'none')
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TABLE IF NOT EXISTS "SourceArtifact" (
    "sha256" TEXT NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "storageKind" TEXT NOT NULL,
    "storageRef" TEXT NOT NULL,
    "storedAt" TIMESTAMPTZ(3) NOT NULL,
    "storedBy" TEXT NOT NULL,
    "lastVerifiedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SourceArtifact_pkey" PRIMARY KEY ("sha256"),
    CONSTRAINT "SourceArtifact_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "SourceArtifact_byteSize_positive" CHECK ("byteSize" > 0),
    CONSTRAINT "SourceArtifact_mediaType_known" CHECK ("mediaType" IN ('application/zip', 'text/csv')),
    CONSTRAINT "SourceArtifact_storageKind_known" CHECK ("storageKind" IN ('BLOB_PRIVATE', 'LOCAL_OFFLINE')),
    CONSTRAINT "SourceArtifact_storageRef_not_url" CHECK ("storageRef" <> '' AND "storageRef" !~* '^[a-z][a-z0-9+.-]*://'),
    CONSTRAINT "SourceArtifact_storedBy_present" CHECK ("storedBy" <> '')
);

CREATE TABLE IF NOT EXISTS "OfficialSourceSnapshot" (
    "id" TEXT NOT NULL,
    "stream" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "artifactSha256" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fetchedAt" TIMESTAMPTZ(3) NOT NULL,
    "sourceAsOf" TIMESTAMPTZ(3),
    "integrity" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "recordCounts" JSONB NOT NULL,
    "importedBy" TEXT NOT NULL,
    "importedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficialSourceSnapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OfficialSourceSnapshot_stream_seq_key" UNIQUE ("stream", "seq"),
    CONSTRAINT "OfficialSourceSnapshot_stream_artifactSha256_parserVersion_key" UNIQUE ("stream", "artifactSha256", "parserVersion"),
    CONSTRAINT "OfficialSourceSnapshot_stream_seq_stateHash_key" UNIQUE ("stream", "seq", "stateHash"),
    CONSTRAINT "OfficialSourceSnapshot_artifactSha256_fkey" FOREIGN KEY ("artifactSha256") REFERENCES "SourceArtifact"("sha256") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "OfficialSourceSnapshot_stream_known" CHECK ("stream" IN ('AN_AMO30', 'AN_SCRUTINS_L15', 'AN_SCRUTINS_L16', 'AN_SCRUTINS_L17', 'SENAT_HISTOGROUPES')),
    CONSTRAINT "OfficialSourceSnapshot_seq_positive" CHECK ("seq" > 0),
    CONSTRAINT "OfficialSourceSnapshot_integrity_known" CHECK ("integrity" IN ('VERIFIED', 'FAILED')),
    CONSTRAINT "OfficialSourceSnapshot_stateHash_format" CHECK ("stateHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "OfficialSourceSnapshot_url_https" CHECK ("url" ~ '^https://'),
    CONSTRAINT "OfficialSourceSnapshot_recordCounts_object" CHECK (jsonb_typeof("recordCounts") = 'object'),
    CONSTRAINT "OfficialSourceSnapshot_parserVersion_present" CHECK ("parserVersion" <> ''),
    CONSTRAINT "OfficialSourceSnapshot_importedBy_present" CHECK ("importedBy" <> '')
);

CREATE TABLE IF NOT EXISTS "SnapshotDecision" (
    "decisionNo" BIGSERIAL NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "decidedBy" TEXT NOT NULL,
    "decidedByKind" TEXT NOT NULL,
    "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SnapshotDecision_pkey" PRIMARY KEY ("decisionNo"),
    CONSTRAINT "SnapshotDecision_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "OfficialSourceSnapshot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "SnapshotDecision_status_known" CHECK ("status" IN ('QUARANTINED', 'RELEASED', 'REVOKED')),
    CONSTRAINT "SnapshotDecision_reason_present" CHECK ("reason" <> ''),
    CONSTRAINT "SnapshotDecision_decidedBy_present" CHECK ("decidedBy" <> ''),
    CONSTRAINT "SnapshotDecision_decidedByKind_known" CHECK ("decidedByKind" IN ('HUMAN', 'SCRIPT')),
    CONSTRAINT "SnapshotDecision_release_and_revoke_by_human" CHECK ("status" = 'QUARANTINED' OR "decidedByKind" = 'HUMAN')
);
CREATE INDEX IF NOT EXISTS "SnapshotDecision_snapshotId_decisionNo_idx" ON "SnapshotDecision"("snapshotId", "decisionNo");

CREATE TABLE IF NOT EXISTS "OfficialActor" (
    "stream" TEXT NOT NULL,
    "officialId" TEXT NOT NULL,
    "fromSeq" INTEGER NOT NULL,
    "toSeq" INTEGER,
    "sourceMember" TEXT NOT NULL,
    "rawHash" TEXT NOT NULL,

    CONSTRAINT "OfficialActor_pkey" PRIMARY KEY ("stream", "officialId", "fromSeq"),
    CONSTRAINT "OfficialActor_fromSnapshot_fkey" FOREIGN KEY ("stream", "fromSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "OfficialActor_toSnapshot_fkey" FOREIGN KEY ("stream", "toSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "OfficialActor_fromSeq_positive" CHECK ("fromSeq" > 0),
    CONSTRAINT "OfficialActor_toSeq_after_fromSeq" CHECK ("toSeq" IS NULL OR "toSeq" > "fromSeq"),
    CONSTRAINT "OfficialActor_stream_known" CHECK ("stream" IN ('AN_AMO30', 'AN_SCRUTINS_L15', 'AN_SCRUTINS_L16', 'AN_SCRUTINS_L17', 'SENAT_HISTOGROUPES')),
    CONSTRAINT "OfficialActor_rawHash_format" CHECK ("rawHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "OfficialActor_sourceMember_present" CHECK ("sourceMember" <> ''),
    CONSTRAINT "OfficialActor_officialId_present" CHECK ("officialId" <> ''),
    CONSTRAINT "OfficialActor_stream_is_amo30" CHECK ("stream" = 'AN_AMO30'),
    CONSTRAINT "OfficialActor_no_overlap" EXCLUDE USING gist ("stream" WITH =, "officialId" WITH =, int4range("fromSeq", "toSeq", '[)') WITH &&)
);

CREATE UNIQUE INDEX IF NOT EXISTS "OfficialActor_active_key" ON "OfficialActor"("stream", "officialId") WHERE "toSeq" IS NULL;

CREATE TABLE IF NOT EXISTS "OfficialOrganRecord" (
    "stream" TEXT NOT NULL,
    "organeRef" TEXT NOT NULL,
    "fromSeq" INTEGER NOT NULL,
    "toSeq" INTEGER,
    "codeType" TEXT NOT NULL,
    "legislature" INTEGER,
    "label" TEXT NOT NULL,
    "abbreviation" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "sourceMember" TEXT NOT NULL,
    "rawHash" TEXT NOT NULL,

    CONSTRAINT "OfficialOrganRecord_pkey" PRIMARY KEY ("stream", "organeRef", "fromSeq"),
    CONSTRAINT "OfficialOrganRecord_fromSnapshot_fkey" FOREIGN KEY ("stream", "fromSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "OfficialOrganRecord_toSnapshot_fkey" FOREIGN KEY ("stream", "toSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "OfficialOrganRecord_fromSeq_positive" CHECK ("fromSeq" > 0),
    CONSTRAINT "OfficialOrganRecord_toSeq_after_fromSeq" CHECK ("toSeq" IS NULL OR "toSeq" > "fromSeq"),
    CONSTRAINT "OfficialOrganRecord_stream_known" CHECK ("stream" IN ('AN_AMO30', 'AN_SCRUTINS_L15', 'AN_SCRUTINS_L16', 'AN_SCRUTINS_L17', 'SENAT_HISTOGROUPES')),
    CONSTRAINT "OfficialOrganRecord_rawHash_format" CHECK ("rawHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "OfficialOrganRecord_sourceMember_present" CHECK ("sourceMember" <> ''),
    CONSTRAINT "OfficialOrganRecord_organeRef_present" CHECK ("organeRef" <> ''),
    CONSTRAINT "OfficialOrganRecord_stream_is_amo30" CHECK ("stream" = 'AN_AMO30'),
    CONSTRAINT "OfficialOrganRecord_dates_ordered" CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "startDate" <= "endDate"),
    CONSTRAINT "OfficialOrganRecord_codeType_present" CHECK ("codeType" <> ''),
    CONSTRAINT "OfficialOrganRecord_no_overlap" EXCLUDE USING gist ("stream" WITH =, "organeRef" WITH =, int4range("fromSeq", "toSeq", '[)') WITH &&)
);

CREATE UNIQUE INDEX IF NOT EXISTS "OfficialOrganRecord_active_key" ON "OfficialOrganRecord"("stream", "organeRef") WHERE "toSeq" IS NULL;
CREATE INDEX IF NOT EXISTS "OfficialOrganRecord_stream_legislature_startDate_idx" ON "OfficialOrganRecord"("stream", "legislature", "startDate");

CREATE TABLE IF NOT EXISTS "GroupMembershipRecord" (
    "stream" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "fromSeq" INTEGER NOT NULL,
    "toSeq" INTEGER,
    "officialId" TEXT NOT NULL,
    "chamber" TEXT NOT NULL,
    "groupRef" TEXT NOT NULL,
    "legislature" INTEGER,
    "qualityCode" TEXT,
    "isPrincipal" BOOLEAN,
    "precedence" INTEGER,
    "startDate" DATE,
    "startState" TEXT NOT NULL,
    "endDate" DATE,
    "endState" TEXT NOT NULL,
    "publicationDate" DATE,
    "sourceMember" TEXT NOT NULL,
    "rawHash" TEXT NOT NULL,

    CONSTRAINT "GroupMembershipRecord_pkey" PRIMARY KEY ("stream", "sourceRecordId", "fromSeq"),
    CONSTRAINT "GroupMembershipRecord_fromSnapshot_fkey" FOREIGN KEY ("stream", "fromSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "GroupMembershipRecord_toSnapshot_fkey" FOREIGN KEY ("stream", "toSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "GroupMembershipRecord_fromSeq_positive" CHECK ("fromSeq" > 0),
    CONSTRAINT "GroupMembershipRecord_toSeq_after_fromSeq" CHECK ("toSeq" IS NULL OR "toSeq" > "fromSeq"),
    CONSTRAINT "GroupMembershipRecord_stream_known" CHECK ("stream" IN ('AN_AMO30', 'AN_SCRUTINS_L15', 'AN_SCRUTINS_L16', 'AN_SCRUTINS_L17', 'SENAT_HISTOGROUPES')),
    CONSTRAINT "GroupMembershipRecord_rawHash_format" CHECK ("rawHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "GroupMembershipRecord_sourceMember_present" CHECK ("sourceMember" <> ''),
    CONSTRAINT "GroupMembershipRecord_sourceRecordId_present" CHECK ("sourceRecordId" <> ''),
    CONSTRAINT "GroupMembershipRecord_dates_ordered" CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "startDate" <= "endDate"),
    CONSTRAINT "GroupMembershipRecord_startState_consistent" CHECK (("startState" = 'DATED' AND "startDate" IS NOT NULL) OR ("startState" = 'UNKNOWN' AND "startDate" IS NULL)),
    CONSTRAINT "GroupMembershipRecord_endState_consistent" CHECK (("endState" = 'DATED' AND "endDate" IS NOT NULL) OR ("endState" IN ('OPEN_AT_SNAPSHOT', 'UNKNOWN') AND "endDate" IS NULL)),
    CONSTRAINT "GroupMembershipRecord_officialId_present" CHECK ("officialId" <> ''),
    CONSTRAINT "GroupMembershipRecord_groupRef_present" CHECK ("groupRef" <> ''),
    CONSTRAINT "GroupMembershipRecord_chamber_known" CHECK ("chamber" IN ('AN', 'SENAT')),
    CONSTRAINT "GroupMembershipRecord_chamber_matches_stream" CHECK (("chamber" = 'AN' AND "stream" LIKE 'AN\_%') OR ("chamber" = 'SENAT' AND "stream" LIKE 'SENAT\_%')),
    CONSTRAINT "GroupMembershipRecord_no_overlap" EXCLUDE USING gist ("stream" WITH =, "sourceRecordId" WITH =, int4range("fromSeq", "toSeq", '[)') WITH &&)
);

CREATE UNIQUE INDEX IF NOT EXISTS "GroupMembershipRecord_active_key" ON "GroupMembershipRecord"("stream", "sourceRecordId") WHERE "toSeq" IS NULL;
CREATE INDEX IF NOT EXISTS "GroupMembershipRecord_stream_officialId_startDate_idx" ON "GroupMembershipRecord"("stream", "officialId", "startDate");
CREATE INDEX IF NOT EXISTS "GroupMembershipRecord_stream_groupRef_startDate_idx" ON "GroupMembershipRecord"("stream", "groupRef", "startDate");

CREATE TABLE IF NOT EXISTS "SeatMandateRecord" (
    "stream" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "fromSeq" INTEGER NOT NULL,
    "toSeq" INTEGER,
    "officialId" TEXT NOT NULL,
    "legislature" INTEGER,
    "startDate" DATE,
    "startState" TEXT NOT NULL,
    "endDate" DATE,
    "endState" TEXT NOT NULL,
    "sourceMember" TEXT NOT NULL,
    "rawHash" TEXT NOT NULL,

    CONSTRAINT "SeatMandateRecord_pkey" PRIMARY KEY ("stream", "sourceRecordId", "fromSeq"),
    CONSTRAINT "SeatMandateRecord_fromSnapshot_fkey" FOREIGN KEY ("stream", "fromSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "SeatMandateRecord_toSnapshot_fkey" FOREIGN KEY ("stream", "toSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "SeatMandateRecord_fromSeq_positive" CHECK ("fromSeq" > 0),
    CONSTRAINT "SeatMandateRecord_toSeq_after_fromSeq" CHECK ("toSeq" IS NULL OR "toSeq" > "fromSeq"),
    CONSTRAINT "SeatMandateRecord_stream_known" CHECK ("stream" IN ('AN_AMO30', 'AN_SCRUTINS_L15', 'AN_SCRUTINS_L16', 'AN_SCRUTINS_L17', 'SENAT_HISTOGROUPES')),
    CONSTRAINT "SeatMandateRecord_rawHash_format" CHECK ("rawHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "SeatMandateRecord_sourceMember_present" CHECK ("sourceMember" <> ''),
    CONSTRAINT "SeatMandateRecord_sourceRecordId_present" CHECK ("sourceRecordId" <> ''),
    CONSTRAINT "SeatMandateRecord_stream_is_amo30" CHECK ("stream" = 'AN_AMO30'),
    CONSTRAINT "SeatMandateRecord_dates_ordered" CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "startDate" <= "endDate"),
    CONSTRAINT "SeatMandateRecord_startState_consistent" CHECK (("startState" = 'DATED' AND "startDate" IS NOT NULL) OR ("startState" = 'UNKNOWN' AND "startDate" IS NULL)),
    CONSTRAINT "SeatMandateRecord_endState_consistent" CHECK (("endState" = 'DATED' AND "endDate" IS NOT NULL) OR ("endState" IN ('OPEN_AT_SNAPSHOT', 'UNKNOWN') AND "endDate" IS NULL)),
    CONSTRAINT "SeatMandateRecord_officialId_present" CHECK ("officialId" <> ''),
    CONSTRAINT "SeatMandateRecord_no_overlap" EXCLUDE USING gist ("stream" WITH =, "sourceRecordId" WITH =, int4range("fromSeq", "toSeq", '[)') WITH &&)
);

CREATE UNIQUE INDEX IF NOT EXISTS "SeatMandateRecord_active_key" ON "SeatMandateRecord"("stream", "sourceRecordId") WHERE "toSeq" IS NULL;
CREATE INDEX IF NOT EXISTS "SeatMandateRecord_stream_officialId_startDate_idx" ON "SeatMandateRecord"("stream", "officialId", "startDate");

CREATE TABLE IF NOT EXISTS "ScrutinVoterAttestation" (
    "stream" TEXT NOT NULL,
    "scrutinExternalId" TEXT NOT NULL,
    "officialId" TEXT NOT NULL,
    "fromSeq" INTEGER NOT NULL,
    "toSeq" INTEGER,
    "scrutinDate" DATE NOT NULL,
    "legislature" INTEGER NOT NULL,
    "publishedOrganRef" TEXT NOT NULL,
    "publishedPosition" TEXT NOT NULL,
    "byDelegation" BOOLEAN,
    "seatMandateRef" TEXT,
    "memberHash" TEXT NOT NULL,
    "sourceMember" TEXT NOT NULL,
    "rawHash" TEXT NOT NULL,

    CONSTRAINT "ScrutinVoterAttestation_pkey" PRIMARY KEY ("stream", "scrutinExternalId", "officialId", "fromSeq"),
    CONSTRAINT "ScrutinVoterAttestation_fromSnapshot_fkey" FOREIGN KEY ("stream", "fromSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ScrutinVoterAttestation_toSnapshot_fkey" FOREIGN KEY ("stream", "toSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ScrutinVoterAttestation_fromSeq_positive" CHECK ("fromSeq" > 0),
    CONSTRAINT "ScrutinVoterAttestation_toSeq_after_fromSeq" CHECK ("toSeq" IS NULL OR "toSeq" > "fromSeq"),
    CONSTRAINT "ScrutinVoterAttestation_stream_known" CHECK ("stream" IN ('AN_AMO30', 'AN_SCRUTINS_L15', 'AN_SCRUTINS_L16', 'AN_SCRUTINS_L17', 'SENAT_HISTOGROUPES')),
    CONSTRAINT "ScrutinVoterAttestation_rawHash_format" CHECK ("rawHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ScrutinVoterAttestation_sourceMember_present" CHECK ("sourceMember" <> ''),
    CONSTRAINT "ScrutinVoterAttestation_scrutinExternalId_present" CHECK ("scrutinExternalId" <> ''),
    CONSTRAINT "ScrutinVoterAttestation_officialId_present" CHECK ("officialId" <> ''),
    CONSTRAINT "ScrutinVoterAttestation_stream_is_scrutins" CHECK ("stream" LIKE 'AN\_SCRUTINS\_%'),
    CONSTRAINT "ScrutinVoterAttestation_publishedPosition_known" CHECK ("publishedPosition" IN ('pour', 'contre', 'abstention', 'nonVotant')),
    CONSTRAINT "ScrutinVoterAttestation_publishedOrganRef_present" CHECK ("publishedOrganRef" <> ''),
    CONSTRAINT "ScrutinVoterAttestation_memberHash_format" CHECK ("memberHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ScrutinVoterAttestation_seatMandateRef_not_empty" CHECK ("seatMandateRef" IS NULL OR "seatMandateRef" <> ''),
    CONSTRAINT "ScrutinVoterAttestation_no_overlap" EXCLUDE USING gist ("stream" WITH =, "scrutinExternalId" WITH =, "officialId" WITH =, int4range("fromSeq", "toSeq", '[)') WITH &&)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ScrutinVoterAttestation_active_key" ON "ScrutinVoterAttestation"("stream", "scrutinExternalId", "officialId") WHERE "toSeq" IS NULL;
CREATE INDEX IF NOT EXISTS "ScrutinVoterAttestation_stream_scrutinExternalId_idx" ON "ScrutinVoterAttestation"("stream", "scrutinExternalId");
CREATE INDEX IF NOT EXISTS "ScrutinVoterAttestation_stream_officialId_scrutinDate_idx" ON "ScrutinVoterAttestation"("stream", "officialId", "scrutinDate");
CREATE INDEX IF NOT EXISTS "ScrutinVoterAttestation_stream_organRef_date_idx" ON "ScrutinVoterAttestation"("stream", "publishedOrganRef", "scrutinDate");

CREATE TABLE IF NOT EXISTS "OfficialActorLinkDecision" (
    "decisionNo" BIGSERIAL NOT NULL,
    "chamber" TEXT NOT NULL,
    "officialId" TEXT NOT NULL,
    "politicianId" TEXT,
    "status" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "decidedBy" TEXT NOT NULL,
    "decidedByKind" TEXT NOT NULL,
    "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficialActorLinkDecision_pkey" PRIMARY KEY ("decisionNo"),
    CONSTRAINT "OfficialActorLinkDecision_chamber_known" CHECK ("chamber" IN ('AN', 'SENAT')),
    CONSTRAINT "OfficialActorLinkDecision_status_known" CHECK ("status" IN ('LINKED_OFFICIAL_ID', 'LINKED_EXTERNAL_ID', 'LINKED_MANUAL', 'AMBIGUOUS', 'NONE')),
    CONSTRAINT "OfficialActorLinkDecision_politicianId_matches_status" CHECK (("status" IN ('LINKED_OFFICIAL_ID', 'LINKED_EXTERNAL_ID', 'LINKED_MANUAL') AND "politicianId" IS NOT NULL) OR ("status" IN ('AMBIGUOUS', 'NONE') AND "politicianId" IS NULL)),
    CONSTRAINT "OfficialActorLinkDecision_officialId_present" CHECK ("officialId" <> ''),
    CONSTRAINT "OfficialActorLinkDecision_evidence_present" CHECK ("evidence" <> ''),
    CONSTRAINT "OfficialActorLinkDecision_decidedBy_present" CHECK ("decidedBy" <> ''),
    CONSTRAINT "OfficialActorLinkDecision_decidedByKind_known" CHECK ("decidedByKind" IN ('HUMAN', 'SCRIPT')),
    CONSTRAINT "OfficialActorLinkDecision_only_official_id_link_by_script" CHECK ("status" IN ('LINKED_OFFICIAL_ID', 'AMBIGUOUS', 'NONE') OR "decidedByKind" = 'HUMAN')
);
CREATE INDEX IF NOT EXISTS "OfficialActorLinkDecision_chamber_officialId_decisionNo_idx" ON "OfficialActorLinkDecision"("chamber", "officialId", "decisionNo");

CREATE TABLE IF NOT EXISTS "OrganContinuityDecision" (
    "decisionNo" BIGSERIAL NOT NULL,
    "fromOrganRef" TEXT NOT NULL,
    "toOrganRef" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "evidenceUrl" TEXT,
    "decidedBy" TEXT NOT NULL,
    "decidedByKind" TEXT NOT NULL,
    "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganContinuityDecision_pkey" PRIMARY KEY ("decisionNo"),
    CONSTRAINT "OrganContinuityDecision_organs_differ" CHECK ("fromOrganRef" <> "toOrganRef"),
    CONSTRAINT "OrganContinuityDecision_organRefs_present" CHECK ("fromOrganRef" <> '' AND "toOrganRef" <> ''),
    CONSTRAINT "OrganContinuityDecision_relation_known" CHECK ("relation" IN ('RENAMED_SAME_GROUP', 'SUCCESSOR', 'SPLIT', 'MERGED', 'EDITORIAL_CONTINUITY', 'NOT_RELATED')),
    CONSTRAINT "OrganContinuityDecision_status_known" CHECK ("status" IN ('PROPOSED', 'VALIDATED', 'REJECTED')),
    CONSTRAINT "OrganContinuityDecision_evidence_present" CHECK ("evidence" <> ''),
    CONSTRAINT "OrganContinuityDecision_evidenceUrl_https" CHECK ("evidenceUrl" IS NULL OR "evidenceUrl" ~ '^https://'),
    CONSTRAINT "OrganContinuityDecision_decidedBy_present" CHECK ("decidedBy" <> ''),
    CONSTRAINT "OrganContinuityDecision_decidedByKind_known" CHECK ("decidedByKind" IN ('HUMAN', 'SCRIPT')),
    CONSTRAINT "OrganContinuityDecision_only_proposals_by_script" CHECK ("status" = 'PROPOSED' OR "decidedByKind" = 'HUMAN')
);
CREATE INDEX IF NOT EXISTS "OrganContinuityDecision_fromOrganRef_toOrganRef_decisionNo_idx" ON "OrganContinuityDecision"("fromOrganRef", "toOrganRef", "decisionNo");

CREATE TABLE IF NOT EXISTS "HistoricalResolutionRun" (
    "id" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "linkDecisionCutoff" BIGINT NOT NULL,
    "continuityDecisionCutoff" BIGINT NOT NULL,
    "decisionsHash" TEXT NOT NULL,
    "preparedInputsHash" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "resolverVersion" TEXT NOT NULL,
    "dateSemanticsVersion" TEXT NOT NULL,
    "exclusionRulesVersion" TEXT NOT NULL,
    "configHash" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "codeVersion" TEXT NOT NULL,
    "outputHash" TEXT,
    "statusCounts" JSONB,
    "startedBy" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "HistoricalResolutionRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HistoricalResolutionRun_inputHash_key" UNIQUE ("inputHash"),
    CONSTRAINT "HistoricalResolutionRun_status_known" CHECK ("status" IN ('RUNNING', 'COMPLETED', 'FAILED')),
    CONSTRAINT "HistoricalResolutionRun_inputHash_format" CHECK ("inputHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "HistoricalResolutionRun_decisionsHash_format" CHECK ("decisionsHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "HistoricalResolutionRun_preparedInputsHash_format" CHECK ("preparedInputsHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "HistoricalResolutionRun_configHash_format" CHECK ("configHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "HistoricalResolutionRun_outputHash_format" CHECK (("outputHash" IS NULL OR "outputHash" ~ '^[0-9a-f]{64}$')),
    CONSTRAINT "HistoricalResolutionRun_cutoffs_not_negative" CHECK ("linkDecisionCutoff" >= 0 AND "continuityDecisionCutoff" >= 0),
    CONSTRAINT "HistoricalResolutionRun_versions_present" CHECK ("parserVersion" <> '' AND "resolverVersion" <> '' AND "dateSemanticsVersion" <> '' AND "exclusionRulesVersion" <> '' AND "codeVersion" <> '' AND "startedBy" <> ''),
    CONSTRAINT "HistoricalResolutionRun_config_object" CHECK (jsonb_typeof("config") = 'object'),
    CONSTRAINT "HistoricalResolutionRun_statusCounts_object" CHECK ("statusCounts" IS NULL OR jsonb_typeof("statusCounts") = 'object'),
    CONSTRAINT "HistoricalResolutionRun_lifecycle_consistent" CHECK (("status" = 'RUNNING' AND "outputHash" IS NULL AND "finishedAt" IS NULL) OR ("status" = 'COMPLETED' AND "outputHash" IS NOT NULL AND "statusCounts" IS NOT NULL AND "finishedAt" IS NOT NULL) OR ("status" = 'FAILED' AND "outputHash" IS NULL AND "finishedAt" IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS "HistoricalRunSnapshotPin" (
    "runId" TEXT NOT NULL,
    "stream" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "stateHash" TEXT NOT NULL,

    CONSTRAINT "HistoricalRunSnapshotPin_pkey" PRIMARY KEY ("runId", "stream"),
    CONSTRAINT "HistoricalRunSnapshotPin_runId_fkey" FOREIGN KEY ("runId") REFERENCES "HistoricalResolutionRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "HistoricalRunSnapshotPin_snapshot_fkey" FOREIGN KEY ("stream", "seq", "stateHash") REFERENCES "OfficialSourceSnapshot"("stream", "seq", "stateHash") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "HistoricalRunSnapshotPin_stateHash_format" CHECK ("stateHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "HistoricalRunSnapshotPin_stream_known" CHECK ("stream" IN ('AN_AMO30', 'AN_SCRUTINS_L15', 'AN_SCRUTINS_L16', 'AN_SCRUTINS_L17', 'SENAT_HISTOGROUPES'))
);

CREATE TABLE IF NOT EXISTS "RunExclusion" (
    "runId" TEXT NOT NULL,
    "scrutinExternalId" TEXT NOT NULL,
    "officialId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,

    CONSTRAINT "RunExclusion_pkey" PRIMARY KEY ("runId", "scrutinExternalId", "officialId"),
    CONSTRAINT "RunExclusion_runId_fkey" FOREIGN KEY ("runId") REFERENCES "HistoricalResolutionRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "RunExclusion_status_known" CHECK ("status" IN ('UNKNOWN', 'CONFLICT', 'INSUFFICIENT', 'UNRESOLVED_IDENTITY')),
    CONSTRAINT "RunExclusion_reason_present" CHECK ("reason" <> ''),
    CONSTRAINT "RunExclusion_evidence_object" CHECK (jsonb_typeof("evidence") = 'object')
);
CREATE INDEX IF NOT EXISTS "RunExclusion_runId_reason_idx" ON "RunExclusion"("runId", "reason");

CREATE OR REPLACE TRIGGER "SourceArtifact_update_guard" BEFORE UPDATE ON "SourceArtifact" FOR EACH ROW EXECUTE FUNCTION historical_artifact_guard();
ALTER TABLE "SourceArtifact" ENABLE ALWAYS TRIGGER "SourceArtifact_update_guard";
CREATE OR REPLACE TRIGGER "SourceArtifact_no_delete" BEFORE DELETE ON "SourceArtifact" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "SourceArtifact" ENABLE ALWAYS TRIGGER "SourceArtifact_no_delete";
CREATE OR REPLACE TRIGGER "SourceArtifact_no_truncate" BEFORE TRUNCATE ON "SourceArtifact" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "SourceArtifact" ENABLE ALWAYS TRIGGER "SourceArtifact_no_truncate";
CREATE OR REPLACE TRIGGER "OfficialSourceSnapshot_no_update_delete" BEFORE UPDATE OR DELETE ON "OfficialSourceSnapshot" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "OfficialSourceSnapshot" ENABLE ALWAYS TRIGGER "OfficialSourceSnapshot_no_update_delete";
CREATE OR REPLACE TRIGGER "OfficialSourceSnapshot_insert_guard" BEFORE INSERT ON "OfficialSourceSnapshot" FOR EACH ROW EXECUTE FUNCTION historical_snapshot_insert_guard();
ALTER TABLE "OfficialSourceSnapshot" ENABLE ALWAYS TRIGGER "OfficialSourceSnapshot_insert_guard";
CREATE OR REPLACE TRIGGER "OfficialSourceSnapshot_no_truncate" BEFORE TRUNCATE ON "OfficialSourceSnapshot" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "OfficialSourceSnapshot" ENABLE ALWAYS TRIGGER "OfficialSourceSnapshot_no_truncate";
CREATE OR REPLACE TRIGGER "SnapshotDecision_no_update_delete" BEFORE UPDATE OR DELETE ON "SnapshotDecision" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "SnapshotDecision" ENABLE ALWAYS TRIGGER "SnapshotDecision_no_update_delete";
CREATE OR REPLACE TRIGGER "SnapshotDecision_insert_guard" BEFORE INSERT ON "SnapshotDecision" FOR EACH ROW EXECUTE FUNCTION historical_snapshot_decision_guard();
ALTER TABLE "SnapshotDecision" ENABLE ALWAYS TRIGGER "SnapshotDecision_insert_guard";
CREATE OR REPLACE TRIGGER "SnapshotDecision_no_truncate" BEFORE TRUNCATE ON "SnapshotDecision" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "SnapshotDecision" ENABLE ALWAYS TRIGGER "SnapshotDecision_no_truncate";
CREATE OR REPLACE TRIGGER "OfficialActor_version_guard" BEFORE INSERT OR UPDATE ON "OfficialActor" FOR EACH ROW EXECUTE FUNCTION historical_version_guard();
ALTER TABLE "OfficialActor" ENABLE ALWAYS TRIGGER "OfficialActor_version_guard";
CREATE OR REPLACE TRIGGER "OfficialActor_no_delete" BEFORE DELETE ON "OfficialActor" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "OfficialActor" ENABLE ALWAYS TRIGGER "OfficialActor_no_delete";
CREATE OR REPLACE TRIGGER "OfficialActor_no_truncate" BEFORE TRUNCATE ON "OfficialActor" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "OfficialActor" ENABLE ALWAYS TRIGGER "OfficialActor_no_truncate";
CREATE OR REPLACE TRIGGER "OfficialOrganRecord_version_guard" BEFORE INSERT OR UPDATE ON "OfficialOrganRecord" FOR EACH ROW EXECUTE FUNCTION historical_version_guard();
ALTER TABLE "OfficialOrganRecord" ENABLE ALWAYS TRIGGER "OfficialOrganRecord_version_guard";
CREATE OR REPLACE TRIGGER "OfficialOrganRecord_no_delete" BEFORE DELETE ON "OfficialOrganRecord" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "OfficialOrganRecord" ENABLE ALWAYS TRIGGER "OfficialOrganRecord_no_delete";
CREATE OR REPLACE TRIGGER "OfficialOrganRecord_no_truncate" BEFORE TRUNCATE ON "OfficialOrganRecord" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "OfficialOrganRecord" ENABLE ALWAYS TRIGGER "OfficialOrganRecord_no_truncate";
CREATE OR REPLACE TRIGGER "GroupMembershipRecord_version_guard" BEFORE INSERT OR UPDATE ON "GroupMembershipRecord" FOR EACH ROW EXECUTE FUNCTION historical_version_guard();
ALTER TABLE "GroupMembershipRecord" ENABLE ALWAYS TRIGGER "GroupMembershipRecord_version_guard";
CREATE OR REPLACE TRIGGER "GroupMembershipRecord_no_delete" BEFORE DELETE ON "GroupMembershipRecord" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "GroupMembershipRecord" ENABLE ALWAYS TRIGGER "GroupMembershipRecord_no_delete";
CREATE OR REPLACE TRIGGER "GroupMembershipRecord_no_truncate" BEFORE TRUNCATE ON "GroupMembershipRecord" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "GroupMembershipRecord" ENABLE ALWAYS TRIGGER "GroupMembershipRecord_no_truncate";
CREATE OR REPLACE TRIGGER "SeatMandateRecord_version_guard" BEFORE INSERT OR UPDATE ON "SeatMandateRecord" FOR EACH ROW EXECUTE FUNCTION historical_version_guard();
ALTER TABLE "SeatMandateRecord" ENABLE ALWAYS TRIGGER "SeatMandateRecord_version_guard";
CREATE OR REPLACE TRIGGER "SeatMandateRecord_no_delete" BEFORE DELETE ON "SeatMandateRecord" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "SeatMandateRecord" ENABLE ALWAYS TRIGGER "SeatMandateRecord_no_delete";
CREATE OR REPLACE TRIGGER "SeatMandateRecord_no_truncate" BEFORE TRUNCATE ON "SeatMandateRecord" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "SeatMandateRecord" ENABLE ALWAYS TRIGGER "SeatMandateRecord_no_truncate";
CREATE OR REPLACE TRIGGER "ScrutinVoterAttestation_version_guard" BEFORE INSERT OR UPDATE ON "ScrutinVoterAttestation" FOR EACH ROW EXECUTE FUNCTION historical_version_guard();
ALTER TABLE "ScrutinVoterAttestation" ENABLE ALWAYS TRIGGER "ScrutinVoterAttestation_version_guard";
CREATE OR REPLACE TRIGGER "ScrutinVoterAttestation_no_delete" BEFORE DELETE ON "ScrutinVoterAttestation" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "ScrutinVoterAttestation" ENABLE ALWAYS TRIGGER "ScrutinVoterAttestation_no_delete";
CREATE OR REPLACE TRIGGER "ScrutinVoterAttestation_no_truncate" BEFORE TRUNCATE ON "ScrutinVoterAttestation" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "ScrutinVoterAttestation" ENABLE ALWAYS TRIGGER "ScrutinVoterAttestation_no_truncate";
CREATE OR REPLACE TRIGGER "OfficialActorLinkDecision_no_update_delete" BEFORE UPDATE OR DELETE ON "OfficialActorLinkDecision" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "OfficialActorLinkDecision" ENABLE ALWAYS TRIGGER "OfficialActorLinkDecision_no_update_delete";
CREATE OR REPLACE TRIGGER "OfficialActorLinkDecision_no_truncate" BEFORE TRUNCATE ON "OfficialActorLinkDecision" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "OfficialActorLinkDecision" ENABLE ALWAYS TRIGGER "OfficialActorLinkDecision_no_truncate";
CREATE OR REPLACE TRIGGER "OrganContinuityDecision_no_update_delete" BEFORE UPDATE OR DELETE ON "OrganContinuityDecision" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "OrganContinuityDecision" ENABLE ALWAYS TRIGGER "OrganContinuityDecision_no_update_delete";
CREATE OR REPLACE TRIGGER "OrganContinuityDecision_no_truncate" BEFORE TRUNCATE ON "OrganContinuityDecision" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "OrganContinuityDecision" ENABLE ALWAYS TRIGGER "OrganContinuityDecision_no_truncate";
CREATE OR REPLACE TRIGGER "HistoricalResolutionRun_run_guard" BEFORE INSERT OR UPDATE ON "HistoricalResolutionRun" FOR EACH ROW EXECUTE FUNCTION historical_run_guard();
ALTER TABLE "HistoricalResolutionRun" ENABLE ALWAYS TRIGGER "HistoricalResolutionRun_run_guard";
CREATE OR REPLACE TRIGGER "HistoricalResolutionRun_no_delete" BEFORE DELETE ON "HistoricalResolutionRun" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "HistoricalResolutionRun" ENABLE ALWAYS TRIGGER "HistoricalResolutionRun_no_delete";
CREATE OR REPLACE TRIGGER "HistoricalResolutionRun_no_truncate" BEFORE TRUNCATE ON "HistoricalResolutionRun" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "HistoricalResolutionRun" ENABLE ALWAYS TRIGGER "HistoricalResolutionRun_no_truncate";
CREATE OR REPLACE TRIGGER "HistoricalRunSnapshotPin_no_update_delete" BEFORE UPDATE OR DELETE ON "HistoricalRunSnapshotPin" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "HistoricalRunSnapshotPin" ENABLE ALWAYS TRIGGER "HistoricalRunSnapshotPin_no_update_delete";
CREATE OR REPLACE TRIGGER "HistoricalRunSnapshotPin_insert_guard" BEFORE INSERT ON "HistoricalRunSnapshotPin" FOR EACH ROW EXECUTE FUNCTION historical_pin_guard();
ALTER TABLE "HistoricalRunSnapshotPin" ENABLE ALWAYS TRIGGER "HistoricalRunSnapshotPin_insert_guard";
CREATE OR REPLACE TRIGGER "HistoricalRunSnapshotPin_no_truncate" BEFORE TRUNCATE ON "HistoricalRunSnapshotPin" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "HistoricalRunSnapshotPin" ENABLE ALWAYS TRIGGER "HistoricalRunSnapshotPin_no_truncate";
CREATE OR REPLACE TRIGGER "RunExclusion_no_update_delete" BEFORE UPDATE OR DELETE ON "RunExclusion" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "RunExclusion" ENABLE ALWAYS TRIGGER "RunExclusion_no_update_delete";
CREATE OR REPLACE TRIGGER "RunExclusion_insert_guard" BEFORE INSERT ON "RunExclusion" FOR EACH ROW EXECUTE FUNCTION historical_run_child_guard();
ALTER TABLE "RunExclusion" ENABLE ALWAYS TRIGGER "RunExclusion_insert_guard";
CREATE OR REPLACE TRIGGER "RunExclusion_no_truncate" BEFORE TRUNCATE ON "RunExclusion" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "RunExclusion" ENABLE ALWAYS TRIGGER "RunExclusion_no_truncate";

ALTER TABLE "SourceArtifact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OfficialSourceSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SnapshotDecision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OfficialActor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OfficialOrganRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GroupMembershipRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SeatMandateRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScrutinVoterAttestation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OfficialActorLinkDecision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrganContinuityDecision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HistoricalResolutionRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HistoricalRunSnapshotPin" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RunExclusion" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "SourceArtifact", "OfficialSourceSnapshot", "SnapshotDecision", "OfficialActor", "OfficialOrganRecord", "GroupMembershipRecord", "SeatMandateRecord", "ScrutinVoterAttestation", "OfficialActorLinkDecision", "OrganContinuityDecision", "HistoricalResolutionRun", "HistoricalRunSnapshotPin", "RunExclusion" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE "SnapshotDecision_decisionNo_seq", "OfficialActorLinkDecision_decisionNo_seq", "OrganContinuityDecision_decisionNo_seq" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION historical_refuse_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION historical_refuse_truncate() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION historical_assert_snapshot_writable(text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION historical_version_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION historical_artifact_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION historical_snapshot_insert_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION historical_snapshot_decision_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION historical_run_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION historical_run_child_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION historical_pin_guard() FROM PUBLIC, anon, authenticated;

-- hg:real-build
SET LOCAL search_path TO public, pg_catalog;

CREATE OR REPLACE FUNCTION historical_refuse_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RAISE EXCEPTION '% is append-only: % refused', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END;
$fn$;

CREATE OR REPLACE FUNCTION historical_refuse_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RAISE EXCEPTION '% is append-only: TRUNCATE refused', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$fn$;

CREATE OR REPLACE FUNCTION historical_assert_snapshot_writable(p_stream text, p_seq integer)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_latest integer;
  v_integrity text;
BEGIN
  SELECT max("seq") INTO v_latest FROM "OfficialSourceSnapshot" WHERE "stream" = p_stream;
  IF v_latest IS NULL OR p_seq <> v_latest THEN
    RAISE EXCEPTION 'only the latest snapshot of stream % accepts record writes (asked %, latest %)', p_stream, p_seq, v_latest
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT "integrity" INTO v_integrity FROM "OfficialSourceSnapshot" WHERE "stream" = p_stream AND "seq" = p_seq;
  IF v_integrity IS DISTINCT FROM 'VERIFIED' THEN
    RAISE EXCEPTION 'snapshot %/% is not VERIFIED: it accepts no record', p_stream, p_seq
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "SnapshotDecision" d
    JOIN "OfficialSourceSnapshot" s ON s."id" = d."snapshotId"
    WHERE s."stream" = p_stream AND s."seq" = p_seq AND d."status" IN ('RELEASED', 'REVOKED')
  ) THEN
    RAISE EXCEPTION 'snapshot %/% was released or revoked: its records are frozen', p_stream, p_seq
      USING ERRCODE = 'restrict_violation';
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION historical_version_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."toSeq" IS NOT NULL THEN
      RAISE EXCEPTION '% rows are inserted open (toSeq NULL)', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
    END IF;
    PERFORM historical_assert_snapshot_writable(NEW."stream", NEW."fromSeq");
    RETURN NEW;
  END IF;
  IF OLD."toSeq" IS NOT NULL THEN
    RAISE EXCEPTION 'a closed version of % never changes', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."toSeq" IS NULL OR (to_jsonb(NEW) - 'toSeq') IS DISTINCT FROM (to_jsonb(OLD) - 'toSeq') THEN
    RAISE EXCEPTION 'on %, only toSeq may change, and only to be set once', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
  END IF;
  PERFORM historical_assert_snapshot_writable(NEW."stream", NEW."toSeq");
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION historical_artifact_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF (to_jsonb(NEW) - 'lastVerifiedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'lastVerifiedAt') THEN
    RAISE EXCEPTION 'on SourceArtifact, only lastVerifiedAt may change' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."lastVerifiedAt" IS NULL OR (OLD."lastVerifiedAt" IS NOT NULL AND NEW."lastVerifiedAt" < OLD."lastVerifiedAt") THEN
    RAISE EXCEPTION 'SourceArtifact.lastVerifiedAt only moves forward' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION historical_snapshot_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_expected integer;
BEGIN
  SELECT COALESCE(max("seq"), 0) + 1 INTO v_expected FROM "OfficialSourceSnapshot" WHERE "stream" = NEW."stream";
  IF NEW."seq" <> v_expected THEN
    RAISE EXCEPTION 'snapshot seq of stream % must be % (no gap, no reuse), got %', NEW."stream", v_expected, NEW."seq"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION historical_snapshot_decision_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_last text;
  v_integrity text;
BEGIN
  SELECT "status" INTO v_last FROM "SnapshotDecision"
    WHERE "snapshotId" = NEW."snapshotId" ORDER BY "decisionNo" DESC LIMIT 1;
  IF v_last = 'REVOKED' THEN
    RAISE EXCEPTION 'a revoked snapshot takes no further decision' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."status" = 'RELEASED' THEN
    SELECT "integrity" INTO v_integrity FROM "OfficialSourceSnapshot" WHERE "id" = NEW."snapshotId";
    IF v_integrity IS DISTINCT FROM 'VERIFIED' THEN
      RAISE EXCEPTION 'a snapshot whose integrity is not VERIFIED can never be RELEASED' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION historical_run_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'RUNNING' THEN
      RAISE EXCEPTION 'a run is created RUNNING' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" <> 'RUNNING' THEN
    RAISE EXCEPTION 'a finished run never changes' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."status" = 'RUNNING' THEN
    RAISE EXCEPTION 'a running run changes only by finishing' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'outputHash', 'statusCounts', 'finishedAt'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'outputHash', 'statusCounts', 'finishedAt']) THEN
    RAISE EXCEPTION 'the inputs of a run never change' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION historical_run_child_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_status text;
BEGIN
  SELECT "status" INTO v_status FROM "HistoricalResolutionRun" WHERE "id" = NEW."runId";
  IF v_status IS DISTINCT FROM 'RUNNING' THEN
    RAISE EXCEPTION 'rows are added to a run only while it is RUNNING' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION historical_pin_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_status text;
  v_decision text;
BEGIN
  SELECT "status" INTO v_status FROM "HistoricalResolutionRun" WHERE "id" = NEW."runId";
  IF v_status IS DISTINCT FROM 'RUNNING' THEN
    RAISE EXCEPTION 'snapshots are pinned only while the run is RUNNING' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT d."status" INTO v_decision
    FROM "SnapshotDecision" d
    JOIN "OfficialSourceSnapshot" s ON s."id" = d."snapshotId"
    WHERE s."stream" = NEW."stream" AND s."seq" = NEW."seq"
    ORDER BY d."decisionNo" DESC LIMIT 1;
  IF v_decision IS DISTINCT FROM 'RELEASED' THEN
    RAISE EXCEPTION 'only a RELEASED snapshot can be pinned (latest decision: %)', COALESCE(v_decision, 'none')
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TABLE IF NOT EXISTS "SourceArtifact" (
    "sha256" TEXT NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "storageKind" TEXT NOT NULL,
    "storageRef" TEXT NOT NULL,
    "storedAt" TIMESTAMPTZ(3) NOT NULL,
    "storedBy" TEXT NOT NULL,
    "lastVerifiedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SourceArtifact_pkey" PRIMARY KEY ("sha256"),
    CONSTRAINT "SourceArtifact_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "SourceArtifact_byteSize_positive" CHECK ("byteSize" > 0),
    CONSTRAINT "SourceArtifact_mediaType_known" CHECK ("mediaType" IN ('application/zip', 'text/csv')),
    CONSTRAINT "SourceArtifact_storageKind_known" CHECK ("storageKind" IN ('BLOB_PRIVATE', 'LOCAL_OFFLINE')),
    CONSTRAINT "SourceArtifact_storageRef_not_url" CHECK ("storageRef" <> '' AND "storageRef" !~* '^[a-z][a-z0-9+.-]*://'),
    CONSTRAINT "SourceArtifact_storedBy_present" CHECK ("storedBy" <> '')
);

CREATE TABLE IF NOT EXISTS "OfficialSourceSnapshot" (
    "id" TEXT NOT NULL,
    "stream" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "artifactSha256" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fetchedAt" TIMESTAMPTZ(3) NOT NULL,
    "sourceAsOf" TIMESTAMPTZ(3),
    "integrity" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "recordCounts" JSONB NOT NULL,
    "importedBy" TEXT NOT NULL,
    "importedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficialSourceSnapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OfficialSourceSnapshot_stream_seq_key" UNIQUE ("stream", "seq"),
    CONSTRAINT "OfficialSourceSnapshot_stream_artifactSha256_parserVersion_key" UNIQUE ("stream", "artifactSha256", "parserVersion"),
    CONSTRAINT "OfficialSourceSnapshot_stream_seq_stateHash_key" UNIQUE ("stream", "seq", "stateHash"),
    CONSTRAINT "OfficialSourceSnapshot_artifactSha256_fkey" FOREIGN KEY ("artifactSha256") REFERENCES "SourceArtifact"("sha256") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "OfficialSourceSnapshot_stream_known" CHECK ("stream" IN ('AN_AMO30', 'AN_SCRUTINS_L15', 'AN_SCRUTINS_L16', 'AN_SCRUTINS_L17', 'SENAT_HISTOGROUPES')),
    CONSTRAINT "OfficialSourceSnapshot_seq_positive" CHECK ("seq" > 0),
    CONSTRAINT "OfficialSourceSnapshot_integrity_known" CHECK ("integrity" IN ('VERIFIED', 'FAILED')),
    CONSTRAINT "OfficialSourceSnapshot_stateHash_format" CHECK ("stateHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "OfficialSourceSnapshot_url_https" CHECK ("url" ~ '^https://'),
    CONSTRAINT "OfficialSourceSnapshot_recordCounts_object" CHECK (jsonb_typeof("recordCounts") = 'object'),
    CONSTRAINT "OfficialSourceSnapshot_parserVersion_present" CHECK ("parserVersion" <> ''),
    CONSTRAINT "OfficialSourceSnapshot_importedBy_present" CHECK ("importedBy" <> '')
);

CREATE TABLE IF NOT EXISTS "SnapshotDecision" (
    "decisionNo" BIGSERIAL NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "decidedBy" TEXT NOT NULL,
    "decidedByKind" TEXT NOT NULL,
    "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SnapshotDecision_pkey" PRIMARY KEY ("decisionNo"),
    CONSTRAINT "SnapshotDecision_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "OfficialSourceSnapshot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "SnapshotDecision_status_known" CHECK ("status" IN ('QUARANTINED', 'RELEASED', 'REVOKED')),
    CONSTRAINT "SnapshotDecision_reason_present" CHECK ("reason" <> ''),
    CONSTRAINT "SnapshotDecision_decidedBy_present" CHECK ("decidedBy" <> ''),
    CONSTRAINT "SnapshotDecision_decidedByKind_known" CHECK ("decidedByKind" IN ('HUMAN', 'SCRIPT')),
    CONSTRAINT "SnapshotDecision_release_and_revoke_by_human" CHECK ("status" = 'QUARANTINED' OR "decidedByKind" = 'HUMAN')
);
CREATE INDEX IF NOT EXISTS "SnapshotDecision_snapshotId_decisionNo_idx" ON "SnapshotDecision"("snapshotId", "decisionNo");

CREATE TABLE IF NOT EXISTS "OfficialActor" (
    "stream" TEXT NOT NULL,
    "officialId" TEXT NOT NULL,
    "fromSeq" INTEGER NOT NULL,
    "toSeq" INTEGER,
    "sourceMember" TEXT NOT NULL,
    "rawHash" TEXT NOT NULL,

    CONSTRAINT "OfficialActor_pkey" PRIMARY KEY ("stream", "officialId", "fromSeq"),
    CONSTRAINT "OfficialActor_fromSnapshot_fkey" FOREIGN KEY ("stream", "fromSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "OfficialActor_toSnapshot_fkey" FOREIGN KEY ("stream", "toSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "OfficialActor_fromSeq_positive" CHECK ("fromSeq" > 0),
    CONSTRAINT "OfficialActor_toSeq_after_fromSeq" CHECK ("toSeq" IS NULL OR "toSeq" > "fromSeq"),
    CONSTRAINT "OfficialActor_stream_known" CHECK ("stream" IN ('AN_AMO30', 'AN_SCRUTINS_L15', 'AN_SCRUTINS_L16', 'AN_SCRUTINS_L17', 'SENAT_HISTOGROUPES')),
    CONSTRAINT "OfficialActor_rawHash_format" CHECK ("rawHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "OfficialActor_sourceMember_present" CHECK ("sourceMember" <> ''),
    CONSTRAINT "OfficialActor_officialId_present" CHECK ("officialId" <> ''),
    CONSTRAINT "OfficialActor_stream_is_amo30" CHECK ("stream" = 'AN_AMO30'),
    CONSTRAINT "OfficialActor_no_overlap" EXCLUDE USING gist ("stream" WITH =, "officialId" WITH =, int4range("fromSeq", "toSeq", '[)') WITH &&)
);

CREATE UNIQUE INDEX IF NOT EXISTS "OfficialActor_active_key" ON "OfficialActor"("stream", "officialId") WHERE "toSeq" IS NULL;

CREATE TABLE IF NOT EXISTS "OfficialOrganRecord" (
    "stream" TEXT NOT NULL,
    "organeRef" TEXT NOT NULL,
    "fromSeq" INTEGER NOT NULL,
    "toSeq" INTEGER,
    "codeType" TEXT NOT NULL,
    "legislature" INTEGER,
    "label" TEXT NOT NULL,
    "abbreviation" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "sourceMember" TEXT NOT NULL,
    "rawHash" TEXT NOT NULL,

    CONSTRAINT "OfficialOrganRecord_pkey" PRIMARY KEY ("stream", "organeRef", "fromSeq"),
    CONSTRAINT "OfficialOrganRecord_fromSnapshot_fkey" FOREIGN KEY ("stream", "fromSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "OfficialOrganRecord_toSnapshot_fkey" FOREIGN KEY ("stream", "toSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "OfficialOrganRecord_fromSeq_positive" CHECK ("fromSeq" > 0),
    CONSTRAINT "OfficialOrganRecord_toSeq_after_fromSeq" CHECK ("toSeq" IS NULL OR "toSeq" > "fromSeq"),
    CONSTRAINT "OfficialOrganRecord_stream_known" CHECK ("stream" IN ('AN_AMO30', 'AN_SCRUTINS_L15', 'AN_SCRUTINS_L16', 'AN_SCRUTINS_L17', 'SENAT_HISTOGROUPES')),
    CONSTRAINT "OfficialOrganRecord_rawHash_format" CHECK ("rawHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "OfficialOrganRecord_sourceMember_present" CHECK ("sourceMember" <> ''),
    CONSTRAINT "OfficialOrganRecord_organeRef_present" CHECK ("organeRef" <> ''),
    CONSTRAINT "OfficialOrganRecord_stream_is_amo30" CHECK ("stream" = 'AN_AMO30'),
    CONSTRAINT "OfficialOrganRecord_dates_ordered" CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "startDate" <= "endDate"),
    CONSTRAINT "OfficialOrganRecord_codeType_present" CHECK ("codeType" <> ''),
    CONSTRAINT "OfficialOrganRecord_no_overlap" EXCLUDE USING gist ("stream" WITH =, "organeRef" WITH =, int4range("fromSeq", "toSeq", '[)') WITH &&)
);

CREATE UNIQUE INDEX IF NOT EXISTS "OfficialOrganRecord_active_key" ON "OfficialOrganRecord"("stream", "organeRef") WHERE "toSeq" IS NULL;
CREATE INDEX IF NOT EXISTS "OfficialOrganRecord_stream_legislature_startDate_idx" ON "OfficialOrganRecord"("stream", "legislature", "startDate");

CREATE TABLE IF NOT EXISTS "GroupMembershipRecord" (
    "stream" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "fromSeq" INTEGER NOT NULL,
    "toSeq" INTEGER,
    "officialId" TEXT NOT NULL,
    "chamber" TEXT NOT NULL,
    "groupRef" TEXT NOT NULL,
    "legislature" INTEGER,
    "qualityCode" TEXT,
    "isPrincipal" BOOLEAN,
    "precedence" INTEGER,
    "startDate" DATE,
    "startState" TEXT NOT NULL,
    "endDate" DATE,
    "endState" TEXT NOT NULL,
    "publicationDate" DATE,
    "sourceMember" TEXT NOT NULL,
    "rawHash" TEXT NOT NULL,

    CONSTRAINT "GroupMembershipRecord_pkey" PRIMARY KEY ("stream", "sourceRecordId", "fromSeq"),
    CONSTRAINT "GroupMembershipRecord_fromSnapshot_fkey" FOREIGN KEY ("stream", "fromSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "GroupMembershipRecord_toSnapshot_fkey" FOREIGN KEY ("stream", "toSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "GroupMembershipRecord_fromSeq_positive" CHECK ("fromSeq" > 0),
    CONSTRAINT "GroupMembershipRecord_toSeq_after_fromSeq" CHECK ("toSeq" IS NULL OR "toSeq" > "fromSeq"),
    CONSTRAINT "GroupMembershipRecord_stream_known" CHECK ("stream" IN ('AN_AMO30', 'AN_SCRUTINS_L15', 'AN_SCRUTINS_L16', 'AN_SCRUTINS_L17', 'SENAT_HISTOGROUPES')),
    CONSTRAINT "GroupMembershipRecord_rawHash_format" CHECK ("rawHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "GroupMembershipRecord_sourceMember_present" CHECK ("sourceMember" <> ''),
    CONSTRAINT "GroupMembershipRecord_sourceRecordId_present" CHECK ("sourceRecordId" <> ''),
    CONSTRAINT "GroupMembershipRecord_dates_ordered" CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "startDate" <= "endDate"),
    CONSTRAINT "GroupMembershipRecord_startState_consistent" CHECK (("startState" = 'DATED' AND "startDate" IS NOT NULL) OR ("startState" = 'UNKNOWN' AND "startDate" IS NULL)),
    CONSTRAINT "GroupMembershipRecord_endState_consistent" CHECK (("endState" = 'DATED' AND "endDate" IS NOT NULL) OR ("endState" IN ('OPEN_AT_SNAPSHOT', 'UNKNOWN') AND "endDate" IS NULL)),
    CONSTRAINT "GroupMembershipRecord_officialId_present" CHECK ("officialId" <> ''),
    CONSTRAINT "GroupMembershipRecord_groupRef_present" CHECK ("groupRef" <> ''),
    CONSTRAINT "GroupMembershipRecord_chamber_known" CHECK ("chamber" IN ('AN', 'SENAT')),
    CONSTRAINT "GroupMembershipRecord_chamber_matches_stream" CHECK (("chamber" = 'AN' AND "stream" LIKE 'AN\_%') OR ("chamber" = 'SENAT' AND "stream" LIKE 'SENAT\_%')),
    CONSTRAINT "GroupMembershipRecord_no_overlap" EXCLUDE USING gist ("stream" WITH =, "sourceRecordId" WITH =, int4range("fromSeq", "toSeq", '[)') WITH &&)
);

CREATE UNIQUE INDEX IF NOT EXISTS "GroupMembershipRecord_active_key" ON "GroupMembershipRecord"("stream", "sourceRecordId") WHERE "toSeq" IS NULL;
CREATE INDEX IF NOT EXISTS "GroupMembershipRecord_stream_officialId_startDate_idx" ON "GroupMembershipRecord"("stream", "officialId", "startDate");
CREATE INDEX IF NOT EXISTS "GroupMembershipRecord_stream_groupRef_startDate_idx" ON "GroupMembershipRecord"("stream", "groupRef", "startDate");

CREATE TABLE IF NOT EXISTS "SeatMandateRecord" (
    "stream" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "fromSeq" INTEGER NOT NULL,
    "toSeq" INTEGER,
    "officialId" TEXT NOT NULL,
    "legislature" INTEGER,
    "startDate" DATE,
    "startState" TEXT NOT NULL,
    "endDate" DATE,
    "endState" TEXT NOT NULL,
    "sourceMember" TEXT NOT NULL,
    "rawHash" TEXT NOT NULL,

    CONSTRAINT "SeatMandateRecord_pkey" PRIMARY KEY ("stream", "sourceRecordId", "fromSeq"),
    CONSTRAINT "SeatMandateRecord_fromSnapshot_fkey" FOREIGN KEY ("stream", "fromSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "SeatMandateRecord_toSnapshot_fkey" FOREIGN KEY ("stream", "toSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "SeatMandateRecord_fromSeq_positive" CHECK ("fromSeq" > 0),
    CONSTRAINT "SeatMandateRecord_toSeq_after_fromSeq" CHECK ("toSeq" IS NULL OR "toSeq" > "fromSeq"),
    CONSTRAINT "SeatMandateRecord_stream_known" CHECK ("stream" IN ('AN_AMO30', 'AN_SCRUTINS_L15', 'AN_SCRUTINS_L16', 'AN_SCRUTINS_L17', 'SENAT_HISTOGROUPES')),
    CONSTRAINT "SeatMandateRecord_rawHash_format" CHECK ("rawHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "SeatMandateRecord_sourceMember_present" CHECK ("sourceMember" <> ''),
    CONSTRAINT "SeatMandateRecord_sourceRecordId_present" CHECK ("sourceRecordId" <> ''),
    CONSTRAINT "SeatMandateRecord_stream_is_amo30" CHECK ("stream" = 'AN_AMO30'),
    CONSTRAINT "SeatMandateRecord_dates_ordered" CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "startDate" <= "endDate"),
    CONSTRAINT "SeatMandateRecord_startState_consistent" CHECK (("startState" = 'DATED' AND "startDate" IS NOT NULL) OR ("startState" = 'UNKNOWN' AND "startDate" IS NULL)),
    CONSTRAINT "SeatMandateRecord_endState_consistent" CHECK (("endState" = 'DATED' AND "endDate" IS NOT NULL) OR ("endState" IN ('OPEN_AT_SNAPSHOT', 'UNKNOWN') AND "endDate" IS NULL)),
    CONSTRAINT "SeatMandateRecord_officialId_present" CHECK ("officialId" <> ''),
    CONSTRAINT "SeatMandateRecord_no_overlap" EXCLUDE USING gist ("stream" WITH =, "sourceRecordId" WITH =, int4range("fromSeq", "toSeq", '[)') WITH &&)
);

CREATE UNIQUE INDEX IF NOT EXISTS "SeatMandateRecord_active_key" ON "SeatMandateRecord"("stream", "sourceRecordId") WHERE "toSeq" IS NULL;
CREATE INDEX IF NOT EXISTS "SeatMandateRecord_stream_officialId_startDate_idx" ON "SeatMandateRecord"("stream", "officialId", "startDate");

CREATE TABLE IF NOT EXISTS "ScrutinVoterAttestation" (
    "stream" TEXT NOT NULL,
    "scrutinExternalId" TEXT NOT NULL,
    "officialId" TEXT NOT NULL,
    "fromSeq" INTEGER NOT NULL,
    "toSeq" INTEGER,
    "scrutinDate" DATE NOT NULL,
    "legislature" INTEGER NOT NULL,
    "publishedOrganRef" TEXT NOT NULL,
    "publishedPosition" TEXT NOT NULL,
    "byDelegation" BOOLEAN,
    "seatMandateRef" TEXT,
    "memberHash" TEXT NOT NULL,
    "sourceMember" TEXT NOT NULL,
    "rawHash" TEXT NOT NULL,

    CONSTRAINT "ScrutinVoterAttestation_pkey" PRIMARY KEY ("stream", "scrutinExternalId", "officialId", "fromSeq"),
    CONSTRAINT "ScrutinVoterAttestation_fromSnapshot_fkey" FOREIGN KEY ("stream", "fromSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ScrutinVoterAttestation_toSnapshot_fkey" FOREIGN KEY ("stream", "toSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ScrutinVoterAttestation_fromSeq_positive" CHECK ("fromSeq" > 0),
    CONSTRAINT "ScrutinVoterAttestation_toSeq_after_fromSeq" CHECK ("toSeq" IS NULL OR "toSeq" > "fromSeq"),
    CONSTRAINT "ScrutinVoterAttestation_stream_known" CHECK ("stream" IN ('AN_AMO30', 'AN_SCRUTINS_L15', 'AN_SCRUTINS_L16', 'AN_SCRUTINS_L17', 'SENAT_HISTOGROUPES')),
    CONSTRAINT "ScrutinVoterAttestation_rawHash_format" CHECK ("rawHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ScrutinVoterAttestation_sourceMember_present" CHECK ("sourceMember" <> ''),
    CONSTRAINT "ScrutinVoterAttestation_scrutinExternalId_present" CHECK ("scrutinExternalId" <> ''),
    CONSTRAINT "ScrutinVoterAttestation_officialId_present" CHECK ("officialId" <> ''),
    CONSTRAINT "ScrutinVoterAttestation_stream_is_scrutins" CHECK ("stream" LIKE 'AN\_SCRUTINS\_%'),
    CONSTRAINT "ScrutinVoterAttestation_publishedPosition_known" CHECK ("publishedPosition" IN ('pour', 'contre', 'abstention', 'nonVotant')),
    CONSTRAINT "ScrutinVoterAttestation_publishedOrganRef_present" CHECK ("publishedOrganRef" <> ''),
    CONSTRAINT "ScrutinVoterAttestation_memberHash_format" CHECK ("memberHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ScrutinVoterAttestation_seatMandateRef_not_empty" CHECK ("seatMandateRef" IS NULL OR "seatMandateRef" <> ''),
    CONSTRAINT "ScrutinVoterAttestation_no_overlap" EXCLUDE USING gist ("stream" WITH =, "scrutinExternalId" WITH =, "officialId" WITH =, int4range("fromSeq", "toSeq", '[)') WITH &&)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ScrutinVoterAttestation_active_key" ON "ScrutinVoterAttestation"("stream", "scrutinExternalId", "officialId") WHERE "toSeq" IS NULL;
CREATE INDEX IF NOT EXISTS "ScrutinVoterAttestation_stream_scrutinExternalId_idx" ON "ScrutinVoterAttestation"("stream", "scrutinExternalId");
CREATE INDEX IF NOT EXISTS "ScrutinVoterAttestation_stream_officialId_scrutinDate_idx" ON "ScrutinVoterAttestation"("stream", "officialId", "scrutinDate");
CREATE INDEX IF NOT EXISTS "ScrutinVoterAttestation_stream_organRef_date_idx" ON "ScrutinVoterAttestation"("stream", "publishedOrganRef", "scrutinDate");

CREATE TABLE IF NOT EXISTS "OfficialActorLinkDecision" (
    "decisionNo" BIGSERIAL NOT NULL,
    "chamber" TEXT NOT NULL,
    "officialId" TEXT NOT NULL,
    "politicianId" TEXT,
    "status" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "decidedBy" TEXT NOT NULL,
    "decidedByKind" TEXT NOT NULL,
    "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficialActorLinkDecision_pkey" PRIMARY KEY ("decisionNo"),
    CONSTRAINT "OfficialActorLinkDecision_chamber_known" CHECK ("chamber" IN ('AN', 'SENAT')),
    CONSTRAINT "OfficialActorLinkDecision_status_known" CHECK ("status" IN ('LINKED_OFFICIAL_ID', 'LINKED_EXTERNAL_ID', 'LINKED_MANUAL', 'AMBIGUOUS', 'NONE')),
    CONSTRAINT "OfficialActorLinkDecision_politicianId_matches_status" CHECK (("status" IN ('LINKED_OFFICIAL_ID', 'LINKED_EXTERNAL_ID', 'LINKED_MANUAL') AND "politicianId" IS NOT NULL) OR ("status" IN ('AMBIGUOUS', 'NONE') AND "politicianId" IS NULL)),
    CONSTRAINT "OfficialActorLinkDecision_officialId_present" CHECK ("officialId" <> ''),
    CONSTRAINT "OfficialActorLinkDecision_evidence_present" CHECK ("evidence" <> ''),
    CONSTRAINT "OfficialActorLinkDecision_decidedBy_present" CHECK ("decidedBy" <> ''),
    CONSTRAINT "OfficialActorLinkDecision_decidedByKind_known" CHECK ("decidedByKind" IN ('HUMAN', 'SCRIPT')),
    CONSTRAINT "OfficialActorLinkDecision_only_official_id_link_by_script" CHECK ("status" IN ('LINKED_OFFICIAL_ID', 'AMBIGUOUS', 'NONE') OR "decidedByKind" = 'HUMAN')
);
CREATE INDEX IF NOT EXISTS "OfficialActorLinkDecision_chamber_officialId_decisionNo_idx" ON "OfficialActorLinkDecision"("chamber", "officialId", "decisionNo");

CREATE TABLE IF NOT EXISTS "OrganContinuityDecision" (
    "decisionNo" BIGSERIAL NOT NULL,
    "fromOrganRef" TEXT NOT NULL,
    "toOrganRef" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "evidenceUrl" TEXT,
    "decidedBy" TEXT NOT NULL,
    "decidedByKind" TEXT NOT NULL,
    "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganContinuityDecision_pkey" PRIMARY KEY ("decisionNo"),
    CONSTRAINT "OrganContinuityDecision_organs_differ" CHECK ("fromOrganRef" <> "toOrganRef"),
    CONSTRAINT "OrganContinuityDecision_organRefs_present" CHECK ("fromOrganRef" <> '' AND "toOrganRef" <> ''),
    CONSTRAINT "OrganContinuityDecision_relation_known" CHECK ("relation" IN ('RENAMED_SAME_GROUP', 'SUCCESSOR', 'SPLIT', 'MERGED', 'EDITORIAL_CONTINUITY', 'NOT_RELATED')),
    CONSTRAINT "OrganContinuityDecision_status_known" CHECK ("status" IN ('PROPOSED', 'VALIDATED', 'REJECTED')),
    CONSTRAINT "OrganContinuityDecision_evidence_present" CHECK ("evidence" <> ''),
    CONSTRAINT "OrganContinuityDecision_evidenceUrl_https" CHECK ("evidenceUrl" IS NULL OR "evidenceUrl" ~ '^https://'),
    CONSTRAINT "OrganContinuityDecision_decidedBy_present" CHECK ("decidedBy" <> ''),
    CONSTRAINT "OrganContinuityDecision_decidedByKind_known" CHECK ("decidedByKind" IN ('HUMAN', 'SCRIPT')),
    CONSTRAINT "OrganContinuityDecision_only_proposals_by_script" CHECK ("status" = 'PROPOSED' OR "decidedByKind" = 'HUMAN')
);
CREATE INDEX IF NOT EXISTS "OrganContinuityDecision_fromOrganRef_toOrganRef_decisionNo_idx" ON "OrganContinuityDecision"("fromOrganRef", "toOrganRef", "decisionNo");

CREATE TABLE IF NOT EXISTS "HistoricalResolutionRun" (
    "id" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "linkDecisionCutoff" BIGINT NOT NULL,
    "continuityDecisionCutoff" BIGINT NOT NULL,
    "decisionsHash" TEXT NOT NULL,
    "preparedInputsHash" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "resolverVersion" TEXT NOT NULL,
    "dateSemanticsVersion" TEXT NOT NULL,
    "exclusionRulesVersion" TEXT NOT NULL,
    "configHash" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "codeVersion" TEXT NOT NULL,
    "outputHash" TEXT,
    "statusCounts" JSONB,
    "startedBy" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "HistoricalResolutionRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HistoricalResolutionRun_inputHash_key" UNIQUE ("inputHash"),
    CONSTRAINT "HistoricalResolutionRun_status_known" CHECK ("status" IN ('RUNNING', 'COMPLETED', 'FAILED')),
    CONSTRAINT "HistoricalResolutionRun_inputHash_format" CHECK ("inputHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "HistoricalResolutionRun_decisionsHash_format" CHECK ("decisionsHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "HistoricalResolutionRun_preparedInputsHash_format" CHECK ("preparedInputsHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "HistoricalResolutionRun_configHash_format" CHECK ("configHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "HistoricalResolutionRun_outputHash_format" CHECK (("outputHash" IS NULL OR "outputHash" ~ '^[0-9a-f]{64}$')),
    CONSTRAINT "HistoricalResolutionRun_cutoffs_not_negative" CHECK ("linkDecisionCutoff" >= 0 AND "continuityDecisionCutoff" >= 0),
    CONSTRAINT "HistoricalResolutionRun_versions_present" CHECK ("parserVersion" <> '' AND "resolverVersion" <> '' AND "dateSemanticsVersion" <> '' AND "exclusionRulesVersion" <> '' AND "codeVersion" <> '' AND "startedBy" <> ''),
    CONSTRAINT "HistoricalResolutionRun_config_object" CHECK (jsonb_typeof("config") = 'object'),
    CONSTRAINT "HistoricalResolutionRun_statusCounts_object" CHECK ("statusCounts" IS NULL OR jsonb_typeof("statusCounts") = 'object'),
    CONSTRAINT "HistoricalResolutionRun_lifecycle_consistent" CHECK (("status" = 'RUNNING' AND "outputHash" IS NULL AND "finishedAt" IS NULL) OR ("status" = 'COMPLETED' AND "outputHash" IS NOT NULL AND "statusCounts" IS NOT NULL AND "finishedAt" IS NOT NULL) OR ("status" = 'FAILED' AND "outputHash" IS NULL AND "finishedAt" IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS "HistoricalRunSnapshotPin" (
    "runId" TEXT NOT NULL,
    "stream" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "stateHash" TEXT NOT NULL,

    CONSTRAINT "HistoricalRunSnapshotPin_pkey" PRIMARY KEY ("runId", "stream"),
    CONSTRAINT "HistoricalRunSnapshotPin_runId_fkey" FOREIGN KEY ("runId") REFERENCES "HistoricalResolutionRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "HistoricalRunSnapshotPin_snapshot_fkey" FOREIGN KEY ("stream", "seq", "stateHash") REFERENCES "OfficialSourceSnapshot"("stream", "seq", "stateHash") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "HistoricalRunSnapshotPin_stateHash_format" CHECK ("stateHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "HistoricalRunSnapshotPin_stream_known" CHECK ("stream" IN ('AN_AMO30', 'AN_SCRUTINS_L15', 'AN_SCRUTINS_L16', 'AN_SCRUTINS_L17', 'SENAT_HISTOGROUPES'))
);

CREATE TABLE IF NOT EXISTS "RunExclusion" (
    "runId" TEXT NOT NULL,
    "scrutinExternalId" TEXT NOT NULL,
    "officialId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,

    CONSTRAINT "RunExclusion_pkey" PRIMARY KEY ("runId", "scrutinExternalId", "officialId"),
    CONSTRAINT "RunExclusion_runId_fkey" FOREIGN KEY ("runId") REFERENCES "HistoricalResolutionRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "RunExclusion_status_known" CHECK ("status" IN ('UNKNOWN', 'CONFLICT', 'INSUFFICIENT', 'UNRESOLVED_IDENTITY')),
    CONSTRAINT "RunExclusion_reason_present" CHECK ("reason" <> ''),
    CONSTRAINT "RunExclusion_evidence_object" CHECK (jsonb_typeof("evidence") = 'object')
);
CREATE INDEX IF NOT EXISTS "RunExclusion_runId_reason_idx" ON "RunExclusion"("runId", "reason");

CREATE OR REPLACE TRIGGER "SourceArtifact_update_guard" BEFORE UPDATE ON "SourceArtifact" FOR EACH ROW EXECUTE FUNCTION historical_artifact_guard();
ALTER TABLE "SourceArtifact" ENABLE ALWAYS TRIGGER "SourceArtifact_update_guard";
CREATE OR REPLACE TRIGGER "SourceArtifact_no_delete" BEFORE DELETE ON "SourceArtifact" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "SourceArtifact" ENABLE ALWAYS TRIGGER "SourceArtifact_no_delete";
CREATE OR REPLACE TRIGGER "SourceArtifact_no_truncate" BEFORE TRUNCATE ON "SourceArtifact" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "SourceArtifact" ENABLE ALWAYS TRIGGER "SourceArtifact_no_truncate";
CREATE OR REPLACE TRIGGER "OfficialSourceSnapshot_no_update_delete" BEFORE UPDATE OR DELETE ON "OfficialSourceSnapshot" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "OfficialSourceSnapshot" ENABLE ALWAYS TRIGGER "OfficialSourceSnapshot_no_update_delete";
CREATE OR REPLACE TRIGGER "OfficialSourceSnapshot_insert_guard" BEFORE INSERT ON "OfficialSourceSnapshot" FOR EACH ROW EXECUTE FUNCTION historical_snapshot_insert_guard();
ALTER TABLE "OfficialSourceSnapshot" ENABLE ALWAYS TRIGGER "OfficialSourceSnapshot_insert_guard";
CREATE OR REPLACE TRIGGER "OfficialSourceSnapshot_no_truncate" BEFORE TRUNCATE ON "OfficialSourceSnapshot" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "OfficialSourceSnapshot" ENABLE ALWAYS TRIGGER "OfficialSourceSnapshot_no_truncate";
CREATE OR REPLACE TRIGGER "SnapshotDecision_no_update_delete" BEFORE UPDATE OR DELETE ON "SnapshotDecision" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "SnapshotDecision" ENABLE ALWAYS TRIGGER "SnapshotDecision_no_update_delete";
CREATE OR REPLACE TRIGGER "SnapshotDecision_insert_guard" BEFORE INSERT ON "SnapshotDecision" FOR EACH ROW EXECUTE FUNCTION historical_snapshot_decision_guard();
ALTER TABLE "SnapshotDecision" ENABLE ALWAYS TRIGGER "SnapshotDecision_insert_guard";
CREATE OR REPLACE TRIGGER "SnapshotDecision_no_truncate" BEFORE TRUNCATE ON "SnapshotDecision" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "SnapshotDecision" ENABLE ALWAYS TRIGGER "SnapshotDecision_no_truncate";
CREATE OR REPLACE TRIGGER "OfficialActor_version_guard" BEFORE INSERT OR UPDATE ON "OfficialActor" FOR EACH ROW EXECUTE FUNCTION historical_version_guard();
ALTER TABLE "OfficialActor" ENABLE ALWAYS TRIGGER "OfficialActor_version_guard";
CREATE OR REPLACE TRIGGER "OfficialActor_no_delete" BEFORE DELETE ON "OfficialActor" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "OfficialActor" ENABLE ALWAYS TRIGGER "OfficialActor_no_delete";
CREATE OR REPLACE TRIGGER "OfficialActor_no_truncate" BEFORE TRUNCATE ON "OfficialActor" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "OfficialActor" ENABLE ALWAYS TRIGGER "OfficialActor_no_truncate";
CREATE OR REPLACE TRIGGER "OfficialOrganRecord_version_guard" BEFORE INSERT OR UPDATE ON "OfficialOrganRecord" FOR EACH ROW EXECUTE FUNCTION historical_version_guard();
ALTER TABLE "OfficialOrganRecord" ENABLE ALWAYS TRIGGER "OfficialOrganRecord_version_guard";
CREATE OR REPLACE TRIGGER "OfficialOrganRecord_no_delete" BEFORE DELETE ON "OfficialOrganRecord" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "OfficialOrganRecord" ENABLE ALWAYS TRIGGER "OfficialOrganRecord_no_delete";
CREATE OR REPLACE TRIGGER "OfficialOrganRecord_no_truncate" BEFORE TRUNCATE ON "OfficialOrganRecord" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "OfficialOrganRecord" ENABLE ALWAYS TRIGGER "OfficialOrganRecord_no_truncate";
CREATE OR REPLACE TRIGGER "GroupMembershipRecord_version_guard" BEFORE INSERT OR UPDATE ON "GroupMembershipRecord" FOR EACH ROW EXECUTE FUNCTION historical_version_guard();
ALTER TABLE "GroupMembershipRecord" ENABLE ALWAYS TRIGGER "GroupMembershipRecord_version_guard";
CREATE OR REPLACE TRIGGER "GroupMembershipRecord_no_delete" BEFORE DELETE ON "GroupMembershipRecord" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "GroupMembershipRecord" ENABLE ALWAYS TRIGGER "GroupMembershipRecord_no_delete";
CREATE OR REPLACE TRIGGER "GroupMembershipRecord_no_truncate" BEFORE TRUNCATE ON "GroupMembershipRecord" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "GroupMembershipRecord" ENABLE ALWAYS TRIGGER "GroupMembershipRecord_no_truncate";
CREATE OR REPLACE TRIGGER "SeatMandateRecord_version_guard" BEFORE INSERT OR UPDATE ON "SeatMandateRecord" FOR EACH ROW EXECUTE FUNCTION historical_version_guard();
ALTER TABLE "SeatMandateRecord" ENABLE ALWAYS TRIGGER "SeatMandateRecord_version_guard";
CREATE OR REPLACE TRIGGER "SeatMandateRecord_no_delete" BEFORE DELETE ON "SeatMandateRecord" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "SeatMandateRecord" ENABLE ALWAYS TRIGGER "SeatMandateRecord_no_delete";
CREATE OR REPLACE TRIGGER "SeatMandateRecord_no_truncate" BEFORE TRUNCATE ON "SeatMandateRecord" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "SeatMandateRecord" ENABLE ALWAYS TRIGGER "SeatMandateRecord_no_truncate";
CREATE OR REPLACE TRIGGER "ScrutinVoterAttestation_version_guard" BEFORE INSERT OR UPDATE ON "ScrutinVoterAttestation" FOR EACH ROW EXECUTE FUNCTION historical_version_guard();
ALTER TABLE "ScrutinVoterAttestation" ENABLE ALWAYS TRIGGER "ScrutinVoterAttestation_version_guard";
CREATE OR REPLACE TRIGGER "ScrutinVoterAttestation_no_delete" BEFORE DELETE ON "ScrutinVoterAttestation" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "ScrutinVoterAttestation" ENABLE ALWAYS TRIGGER "ScrutinVoterAttestation_no_delete";
CREATE OR REPLACE TRIGGER "ScrutinVoterAttestation_no_truncate" BEFORE TRUNCATE ON "ScrutinVoterAttestation" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "ScrutinVoterAttestation" ENABLE ALWAYS TRIGGER "ScrutinVoterAttestation_no_truncate";
CREATE OR REPLACE TRIGGER "OfficialActorLinkDecision_no_update_delete" BEFORE UPDATE OR DELETE ON "OfficialActorLinkDecision" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "OfficialActorLinkDecision" ENABLE ALWAYS TRIGGER "OfficialActorLinkDecision_no_update_delete";
CREATE OR REPLACE TRIGGER "OfficialActorLinkDecision_no_truncate" BEFORE TRUNCATE ON "OfficialActorLinkDecision" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "OfficialActorLinkDecision" ENABLE ALWAYS TRIGGER "OfficialActorLinkDecision_no_truncate";
CREATE OR REPLACE TRIGGER "OrganContinuityDecision_no_update_delete" BEFORE UPDATE OR DELETE ON "OrganContinuityDecision" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "OrganContinuityDecision" ENABLE ALWAYS TRIGGER "OrganContinuityDecision_no_update_delete";
CREATE OR REPLACE TRIGGER "OrganContinuityDecision_no_truncate" BEFORE TRUNCATE ON "OrganContinuityDecision" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "OrganContinuityDecision" ENABLE ALWAYS TRIGGER "OrganContinuityDecision_no_truncate";
CREATE OR REPLACE TRIGGER "HistoricalResolutionRun_run_guard" BEFORE INSERT OR UPDATE ON "HistoricalResolutionRun" FOR EACH ROW EXECUTE FUNCTION historical_run_guard();
ALTER TABLE "HistoricalResolutionRun" ENABLE ALWAYS TRIGGER "HistoricalResolutionRun_run_guard";
CREATE OR REPLACE TRIGGER "HistoricalResolutionRun_no_delete" BEFORE DELETE ON "HistoricalResolutionRun" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "HistoricalResolutionRun" ENABLE ALWAYS TRIGGER "HistoricalResolutionRun_no_delete";
CREATE OR REPLACE TRIGGER "HistoricalResolutionRun_no_truncate" BEFORE TRUNCATE ON "HistoricalResolutionRun" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "HistoricalResolutionRun" ENABLE ALWAYS TRIGGER "HistoricalResolutionRun_no_truncate";
CREATE OR REPLACE TRIGGER "HistoricalRunSnapshotPin_no_update_delete" BEFORE UPDATE OR DELETE ON "HistoricalRunSnapshotPin" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "HistoricalRunSnapshotPin" ENABLE ALWAYS TRIGGER "HistoricalRunSnapshotPin_no_update_delete";
CREATE OR REPLACE TRIGGER "HistoricalRunSnapshotPin_insert_guard" BEFORE INSERT ON "HistoricalRunSnapshotPin" FOR EACH ROW EXECUTE FUNCTION historical_pin_guard();
ALTER TABLE "HistoricalRunSnapshotPin" ENABLE ALWAYS TRIGGER "HistoricalRunSnapshotPin_insert_guard";
CREATE OR REPLACE TRIGGER "HistoricalRunSnapshotPin_no_truncate" BEFORE TRUNCATE ON "HistoricalRunSnapshotPin" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "HistoricalRunSnapshotPin" ENABLE ALWAYS TRIGGER "HistoricalRunSnapshotPin_no_truncate";
CREATE OR REPLACE TRIGGER "RunExclusion_no_update_delete" BEFORE UPDATE OR DELETE ON "RunExclusion" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "RunExclusion" ENABLE ALWAYS TRIGGER "RunExclusion_no_update_delete";
CREATE OR REPLACE TRIGGER "RunExclusion_insert_guard" BEFORE INSERT ON "RunExclusion" FOR EACH ROW EXECUTE FUNCTION historical_run_child_guard();
ALTER TABLE "RunExclusion" ENABLE ALWAYS TRIGGER "RunExclusion_insert_guard";
CREATE OR REPLACE TRIGGER "RunExclusion_no_truncate" BEFORE TRUNCATE ON "RunExclusion" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "RunExclusion" ENABLE ALWAYS TRIGGER "RunExclusion_no_truncate";

ALTER TABLE "SourceArtifact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OfficialSourceSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SnapshotDecision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OfficialActor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OfficialOrganRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GroupMembershipRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SeatMandateRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScrutinVoterAttestation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OfficialActorLinkDecision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrganContinuityDecision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HistoricalResolutionRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HistoricalRunSnapshotPin" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RunExclusion" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "SourceArtifact", "OfficialSourceSnapshot", "SnapshotDecision", "OfficialActor", "OfficialOrganRecord", "GroupMembershipRecord", "SeatMandateRecord", "ScrutinVoterAttestation", "OfficialActorLinkDecision", "OrganContinuityDecision", "HistoricalResolutionRun", "HistoricalRunSnapshotPin", "RunExclusion" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE "SnapshotDecision_decisionNo_seq", "OfficialActorLinkDecision_decisionNo_seq", "OrganContinuityDecision_decisionNo_seq" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION historical_refuse_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION historical_refuse_truncate() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION historical_assert_snapshot_writable(text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION historical_version_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION historical_artifact_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION historical_snapshot_insert_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION historical_snapshot_decision_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION historical_run_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION historical_run_child_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION historical_pin_guard() FROM PUBLIC, anon, authenticated;

-- hg:compare
-- Catalogue du schéma réel contre catalogue du schéma de référence. Les définitions sont lues avec
-- un search_path réduit à pg_catalog, donc toutes qualifiées, puis le nom du schéma est retiré.
SET LOCAL search_path TO pg_catalog;

CREATE TEMP TABLE hg_catalog_dump (side text NOT NULL, kind text NOT NULL, item text NOT NULL) ON COMMIT DROP;

INSERT INTO hg_catalog_dump
SELECT 'hg_reference', 'column', c.relname || '|' || a.attname || '|' || format_type(a.atttypid, a.atttypmod)
       || '|' || a.attnotnull || '|' || COALESCE(regexp_replace(pg_get_expr(d.adbin, d.adrelid), '(hg_reference|public)\.', '', 'g'), '')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'hg_reference'
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE c.relkind = 'r' AND c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion']::text[]);

INSERT INTO hg_catalog_dump
SELECT 'hg_reference', 'constraint', c.relname || '|' || k.conname || '|' || k.contype || '|'
       || regexp_replace(pg_get_constraintdef(k.oid), '(hg_reference|public)\.', '', 'g')
FROM pg_constraint k
JOIN pg_class c ON c.oid = k.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'hg_reference'
WHERE c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion']::text[]);

INSERT INTO hg_catalog_dump
SELECT 'hg_reference', 'index', i.tablename || '|' || i.indexname || '|'
       || regexp_replace(i.indexdef, '(hg_reference|public)\.', '', 'g')
FROM pg_indexes i
WHERE i.schemaname = 'hg_reference' AND i.tablename = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion']::text[]);

INSERT INTO hg_catalog_dump
SELECT 'hg_reference', 'trigger', c.relname || '|' || t.tgname || '|' || t.tgenabled || '|'
       || regexp_replace(pg_get_triggerdef(t.oid), '(hg_reference|public)\.', '', 'g')
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'hg_reference'
WHERE NOT t.tgisinternal AND c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion']::text[]);

INSERT INTO hg_catalog_dump
SELECT 'hg_reference', 'table', c.relname || '|rls=' || c.relrowsecurity || '|force=' || c.relforcerowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'hg_reference'
WHERE c.relkind = 'r' AND c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion']::text[]);

-- Privileges are compared for PUBLIC, anon and authenticated only. Other grantees come from the
-- default privileges of the real schema (Supabase gives service_role its own), which the
-- reference schema does not have: comparing them would make the check fail for no reason.
INSERT INTO hg_catalog_dump
SELECT 'hg_reference', 'acl', c.relkind || '|' || c.relname || '|' || COALESCE(r.rolname, 'PUBLIC') || '|' || x.privilege_type
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'hg_reference'
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault(CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END, c.relowner))) x
LEFT JOIN pg_roles r ON r.oid = x.grantee
WHERE (c.relkind = 'r' AND c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion']::text[])
       OR c.relkind = 'S' AND c.relname ~ ('^(' || array_to_string(ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion']::text[], '|') || ')_.*_seq$'))
  AND (x.grantee = 0 OR r.rolname IN ('anon', 'authenticated'));

INSERT INTO hg_catalog_dump
SELECT 'hg_reference', 'acl', 'f|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|'
       || COALESCE(r.rolname, 'PUBLIC') || '|' || x.privilege_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'hg_reference'
CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
LEFT JOIN pg_roles r ON r.oid = x.grantee
WHERE p.proname LIKE 'historical\_%' AND (x.grantee = 0 OR r.rolname IN ('anon', 'authenticated'));

INSERT INTO hg_catalog_dump
SELECT 'hg_reference', 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|'
       || md5(p.prosrc) || '|' || COALESCE(p.proconfig::text, '') || '|' || p.prosecdef
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'hg_reference'
WHERE p.proname LIKE 'historical\_%';

INSERT INTO hg_catalog_dump
SELECT 'public', 'column', c.relname || '|' || a.attname || '|' || format_type(a.atttypid, a.atttypmod)
       || '|' || a.attnotnull || '|' || COALESCE(regexp_replace(pg_get_expr(d.adbin, d.adrelid), '(hg_reference|public)\.', '', 'g'), '')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE c.relkind = 'r' AND c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion']::text[]);

INSERT INTO hg_catalog_dump
SELECT 'public', 'constraint', c.relname || '|' || k.conname || '|' || k.contype || '|'
       || regexp_replace(pg_get_constraintdef(k.oid), '(hg_reference|public)\.', '', 'g')
FROM pg_constraint k
JOIN pg_class c ON c.oid = k.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion']::text[]);

INSERT INTO hg_catalog_dump
SELECT 'public', 'index', i.tablename || '|' || i.indexname || '|'
       || regexp_replace(i.indexdef, '(hg_reference|public)\.', '', 'g')
FROM pg_indexes i
WHERE i.schemaname = 'public' AND i.tablename = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion']::text[]);

INSERT INTO hg_catalog_dump
SELECT 'public', 'trigger', c.relname || '|' || t.tgname || '|' || t.tgenabled || '|'
       || regexp_replace(pg_get_triggerdef(t.oid), '(hg_reference|public)\.', '', 'g')
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE NOT t.tgisinternal AND c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion']::text[]);

INSERT INTO hg_catalog_dump
SELECT 'public', 'table', c.relname || '|rls=' || c.relrowsecurity || '|force=' || c.relforcerowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.relkind = 'r' AND c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion']::text[]);

-- Privileges are compared for PUBLIC, anon and authenticated only. Other grantees come from the
-- default privileges of the real schema (Supabase gives service_role its own), which the
-- reference schema does not have: comparing them would make the check fail for no reason.
INSERT INTO hg_catalog_dump
SELECT 'public', 'acl', c.relkind || '|' || c.relname || '|' || COALESCE(r.rolname, 'PUBLIC') || '|' || x.privilege_type
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault(CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END, c.relowner))) x
LEFT JOIN pg_roles r ON r.oid = x.grantee
WHERE (c.relkind = 'r' AND c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion']::text[])
       OR c.relkind = 'S' AND c.relname ~ ('^(' || array_to_string(ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion']::text[], '|') || ')_.*_seq$'))
  AND (x.grantee = 0 OR r.rolname IN ('anon', 'authenticated'));

INSERT INTO hg_catalog_dump
SELECT 'public', 'acl', 'f|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|'
       || COALESCE(r.rolname, 'PUBLIC') || '|' || x.privilege_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
LEFT JOIN pg_roles r ON r.oid = x.grantee
WHERE p.proname LIKE 'historical\_%' AND (x.grantee = 0 OR r.rolname IN ('anon', 'authenticated'));

INSERT INTO hg_catalog_dump
SELECT 'public', 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|'
       || md5(p.prosrc) || '|' || COALESCE(p.proconfig::text, '') || '|' || p.prosecdef
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
WHERE p.proname LIKE 'historical\_%';

-- Dernière requête : sans écart, string_agg vaut NULL et le CAST ne fait rien. Avec un écart, le
-- CAST échoue et son message porte la liste des écarts. C'est volontaire : pas de bloc DO.
SELECT CAST(
  'The existing historical groups schema differs from the expected definition. Nothing was changed.'
  || E'\n' || left(string_agg(side || ' ' || kind || ': ' || item, E'\n' ORDER BY kind, item), 4000)
  AS integer)
FROM (
  (SELECT 'only in the reference build'::text AS side, kind, item FROM hg_catalog_dump WHERE side = 'hg_reference'
   EXCEPT SELECT 'only in the reference build', kind, item FROM hg_catalog_dump WHERE side = 'public')
  UNION ALL
  (SELECT 'only in the real schema', kind, item FROM hg_catalog_dump WHERE side = 'public'
   EXCEPT SELECT 'only in the real schema', kind, item FROM hg_catalog_dump WHERE side = 'hg_reference')
) differences;

DROP SCHEMA hg_reference CASCADE;

COMMIT;
