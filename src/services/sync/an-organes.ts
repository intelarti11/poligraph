/**
 * Imports the official AN referential of parliamentary groups into AnOrgan.
 *
 * Manual, additive and independent from every other sync: it only reads the public AMO30
 * archive and only upserts into AnOrgan. It is not part of the daily sync.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { db } from "@/lib/db";
import { extractZip } from "@/lib/parsing/unzip";
import { parseAnOrgan, type AnOrganRow, type AnOrganSkipReason } from "@/lib/parlement/an-organes";

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

    if (!dryRun) {
      for (const row of rows) {
        const data = { ...row, sourceUrl: AN_ORGANES_SOURCE_URL, fetchedAt };
        await db.anOrgan.upsert({
          where: { organeRef: row.organeRef },
          create: data,
          update: data,
        });
        stats.written++;
      }
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
