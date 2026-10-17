/**
 * CLI script to import the official AN referential of parliamentary groups (15th to 17th).
 *
 * Usage:
 *   npm run sync:an-organes -- --dry-run   # Count what would be written, no write
 *   npm run sync:an-organes                # Upsert into AnOrgan (additive, nothing else touched)
 *
 * Data source: data.assemblee-nationale.fr (official Open Data, AMO30)
 */

import "dotenv/config";
import { createCLI, type SyncHandler, type SyncResult } from "../src/lib/sync";
import { getAnOrganesStats, syncAnOrganes } from "../src/services/sync/an-organes";

const handler: SyncHandler = {
  name: "Politic Tracker - AN Organes Sync",
  description: "Import the official labels and periods of AN parliamentary groups",

  options: [],

  showHelp() {
    console.log(`
Politic Tracker - AN Organes Sync

Data source: data.assemblee-nationale.fr (AMO30, historical organs)

Features:
  - Keeps organs of type GP (parliamentary groups) of the 15th, 16th and 17th legislatures
  - Upserts into AnOrgan only, keyed by organeRef
  - --dry-run reads and parses the source without writing
    `);
  },

  async showStats() {
    const stats = await getAnOrganesStats();
    console.log("AN organs (parliamentary groups) by legislature:");
    for (const row of stats) console.log(`  ${row.legislature}e: ${row.count}`);
  },

  async sync(options): Promise<SyncResult> {
    const { dryRun = false } = options as { dryRun?: boolean };
    const result = await syncAnOrganes(dryRun);
    console.log("Skipped by reason:", result.skipped);

    return {
      success: result.errors.length === 0,
      duration: 0,
      stats: {
        processed: result.filesRead,
        found: result.groupsFound,
        created: result.written,
        unreadable: result.unreadable,
      },
      errors: result.errors,
    };
  },
};

createCLI(handler);
