-- Lot 6: public read layer for the historical group positions (AN, legislatures 15 to 17).
--
-- NOT APPLIED. A review deliverable: the lot owner decides when and where it runs
-- (prisma db execute --file), never through db:push. It changes no existing table: it adds three
-- views, which hold no data of their own.
--
-- Read contract
--  - The raw tables stay closed to anon and authenticated (RLS, no policy). These views are the only
--    path meant for the application. They run with the rights of the table owner (ordinary views,
--    not security_invoker), so RLS does not apply to them: the definition of the views carries the
--    whole read policy.
--  - Only the owner (the application role) reads them. No GRANT is given: not PUBLIC, not anon, not
--    authenticated, not the hg_* roles. Supabase grants new objects of the public schema to anon and
--    authenticated by default, so the REVOKE below is essential, and the last section makes the
--    script fail if any privilege is left.
--  - A run is readable only when it is COMPLETED and EVERY snapshot it pins is VERIFIED, carries the
--    pinned state hash, and has RELEASED as its latest decision (so neither QUARANTINED nor
--    REVOKED). A revocation takes the run out of the read path with no other gesture.
--  - A position is read only when it is publishable AND has no excluded vote AND belongs to a named
--    group. No majority position is computed here.
--  - The views carry no hash, no run id, no person id, no evidence and no decision: one row per group
--    and scrutin, or one row per scrutin.
--  - "publishable" is a technical status. The decision to show it publicly is editorial and lives in
--    code (src/config/historical-positions.ts), not in these views.
--
-- Rollback: 2026-10-21-historical-groups-public-read-rollback.sql.

BEGIN;

-- 1. Publishable run per legislature: the most recent completed run whose pinned snapshots are all
--    verified, intact and released. Internal view, never read directly by the application.
CREATE VIEW "HistoricalPublishedRun" WITH (security_barrier = true) AS
SELECT DISTINCT ON (l."legislature")
  r."id" AS "runId",
  l."legislature"
FROM "HistoricalResolutionRun" r
CROSS JOIN LATERAL (
  SELECT (r."config" -> 'scope' -> 'legislatures' ->> 0)::int AS "legislature"
) l
WHERE r."status" = 'COMPLETED'
  AND jsonb_typeof(r."config" -> 'scope' -> 'legislatures') = 'array'
  AND jsonb_array_length(r."config" -> 'scope' -> 'legislatures') = 1
  AND EXISTS (SELECT 1 FROM "HistoricalRunSnapshotPin" p WHERE p."runId" = r."id")
  AND NOT EXISTS (
    SELECT 1
    FROM "HistoricalRunSnapshotPin" p
    LEFT JOIN "OfficialSourceSnapshot" s ON s."stream" = p."stream" AND s."seq" = p."seq"
    WHERE p."runId" = r."id"
      AND NOT (
        s."id" IS NOT NULL
        AND s."integrity" = 'VERIFIED'
        AND s."stateHash" = p."stateHash"
        AND (
          SELECT d."status"
          FROM "SnapshotDecision" d
          WHERE d."snapshotId" = s."id"
          ORDER BY d."decidedAt" DESC, d."decisionNo" DESC
          LIMIT 1
        ) = 'RELEASED'
      )
  )
ORDER BY l."legislature", r."finishedAt" DESC, r."id" DESC;

-- 2. Presentable positions: a named group, with no excluded vote, from a scrutin whose totals agree.
CREATE VIEW "HistoricalGroupPositionPublic" WITH (security_barrier = true) AS
SELECT
  pr."legislature",
  p."scrutinExternalId",
  p."organRef",
  o."label" AS "organLabel",
  o."abbreviation" AS "organAbbreviation",
  p."forCount",
  p."againstCount",
  p."abstainCount",
  p."nonVoterCount",
  EXISTS (
    SELECT 1
    FROM "AnOrgan" o2
    WHERE o2."legislature" = o."legislature"
      AND o2."abbreviation" IS NOT NULL
      AND o2."abbreviation" = o."abbreviation"
      AND o2."organeRef" <> o."organeRef"
  ) AS "sameAbbreviationElsewhere"
FROM "HistoricalPublishedRun" pr
JOIN "ScrutinOrganPosition" p ON p."runId" = pr."runId"
JOIN "AnOrgan" o ON o."organeRef" = p."organRef" AND o."legislature" = pr."legislature"
WHERE p."publishable"
  AND p."reason" IS NULL
  AND p."organKind" = 'GROUP'
  AND p."excludedCount" = 0;

-- 3. Publication state of a scrutin: what is needed to explain what is not shown, without exposing a
--    single vote or a single person. Counts and group names, nothing else.
CREATE VIEW "HistoricalScrutinPublicStatus" WITH (security_barrier = true) AS
SELECT
  b."legislature",
  b."scrutinExternalId",
  COALESCE(cc."countCoherence", 'COUNT_COHERENCE_UNKNOWN') AS "countCoherence",
  count(*) FILTER (
    WHERE b."publishable" AND b."reason" IS NULL AND b."organKind" = 'GROUP'
      AND b."excludedCount" = 0 AND b."label" IS NOT NULL
  )::int AS "groupsShown",
  count(*) FILTER (
    WHERE b."organKind" = 'GROUP'
      AND NOT (b."publishable" AND b."reason" IS NULL AND b."excludedCount" = 0 AND b."label" IS NOT NULL)
  )::int AS "groupsWithheld",
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'label', b."label",
        'abbreviation', b."abbreviation",
        'reason', COALESCE(b."reason", 'UNLABELLED_GROUP')
      )
      ORDER BY b."label"
    ) FILTER (
      WHERE b."organKind" = 'GROUP' AND b."label" IS NOT NULL
        AND NOT (b."publishable" AND b."reason" IS NULL AND b."excludedCount" = 0)
        -- Group-level reasons only. COUNT_MISMATCH, COUNT_UNVERIFIABLE and COUNT_COHERENCE_UNKNOWN
        -- describe the whole scrutin, which "countCoherence" already says; listing them per group
        -- made the reader refuse the row of every discordant scrutin.
        AND COALESCE(b."reason", 'UNLABELLED_GROUP') IN
          ('EXCLUDED_VOTES_PRESENT', 'NO_ATTESTED_VOTE', 'UNLABELLED_GROUP')
    ),
    '[]'::jsonb
  ) AS "withheldGroups",
  COALESCE(sum(b."votes") FILTER (WHERE b."organKind" = 'NON_INSCRIT'), 0)::int AS "nonInscritVotes",
  COALESCE(sum((b."excludedByReason" ->> 'CONFLICT')::int), 0)::int AS "excludedConflictVotes",
  COALESCE(sum((b."excludedByReason" ->> 'PO0')::int), 0)::int AS "excludedUnknownGroupVotes",
  amo."url" AS "affiliationsUrl",
  amo."fetchedAt" AS "affiliationsFetchedAt",
  amo."sourceAsOf" AS "affiliationsAsOf",
  sc."url" AS "scrutinsUrl",
  sc."fetchedAt" AS "scrutinsFetchedAt"
FROM (
  -- One reference only: the planner can then push the scrutin filter into this subquery instead of
  -- materialising every position of the run (about 175 000 rows) for each page.
  SELECT
    pr."legislature",
    pr."runId",
    p."scrutinExternalId",
    p."organKind",
    p."publishable",
    p."reason",
    p."forCount" + p."againstCount" + p."abstainCount" + p."nonVoterCount" AS "votes",
    p."excludedCount",
    p."excludedByReason",
    o."label",
    o."abbreviation"
  FROM "HistoricalPublishedRun" pr
  JOIN "ScrutinOrganPosition" p ON p."runId" = pr."runId"
  LEFT JOIN "AnOrgan" o ON o."organeRef" = p."organRef" AND o."legislature" = pr."legislature"
) b
LEFT JOIN LATERAL (
  SELECT c."countCoherence"
  FROM "HistoricalRunSnapshotPin" pin
  JOIN "ScrutinCountCheck" c
    ON c."stream" = pin."stream"
   AND c."scrutinExternalId" = b."scrutinExternalId"
   AND c."fromSeq" <= pin."seq"
   AND (c."toSeq" IS NULL OR c."toSeq" > pin."seq")
  WHERE pin."runId" = b."runId" AND pin."stream" LIKE 'AN\_SCRUTINS\_%'
  LIMIT 1
) cc ON true
LEFT JOIN LATERAL (
  SELECT s."url", s."fetchedAt", s."sourceAsOf"
  FROM "HistoricalRunSnapshotPin" pin
  JOIN "OfficialSourceSnapshot" s ON s."stream" = pin."stream" AND s."seq" = pin."seq"
  WHERE pin."runId" = b."runId" AND pin."stream" = 'AN_AMO30'
  LIMIT 1
) amo ON true
LEFT JOIN LATERAL (
  SELECT s."url", s."fetchedAt"
  FROM "HistoricalRunSnapshotPin" pin
  JOIN "OfficialSourceSnapshot" s ON s."stream" = pin."stream" AND s."seq" = pin."seq"
  WHERE pin."runId" = b."runId" AND pin."stream" LIKE 'AN\_SCRUTINS\_%'
  LIMIT 1
) sc ON true
GROUP BY b."legislature", b."runId", b."scrutinExternalId", cc."countCoherence",
         amo."url", amo."fetchedAt", amo."sourceAsOf", sc."url", sc."fetchedAt";

-- 4. Rights: nobody but the owner.
REVOKE ALL ON TABLE "HistoricalPublishedRun", "HistoricalGroupPositionPublic", "HistoricalScrutinPublicStatus"
  FROM PUBLIC, anon, authenticated;

-- 5. Self-check: the script fails if a view is readable by PUBLIC, anon or authenticated, or if row
--    level security has been switched off on a raw table. No DO block here (the SEC-06 guard allows
--    none outside its own migration): a failed cast of the message to int aborts the transaction and
--    carries the message in the error text.
SELECT CASE
  WHEN n > 0 THEN ('public read views: ' || n || ' privilege(s) left to PUBLIC, anon or authenticated')::int
  ELSE 0
END AS "privileges_ok"
FROM (
  SELECT count(*) AS n
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) x
  LEFT JOIN pg_roles r ON r.oid = x.grantee
  WHERE ns.nspname = 'public'
    AND c.relname IN ('HistoricalPublishedRun', 'HistoricalGroupPositionPublic', 'HistoricalScrutinPublicStatus')
    AND (x.grantee = 0 OR r.rolname IN ('anon', 'authenticated'))
) leak;

SELECT CASE
  WHEN n > 0 THEN ('public read views: row level security is off on ' || n || ' raw table(s)')::int
  ELSE 0
END AS "rls_ok"
FROM (
  SELECT count(*) AS n
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public'
    AND c.relname IN ('ScrutinOrganPosition', 'HistoricalResolutionRun', 'HistoricalRunSnapshotPin',
                      'OfficialSourceSnapshot', 'SnapshotDecision', 'ScrutinCountCheck', 'RunExclusion')
    AND NOT c.relrowsecurity
) open_tables;

COMMIT;
