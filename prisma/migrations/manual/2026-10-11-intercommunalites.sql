-- Intercommunalités et appartenances datées des communes (#1052, lot 1.8).
--
-- Ajouts uniquement : un type énuméré et deux tables neuves, aucune donnée existante lue ni
-- réécrite. Remplies ensuite par `npm run sync:intercommunalites` (fichiers INSEE au 1er janvier).
-- La RLS est posée par l'event trigger à la création des tables.

-- CreateEnum
CREATE TYPE "IntercommunaliteNature" AS ENUM ('CC', 'CA', 'CU', 'METRO', 'MET69', 'EPT');

-- CreateTable
CREATE TABLE "Intercommunalite" (
    "siren" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nature" "IntercommunaliteNature" NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "situationDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Intercommunalite_pkey" PRIMARY KEY ("siren")
);

-- CreateTable
CREATE TABLE "CommuneIntercommunalite" (
    "id" TEXT NOT NULL,
    "communeId" TEXT NOT NULL,
    "siren" TEXT,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "sourceLabel" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "situationDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommuneIntercommunalite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommuneIntercommunalite_siren_idx" ON "CommuneIntercommunalite"("siren");

-- CreateIndex
CREATE UNIQUE INDEX "CommuneIntercommunalite_communeId_siren_validFrom_key" ON "CommuneIntercommunalite"("communeId", "siren", "validFrom");

-- AddForeignKey
ALTER TABLE "CommuneIntercommunalite" ADD CONSTRAINT "CommuneIntercommunalite_communeId_fkey" FOREIGN KEY ("communeId") REFERENCES "Commune"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommuneIntercommunalite" ADD CONSTRAINT "CommuneIntercommunalite_siren_fkey" FOREIGN KEY ("siren") REFERENCES "Intercommunalite"("siren") ON DELETE RESTRICT ON UPDATE CASCADE;

