-- Lot 5B : benchmark des gardes sur données ENTIÈREMENT SYNTHÉTIQUES, à lancer avec psql sur la base
-- jetable locale (conteneur dédié, voir docs/audits/parlement-historique-lot5b-schema.md), jamais
-- ailleurs. Le schéma est supposé appliqué. Volumes de la 15e, 16e et 17e législatures (2 399 520
-- votes nominatifs), aucune donnée officielle ni personnelle : des identifiants fabriqués.
--   docker exec -i hg-schema-test psql -U hg_schema_test -d hg_schema_test -f - < ce-fichier
\set ON_ERROR_STOP on
\timing on

SELECT current_database() AS database, current_setting('hg.disposable', true) AS marker \gset
\if :{?marker}
\else
  \echo 'refus : pas de marqueur'
  \quit
\endif
SELECT (:'marker' = 'yes') AS ok \gset
\if :ok
\else
  \echo 'refus : la base ne porte pas le marqueur hg.disposable'
  \quit
\endif

-- Un artefact et un instantané par flux.
INSERT INTO "SourceArtifact"("sha256","byteSize","mediaType","storageKind","storageRef","storedAt","storedBy")
SELECT md5(s) || md5(s || 'x'), 1000, 'application/zip', 'LOCAL_OFFLINE', 'bench/' || s, now(), 'bench'
FROM unnest(ARRAY['L15','L16','L17']) s;
INSERT INTO "OfficialSourceSnapshot"("id","stream","seq","artifactSha256","url","fetchedAt","integrity","parserVersion","stateHash","recordCounts","importedBy")
SELECT 'bench-' || s, 'AN_SCRUTINS_' || s, 1, md5(s) || md5(s || 'x'), 'https://example.test/' || s || '.zip', now(),
       'VERIFIED', 'bench', md5(s || 'state') || md5(s || 'state2'), '{}', 'bench'
FROM unnest(ARRAY['L15','L16','L17']) s;

-- Génère les attestations d'un flux : S scrutins, V votes, au plus 'per' votants par scrutin.
CREATE TEMP VIEW bench_rows AS SELECT 1 WHERE false; -- placeholder pour la lisibilité

\echo '=== A. avec les gardes, une transaction par flux (comme l importeur) ==='
\set legs '15 16 17'
BEGIN;
\echo 'L15'
INSERT INTO "ScrutinVoterAttestation"("stream","scrutinExternalId","officialId","fromSeq","scrutinDate","legislature","publishedOrganRef","publishedPosition","byDelegation","seatMandateRef","sourceMember","memberHash","rawHash")
SELECT 'AN_SCRUTINS_L15', 'VTANR5L15V' || sc, 'PA' || act, 1, DATE '2017-07-04' + (sc % 1500), 15, 'PO' || (act % 20),
       (ARRAY['pour','contre','abstention','nonVotant'])[1 + (n % 4)], false, 'PM' || n, 'json/VTANR5L15V' || sc || '.json',
       md5('m' || sc) || md5('M' || sc), md5('r' || n) || md5('R' || n)
FROM (SELECT n, ((n - 1) / 107) + 1 AS sc, ((n - 1) % 107) AS act FROM generate_series(1, 472631) n) g;
COMMIT;
BEGIN;
\echo 'L16'
INSERT INTO "ScrutinVoterAttestation"("stream","scrutinExternalId","officialId","fromSeq","scrutinDate","legislature","publishedOrganRef","publishedPosition","byDelegation","seatMandateRef","sourceMember","memberHash","rawHash")
SELECT 'AN_SCRUTINS_L16', 'VTANR5L16V' || sc, 'PA' || act, 1, DATE '2022-06-28' + (sc % 600), 16, 'PO' || (act % 20),
       (ARRAY['pour','contre','abstention','nonVotant'])[1 + (n % 4)], false, 'PM' || n, 'json/VTANR5L16V' || sc || '.json',
       md5('m' || sc) || md5('M' || sc), md5('r' || n) || md5('R' || n)
FROM (SELECT n, ((n - 1) / 147) + 1 AS sc, ((n - 1) % 147) AS act FROM generate_series(1, 602911) n) g;
COMMIT;
BEGIN;
\echo 'L17'
INSERT INTO "ScrutinVoterAttestation"("stream","scrutinExternalId","officialId","fromSeq","scrutinDate","legislature","publishedOrganRef","publishedPosition","byDelegation","seatMandateRef","sourceMember","memberHash","rawHash")
SELECT 'AN_SCRUTINS_L17', 'VTANR5L17V' || sc, 'PA' || act, 1, DATE '2024-07-18' + (sc % 450), 17, 'PO' || (act % 20),
       (ARRAY['pour','contre','abstention','nonVotant'])[1 + (n % 4)], false, 'PM' || n, 'json/VTANR5L17V' || sc || '.json',
       md5('m' || sc) || md5('M' || sc), md5('r' || n) || md5('R' || n)
FROM (SELECT n, ((n - 1) / 150) + 1 AS sc, ((n - 1) % 150) AS act FROM generate_series(1, 1323978) n) g;
COMMIT;

\echo '=== volumes ==='
SELECT count(*) AS attestations FROM "ScrutinVoterAttestation";
SELECT pg_size_pretty(pg_table_size('"ScrutinVoterAttestation"')) AS table_size,
       pg_size_pretty(pg_indexes_size('"ScrutinVoterAttestation"')) AS indexes_size,
       pg_size_pretty(pg_total_relation_size('"ScrutinVoterAttestation"')) AS total_size;
SELECT indexrelid::regclass AS index, pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_index WHERE indrelid = '"ScrutinVoterAttestation"'::regclass ORDER BY pg_relation_size(indexrelid) DESC;

ANALYZE "ScrutinVoterAttestation";
\echo '=== plans des lectures du résolveur ==='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) SELECT * FROM "ScrutinVoterAttestation" WHERE "stream" = 'AN_SCRUTINS_L17' AND "scrutinExternalId" = 'VTANR5L17V501' AND "toSeq" IS NULL;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) SELECT * FROM "ScrutinVoterAttestation" WHERE "stream" = 'AN_SCRUTINS_L17' AND "officialId" = 'PA42' AND "scrutinDate" BETWEEN DATE '2025-01-01' AND DATE '2025-03-01';
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) SELECT count(*) FROM "ScrutinVoterAttestation" WHERE "stream" = 'AN_SCRUTINS_L17' AND "publishedOrganRef" = 'PO7' AND "scrutinDate" >= DATE '2025-01-01';
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) SELECT * FROM "ScrutinVoterAttestation" WHERE "stream" = 'AN_SCRUTINS_L17' AND "scrutinExternalId" = 'VTANR5L17V501' AND "officialId" = 'PA42' AND "toSeq" IS NULL;

\echo '=== B. même insertion SANS gardes : transaction isolée, annulée ensuite (mesure du coût des gardes) ==='
BEGIN;
ALTER TABLE "ScrutinVoterAttestation" DISABLE TRIGGER USER;
INSERT INTO "ScrutinVoterAttestation"("stream","scrutinExternalId","officialId","fromSeq","scrutinDate","legislature","publishedOrganRef","publishedPosition","byDelegation","seatMandateRef","sourceMember","memberHash","rawHash")
SELECT 'AN_SCRUTINS_L16', 'BENCHV' || sc, 'PA' || act, 1, DATE '2022-06-28' + (sc % 600), 16, 'PO' || (act % 20),
       (ARRAY['pour','contre','abstention','nonVotant'])[1 + (n % 4)], false, 'PM' || n, 'json/BENCHV' || sc || '.json',
       md5('m' || sc) || md5('M' || sc), md5('r' || n) || md5('R' || n)
FROM (SELECT n, ((n - 1) / 147) + 1 AS sc, ((n - 1) % 147) AS act FROM generate_series(1, 602911) n) g;
ROLLBACK;
\echo '=== B'' même volume AVEC gardes (L16 de test, annulé) pour comparer à B ==='
BEGIN;
INSERT INTO "ScrutinVoterAttestation"("stream","scrutinExternalId","officialId","fromSeq","scrutinDate","legislature","publishedOrganRef","publishedPosition","byDelegation","seatMandateRef","sourceMember","memberHash","rawHash")
SELECT 'AN_SCRUTINS_L16', 'BENCHV' || sc, 'PA' || act, 1, DATE '2022-06-28' + (sc % 600), 16, 'PO' || (act % 20),
       (ARRAY['pour','contre','abstention','nonVotant'])[1 + (n % 4)], false, 'PM' || n, 'json/BENCHV' || sc || '.json',
       md5('m' || sc) || md5('M' || sc), md5('r' || n) || md5('R' || n)
FROM (SELECT n, ((n - 1) / 147) + 1 AS sc, ((n - 1) % 147) AS act FROM generate_series(1, 602911) n) g;
ROLLBACK;

\echo '=== C. correction rétroactive : 1 % des attestations de la L17 corrigées au snapshot 2 ==='
INSERT INTO "SnapshotDecision"("snapshotId","status","reason","decidedBy","decidedByKind") VALUES ('bench-L17','RELEASED','bench','bench','HUMAN');
INSERT INTO "SourceArtifact"("sha256","byteSize","mediaType","storageKind","storageRef","storedAt","storedBy")
VALUES (md5('L17b') || md5('L17bx'), 1000, 'application/zip', 'LOCAL_OFFLINE', 'bench/L17b', now(), 'bench');
INSERT INTO "OfficialSourceSnapshot"("id","stream","seq","artifactSha256","url","fetchedAt","integrity","parserVersion","stateHash","recordCounts","importedBy")
VALUES ('bench-L17-2', 'AN_SCRUTINS_L17', 2, md5('L17b') || md5('L17bx'), 'https://example.test/L17b.zip', now(), 'VERIFIED', 'bench', md5('s2') || md5('s2b'), '{}', 'bench');
BEGIN;
UPDATE "ScrutinVoterAttestation" SET "toSeq" = 2
WHERE "stream" = 'AN_SCRUTINS_L17' AND "toSeq" IS NULL AND "scrutinExternalId" IN (SELECT 'VTANR5L17V' || g FROM generate_series(1, 89) g);
INSERT INTO "ScrutinVoterAttestation"("stream","scrutinExternalId","officialId","fromSeq","scrutinDate","legislature","publishedOrganRef","publishedPosition","byDelegation","seatMandateRef","sourceMember","memberHash","rawHash")
SELECT "stream","scrutinExternalId","officialId",2,"scrutinDate","legislature",'PO99',"publishedPosition","byDelegation","seatMandateRef","sourceMember","memberHash", md5('corrected' || "seatMandateRef") || md5('c2' || "seatMandateRef")
FROM "ScrutinVoterAttestation" WHERE "stream" = 'AN_SCRUTINS_L17' AND "toSeq" = 2;
COMMIT;
SELECT count(*) FILTER (WHERE "toSeq" IS NULL) AS active, count(*) FILTER (WHERE "toSeq" IS NOT NULL) AS closed, count(*) AS versions FROM "ScrutinVoterAttestation" WHERE "stream" = 'AN_SCRUTINS_L17';

\echo '=== D. état au snapshot S : lecture d un scrutin à la version 1 et à la version 2 ==='
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF) SELECT count(*) FROM "ScrutinVoterAttestation" WHERE "stream" = 'AN_SCRUTINS_L17' AND "scrutinExternalId" = 'VTANR5L17V10' AND "fromSeq" <= 1 AND ("toSeq" IS NULL OR 1 < "toSeq");
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF) SELECT count(*) FROM "ScrutinVoterAttestation" WHERE "stream" = 'AN_SCRUTINS_L17' AND "scrutinExternalId" = 'VTANR5L17V10' AND "fromSeq" <= 2 AND ("toSeq" IS NULL OR 2 < "toSeq");

\echo '=== tailles finales de toutes les tables ==='
SELECT relname, reltuples::bigint AS approx_rows, pg_size_pretty(pg_total_relation_size(oid)) AS total
FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY pg_total_relation_size(oid) DESC;
