-- Décisions curées de la rubrique Territoires (#1052, lot 2) : Institution, TerritorialSource,
-- Decision.
--
-- Migration additive : trois tables et quatre énumérations neuves, aucune colonne existante
-- modifiée. Les noms sont ceux que Prisma génère, pour qu'un `prisma migrate diff` ne voie
-- aucune dérive. La RLS est posée par l'event trigger à la création des tables ; aucune
-- politique de lecture anon n'est ajoutée : le site lit via Prisma, et une table sans politique
-- reste fermée au rôle anon.
--
-- Les deux contraintes CHECK sur les URL ne sont pas déclarées dans schema.prisma (Prisma ne
-- les modélise pas) : elles doublent côté base la validation http/https des routes admin.
--
-- Pas de bloc DO (SEC-06). Le fichier s'exécute une seule fois, dans une transaction : rejoué,
-- il échoue au premier CREATE TYPE sans rien modifier.
--
-- À exécuter avec `npx prisma db execute --file prisma/migrations/manual/2026-10-11_territoires-decisions.sql`
-- (pas de db:push : le diff porterait la suppression de l'index HNSW). .env pointe sur la
-- production.

BEGIN;
-- CreateEnum
CREATE TYPE "CurationStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InstitutionKind" AS ENUM ('CONSEIL_MUNICIPAL', 'CONSEIL_COMMUNAUTAIRE');

-- CreateEnum
CREATE TYPE "TerritorialSourceKind" AS ENUM ('DELIBERATION', 'PROCES_VERBAL', 'LISTE_DELIBERATIONS', 'RECUEIL_ACTES_ADMINISTRATIFS');

-- CreateEnum
CREATE TYPE "DecisionOutcome" AS ENUM ('ADOPTEE', 'REJETEE');

-- CreateTable
CREATE TABLE "Institution" (
    "id" TEXT NOT NULL,
    "kind" "InstitutionKind" NOT NULL,
    "name" TEXT NOT NULL,
    "communeId" TEXT,
    "sirenEpci" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerritorialSource" (
    "id" TEXT NOT NULL,
    "kind" "TerritorialSourceKind" NOT NULL,
    "title" TEXT NOT NULL,
    "producer" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "archiveUrl" TEXT,
    "documentDate" DATE,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TerritorialSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "communeId" TEXT NOT NULL,
    "reference" TEXT,
    "title" TEXT NOT NULL,
    "adoptionDate" DATE NOT NULL,
    "adoptionDatePrecision" "DatePrecision" NOT NULL DEFAULT 'DAY',
    "publicationDate" DATE,
    "effectiveDate" DATE,
    "outcome" "DecisionOutcome" NOT NULL,
    "outcomeWording" TEXT,
    "sourceId" TEXT NOT NULL,
    "sourceLocator" TEXT NOT NULL,
    "status" "CurationStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Institution_kind_communeId_key" ON "Institution"("kind", "communeId");

-- CreateIndex
CREATE UNIQUE INDEX "Institution_kind_sirenEpci_key" ON "Institution"("kind", "sirenEpci");

-- CreateIndex
CREATE INDEX "Decision_communeId_status_adoptionDate_idx" ON "Decision"("communeId", "status", "adoptionDate");

-- CreateIndex
CREATE INDEX "Decision_institutionId_status_adoptionDate_idx" ON "Decision"("institutionId", "status", "adoptionDate");

-- CreateIndex
CREATE INDEX "Decision_status_updatedAt_idx" ON "Decision"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Decision_sourceId_idx" ON "Decision"("sourceId");

-- AddForeignKey
ALTER TABLE "Institution" ADD CONSTRAINT "Institution_communeId_fkey" FOREIGN KEY ("communeId") REFERENCES "Commune"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_communeId_fkey" FOREIGN KEY ("communeId") REFERENCES "Commune"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "TerritorialSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- URL de source : http ou https uniquement (doublon base de la validation applicative)
ALTER TABLE "TerritorialSource" ADD CONSTRAINT "TerritorialSource_url_http_check"
  CHECK ("url" ~ '^https?://');
ALTER TABLE "TerritorialSource" ADD CONSTRAINT "TerritorialSource_archiveUrl_http_check"
  CHECK ("archiveUrl" IS NULL OR "archiveUrl" ~ '^https?://');

COMMIT;
