/**
 * Remove the duplicate SENAT mandate rows created by the 2026-02-16 legacy sync.
 *
 * The bad batch has an exact signature: a SENAT-sourced closed SENATEUR row, opened on
 * 2020-10-01, closed on 2026-02-15, created on 2026-02-16, with no senateSeries, and a
 * sibling mandate on the same politician carrying the same Senate matricule. The Senate
 * profile for Yannick Jadot confirms his actual election on 2023-09-24; his valid mandate
 * starts on 2023-10-01. This script checks the whole cohort before deleting any row.
 *
 * Dry-run by default. Apply only against the reviewed production dataset:
 *   npx tsx --env-file=.env scripts/cleanup-duplicate-senate-mandates.ts --apply
 */

import "dotenv/config";
import { DataSource, MandateType } from "../src/generated/prisma";
import { db } from "../src/lib/db";
import { requestProfileRefresh } from "../src/lib/politicians/profile-snapshot/request";

const EXPECTED_ROWS = 26;
const START_DATE = new Date("2020-10-01T00:00:00.000Z");
const END_DAY_START = new Date("2026-02-15T00:00:00.000Z");
const END_DAY_NEXT = new Date("2026-02-16T00:00:00.000Z");
const CREATED_DAY_START = new Date("2026-02-16T00:00:00.000Z");
const CREATED_DAY_NEXT = new Date("2026-02-17T00:00:00.000Z");

const signature = {
  type: MandateType.SENATEUR,
  source: DataSource.SENAT,
  isCurrent: false,
  senateSeries: null,
  startDate: START_DATE,
  endDate: { gte: END_DAY_START, lt: END_DAY_NEXT },
  createdAt: { gte: CREATED_DAY_START, lt: CREATED_DAY_NEXT },
};

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const rows = await db.mandate.findMany({
    where: signature,
    select: {
      id: true,
      politicianId: true,
      externalId: true,
      title: true,
      startDate: true,
      endDate: true,
      createdAt: true,
      politician: {
        select: {
          slug: true,
          fullName: true,
          mandates: {
            select: { id: true, type: true, externalId: true, isCurrent: true },
          },
        },
      },
    },
    orderBy: [{ politician: { fullName: "asc" } }, { id: "asc" }],
  });

  const candidates = rows.filter(
    (row) =>
      row.externalId !== null &&
      row.politician.mandates.some(
        (sibling) =>
          sibling.id !== row.id &&
          sibling.type === MandateType.SENATEUR &&
          sibling.externalId === row.externalId
      )
  );

  if (rows.length !== EXPECTED_ROWS || candidates.length !== EXPECTED_ROWS) {
    throw new Error(
      `Safety check failed: signature matched ${rows.length} rows, ${candidates.length} with a same-person Senate matricule; expected ${EXPECTED_ROWS}. No rows changed.`
    );
  }

  const summary = candidates.map((row) => ({
    id: row.id,
    politicianId: row.politicianId,
    slug: row.politician.slug,
    name: row.politician.fullName,
    externalId: row.externalId,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));

  console.info(JSON.stringify({ mode: apply ? "apply" : "dry-run", count: summary.length, rows: summary }, null, 2));
  if (!apply) {
    console.info("Dry-run only. Pass --apply to delete these verified duplicate rows.");
    return;
  }

  const ids = candidates.map((row) => row.id);
  const politicianIds = [...new Set(candidates.map((row) => row.politicianId))];

  const deleted = await db.$transaction(async (tx) => {
    const stillMatching = await tx.mandate.findMany({
      where: { ...signature, id: { in: ids } },
      select: { id: true, politicianId: true, externalId: true },
    });
    if (stillMatching.length !== EXPECTED_ROWS) {
      throw new Error(
        `Safety check failed inside transaction: found ${stillMatching.length} of ${EXPECTED_ROWS} reviewed rows. No rows changed.`
      );
    }

    const siblingRows = await tx.mandate.findMany({
      where: {
        id: { notIn: ids },
        politicianId: { in: politicianIds },
        type: MandateType.SENATEUR,
        externalId: { in: candidates.map((row) => row.externalId!).filter(Boolean) },
      },
      select: { politicianId: true, externalId: true },
    });
    const siblingKeys = new Set(siblingRows.map((row) => `${row.politicianId}:${row.externalId}`));
    if (
      stillMatching.some(
        (row) => row.externalId === null || !siblingKeys.has(`${row.politicianId}:${row.externalId}`)
      )
    ) {
      throw new Error("Safety check failed inside transaction: a duplicate has no remaining Senate sibling. No rows changed.");
    }

    const result = await tx.mandate.deleteMany({ where: { id: { in: ids } } });
    if (result.count !== EXPECTED_ROWS) {
      throw new Error(`Expected to delete ${EXPECTED_ROWS} rows, deleted ${result.count}. Transaction rolled back.`);
    }
    return result.count;
  });

  const refresh = await requestProfileRefresh(
    { politicianIds },
    "cleanup:duplicate-senate-mandates-2026-02"
  );
  console.info(JSON.stringify({ deleted, profilesToRefresh: politicianIds.length, refresh }));

  if (refresh.sent === 0) {
    throw new Error(
      "The duplicate rows were deleted, but profile refresh was not queued. Run the profile snapshot reconcile before considering the cleanup complete."
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error("Senate mandate cleanup failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
