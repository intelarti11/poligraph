-- Rollback of 2026-10-21-historical-groups-public-read.sql: drops the three views. No data is
-- touched, the views hold none.
BEGIN;
DROP VIEW IF EXISTS "HistoricalScrutinPublicStatus";
DROP VIEW IF EXISTS "HistoricalGroupPositionPublic";
DROP VIEW IF EXISTS "HistoricalPublishedRun";
COMMIT;
