-- Membres des conseils municipaux, départementaux et régionaux (ConseilMembre), #1052.
--
-- Migration additive : un type et une table neufs, aucune table existante touchée.
-- La RLS est posée par l'event trigger de création de table.
-- Remplissage ensuite par : npm run sync:conseils -- --dry-run, puis npm run sync:conseils
-- CreateEnum
CREATE TYPE "ConseilNiveau" AS ENUM ('MUNICIPAL', 'DEPARTEMENTAL', 'REGIONAL');

-- CreateTable
CREATE TABLE "ConseilMembre" (
    "id" TEXT NOT NULL,
    "niveau" "ConseilNiveau" NOT NULL,
    "territoryCode" TEXT NOT NULL,
    "subdivisionCode" TEXT,
    "subdivisionLabel" TEXT,
    "lastName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "gender" TEXT,
    "mandateStart" DATE,
    "functionLabel" TEXT,
    "functionStart" DATE,
    "rowKey" TEXT NOT NULL,
    "registerDate" DATE,
    "sourceUrl" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConseilMembre_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConseilMembre_niveau_rowKey_key" ON "ConseilMembre"("niveau", "rowKey");

-- CreateIndex
CREATE INDEX "ConseilMembre_niveau_territoryCode_idx" ON "ConseilMembre"("niveau", "territoryCode");

-- Row Level Security : idempotent, au cas où l'event trigger de création de table serait absent.
-- Aucune politique : la table reste fermée à anon, l'application lit en rôle postgres.
ALTER TABLE "ConseilMembre" ENABLE ROW LEVEL SECURITY;
