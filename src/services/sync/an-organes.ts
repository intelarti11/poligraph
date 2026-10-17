/**
 * Imports the official AN referential of parliamentary groups into AnOrgan.
 *
 * Manual, additive and independent from every other sync: it only reads the public AMO30
 * archive and only upserts into AnOrgan, in a single transaction after the whole archive has been
 * validated. It is not part of the daily sync.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { db } from "@/lib/db";
import { extractZip } from "@/lib/parsing/unzip";
import {
  isBlockingSkip,
  parseAnOrgan,
  validateAnOrganRows,
  type AnOrganRow,
  type AnOrganSkipReason,
} from "@/lib/parlement/an-organes";

/** The 17th legislature archive holds the organs of the 12th to the 17th. */
export const AN_ORGANES_SOURCE_URL =
  "https://data.assemblee-nationale.fr/static/openData/repository/17/amo/tous_acteurs_mandats_organes_xi_legislature/AMO30_tous_acteurs_tous_mandats_tous_organes_historique.json.zip";

export const AN_ORGANES_LEGISLATURES = [15, 16, 17] as const;

export interface AnOrganesSyncStats {
  filesRead: number;
  groupsFound: number;
  written: number;
  skipped: Partial<Record<AnOrganSkipReason, number>>;
  unreadable: number;
  errors: string[];
}

export async function syncAnOrganes(dryRun = false): Promise<AnOrganesSyncStats> {
  const stats: AnOrganesSyncStats = {
    filesRead: 0,
    groupsFound: 0,
    written: 0,
    skipped: {},
    unreadable: 0,
    errors: [],
  };

  const tempDir = mkdtempSync(path.join(tmpdir(), "an-organes-"));
  try {
    const response = await fetch(AN_ORGANES_SOURCE_URL);
    if (!response.ok) {
      stats.errors.push(`HTTP ${response.status} for ${AN_ORGANES_SOURCE_URL}`);
      return stats;
    }
    const fetchedAt = new Date();
    const zipPath = path.join(tempDir, "organes.zip");
    writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));
    extractZip(zipPath, tempDir);

    const organDir = path.join(tempDir, "json", "organe");
    const rows: AnOrganRow[] = [];
    for (const file of readdirSync(organDir).filter((name) => name.endsWith(".json"))) {
      stats.filesRead++;
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(path.join(organDir, file), "utf8"));
      } catch {
        stats.unreadable++;
        continue;
      }
      const result = parseAnOrgan(raw, AN_ORGANES_LEGISLATURES);
      if ("row" in result) rows.push(result.row);
      else stats.skipped[result.skipped] = (stats.skipped[result.skipped] ?? 0) + 1;
    }
    stats.groupsFound = rows.length;

    // Validate the whole archive before the first write: a partial referential must never
    // replace a complete one, so anything that may hide a group stops the import.
    if (stats.unreadable > 0) stats.errors.push(`${stats.unreadable} unreadable organ file(s)`);
    for (const [reason, count] of Object.entries(stats.skipped)) {
      if (isBlockingSkip(reason as AnOrganSkipReason)) {
        stats.errors.push(`${count} organ(s) skipped for a blocking reason: ${reason}`);
      }
    }
    stats.errors.push(...validateAnOrganRows(rows, AN_ORGANES_LEGISLATURES));
    if (stats.errors.length > 0) return stats;

    if (!dryRun) {
      // One transaction: either every group is written or none is.
      await db.$transaction(
        rows.map((row) => {
          const data = { ...row, sourceUrl: AN_ORGANES_SOURCE_URL, fetchedAt };
          return db.anOrgan.upsert({
            where: { organeRef: row.organeRef },
            create: data,
            update: data,
          });
        })
      );
      stats.written = rows.length;
    }
  } catch (error) {
    stats.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
  return stats;
}

export async function getAnOrganesStats(): Promise<{ legislature: number; count: number }[]> {
  const rows = await db.anOrgan.groupBy({
    by: ["legislature"],
    _count: true,
    orderBy: { legislature: "asc" },
  });
  return rows.map((row) => ({ legislature: row.legislature, count: row._count }));
}
