/**
 * Decision to show the historical group counts on the public scrutin page.
 *
 * Two different things, never confused:
 * - `publishable` (technical): a row of `ScrutinOrganPosition` that the lot 5 rules let through. It
 *   is read only through the public views of `2026-10-21-historical-groups-public-read.sql`.
 * - this switch (editorial): whether the site shows those rows at all.
 *
 * Turned on on 2026-10-19, once the checklist of
 * `docs/audits/parlement-historique-lot6-consultation.md` was done (the SQL applied to the shared
 * database and its rights checked, the methodology page written, a human read of a sample of
 * scrutins). It changes the pages of 874 scrutins out of 12 982, the others keep the official table.
 * Turning it off removes the block, the methodology section and its link without touching any data,
 * and needs a deployment: the narrower way to take a run off the pages is in section 6.6 of that report.
 */
export const HISTORICAL_GROUP_POSITIONS_PUBLIC = true;

/** Legislatures whose runs exist. Another number gets the "not documented" state, never a fallback. */
export const HISTORICAL_POSITIONS_LEGISLATURES = [15, 16, 17] as const;
