/**
 * The content of `OfficialSourceSnapshot.recordCounts` (lot 5C-0).
 *
 * The column is a `jsonb` object and the database checks nothing else. This is what is written in
 * it, so that a later check has a shape to compare with: how many files the archive held and what
 * became of each, how many rows of each kind the snapshot holds, and the editorial counts that the
 * import records without interpreting them. All numbers, no name, no identifier of a person.
 */
import { RECORD_KINDS, type HashedRecord, type RecordKind } from "./rows";

export interface RecordCounts {
  /** Version of this layout. */
  layout: 1;
  files: {
    total: number;
    /** Parsed into rows. */
    accepted: number;
    /** Left out of the scope of the stream (the Congrès scrutin, organs that are not groups...). */
    outOfScope: number;
    rejected: number;
    rejectedByReason: Record<string, number>;
  };
  /** Rows by kind. Every kind is present, at zero when the stream has none. */
  rows: Record<RecordKind, number>;
  /** Noted, never acted on: the resolver and the publication read them from the rows. */
  editorial: {
    placeholderOrganAttestations: number;
    scrutinsByCountCoherence: { COHERENT: number; COUNT_MISMATCH: number; UNVERIFIABLE: number };
  };
}

export function buildRecordCounts(input: {
  files: RecordCounts["files"];
  records: readonly HashedRecord[];
  placeholderOrganRefs?: readonly string[];
}): RecordCounts {
  const rows = Object.fromEntries(RECORD_KINDS.map((k) => [k, 0])) as Record<RecordKind, number>;
  const scrutins = { COHERENT: 0, COUNT_MISMATCH: 0, UNVERIFIABLE: 0 };
  const placeholders = new Set(input.placeholderOrganRefs ?? ["PO0"]);
  let placeholderOrganAttestations = 0;
  for (const record of input.records) {
    rows[record.kind] += 1;
    if (record.kind === "SCRUTIN_COUNT_CHECK") {
      scrutins[(record.row as { countCoherence: keyof typeof scrutins }).countCoherence] += 1;
    }
    if (
      record.kind === "SCRUTIN_ATTESTATION" &&
      placeholders.has((record.row as { publishedOrganRef: string }).publishedOrganRef)
    ) {
      placeholderOrganAttestations += 1;
    }
  }
  const rejectedByReason = Object.fromEntries(
    Object.entries(input.files.rejectedByReason).sort(([a], [b]) => (a < b ? -1 : 1))
  );
  return {
    layout: 1,
    files: { ...input.files, rejectedByReason },
    rows,
    editorial: { placeholderOrganAttestations, scrutinsByCountCoherence: scrutins },
  };
}

/** Problems of a `recordCounts` value. Empty when it holds together. */
export function validateRecordCounts(counts: RecordCounts): string[] {
  const issues: string[] = [];
  const { files } = counts;
  if (files.accepted + files.outOfScope + files.rejected !== files.total) {
    issues.push("files: accepted + out of scope + rejected != total");
  }
  const rejected = Object.values(files.rejectedByReason).reduce((a, b) => a + b, 0);
  if (rejected !== files.rejected) issues.push("files: rejected by reason != rejected");
  for (const kind of RECORD_KINDS) {
    if (!Number.isSafeInteger(counts.rows[kind]) || counts.rows[kind] < 0)
      issues.push(`rows.${kind} is not a count`);
  }
  const coherent = Object.values(counts.editorial.scrutinsByCountCoherence).reduce(
    (a, b) => a + b,
    0
  );
  if (coherent !== counts.rows.SCRUTIN_COUNT_CHECK)
    issues.push("one coherence row per scrutin is expected");
  return issues;
}
