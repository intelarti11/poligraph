-- Lot 5C-0 : retour arrière des tables de cohérence des décomptes. NON EXÉCUTÉ en préproduction ni en production.
--
-- Ne supprime que les deux tables de ce lot, et seulement si elles sont vides. Dès qu'une ligne existe,
-- une requête échoue avant tout DROP, la transaction est annulée et rien n'est touché : on n'efface
-- jamais une preuve. Le schéma du lot 5B (fonctions de garde comprises) n'est pas touché : son propre
-- retour arrière est 2026-10-18-historical-groups-schema-rollback.sql, à lancer APRÈS celui-ci.
-- Si une table manque, le script échoue aussi : il n'y a rien à défaire, ou le schéma n'est pas celui du lot.
-- SQL simple, sans bloc DO ni SQL dynamique (contrat SEC-06 du dépôt).
--   npx prisma db execute --file prisma/migrations/manual/2026-10-19-historical-groups-count-check-rollback.sql

BEGIN;

-- Chaque requête échoue (CAST d'un texte en entier) si sa table contient au moins une ligne.
SELECT CAST(string_agg('ScrutinCountCheck holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.', '') AS integer)
FROM "ScrutinCountCheck";
SELECT CAST(string_agg('ScrutinGroupCountCheck holds rows: no rollback, nothing was dropped. Revoke the snapshot instead.', '') AS integer)
FROM "ScrutinGroupCountCheck";

DROP TABLE "ScrutinGroupCountCheck";
DROP TABLE "ScrutinCountCheck";

COMMIT;
