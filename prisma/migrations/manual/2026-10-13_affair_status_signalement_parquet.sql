-- Statut d'affaire « Signalement au parquet » : un signalement (article 40) est transmis, aucune enquête n'est connue.
-- Additive: the deployed code never reads the value until an affair carries it, so this must run
-- BEFORE the code is deployed and the code must be deployed BEFORE any affair is moved to it.
-- ADD VALUE cannot run inside a transaction block that then uses the value: no BEGIN here.
-- Run with: npx prisma db execute --file prisma/migrations/manual/2026-10-13_affair_status_signalement_parquet.sql

ALTER TYPE "AffairStatus" ADD VALUE IF NOT EXISTS 'SIGNALEMENT_PARQUET' AFTER 'PLAINTE_DEPOSEE';
