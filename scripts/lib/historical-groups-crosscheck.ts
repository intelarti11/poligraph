/**
 * Reconciliation of a run with the independent measurement of lot 5A-2 (architecture 8.3).
 *
 * The baseline classified every vote of the archives with its own code (`official-validation.ts`),
 * which never imports the resolver. A run resolves the same votes with the resolver. Each line below
 * states what the baseline implies for one status, and what the run produced. A line that differs is
 * reported, never averaged away: the two implementations disagree and one of them is wrong.
 *
 * The expectations hold for runs without continuity decisions and without identity links, which is
 * what this lot produces: a vote whose organ is a placeholder cannot be placed (`INSUFFICIENT`), a
 * vote whose interval record names another group, or the same group under another reference, is a
 * `CONFLICT`, and the votes where both sources agree are attested at level `BOTH`.
 */
import fs from "node:fs";
import path from "node:path";
import type { RunSummary } from "./historical-groups-run";

export interface CrossCheckItem {
  label: string;
  expected: number;
  observed: number;
  equal: boolean;
}

interface BaselineLegislature {
  nominalVotes: number;
  categories: Record<string, number>;
  organAbsentPlaceholder: number;
}

export function readBaselineLegislature(file: string, legislature: number): BaselineLegislature {
  const baseline = JSON.parse(fs.readFileSync(file, "utf8")) as {
    scrutins: { aggregate: { byLegislature: Record<string, BaselineLegislature> } }[];
  };
  for (const archive of baseline.scrutins) {
    const found = archive.aggregate.byLegislature[String(legislature)];
    if (found) return found;
  }
  throw new Error(`the baseline has no legislature ${legislature}`);
}

export const BASELINE_FILE = path.resolve(
  process.cwd(),
  "docs/audits/parlement-historique-lot5-baseline-5a2.json"
);

export function crossCheck(summary: RunSummary, baseline: BaselineLegislature): CrossCheckItem[] {
  const c = baseline.categories;
  const n = (key: string) => c[key] ?? 0;
  const status = (key: string) => summary.statusCounts[key] ?? 0;
  const reason = (key: string) => summary.reasons[key] ?? 0;
  const items: [string, number, number][] = [
    ["votes in the run = nominal votes of the baseline", baseline.nominalVotes, summary.votes],
    [
      "attested at level BOTH = votes where the single record or the records of the same organ agree",
      n("AGREE_SINGLE_RECORD") + n("AGREE_SAME_ORGAN_RECORDS"),
      summary.levels["BOTH"] ?? 0,
    ],
    [
      "attested at level SCRUTIN_ONLY = votes with no group record",
      n("NO_GROUP_RECORD"),
      summary.levels["SCRUTIN_ONLY"] ?? 0,
    ],
    [
      "attested at level INTERVAL_ONLY (none expected: every vote carries an attestation)",
      0,
      summary.levels["INTERVAL_ONLY"] ?? 0,
    ],
    [
      "CONFLICT = several organs, same abbreviation under another reference, different group",
      n("MULTIPLE_DISTINCT_ORGANS") + n("SAME_SIGLE_OTHER_REF") + n("DIFFERENT_GROUP"),
      status("CONFLICT"),
    ],
    [
      "INSUFFICIENT because of the placeholder organ",
      baseline.organAbsentPlaceholder,
      reason("INSUFFICIENT:PO0"),
    ],
    [
      "INSUFFICIENT because the organ is unknown (absent organs other than the placeholder)",
      n("ORGAN_ABSENT") - baseline.organAbsentPlaceholder,
      reason("INSUFFICIENT:UNKNOWN_ORGAN"),
    ],
    [
      "UNKNOWN, UNRESOLVED_IDENTITY (none expected)",
      0,
      status("UNKNOWN") + status("UNRESOLVED_IDENTITY"),
    ],
  ];
  return items.map(([label, expected, observed]) => ({
    label,
    expected,
    observed,
    equal: expected === observed,
  }));
}
