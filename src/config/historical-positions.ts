/**
 * Decision to show the historical group counts on the public scrutin page.
 *
 * Two different things, never confused:
 * - `publishable` (technical): a row of `ScrutinOrganPosition` that the lot 5 rules let through. It
 *   is read only through the public views of `2026-10-21-historical-groups-public-read.sql`.
 * - this switch (editorial): whether the site shows those rows at all.
 *
 * It stays `false` until the owner of the lot decides, in a reviewed change, once the checklist of
 * `docs/audits/parlement-historique-lot6-consultation.md` is done (the SQL applied to the shared
 * database, the methodology page written, a human read of a sample of scrutins). Turning it on
 * does not require a migration, and turning it off removes the block without touching any data.
 */
export const HISTORICAL_GROUP_POSITIONS_PUBLIC = false;

/** Legislatures whose runs exist. Another number gets the "not documented" state, never a fallback. */
export const HISTORICAL_POSITIONS_LEGISLATURES = [15, 16, 17] as const;
