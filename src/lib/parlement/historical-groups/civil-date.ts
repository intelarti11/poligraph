import type { CivilDate } from "./types";

/**
 * Strict calendar days (`xs:date`, `YYYY-MM-DD`).
 *
 * The same rule exists privately in `src/lib/parlement/an-organes.ts` (`parseCalendarDate`). It is
 * written again here on purpose: lot 3 is delivered and this lot must not touch its files. The
 * duplicate is temporary and is to be merged in a separate cleanup PR.
 *
 * No `Date`, no clock, no time zone: a civil day is compared as text, which orders correctly for
 * `YYYY-MM-DD`.
 */

const SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * Returns the civil day, or `null` when the value is not a real calendar day. "2024-02-31" is
 * invalid, never normalized into another day. Surrounding spaces and time parts are invalid.
 */
export function parseCivilDate(value: unknown): CivilDate | null {
  if (typeof value !== "string") return null;
  const match = SHAPE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return value as CivilDate;
}

/** Same as `parseCivilDate`, for values that are expected to be valid. Throws otherwise. */
export function civilDate(value: string): CivilDate {
  const parsed = parseCivilDate(value);
  if (parsed === null) throw new Error(`Not a civil date: ${JSON.stringify(value)}`);
  return parsed;
}

export function compareCivilDates(a: CivilDate, b: CivilDate): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}
