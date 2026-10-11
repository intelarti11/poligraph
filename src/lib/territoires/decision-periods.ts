import type { DatePrecision } from "@/generated/prisma";
import { parisDay } from "@/lib/governments/dates";

/**
 * Places curated decisions in institutional periods (#1052, lot 2, cadrage §6.1 and §6.2).
 *
 * "During the mandate" is a temporal relation, never a participation: a decision sits under a
 * mayor only because its adoption window falls inside exactly one mayor mandate. The relation is
 * computed at read time from the dates, so correcting a mandate date moves the decision without
 * any stored link to repair.
 *
 * Conservative by construction: an imprecise adoption date, two mandates overlapping the window,
 * a past mandate without an end date, or a mayor whose profile is not public all give
 * "période institutionnelle non établie" rather than a guess.
 */

export interface MayorMandate {
  mandateId: string;
  politicianId: string;
  /** Null when the profile is not public: the period then cannot be named. */
  person: { fullName: string; slug: string } | null;
  startDate: Date;
  endDate: Date | null;
  isCurrent: boolean;
}

export interface PeriodDecision {
  id: string;
  adoptionDate: Date;
  adoptionDatePrecision: DatePrecision;
}

/** First and last calendar day ("YYYY-MM-DD") the adoption date may designate. */
export function adoptionWindow(date: Date, precision: DatePrecision): [string, string] {
  const day = date.toISOString().slice(0, 10);
  const [y, m] = day.split("-").map(Number) as [number, number];
  if (precision === "YEAR") return [`${y}-01-01`, `${y}-12-31`];
  if (precision === "MONTH") {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const mm = String(m).padStart(2, "0");
    return [`${y}-${mm}-01`, `${y}-${mm}-${String(last).padStart(2, "0")}`];
  }
  return [day, day];
}

const OPEN_END = "9999-12-31";

/** Calendar span of a mandate, or null for its end when the end is unknown. */
function mandateSpan(m: MayorMandate): { start: string; end: string | null } {
  const start = parisDay(m.startDate);
  if (m.endDate) return { start, end: parisDay(m.endDate) };
  return { start, end: m.isCurrent ? OPEN_END : null };
}

/**
 * The single mandate that covers the whole window, or null. A mandate intersecting the window
 * without covering it (a change of mayor inside the month) makes the period unestablished.
 */
export function coveringMandate(
  window: [string, string],
  mandates: readonly MayorMandate[]
): MayorMandate | null {
  const [from, to] = window;
  const touching = mandates.filter((m) => {
    const { start, end } = mandateSpan(m);
    return start <= to && (end === null || end >= from);
  });
  if (touching.length !== 1) return null;
  const only = touching[0]!;
  const { start, end } = mandateSpan(only);
  if (end === null || start > from || end < to) return null;
  return only.person ? only : null;
}

export interface MayorPeriod<D> {
  politicianId: string;
  person: { fullName: string; slug: string };
  /** One entry per mandate record, oldest first: a re-elected mayor keeps one period, split here. */
  mandates: { mandateId: string; start: string; end: string | null; decisions: D[] }[];
  decisionCount: number;
}

export interface DecisionPeriods<D> {
  /** Most recent mayor first. */
  mayors: MayorPeriod<D>[];
  unestablished: D[];
}

/** Decisions inside each list are sorted by adoption date, most recent first. */
export function groupDecisionsByPeriod<D extends PeriodDecision>(
  decisions: readonly D[],
  mandates: readonly MayorMandate[]
): DecisionPeriods<D> {
  const byMandate = new Map<string, D[]>();
  const unestablished: D[] = [];
  const sorted = [...decisions].sort((a, b) => b.adoptionDate.getTime() - a.adoptionDate.getTime());
  for (const decision of sorted) {
    const mandate = coveringMandate(
      adoptionWindow(decision.adoptionDate, decision.adoptionDatePrecision),
      mandates
    );
    if (!mandate) {
      unestablished.push(decision);
      continue;
    }
    byMandate.set(mandate.mandateId, [...(byMandate.get(mandate.mandateId) ?? []), decision]);
  }

  const periods = new Map<string, MayorPeriod<D>>();
  const chronological = [...mandates].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  for (const m of chronological) {
    if (!m.person) continue;
    const span = mandateSpan(m);
    const period = periods.get(m.politicianId) ?? {
      politicianId: m.politicianId,
      person: m.person,
      mandates: [],
      decisionCount: 0,
    };
    const list = byMandate.get(m.mandateId) ?? [];
    period.mandates.push({
      mandateId: m.mandateId,
      start: span.start,
      end: span.end === OPEN_END ? null : span.end,
      decisions: list,
    });
    period.decisionCount += list.length;
    periods.set(m.politicianId, period);
  }

  // A period with no decision and no later documented mandate adds nothing: keep only mayors
  // whose span reaches the documented decisions, plus the current one for context.
  const mayors = [...periods.values()]
    .filter(
      (p) =>
        p.decisionCount > 0 ||
        mandates.some((m) => m.politicianId === p.politicianId && m.isCurrent)
    )
    .sort((a, b) => lastStart(b).localeCompare(lastStart(a)));

  return { mayors, unestablished };
}

function lastStart<D>(p: MayorPeriod<D>): string {
  return p.mandates[p.mandates.length - 1]!.start;
}
