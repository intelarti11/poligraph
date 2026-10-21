import { createHash } from "node:crypto";
import { normalizeName, parseFrenchDate } from "./rne-parse";

/**
 * Parsing of the RNE council files (departmental and regional first, municipal later). Pure:
 * no network, no database. One output row per member, identified across imports by `rowKey`.
 */

export type ConseilNiveau = "MUNICIPAL" | "DEPARTEMENTAL" | "REGIONAL";

export interface ConseilMembreRow {
  niveau: ConseilNiveau;
  territoryCode: string;
  subdivisionCode: string | null;
  subdivisionLabel: string | null;
  lastName: string;
  firstName: string;
  gender: string | null;
  mandateStart: Date | null;
  functionLabel: string | null;
  functionStart: Date | null;
  rowKey: string;
}

export interface ConseilParseResult {
  rows: ConseilMembreRow[];
  /** Lines with no name or no territory code: counted, never guessed. */
  skipped: number;
  /** Lines whose `rowKey` repeats an earlier one (same person listed twice). */
  duplicates: number;
}

type Record_ = Record<string, string | undefined>;

/** Column names of each file, as published in the 2026 RNE exports. */
const COLUMNS = {
  DEPARTEMENTAL: {
    territory: "Code du département",
    subdivisionCode: "Code du canton",
    subdivisionLabel: "Libellé du canton",
  },
  REGIONAL: {
    territory: "Code de la région",
    subdivisionCode: "Code de la section départementale",
    subdivisionLabel: "Libellé de la section départementale",
  },
  MUNICIPAL: {
    territory: "Code de la commune",
    subdivisionCode: null,
    subdivisionLabel: null,
  },
} as const;

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function buildRowKey(
  niveau: ConseilNiveau,
  territoryCode: string,
  lastName: string,
  firstName: string,
  birthDate: string | null
): string {
  const parts = [niveau, territoryCode, lastName, firstName, birthDate ?? ""].map((p) =>
    p.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
  );
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export function parseConseilRows(niveau: ConseilNiveau, records: Record_[]): ConseilParseResult {
  const columns = COLUMNS[niveau];
  const rows: ConseilMembreRow[] = [];
  const indexByKey = new Map<string, number>();
  let skipped = 0;
  let duplicates = 0;

  for (const record of records) {
    const territoryCode = clean(record[columns.territory]);
    const lastName = clean(record["Nom de l'élu"]);
    const firstName = clean(record["Prénom de l'élu"]);
    if (!territoryCode || !lastName || !firstName) {
      skipped++;
      continue;
    }

    const rowKey = buildRowKey(
      niveau,
      territoryCode,
      lastName,
      firstName,
      clean(record["Date de naissance"])
    );
    const row: ConseilMembreRow = {
      niveau,
      territoryCode,
      subdivisionCode: columns.subdivisionCode ? clean(record[columns.subdivisionCode]) : null,
      subdivisionLabel: columns.subdivisionLabel ? clean(record[columns.subdivisionLabel]) : null,
      lastName: normalizeName(lastName),
      firstName: normalizeName(firstName),
      gender: clean(record["Code sexe"]),
      mandateStart: parseFrenchDate(record["Date de début du mandat"] ?? ""),
      functionLabel: clean(record["Libellé de la fonction"]),
      functionStart: parseFrenchDate(record["Date de début de la fonction"] ?? ""),
      rowKey,
    };

    // A person listed twice holds successive functions (a vice-presidency renumbered after a
    // resignation): the most recent function start is the current one.
    const previous = indexByKey.get(rowKey);
    if (previous !== undefined) {
      duplicates++;
      const kept = rows[previous]!;
      if ((row.functionStart?.getTime() ?? 0) > (kept.functionStart?.getTime() ?? 0)) {
        rows[previous] = row;
      }
      continue;
    }
    indexByKey.set(rowKey, rows.length);
    rows.push(row);
  }

  return { rows, skipped, duplicates };
}
