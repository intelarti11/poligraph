/**
 * Version of the official-file parsers and of the row projection (`rows.ts`).
 *
 * It is stored with every snapshot (`OfficialSourceSnapshot.parserVersion`). "Replay a snapshot with
 * its parser" (architecture 4.7) only means something if that version names code that can be found
 * again: each published version has a git tag `historical-groups-parser/<version>`, created when the
 * change that bumps it is merged.
 *
 * Bump it whenever the result of parsing or of the projection can change for the same bytes:
 * a field read, a rule of rejection, a rule of coherence, the content of a row.
 *
 * - `5A-2.1`: the parsers of the lot 5A-2, before any row existed.
 * - `5C-0.1`: reads `preseance`, `datePublication` and `parDelegation`, and adds the row projection
 *   and its hashes. The figures of the 5A-2 baseline are unchanged (checked on the official files).
 */
export const PARSER_VERSION = "5C-0.1";
