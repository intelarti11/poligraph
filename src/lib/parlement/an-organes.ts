/**
 * Parser for the official Assemblée nationale referential of organs (AMO30), reduced to
 * parliamentary groups.
 *
 * The scrutin payloads only carry an `organeRef`. This referential is where the label and the
 * validity period of that reference live. Nothing here is inferred: a field the source does not
 * provide stays null, and an organ that is not a parliamentary group of a wanted legislature is
 * skipped with a reason instead of being coerced.
 */

export interface AnOrganRow {
  organeRef: string;
  legislature: number;
  label: string;
  abbreviation: string | null;
  startDate: Date | null;
  endDate: Date | null;
}

export type AnOrganSkipReason =
  | "not-an-organ"
  | "not-parliamentary-group"
  | "legislature-out-of-scope"
  | "missing-legislature"
  | "missing-label"
  | "invalid-date";

/**
 * Skips that lose nothing: the organ is not a parliamentary group of a wanted legislature.
 * Any other reason may hide a group that should have been imported.
 */
const HARMLESS_SKIPS: readonly AnOrganSkipReason[] = [
  "not-parliamentary-group",
  "legislature-out-of-scope",
];

export function isBlockingSkip(reason: AnOrganSkipReason): boolean {
  return !HARMLESS_SKIPS.includes(reason);
}

export type AnOrganParseResult = { row: AnOrganRow } | { skipped: AnOrganSkipReason };

/** AN code for a parliamentary group in the organ referential. */
const PARLIAMENTARY_GROUP_CODE = "GP";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The source gives calendar dates (YYYY-MM-DD). Absent or empty: unknown (`null`). Present but
 * impossible ("2024-02-31"): invalid, never normalized into another date.
 */
function parseCalendarDate(value: unknown): Date | null | "invalid" {
  if (value === null || value === undefined) return null;
  const text = nonEmptyString(value);
  if (text === null) return typeof value === "string" ? null : "invalid";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "invalid";
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) return "invalid";
  return date;
}

/**
 * Parse one organ file (`{ organe: { uid, codeType, libelle, libelleAbrege, viMoDe, legislature } }`).
 */
export function parseAnOrgan(raw: unknown, legislatures: readonly number[]): AnOrganParseResult {
  const organ = asRecord(asRecord(raw)?.organe);
  const organeRef = nonEmptyString(organ?.uid);
  if (!organ || !organeRef) return { skipped: "not-an-organ" };

  if (organ.codeType !== PARLIAMENTARY_GROUP_CODE) return { skipped: "not-parliamentary-group" };

  const legislatureText = nonEmptyString(organ.legislature);
  const legislature = legislatureText === null ? Number.NaN : Number(legislatureText);
  if (!Number.isInteger(legislature)) return { skipped: "missing-legislature" };
  if (!legislatures.includes(legislature)) return { skipped: "legislature-out-of-scope" };

  const label = nonEmptyString(organ.libelle);
  if (!label) return { skipped: "missing-label" };

  const period = asRecord(organ.viMoDe);
  const startDate = parseCalendarDate(period?.dateDebut);
  const endDate = parseCalendarDate(period?.dateFin);
  if (startDate === "invalid" || endDate === "invalid") return { skipped: "invalid-date" };

  return {
    row: {
      organeRef,
      legislature,
      label,
      abbreviation: nonEmptyString(organ.libelleAbrege),
      startDate,
      endDate,
    },
  };
}

/**
 * Checks on the whole set of rows, to run before any write: a referential whose gaps are unknown
 * must not replace the previous one. Returns an empty list when everything is consistent.
 */
export function validateAnOrganRows(
  rows: readonly AnOrganRow[],
  legislatures: readonly number[]
): string[] {
  const issues: string[] = [];

  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.organeRef)) issues.push(`duplicate organeRef: ${row.organeRef}`);
    seen.add(row.organeRef);
    if (row.startDate && row.endDate && row.endDate < row.startDate) {
      issues.push(`end date before start date for ${row.organeRef}`);
    }
  }
  for (const legislature of legislatures) {
    if (!rows.some((row) => row.legislature === legislature)) {
      issues.push(`no group for legislature ${legislature}`);
    }
  }
  return issues;
}
