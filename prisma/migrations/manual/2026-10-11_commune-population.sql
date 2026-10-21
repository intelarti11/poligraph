-- Populations de référence millésimées des communes (CommunePopulation), lot 1.7 Territoires.
--
-- Migration additive : une table neuve, aucune colonne existante modifiée ni supprimée.
-- La RLS est posée par l'event trigger de création de table.
-- Remplissage ensuite par : npm run sync:populations -- --dry-run, puis npm run sync:populations
-- CreateTable
CREATE TABLE "CommunePopulation" (
    "id" TEXT NOT NULL,
    "communeId" TEXT NOT NULL,
    "millesime" INTEGER NOT NULL,
    "populationMunicipale" INTEGER NOT NULL,
    "populationCompteeAPart" INTEGER,
    "populationTotale" INTEGER,
    "effectiveFrom" DATE NOT NULL,
    "producer" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunePopulation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommunePopulation_communeId_effectiveFrom_idx" ON "CommunePopulation"("communeId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "CommunePopulation_communeId_millesime_key" ON "CommunePopulation"("communeId", "millesime");

-- AddForeignKey
ALTER TABLE "CommunePopulation" ADD CONSTRAINT "CommunePopulation_communeId_fkey" FOREIGN KEY ("communeId") REFERENCES "Commune"("id") ON DELETE CASCADE ON UPDATE CASCADE;

