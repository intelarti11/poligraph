-- Résultats de la présidentielle par commune (issue #1052, lot 1.9).
--
-- Table neuve, additive : aucune donnée existante n'est lue ni réécrite. La participation
-- par commune va dans "CommuneElectionRound", déjà en place.
--
-- Empreinte estimée pour 2022 (12 candidats au 1er tour, 2 au 2d, 34 942 communes
-- rapprochées) : 489 188 lignes (419 304 au 1er tour, 69 884 au 2d). Ligne mesurée à 64
-- octets (pg_column_size) : environ 33 Mo de table, 26 Mo de clé primaire et quelques Mo
-- pour l'index (candidacyId, round), dédupliqué. Soit 1,5 % de la base (4,1 Go).
-- "CommuneElectionRound" gagne 69 884 lignes, environ 22 Mo au ratio actuel de la table.
--
-- À appliquer avant le premier import (npm run sync:presidentielle-communes). Le code
-- déployé fonctionne sans cette table tant qu'aucun import n'a eu lieu : la page ne lit
-- la table qu'après avoir trouvé une participation présidentielle pour la commune.

CREATE TABLE IF NOT EXISTS "CommuneCandidacyResult" (
    "communeId" TEXT NOT NULL,
    "candidacyId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "votes" INTEGER NOT NULL,

    CONSTRAINT "CommuneCandidacyResult_pkey" PRIMARY KEY ("communeId","candidacyId","round")
);

CREATE INDEX IF NOT EXISTS "CommuneCandidacyResult_candidacyId_round_idx"
    ON "CommuneCandidacyResult"("candidacyId", "round");

ALTER TABLE "CommuneCandidacyResult" ADD CONSTRAINT "CommuneCandidacyResult_communeId_fkey"
    FOREIGN KEY ("communeId") REFERENCES "Commune"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommuneCandidacyResult" ADD CONSTRAINT "CommuneCandidacyResult_candidacyId_fkey"
    FOREIGN KEY ("candidacyId") REFERENCES "Candidacy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
