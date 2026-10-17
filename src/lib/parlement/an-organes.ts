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
  | "missing-label";

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

/** The source gives plain calendar dates (YYYY-MM-DD). Anything else is treated as unknown. */
function parseCalendarDate(value: unknown): Date | null {
  const text = nonEmptyString(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Parse one organ file (`{ organe: { uid, codeType, libelle, libelleAbrege, viMoDe, legislature } }`).
 */
export function parseAnOrgan(raw: unknown, legislatures: readonly number[]): AnOrganParseResult {
  const organ = asRecord(asRecord(raw)?.organe);
  const organeRef = nonEmptyString(organ?.uid);
  if (!organ || !organeRef) return { skipped: "not-an-organ" };

  if (organ.codeType !== PARLIAMENTARY_GROUP_CODE) return { skipped: "not-parliamentary-group" };

  const legislature = Number(nonEmptyString(organ.legislature));
  if (!Number.isInteger(legislature) || !legislatures.includes(legislature)) {
    return { skipped: "legislature-out-of-scope" };
  }

  const label = nonEmptyString(organ.libelle);
  if (!label) return { skipped: "missing-label" };

  const period = asRecord(organ.viMoDe);
  return {
    row: {
      organeRef,
      legislature,
      label,
      abbreviation: nonEmptyString(organ.libelleAbrege),
      startDate: parseCalendarDate(period?.dateDebut),
      endDate: parseCalendarDate(period?.dateFin),
    },
  };
}
