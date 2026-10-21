-- Lot 5C-0 : cohérence des décomptes officiels (additif, deux tables neuves, au-dessus du lot 5B).
--
-- Référence : docs/audits/parlement-historique-lot5c0-schema.md. Complète le schéma de
-- 2026-10-18-historical-groups-schema.sql (qui doit être appliqué avant) sans le modifier.
--
-- NON EXÉCUTÉ en préproduction ni en production. À lancer à la main, jamais avant accord explicite :
--   npx prisma db execute --file prisma/migrations/manual/2026-10-19-historical-groups-count-check.sql
-- (utilise DIRECT_URL). Ne jamais `db:push` : le diff supprimerait les contraintes d'exclusion, les
-- index partiels et les déclencheurs que le modèle Prisma ne peut pas déclarer.
--
-- Garanties, identiques à celles du lot 5B :
--  - Une seule transaction, SQL simple : aucun bloc DO, aucun SQL dynamique (contrat SEC-06).
--  - Aucune table existante n'est modifiée. Les deux tables réutilisent les fonctions de garde du
--    lot 5B (aucune fonction nouvelle) : snapshots figés, versions fermées par `toSeq` seulement,
--    ni DELETE ni TRUNCATE.
--  - Prérequis vérifiés AVANT toute écriture, avec la liste de ce qui manque : les 13 tables du lot
--    5B, les trois fonctions de garde qu'elles utilisent, l'extension btree_gist.
--  - Sur une installation existante, AUCUNE réparation : toute divergence fait échouer le script
--    avant qu'il n'écrive, avec la liste des écarts. Même méthode que le lot 5B (schéma de
--    référence jetable, comparaison avant puis après la construction).
--  - Deux états acceptés : aucune des deux tables, ou les deux tables identiques à la référence.
--  - Les fonctions ne sont pas comparées ici : elles appartiennent au script du lot 5B.
--  - La RLS est posée sans politique, fermée à anon et authenticated.

BEGIN;

-- hg:prerequisites
-- Ce que le lot 5B doit avoir posé. Vérifié avant de construire quoi que ce soit, pour que l'erreur
-- nomme ce qui manque au lieu de tomber sur une clé étrangère sans cible.
-- Sans manque, string_agg vaut NULL et le CAST ne fait rien : c'est volontaire, pas de bloc DO.
SELECT CAST(
  'The prerequisites of the count-check schema are missing. Nothing was changed.'
  || E'
' || string_agg(problem, E'
' ORDER BY problem)
  AS integer)
FROM (
  SELECT 'the lot 5B schema is missing or partial: ' || count(*) || ' of 13 tables' AS problem
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  WHERE c.relkind = 'r' AND c.relname = ANY (ARRAY['SourceArtifact', 'OfficialSourceSnapshot', 'SnapshotDecision', 'OfficialActor', 'OfficialOrganRecord', 'GroupMembershipRecord', 'SeatMandateRecord', 'ScrutinVoterAttestation', 'OfficialActorLinkDecision', 'OrganContinuityDecision', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin', 'RunExclusion']::text[])
  HAVING count(*) <> 13
  UNION ALL
  SELECT 'the lot 5B guard functions are missing: ' || count(DISTINCT p.proname) || ' of 3'
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
  WHERE p.proname IN ('historical_version_guard', 'historical_refuse_mutation', 'historical_refuse_truncate')
  HAVING count(DISTINCT p.proname) <> 3
  UNION ALL
  SELECT 'the btree_gist extension is not installed'
  WHERE NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist')
) problems;

DROP SCHEMA IF EXISTS hg_reference CASCADE;
CREATE SCHEMA hg_reference;

-- hg:reference-build
-- `public` suit hg_reference : les fonctions de garde et la table des snapshots du lot 5B s'y trouvent.
SET LOCAL search_path TO hg_reference, public, pg_catalog;

CREATE TABLE IF NOT EXISTS "ScrutinCountCheck" (
    "stream" TEXT NOT NULL,
    "scrutinExternalId" TEXT NOT NULL,
    "fromSeq" INTEGER NOT NULL,
    "toSeq" INTEGER,
    "scrutinDate" DATE NOT NULL,
    "legislature" INTEGER NOT NULL,
    "countCoherence" TEXT NOT NULL,
    "groupCount" INTEGER NOT NULL,
    "mismatchedGroups" INTEGER NOT NULL,
    "unverifiableGroups" INTEGER NOT NULL,
    "nominalPour" INTEGER NOT NULL,
    "nominalContre" INTEGER NOT NULL,
    "nominalAbstention" INTEGER NOT NULL,
    "nominalNonVotant" INTEGER NOT NULL,
    "officialPour" INTEGER,
    "officialContre" INTEGER,
    "officialAbstention" INTEGER,
    "officialNonVotant" INTEGER,
    "diffPour" INTEGER,
    "diffContre" INTEGER,
    "diffAbstention" INTEGER,
    "diffNonVotant" INTEGER,
    "miseAuPointListedVotants" INTEGER NOT NULL,
    "miseAuPointMalformedBlocks" INTEGER NOT NULL,
    "memberHash" TEXT NOT NULL,
    "sourceMember" TEXT NOT NULL,
    "rawHash" TEXT NOT NULL,

    CONSTRAINT "ScrutinCountCheck_pkey" PRIMARY KEY ("stream", "scrutinExternalId", "fromSeq"),
    CONSTRAINT "ScrutinCountCheck_fromSnapshot_fkey" FOREIGN KEY ("stream", "fromSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ScrutinCountCheck_toSnapshot_fkey" FOREIGN KEY ("stream", "toSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ScrutinCountCheck_fromSeq_positive" CHECK ("fromSeq" > 0),
    CONSTRAINT "ScrutinCountCheck_toSeq_after_fromSeq" CHECK ("toSeq" IS NULL OR "toSeq" > "fromSeq"),
    CONSTRAINT "ScrutinCountCheck_stream_known" CHECK ("stream" IN ('AN_AMO30', 'AN_SCRUTINS_L15', 'AN_SCRUTINS_L16', 'AN_SCRUTINS_L17', 'SENAT_HISTOGROUPES')),
    CONSTRAINT "ScrutinCountCheck_rawHash_format" CHECK ("rawHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ScrutinCountCheck_sourceMember_present" CHECK ("sourceMember" <> ''),
    CONSTRAINT "ScrutinCountCheck_scrutinExternalId_present" CHECK ("scrutinExternalId" <> ''),
    CONSTRAINT "ScrutinCountCheck_stream_is_scrutins" CHECK ("stream" LIKE 'AN\_SCRUTINS\_%'),
    CONSTRAINT "ScrutinCountCheck_counts_not_negative" CHECK ("nominalPour" >= 0 AND "nominalContre" >= 0 AND "nominalAbstention" >= 0 AND "nominalNonVotant" >= 0),
    CONSTRAINT "ScrutinCountCheck_official_not_negative" CHECK (("officialPour" IS NULL OR "officialPour" >= 0) AND ("officialContre" IS NULL OR "officialContre" >= 0) AND ("officialAbstention" IS NULL OR "officialAbstention" >= 0) AND ("officialNonVotant" IS NULL OR "officialNonVotant" >= 0)),
    CONSTRAINT "ScrutinCountCheck_official_all_or_none" CHECK (("officialPour" IS NULL) = ("officialContre" IS NULL) AND ("officialPour" IS NULL) = ("officialAbstention" IS NULL) AND ("officialPour" IS NULL) = ("officialNonVotant" IS NULL)),
    CONSTRAINT "ScrutinCountCheck_diffPour_consistent" CHECK (("officialPour" IS NULL AND "diffPour" IS NULL) OR ("officialPour" IS NOT NULL AND "diffPour" = "nominalPour" - "officialPour")),
    CONSTRAINT "ScrutinCountCheck_diffContre_consistent" CHECK (("officialContre" IS NULL AND "diffContre" IS NULL) OR ("officialContre" IS NOT NULL AND "diffContre" = "nominalContre" - "officialContre")),
    CONSTRAINT "ScrutinCountCheck_diffAbstention_consistent" CHECK (("officialAbstention" IS NULL AND "diffAbstention" IS NULL) OR ("officialAbstention" IS NOT NULL AND "diffAbstention" = "nominalAbstention" - "officialAbstention")),
    CONSTRAINT "ScrutinCountCheck_diffNonVotant_consistent" CHECK (("officialNonVotant" IS NULL AND "diffNonVotant" IS NULL) OR ("officialNonVotant" IS NOT NULL AND "diffNonVotant" = "nominalNonVotant" - "officialNonVotant")),
    CONSTRAINT "ScrutinCountCheck_countCoherence_known" CHECK ("countCoherence" IN ('COHERENT', 'COUNT_MISMATCH', 'UNVERIFIABLE')),
    CONSTRAINT "ScrutinCountCheck_groups_counted" CHECK ("groupCount" > 0 AND "mismatchedGroups" >= 0 AND "unverifiableGroups" >= 0 AND "mismatchedGroups" + "unverifiableGroups" <= "groupCount"),
    CONSTRAINT "ScrutinCountCheck_countCoherence_derived" CHECK ("countCoherence" = CASE WHEN "mismatchedGroups" > 0 OR ("officialPour" IS NOT NULL AND ("diffPour" <> 0 OR "diffContre" <> 0 OR "diffAbstention" <> 0 OR "diffNonVotant" <> 0)) THEN 'COUNT_MISMATCH' WHEN "officialPour" IS NULL OR "unverifiableGroups" > 0 THEN 'UNVERIFIABLE' ELSE 'COHERENT' END),
    CONSTRAINT "ScrutinCountCheck_miseAuPoint_not_negative" CHECK ("miseAuPointListedVotants" >= 0 AND "miseAuPointMalformedBlocks" >= 0),
    CONSTRAINT "ScrutinCountCheck_memberHash_format" CHECK ("memberHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ScrutinCountCheck_legislature_positive" CHECK ("legislature" > 0),
    CONSTRAINT "ScrutinCountCheck_no_overlap" EXCLUDE USING gist ("stream" WITH =, "scrutinExternalId" WITH =, int4range("fromSeq", "toSeq", '[)') WITH &&)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ScrutinCountCheck_active_key" ON "ScrutinCountCheck"("stream", "scrutinExternalId") WHERE "toSeq" IS NULL;
CREATE INDEX IF NOT EXISTS "ScrutinCountCheck_stream_countCoherence_idx" ON "ScrutinCountCheck"("stream", "countCoherence");

CREATE TABLE IF NOT EXISTS "ScrutinGroupCountCheck" (
    "stream" TEXT NOT NULL,
    "scrutinExternalId" TEXT NOT NULL,
    "organRef" TEXT NOT NULL,
    "organOrdinal" INTEGER NOT NULL,
    "fromSeq" INTEGER NOT NULL,
    "toSeq" INTEGER,
    "groupCoherence" TEXT NOT NULL,
    "nominalPour" INTEGER NOT NULL,
    "nominalContre" INTEGER NOT NULL,
    "nominalAbstention" INTEGER NOT NULL,
    "nominalNonVotant" INTEGER NOT NULL,
    "officialPour" INTEGER,
    "officialContre" INTEGER,
    "officialAbstention" INTEGER,
    "officialNonVotant" INTEGER,
    "diffPour" INTEGER,
    "diffContre" INTEGER,
    "diffAbstention" INTEGER,
    "diffNonVotant" INTEGER,
    "memberHash" TEXT NOT NULL,
    "sourceMember" TEXT NOT NULL,
    "rawHash" TEXT NOT NULL,

    CONSTRAINT "ScrutinGroupCountCheck_pkey" PRIMARY KEY ("stream", "scrutinExternalId", "organRef", "organOrdinal", "fromSeq"),
    CONSTRAINT "ScrutinGroupCountCheck_fromSnapshot_fkey" FOREIGN KEY ("stream", "fromSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ScrutinGroupCountCheck_toSnapshot_fkey" FOREIGN KEY ("stream", "toSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ScrutinGroupCountCheck_fromSeq_positive" CHECK ("fromSeq" > 0),
    CONSTRAINT "ScrutinGroupCountCheck_toSeq_after_fromSeq" CHECK ("toSeq" IS NULL OR "toSeq" > "fromSeq"),
    CONSTRAINT "ScrutinGroupCountCheck_stream_known" CHECK ("stream" IN ('AN_AMO30', 'AN_SCRUTINS_L15', 'AN_SCRUTINS_L16', 'AN_SCRUTINS_L17', 'SENAT_HISTOGROUPES')),
    CONSTRAINT "ScrutinGroupCountCheck_rawHash_format" CHECK ("rawHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ScrutinGroupCountCheck_sourceMember_present" CHECK ("sourceMember" <> ''),
    CONSTRAINT "ScrutinGroupCountCheck_scrutinExternalId_present" CHECK ("scrutinExternalId" <> ''),
    CONSTRAINT "ScrutinGroupCountCheck_organRef_present" CHECK ("organRef" <> ''),
    CONSTRAINT "ScrutinGroupCountCheck_stream_is_scrutins" CHECK ("stream" LIKE 'AN\_SCRUTINS\_%'),
    CONSTRAINT "ScrutinGroupCountCheck_counts_not_negative" CHECK ("nominalPour" >= 0 AND "nominalContre" >= 0 AND "nominalAbstention" >= 0 AND "nominalNonVotant" >= 0),
    CONSTRAINT "ScrutinGroupCountCheck_official_not_negative" CHECK (("officialPour" IS NULL OR "officialPour" >= 0) AND ("officialContre" IS NULL OR "officialContre" >= 0) AND ("officialAbstention" IS NULL OR "officialAbstention" >= 0) AND ("officialNonVotant" IS NULL OR "officialNonVotant" >= 0)),
    CONSTRAINT "ScrutinGroupCountCheck_official_all_or_none" CHECK (("officialPour" IS NULL) = ("officialContre" IS NULL) AND ("officialPour" IS NULL) = ("officialAbstention" IS NULL) AND ("officialPour" IS NULL) = ("officialNonVotant" IS NULL)),
    CONSTRAINT "ScrutinGroupCountCheck_diffPour_consistent" CHECK (("officialPour" IS NULL AND "diffPour" IS NULL) OR ("officialPour" IS NOT NULL AND "diffPour" = "nominalPour" - "officialPour")),
    CONSTRAINT "ScrutinGroupCountCheck_diffContre_consistent" CHECK (("officialContre" IS NULL AND "diffContre" IS NULL) OR ("officialContre" IS NOT NULL AND "diffContre" = "nominalContre" - "officialContre")),
    CONSTRAINT "ScrutinGroupCountCheck_diffAbstention_consistent" CHECK (("officialAbstention" IS NULL AND "diffAbstention" IS NULL) OR ("officialAbstention" IS NOT NULL AND "diffAbstention" = "nominalAbstention" - "officialAbstention")),
    CONSTRAINT "ScrutinGroupCountCheck_diffNonVotant_consistent" CHECK (("officialNonVotant" IS NULL AND "diffNonVotant" IS NULL) OR ("officialNonVotant" IS NOT NULL AND "diffNonVotant" = "nominalNonVotant" - "officialNonVotant")),
    CONSTRAINT "ScrutinGroupCountCheck_organOrdinal_not_negative" CHECK ("organOrdinal" >= 0),
    CONSTRAINT "ScrutinGroupCountCheck_groupCoherence_known" CHECK ("groupCoherence" IN ('COHERENT', 'COUNT_MISMATCH', 'UNVERIFIABLE')),
    CONSTRAINT "ScrutinGroupCountCheck_groupCoherence_derived" CHECK ("groupCoherence" = CASE WHEN "officialPour" IS NULL THEN 'UNVERIFIABLE' WHEN "diffPour" <> 0 OR "diffContre" <> 0 OR "diffAbstention" <> 0 OR "diffNonVotant" <> 0 THEN 'COUNT_MISMATCH' ELSE 'COHERENT' END),
    CONSTRAINT "ScrutinGroupCountCheck_memberHash_format" CHECK ("memberHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ScrutinGroupCountCheck_no_overlap" EXCLUDE USING gist ("stream" WITH =, "scrutinExternalId" WITH =, "organRef" WITH =, "organOrdinal" WITH =, int4range("fromSeq", "toSeq", '[)') WITH &&)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ScrutinGroupCountCheck_active_key" ON "ScrutinGroupCountCheck"("stream", "scrutinExternalId", "organRef", "organOrdinal") WHERE "toSeq" IS NULL;
CREATE INDEX IF NOT EXISTS "ScrutinGroupCountCheck_stream_scrutinExternalId_idx" ON "ScrutinGroupCountCheck"("stream", "scrutinExternalId");

CREATE OR REPLACE TRIGGER "ScrutinCountCheck_version_guard" BEFORE INSERT OR UPDATE ON "ScrutinCountCheck" FOR EACH ROW EXECUTE FUNCTION historical_version_guard();
ALTER TABLE "ScrutinCountCheck" ENABLE ALWAYS TRIGGER "ScrutinCountCheck_version_guard";
CREATE OR REPLACE TRIGGER "ScrutinCountCheck_no_delete" BEFORE DELETE ON "ScrutinCountCheck" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "ScrutinCountCheck" ENABLE ALWAYS TRIGGER "ScrutinCountCheck_no_delete";
CREATE OR REPLACE TRIGGER "ScrutinCountCheck_no_truncate" BEFORE TRUNCATE ON "ScrutinCountCheck" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "ScrutinCountCheck" ENABLE ALWAYS TRIGGER "ScrutinCountCheck_no_truncate";
CREATE OR REPLACE TRIGGER "ScrutinGroupCountCheck_version_guard" BEFORE INSERT OR UPDATE ON "ScrutinGroupCountCheck" FOR EACH ROW EXECUTE FUNCTION historical_version_guard();
ALTER TABLE "ScrutinGroupCountCheck" ENABLE ALWAYS TRIGGER "ScrutinGroupCountCheck_version_guard";
CREATE OR REPLACE TRIGGER "ScrutinGroupCountCheck_no_delete" BEFORE DELETE ON "ScrutinGroupCountCheck" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "ScrutinGroupCountCheck" ENABLE ALWAYS TRIGGER "ScrutinGroupCountCheck_no_delete";
CREATE OR REPLACE TRIGGER "ScrutinGroupCountCheck_no_truncate" BEFORE TRUNCATE ON "ScrutinGroupCountCheck" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "ScrutinGroupCountCheck" ENABLE ALWAYS TRIGGER "ScrutinGroupCountCheck_no_truncate";

ALTER TABLE "ScrutinCountCheck" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScrutinGroupCountCheck" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "ScrutinCountCheck", "ScrutinGroupCountCheck" FROM PUBLIC, anon, authenticated;

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
WHERE c.relkind = 'r' AND c.relname = ANY (ARRAY['ScrutinCountCheck', 'ScrutinGroupCountCheck']::text[]);

INSERT INTO hg_catalog_dump
SELECT 'hg_reference', 'constraint', c.relname || '|' || k.conname || '|' || k.contype::text || '|'
       || regexp_replace(pg_get_constraintdef(k.oid), '(hg_reference|public)\.', '', 'g')
FROM pg_constraint k
JOIN pg_class c ON c.oid = k.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'hg_reference'
WHERE c.relname = ANY (ARRAY['ScrutinCountCheck', 'ScrutinGroupCountCheck']::text[]);

INSERT INTO hg_catalog_dump
SELECT 'hg_reference', 'index', i.tablename || '|' || i.indexname || '|'
       || regexp_replace(i.indexdef, '(hg_reference|public)\.', '', 'g')
FROM pg_indexes i
WHERE i.schemaname = 'hg_reference' AND i.tablename = ANY (ARRAY['ScrutinCountCheck', 'ScrutinGroupCountCheck']::text[]);

INSERT INTO hg_catalog_dump
SELECT 'hg_reference', 'trigger', c.relname || '|' || t.tgname || '|' || t.tgenabled::text || '|'
       || regexp_replace(pg_get_triggerdef(t.oid), '(hg_reference|public)\.', '', 'g')
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'hg_reference'
WHERE NOT t.tgisinternal AND c.relname = ANY (ARRAY['ScrutinCountCheck', 'ScrutinGroupCountCheck']::text[]);

INSERT INTO hg_catalog_dump
SELECT 'hg_reference', 'table', c.relname || '|rls=' || c.relrowsecurity::text || '|force=' || c.relforcerowsecurity::text
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'hg_reference'
WHERE c.relkind = 'r' AND c.relname = ANY (ARRAY['ScrutinCountCheck', 'ScrutinGroupCountCheck']::text[]);

-- Privileges are compared for PUBLIC, anon and authenticated only. Other grantees come from the
-- default privileges of the real schema (Supabase gives service_role its own), which the
-- reference schema does not have: comparing them would make the check fail for no reason.
INSERT INTO hg_catalog_dump
SELECT 'hg_reference', 'acl', c.relkind::text || '|' || c.relname || '|' || COALESCE(r.rolname, 'PUBLIC') || '|' || x.privilege_type
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'hg_reference'
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault((CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) x
LEFT JOIN pg_roles r ON r.oid = x.grantee
WHERE (c.relkind = 'r' AND c.relname = ANY (ARRAY['ScrutinCountCheck', 'ScrutinGroupCountCheck']::text[])
       OR c.relkind = 'S' AND c.relname ~ ('^(' || array_to_string(ARRAY['ScrutinCountCheck', 'ScrutinGroupCountCheck']::text[], '|') || ')_.*_seq$'))
  AND (x.grantee = 0 OR r.rolname IN ('anon', 'authenticated'));

INSERT INTO hg_catalog_dump
SELECT 'public_before', 'column', c.relname || '|' || a.attname || '|' || format_type(a.atttypid, a.atttypmod)
       || '|' || a.attnotnull::text || '|' || COALESCE(regexp_replace(pg_get_expr(d.adbin, d.adrelid), '(hg_reference|public)\.', '', 'g'), '')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE c.relkind = 'r' AND c.relname = ANY (ARRAY['ScrutinCountCheck', 'ScrutinGroupCountCheck']::text[]);

INSERT INTO hg_catalog_dump
SELECT 'public_before', 'constraint', c.relname || '|' || k.conname || '|' || k.contype::text || '|'
       || regexp_replace(pg_get_constraintdef(k.oid), '(hg_reference|public)\.', '', 'g')
FROM pg_constraint k
JOIN pg_class c ON c.oid = k.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.relname = ANY (ARRAY['ScrutinCountCheck', 'ScrutinGroupCountCheck']::text[]);

INSERT INTO hg_catalog_dump
SELECT 'public_before', 'index', i.tablename || '|' || i.indexname || '|'
       || regexp_replace(i.indexdef, '(hg_reference|public)\.', '', 'g')
FROM pg_indexes i
WHERE i.schemaname = 'public' AND i.tablename = ANY (ARRAY['ScrutinCountCheck', 'ScrutinGroupCountCheck']::text[]);

INSERT INTO hg_catalog_dump
SELECT 'public_before', 'trigger', c.relname || '|' || t.tgname || '|' || t.tgenabled::text || '|'
       || regexp_replace(pg_get_triggerdef(t.oid), '(hg_reference|public)\.', '', 'g')
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE NOT t.tgisinternal AND c.relname = ANY (ARRAY['ScrutinCountCheck', 'ScrutinGroupCountCheck']::text[]);

INSERT INTO hg_catalog_dump
SELECT 'public_before', 'table', c.relname || '|rls=' || c.relrowsecurity::text || '|force=' || c.relforcerowsecurity::text
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.relkind = 'r' AND c.relname = ANY (ARRAY['ScrutinCountCheck', 'ScrutinGroupCountCheck']::text[]);

-- Privileges are compared for PUBLIC, anon and authenticated only. Other grantees come from the
-- default privileges of the real schema (Supabase gives service_role its own), which the
-- reference schema does not have: comparing them would make the check fail for no reason.
INSERT INTO hg_catalog_dump
SELECT 'public_before', 'acl', c.relkind::text || '|' || c.relname || '|' || COALESCE(r.rolname, 'PUBLIC') || '|' || x.privilege_type
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault((CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) x
LEFT JOIN pg_roles r ON r.oid = x.grantee
WHERE (c.relkind = 'r' AND c.relname = ANY (ARRAY['ScrutinCountCheck', 'ScrutinGroupCountCheck']::text[])
       OR c.relkind = 'S' AND c.relname ~ ('^(' || array_to_string(ARRAY['ScrutinCountCheck', 'ScrutinGroupCountCheck']::text[], '|') || ')_.*_seq$'))
  AND (x.grantee = 0 OR r.rolname IN ('anon', 'authenticated'));
-- Sans écart, string_agg vaut NULL et le CAST ne fait rien. Avec un écart ou un prérequis absent, le
-- CAST échoue et son message porte la liste. C'est volontaire : pas de bloc DO.
WITH existing AS (
  SELECT count(*)::int AS n
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  WHERE c.relkind = 'r' AND c.relname = ANY (ARRAY['ScrutinCountCheck', 'ScrutinGroupCountCheck']::text[])
),
diffs AS (
  (SELECT 'only in the reference build'::text AS side, kind, item FROM hg_catalog_dump WHERE side = 'hg_reference'
   EXCEPT SELECT 'only in the reference build', kind, item FROM hg_catalog_dump WHERE side = 'public_before')
  UNION ALL
  (SELECT 'only in the real schema', kind, item FROM hg_catalog_dump WHERE side = 'public_before'
   EXCEPT SELECT 'only in the real schema', kind, item FROM hg_catalog_dump WHERE side = 'hg_reference')
)
SELECT CAST(
  'The count-check schema differs from the expected definition. Nothing was changed.'
  || E'\n' || left(string_agg(problem, E'\n' ORDER BY problem), 4000)
  AS integer)
FROM (
  SELECT 'partial installation: ' || n || ' of 2 tables exist' AS problem FROM existing WHERE n NOT IN (0, 2)
  UNION ALL
  SELECT side || ' ' || kind || ': ' || item FROM diffs, existing WHERE existing.n = 2
) problems;


-- hg:real-build
SET LOCAL search_path TO public, pg_catalog;

CREATE TABLE IF NOT EXISTS "ScrutinCountCheck" (
    "stream" TEXT NOT NULL,
    "scrutinExternalId" TEXT NOT NULL,
    "fromSeq" INTEGER NOT NULL,
    "toSeq" INTEGER,
    "scrutinDate" DATE NOT NULL,
    "legislature" INTEGER NOT NULL,
    "countCoherence" TEXT NOT NULL,
    "groupCount" INTEGER NOT NULL,
    "mismatchedGroups" INTEGER NOT NULL,
    "unverifiableGroups" INTEGER NOT NULL,
    "nominalPour" INTEGER NOT NULL,
    "nominalContre" INTEGER NOT NULL,
    "nominalAbstention" INTEGER NOT NULL,
    "nominalNonVotant" INTEGER NOT NULL,
    "officialPour" INTEGER,
    "officialContre" INTEGER,
    "officialAbstention" INTEGER,
    "officialNonVotant" INTEGER,
    "diffPour" INTEGER,
    "diffContre" INTEGER,
    "diffAbstention" INTEGER,
    "diffNonVotant" INTEGER,
    "miseAuPointListedVotants" INTEGER NOT NULL,
    "miseAuPointMalformedBlocks" INTEGER NOT NULL,
    "memberHash" TEXT NOT NULL,
    "sourceMember" TEXT NOT NULL,
    "rawHash" TEXT NOT NULL,

    CONSTRAINT "ScrutinCountCheck_pkey" PRIMARY KEY ("stream", "scrutinExternalId", "fromSeq"),
    CONSTRAINT "ScrutinCountCheck_fromSnapshot_fkey" FOREIGN KEY ("stream", "fromSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ScrutinCountCheck_toSnapshot_fkey" FOREIGN KEY ("stream", "toSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ScrutinCountCheck_fromSeq_positive" CHECK ("fromSeq" > 0),
    CONSTRAINT "ScrutinCountCheck_toSeq_after_fromSeq" CHECK ("toSeq" IS NULL OR "toSeq" > "fromSeq"),
    CONSTRAINT "ScrutinCountCheck_stream_known" CHECK ("stream" IN ('AN_AMO30', 'AN_SCRUTINS_L15', 'AN_SCRUTINS_L16', 'AN_SCRUTINS_L17', 'SENAT_HISTOGROUPES')),
    CONSTRAINT "ScrutinCountCheck_rawHash_format" CHECK ("rawHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ScrutinCountCheck_sourceMember_present" CHECK ("sourceMember" <> ''),
    CONSTRAINT "ScrutinCountCheck_scrutinExternalId_present" CHECK ("scrutinExternalId" <> ''),
    CONSTRAINT "ScrutinCountCheck_stream_is_scrutins" CHECK ("stream" LIKE 'AN\_SCRUTINS\_%'),
    CONSTRAINT "ScrutinCountCheck_counts_not_negative" CHECK ("nominalPour" >= 0 AND "nominalContre" >= 0 AND "nominalAbstention" >= 0 AND "nominalNonVotant" >= 0),
    CONSTRAINT "ScrutinCountCheck_official_not_negative" CHECK (("officialPour" IS NULL OR "officialPour" >= 0) AND ("officialContre" IS NULL OR "officialContre" >= 0) AND ("officialAbstention" IS NULL OR "officialAbstention" >= 0) AND ("officialNonVotant" IS NULL OR "officialNonVotant" >= 0)),
    CONSTRAINT "ScrutinCountCheck_official_all_or_none" CHECK (("officialPour" IS NULL) = ("officialContre" IS NULL) AND ("officialPour" IS NULL) = ("officialAbstention" IS NULL) AND ("officialPour" IS NULL) = ("officialNonVotant" IS NULL)),
    CONSTRAINT "ScrutinCountCheck_diffPour_consistent" CHECK (("officialPour" IS NULL AND "diffPour" IS NULL) OR ("officialPour" IS NOT NULL AND "diffPour" = "nominalPour" - "officialPour")),
    CONSTRAINT "ScrutinCountCheck_diffContre_consistent" CHECK (("officialContre" IS NULL AND "diffContre" IS NULL) OR ("officialContre" IS NOT NULL AND "diffContre" = "nominalContre" - "officialContre")),
    CONSTRAINT "ScrutinCountCheck_diffAbstention_consistent" CHECK (("officialAbstention" IS NULL AND "diffAbstention" IS NULL) OR ("officialAbstention" IS NOT NULL AND "diffAbstention" = "nominalAbstention" - "officialAbstention")),
    CONSTRAINT "ScrutinCountCheck_diffNonVotant_consistent" CHECK (("officialNonVotant" IS NULL AND "diffNonVotant" IS NULL) OR ("officialNonVotant" IS NOT NULL AND "diffNonVotant" = "nominalNonVotant" - "officialNonVotant")),
    CONSTRAINT "ScrutinCountCheck_countCoherence_known" CHECK ("countCoherence" IN ('COHERENT', 'COUNT_MISMATCH', 'UNVERIFIABLE')),
    CONSTRAINT "ScrutinCountCheck_groups_counted" CHECK ("groupCount" > 0 AND "mismatchedGroups" >= 0 AND "unverifiableGroups" >= 0 AND "mismatchedGroups" + "unverifiableGroups" <= "groupCount"),
    CONSTRAINT "ScrutinCountCheck_countCoherence_derived" CHECK ("countCoherence" = CASE WHEN "mismatchedGroups" > 0 OR ("officialPour" IS NOT NULL AND ("diffPour" <> 0 OR "diffContre" <> 0 OR "diffAbstention" <> 0 OR "diffNonVotant" <> 0)) THEN 'COUNT_MISMATCH' WHEN "officialPour" IS NULL OR "unverifiableGroups" > 0 THEN 'UNVERIFIABLE' ELSE 'COHERENT' END),
    CONSTRAINT "ScrutinCountCheck_miseAuPoint_not_negative" CHECK ("miseAuPointListedVotants" >= 0 AND "miseAuPointMalformedBlocks" >= 0),
    CONSTRAINT "ScrutinCountCheck_memberHash_format" CHECK ("memberHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ScrutinCountCheck_legislature_positive" CHECK ("legislature" > 0),
    CONSTRAINT "ScrutinCountCheck_no_overlap" EXCLUDE USING gist ("stream" WITH =, "scrutinExternalId" WITH =, int4range("fromSeq", "toSeq", '[)') WITH &&)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ScrutinCountCheck_active_key" ON "ScrutinCountCheck"("stream", "scrutinExternalId") WHERE "toSeq" IS NULL;
CREATE INDEX IF NOT EXISTS "ScrutinCountCheck_stream_countCoherence_idx" ON "ScrutinCountCheck"("stream", "countCoherence");

CREATE TABLE IF NOT EXISTS "ScrutinGroupCountCheck" (
    "stream" TEXT NOT NULL,
    "scrutinExternalId" TEXT NOT NULL,
    "organRef" TEXT NOT NULL,
    "organOrdinal" INTEGER NOT NULL,
    "fromSeq" INTEGER NOT NULL,
    "toSeq" INTEGER,
    "groupCoherence" TEXT NOT NULL,
    "nominalPour" INTEGER NOT NULL,
    "nominalContre" INTEGER NOT NULL,
    "nominalAbstention" INTEGER NOT NULL,
    "nominalNonVotant" INTEGER NOT NULL,
    "officialPour" INTEGER,
    "officialContre" INTEGER,
    "officialAbstention" INTEGER,
    "officialNonVotant" INTEGER,
    "diffPour" INTEGER,
    "diffContre" INTEGER,
    "diffAbstention" INTEGER,
    "diffNonVotant" INTEGER,
    "memberHash" TEXT NOT NULL,
    "sourceMember" TEXT NOT NULL,
    "rawHash" TEXT NOT NULL,

    CONSTRAINT "ScrutinGroupCountCheck_pkey" PRIMARY KEY ("stream", "scrutinExternalId", "organRef", "organOrdinal", "fromSeq"),
    CONSTRAINT "ScrutinGroupCountCheck_fromSnapshot_fkey" FOREIGN KEY ("stream", "fromSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ScrutinGroupCountCheck_toSnapshot_fkey" FOREIGN KEY ("stream", "toSeq") REFERENCES "OfficialSourceSnapshot"("stream", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ScrutinGroupCountCheck_fromSeq_positive" CHECK ("fromSeq" > 0),
    CONSTRAINT "ScrutinGroupCountCheck_toSeq_after_fromSeq" CHECK ("toSeq" IS NULL OR "toSeq" > "fromSeq"),
    CONSTRAINT "ScrutinGroupCountCheck_stream_known" CHECK ("stream" IN ('AN_AMO30', 'AN_SCRUTINS_L15', 'AN_SCRUTINS_L16', 'AN_SCRUTINS_L17', 'SENAT_HISTOGROUPES')),
    CONSTRAINT "ScrutinGroupCountCheck_rawHash_format" CHECK ("rawHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ScrutinGroupCountCheck_sourceMember_present" CHECK ("sourceMember" <> ''),
    CONSTRAINT "ScrutinGroupCountCheck_scrutinExternalId_present" CHECK ("scrutinExternalId" <> ''),
    CONSTRAINT "ScrutinGroupCountCheck_organRef_present" CHECK ("organRef" <> ''),
    CONSTRAINT "ScrutinGroupCountCheck_stream_is_scrutins" CHECK ("stream" LIKE 'AN\_SCRUTINS\_%'),
    CONSTRAINT "ScrutinGroupCountCheck_counts_not_negative" CHECK ("nominalPour" >= 0 AND "nominalContre" >= 0 AND "nominalAbstention" >= 0 AND "nominalNonVotant" >= 0),
    CONSTRAINT "ScrutinGroupCountCheck_official_not_negative" CHECK (("officialPour" IS NULL OR "officialPour" >= 0) AND ("officialContre" IS NULL OR "officialContre" >= 0) AND ("officialAbstention" IS NULL OR "officialAbstention" >= 0) AND ("officialNonVotant" IS NULL OR "officialNonVotant" >= 0)),
    CONSTRAINT "ScrutinGroupCountCheck_official_all_or_none" CHECK (("officialPour" IS NULL) = ("officialContre" IS NULL) AND ("officialPour" IS NULL) = ("officialAbstention" IS NULL) AND ("officialPour" IS NULL) = ("officialNonVotant" IS NULL)),
    CONSTRAINT "ScrutinGroupCountCheck_diffPour_consistent" CHECK (("officialPour" IS NULL AND "diffPour" IS NULL) OR ("officialPour" IS NOT NULL AND "diffPour" = "nominalPour" - "officialPour")),
    CONSTRAINT "ScrutinGroupCountCheck_diffContre_consistent" CHECK (("officialContre" IS NULL AND "diffContre" IS NULL) OR ("officialContre" IS NOT NULL AND "diffContre" = "nominalContre" - "officialContre")),
    CONSTRAINT "ScrutinGroupCountCheck_diffAbstention_consistent" CHECK (("officialAbstention" IS NULL AND "diffAbstention" IS NULL) OR ("officialAbstention" IS NOT NULL AND "diffAbstention" = "nominalAbstention" - "officialAbstention")),
    CONSTRAINT "ScrutinGroupCountCheck_diffNonVotant_consistent" CHECK (("officialNonVotant" IS NULL AND "diffNonVotant" IS NULL) OR ("officialNonVotant" IS NOT NULL AND "diffNonVotant" = "nominalNonVotant" - "officialNonVotant")),
    CONSTRAINT "ScrutinGroupCountCheck_organOrdinal_not_negative" CHECK ("organOrdinal" >= 0),
    CONSTRAINT "ScrutinGroupCountCheck_groupCoherence_known" CHECK ("groupCoherence" IN ('COHERENT', 'COUNT_MISMATCH', 'UNVERIFIABLE')),
    CONSTRAINT "ScrutinGroupCountCheck_groupCoherence_derived" CHECK ("groupCoherence" = CASE WHEN "officialPour" IS NULL THEN 'UNVERIFIABLE' WHEN "diffPour" <> 0 OR "diffContre" <> 0 OR "diffAbstention" <> 0 OR "diffNonVotant" <> 0 THEN 'COUNT_MISMATCH' ELSE 'COHERENT' END),
    CONSTRAINT "ScrutinGroupCountCheck_memberHash_format" CHECK ("memberHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ScrutinGroupCountCheck_no_overlap" EXCLUDE USING gist ("stream" WITH =, "scrutinExternalId" WITH =, "organRef" WITH =, "organOrdinal" WITH =, int4range("fromSeq", "toSeq", '[)') WITH &&)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ScrutinGroupCountCheck_active_key" ON "ScrutinGroupCountCheck"("stream", "scrutinExternalId", "organRef", "organOrdinal") WHERE "toSeq" IS NULL;
CREATE INDEX IF NOT EXISTS "ScrutinGroupCountCheck_stream_scrutinExternalId_idx" ON "ScrutinGroupCountCheck"("stream", "scrutinExternalId");

CREATE OR REPLACE TRIGGER "ScrutinCountCheck_version_guard" BEFORE INSERT OR UPDATE ON "ScrutinCountCheck" FOR EACH ROW EXECUTE FUNCTION historical_version_guard();
ALTER TABLE "ScrutinCountCheck" ENABLE ALWAYS TRIGGER "ScrutinCountCheck_version_guard";
CREATE OR REPLACE TRIGGER "ScrutinCountCheck_no_delete" BEFORE DELETE ON "ScrutinCountCheck" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "ScrutinCountCheck" ENABLE ALWAYS TRIGGER "ScrutinCountCheck_no_delete";
CREATE OR REPLACE TRIGGER "ScrutinCountCheck_no_truncate" BEFORE TRUNCATE ON "ScrutinCountCheck" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "ScrutinCountCheck" ENABLE ALWAYS TRIGGER "ScrutinCountCheck_no_truncate";
CREATE OR REPLACE TRIGGER "ScrutinGroupCountCheck_version_guard" BEFORE INSERT OR UPDATE ON "ScrutinGroupCountCheck" FOR EACH ROW EXECUTE FUNCTION historical_version_guard();
ALTER TABLE "ScrutinGroupCountCheck" ENABLE ALWAYS TRIGGER "ScrutinGroupCountCheck_version_guard";
CREATE OR REPLACE TRIGGER "ScrutinGroupCountCheck_no_delete" BEFORE DELETE ON "ScrutinGroupCountCheck" FOR EACH ROW EXECUTE FUNCTION historical_refuse_mutation();
ALTER TABLE "ScrutinGroupCountCheck" ENABLE ALWAYS TRIGGER "ScrutinGroupCountCheck_no_delete";
CREATE OR REPLACE TRIGGER "ScrutinGroupCountCheck_no_truncate" BEFORE TRUNCATE ON "ScrutinGroupCountCheck" FOR EACH STATEMENT EXECUTE FUNCTION historical_refuse_truncate();
ALTER TABLE "ScrutinGroupCountCheck" ENABLE ALWAYS TRIGGER "ScrutinGroupCountCheck_no_truncate";

ALTER TABLE "ScrutinCountCheck" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScrutinGroupCountCheck" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "ScrutinCountCheck", "ScrutinGroupCountCheck" FROM PUBLIC, anon, authenticated;

-- hg:postcheck
SET LOCAL search_path TO pg_catalog;

INSERT INTO hg_catalog_dump
SELECT 'public_after', 'column', c.relname || '|' || a.attname || '|' || format_type(a.atttypid, a.atttypmod)
       || '|' || a.attnotnull::text || '|' || COALESCE(regexp_replace(pg_get_expr(d.adbin, d.adrelid), '(hg_reference|public)\.', '', 'g'), '')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE c.relkind = 'r' AND c.relname = ANY (ARRAY['ScrutinCountCheck', 'ScrutinGroupCountCheck']::text[]);

INSERT INTO hg_catalog_dump
SELECT 'public_after', 'constraint', c.relname || '|' || k.conname || '|' || k.contype::text || '|'
       || regexp_replace(pg_get_constraintdef(k.oid), '(hg_reference|public)\.', '', 'g')
FROM pg_constraint k
JOIN pg_class c ON c.oid = k.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.relname = ANY (ARRAY['ScrutinCountCheck', 'ScrutinGroupCountCheck']::text[]);

INSERT INTO hg_catalog_dump
SELECT 'public_after', 'index', i.tablename || '|' || i.indexname || '|'
       || regexp_replace(i.indexdef, '(hg_reference|public)\.', '', 'g')
FROM pg_indexes i
WHERE i.schemaname = 'public' AND i.tablename = ANY (ARRAY['ScrutinCountCheck', 'ScrutinGroupCountCheck']::text[]);

INSERT INTO hg_catalog_dump
SELECT 'public_after', 'trigger', c.relname || '|' || t.tgname || '|' || t.tgenabled::text || '|'
       || regexp_replace(pg_get_triggerdef(t.oid), '(hg_reference|public)\.', '', 'g')
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE NOT t.tgisinternal AND c.relname = ANY (ARRAY['ScrutinCountCheck', 'ScrutinGroupCountCheck']::text[]);

INSERT INTO hg_catalog_dump
SELECT 'public_after', 'table', c.relname || '|rls=' || c.relrowsecurity::text || '|force=' || c.relforcerowsecurity::text
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.relkind = 'r' AND c.relname = ANY (ARRAY['ScrutinCountCheck', 'ScrutinGroupCountCheck']::text[]);

-- Privileges are compared for PUBLIC, anon and authenticated only. Other grantees come from the
-- default privileges of the real schema (Supabase gives service_role its own), which the
-- reference schema does not have: comparing them would make the check fail for no reason.
INSERT INTO hg_catalog_dump
SELECT 'public_after', 'acl', c.relkind::text || '|' || c.relname || '|' || COALESCE(r.rolname, 'PUBLIC') || '|' || x.privilege_type
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault((CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) x
LEFT JOIN pg_roles r ON r.oid = x.grantee
WHERE (c.relkind = 'r' AND c.relname = ANY (ARRAY['ScrutinCountCheck', 'ScrutinGroupCountCheck']::text[])
       OR c.relkind = 'S' AND c.relname ~ ('^(' || array_to_string(ARRAY['ScrutinCountCheck', 'ScrutinGroupCountCheck']::text[], '|') || ')_.*_seq$'))
  AND (x.grantee = 0 OR r.rolname IN ('anon', 'authenticated'));

SELECT CAST(
  'The count-check schema built here differs from the expected definition. Nothing was changed.'
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
