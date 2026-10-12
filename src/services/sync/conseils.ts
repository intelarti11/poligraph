import { parse } from "csv-parse/sync";
import { db } from "@/lib/db";
import { HTTPClient } from "@/lib/api/http-client";
import { DATA_GOUV_RATE_LIMIT_MS } from "@/config/rate-limits";
import {
  RNE_CONSEILLERS_DEPARTEMENTAUX_FRAGMENTS,
  RNE_CONSEILLERS_REGIONAUX_FRAGMENTS,
  resolveRneResourceUrl,
} from "./rne-resource";
import { parseConseilRows, type ConseilMembreRow, type ConseilNiveau } from "./conseils-parse";

/**
 * Import of the RNE departmental and regional council files into `ConseilMembre` (#1052).
 * Each file is a full snapshot: a level is replaced as a whole, in one transaction. The
 * municipal file (500 000+ lines) needs its own batching and is not handled here.
 */

export type ImportedNiveau = Exclude<ConseilNiveau, "MUNICIPAL">;

const FRAGMENTS: Record<ImportedNiveau, readonly string[]> = {
  DEPARTEMENTAL: RNE_CONSEILLERS_DEPARTEMENTAUX_FRAGMENTS,
  REGIONAL: RNE_CONSEILLERS_REGIONAUX_FRAGMENTS,
};

/** A new snapshot smaller than this share of the stored one is refused: truncated download. */
const MIN_SHARE_OF_STORED = 0.5;

const client = new HTTPClient({ rateLimitMs: DATA_GOUV_RATE_LIMIT_MS });

export interface ConseilsReport {
  niveau: ImportedNiveau;
  dryRun: boolean;
  /** False until the manual SQL has created the table. */
  tableReady: boolean;
  sourceUrl: string;
  registerDate: string | null;
  linesRead: number;
  rows: number;
  skipped: number;
  duplicates: number;
  withFunction: number;
  territories: number;
  stored: number;
  written: boolean;
  /** Members per territory code, to eyeball against the legal sizes. */
  perTerritory: Record<string, number>;
}

/** The resource URL carries its publication timestamp: `/20260811-154909/`. */
export function registerDateFromUrl(url: string): string | null {
  const m = url.match(/\/(\d{4})(\d{2})(\d{2})-\d{6}\//);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

async function storedCount(niveau: ImportedNiveau): Promise<number | null> {
  try {
    return await db.conseilMembre.count({ where: { niveau } });
  } catch {
    return null;
  }
}

export async function syncConseils(
  niveau: ImportedNiveau,
  options: { dryRun?: boolean } = {}
): Promise<ConseilsReport> {
  const dryRun = options.dryRun ?? false;
  const sourceUrl = await resolveRneResourceUrl(FRAGMENTS[niveau]);
  const { data: csvText } = await client.getText(sourceUrl);
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    delimiter: ";",
    bom: true,
  }) as Record<string, string>[];

  const { rows, skipped, duplicates } = parseConseilRows(niveau, records);
  const registerDate = registerDateFromUrl(sourceUrl);

  const perTerritory: Record<string, number> = {};
  for (const r of rows) perTerritory[r.territoryCode] = (perTerritory[r.territoryCode] ?? 0) + 1;

  const stored = await storedCount(niveau);
  const report: ConseilsReport = {
    niveau,
    dryRun,
    tableReady: stored !== null,
    sourceUrl,
    registerDate,
    linesRead: records.length,
    rows: rows.length,
    skipped,
    duplicates,
    withFunction: rows.filter((r) => r.functionLabel).length,
    territories: Object.keys(perTerritory).length,
    stored: stored ?? 0,
    written: false,
    perTerritory,
  };

  if (dryRun) return report;
  if (stored === null) throw new Error("Table ConseilMembre absente : appliquer le SQL manuel.");
  if (rows.length === 0) throw new Error("Fichier sans ligne exploitable : écriture refusée.");
  if (stored > 0 && rows.length < stored * MIN_SHARE_OF_STORED) {
    throw new Error(
      `Fichier ${niveau} trop petit (${rows.length} lignes pour ${stored} en base) : écriture refusée.`
    );
  }

  await replaceLevel(niveau, rows, sourceUrl, registerDate);
  report.written = true;
  return report;
}

async function replaceLevel(
  niveau: ImportedNiveau,
  rows: ConseilMembreRow[],
  sourceUrl: string,
  registerDate: string | null
): Promise<void> {
  const date = registerDate ? new Date(`${registerDate}T12:00:00Z`) : null;
  await db.$transaction(
    async (tx) => {
      await tx.conseilMembre.deleteMany({ where: { niveau } });
      for (let i = 0; i < rows.length; i += 1000) {
        await tx.conseilMembre.createMany({
          data: rows.slice(i, i + 1000).map((r) => ({ ...r, sourceUrl, registerDate: date })),
        });
      }
    },
    { timeout: 60_000 }
  );
}
