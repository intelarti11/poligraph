-- Enables the flags that widen the global header, so the responsive guard always measures
-- its worst case: `STATISTIQUES_SECTION` adds a labelled primary link, `PROGRAMMES_ENABLED`
-- a mobile link and a line in the election panel, `BOUSSOLE_ENABLED` an icon to the tool
-- rail, and `ELECTION_SPOTLIGHT` the election pill, which only shows for an Election row that
-- exists, hence the row inserted below.
--
-- Without this the guard reads whatever the database behind the dev server happens to
-- hold, and a narrower header would pass while proving nothing.
--
-- Meant for a disposable database. Used by the `header-responsive` CI job, and by anyone
-- reproducing it locally:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/visual/fixtures/header-flags.sql
--
-- `id` and `updatedAt` are supplied explicitly: Prisma generates the first with `cuid()`
-- and maintains the second with `@updatedAt`, both client-side, so neither has a database
-- default an INSERT could fall back on.
INSERT INTO "FeatureFlag" ("id", "name", "label", "enabled", "updatedAt")
VALUES
  ('seed-statistiques-section', 'STATISTIQUES_SECTION', 'Section Statistiques', true, NOW()),
  ('seed-programmes-enabled', 'PROGRAMMES_ENABLED', 'Section Programmes', true, NOW()),
  ('seed-boussole-enabled', 'BOUSSOLE_ENABLED', 'Boussole politique', true, NOW())
ON CONFLICT ("name") DO UPDATE SET "enabled" = true, "updatedAt" = NOW();

INSERT INTO "Election" ("id", "slug", "type", "title", "scope", "updatedAt")
VALUES ('seed-presidentielle-2027', 'presidentielle-2027', 'PRESIDENTIELLE', 'Présidentielle 2027', 'NATIONAL', NOW())
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "FeatureFlag" ("id", "name", "label", "enabled", "value", "updatedAt")
VALUES (
  'seed-election-spotlight', 'ELECTION_SPOTLIGHT', 'Élection mise en avant', true,
  '{"slug": "presidentielle-2027"}'::jsonb, NOW()
)
ON CONFLICT ("name") DO UPDATE
  SET "enabled" = true, "value" = EXCLUDED."value", "updatedAt" = NOW();
