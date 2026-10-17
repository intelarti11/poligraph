-- AnOrgan: official AN referential of parliamentary groups (additive, new table only).
-- Run manually: npx prisma db execute --file prisma/migrations/manual/add_an_organ.sql
-- (uses DIRECT_URL). Do NOT db:push: its diff carries DROP INDEX on the pgvector index.
-- Same DDL as `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`.
-- Row Level Security is enabled by the enable_rls_on_create event trigger.

CREATE TABLE IF NOT EXISTS "AnOrgan" (
    "organeRef" TEXT NOT NULL,
    "legislature" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "abbreviation" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "sourceUrl" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnOrgan_pkey" PRIMARY KEY ("organeRef")
);

CREATE INDEX IF NOT EXISTS "AnOrgan_legislature_idx" ON "AnOrgan"("legislature");
