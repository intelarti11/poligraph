/**
 * Versions of source records, and journals of manual decisions.
 *
 * The source does not version its records (architecture doc, 1.4): a correction rewrites the
 * file in place. So nothing is ever overwritten here. A correction closes the old version and adds
 * a new one. The state seen by a given snapshot is rebuilt from the versions, whatever has been
 * imported since.
 *
 * Spans are half-open in snapshot sequence numbers: a version holds for the snapshots `S` with
 * `fromSeq <= S` and (`toSeq === null` or `S < toSeq`). That avoids repeating, on our side, the
 * inclusion question the source leaves open for its own dates.
 *
 * This is a model of what a version means, not of how it is stored.
 */

export interface RecordVersion<T> {
  key: string;
  fromSeq: number;
  toSeq: number | null;
  /** Hash of the record as published. Equal hash, equal content. */
  rawHash: string;
  value: T;
}

export interface IncomingRecord<T> {
  key: string;
  rawHash: string;
  value: T;
}

export interface SnapshotDiff {
  added: string[];
  unchanged: string[];
  corrected: string[];
  removed: string[];
}

function assertSeq(seq: number, label: string): void {
  if (!Number.isInteger(seq) || seq < 1) throw new Error(`${label} must be an integer >= 1`);
}

function holds(version: { fromSeq: number; toSeq: number | null }, seq: number): boolean {
  return version.fromSeq <= seq && (version.toSeq === null || seq < version.toSeq);
}

/** Integrity problems of a set of versions. Empty when consistent. */
export function validateVersions<T>(versions: readonly RecordVersion<T>[]): string[] {
  const issues: string[] = [];
  const byKey = new Map<string, RecordVersion<T>[]>();
  for (const version of versions) {
    if (version.toSeq !== null && version.toSeq <= version.fromSeq) {
      issues.push(`${version.key}: span closes at ${version.toSeq} <= ${version.fromSeq}`);
    }
    const list = byKey.get(version.key) ?? [];
    list.push(version);
    byKey.set(version.key, list);
  }
  for (const [key, list] of byKey) {
    const ordered = [...list].sort((a, b) => a.fromSeq - b.fromSeq);
    for (let i = 1; i < ordered.length; i++) {
      const previous = ordered[i - 1] as RecordVersion<T>;
      const current = ordered[i] as RecordVersion<T>;
      if (previous.toSeq === null || previous.toSeq > current.fromSeq) {
        issues.push(`${key}: versions overlap at ${current.fromSeq}`);
      }
    }
  }
  return issues;
}

/** The versions that hold at snapshot `seq`, sorted by key. Throws on overlapping versions. */
export function stateAt<T>(versions: readonly RecordVersion<T>[], seq: number): RecordVersion<T>[] {
  assertSeq(seq, "seq");
  const result = new Map<string, RecordVersion<T>>();
  for (const version of versions) {
    if (!holds(version, seq)) continue;
    if (result.has(version.key)) {
      throw new Error(`stateAt(${seq}): two versions of ${version.key} hold at the same snapshot`);
    }
    result.set(version.key, version);
  }
  return [...result.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function currentOf<T>(versions: readonly RecordVersion<T>[]): Map<string, RecordVersion<T>> {
  const current = new Map<string, RecordVersion<T>>();
  for (const version of versions) {
    if (version.toSeq !== null) continue;
    if (current.has(version.key)) {
      throw new Error(`two open versions of ${version.key}`);
    }
    current.set(version.key, version);
  }
  return current;
}

function assertUniqueKeys<T>(incoming: readonly IncomingRecord<T>[]): void {
  const seen = new Set<string>();
  for (const record of incoming) {
    if (seen.has(record.key)) throw new Error(`duplicate key in the snapshot: ${record.key}`);
    seen.add(record.key);
  }
}

const sortKeys = (keys: string[]): string[] => keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** What a full snapshot would change, without changing anything. */
export function diffAgainstCurrent<T>(
  versions: readonly RecordVersion<T>[],
  incoming: readonly IncomingRecord<T>[]
): SnapshotDiff {
  assertUniqueKeys(incoming);
  const current = currentOf(versions);
  const diff: SnapshotDiff = { added: [], unchanged: [], corrected: [], removed: [] };
  const incomingKeys = new Set<string>();
  for (const record of incoming) {
    incomingKeys.add(record.key);
    const existing = current.get(record.key);
    if (!existing) diff.added.push(record.key);
    else if (existing.rawHash === record.rawHash) diff.unchanged.push(record.key);
    else diff.corrected.push(record.key);
  }
  for (const key of current.keys()) {
    if (!incomingKeys.has(key)) diff.removed.push(key);
  }
  sortKeys(diff.added);
  sortKeys(diff.unchanged);
  sortKeys(diff.corrected);
  sortKeys(diff.removed);
  return diff;
}

/**
 * Applies a full snapshot at sequence number `seq` and returns the new set of versions.
 * - added: a new version opens at `seq`;
 * - unchanged: nothing is written;
 * - corrected: the old version closes at `seq`, the new one opens at `seq`;
 * - removed: the old version closes at `seq`, nothing replaces it.
 * Never deletes, never edits a value. `seq` must come after every sequence number already used.
 */
export function applySnapshot<T>(
  versions: readonly RecordVersion<T>[],
  incoming: readonly IncomingRecord<T>[],
  seq: number
): { versions: RecordVersion<T>[]; diff: SnapshotDiff } {
  assertSeq(seq, "seq");
  for (const version of versions) {
    if (version.fromSeq >= seq || (version.toSeq !== null && version.toSeq >= seq)) {
      throw new Error(`snapshot ${seq} must come after every snapshot already applied`);
    }
  }
  const diff = diffAgainstCurrent(versions, incoming);
  const closing = new Set([...diff.corrected, ...diff.removed]);
  const byKey = new Map(incoming.map((record) => [record.key, record]));
  const next: RecordVersion<T>[] = versions.map((version) =>
    version.toSeq === null && closing.has(version.key) ? { ...version, toSeq: seq } : version
  );
  for (const key of [...diff.added, ...diff.corrected]) {
    const record = byKey.get(key) as IncomingRecord<T>;
    next.push({
      key,
      fromSeq: seq,
      toSeq: null,
      rawHash: record.rawHash,
      value: record.value,
    });
  }
  return { versions: next, diff };
}

/**
 * An import that would remove more than `maxRatio` of the records currently held must stop and
 * wait for a human: a partial file looks exactly like a mass removal.
 */
export function exceedsRemovalGuard(
  diff: SnapshotDiff,
  currentCount: number,
  maxRatio = 0.01
): boolean {
  if (currentCount <= 0) return false;
  return diff.removed.length / currentCount > maxRatio;
}

// ---------------------------------------------------------------------------
// Journals of decisions
// ---------------------------------------------------------------------------

export interface DecisionEntry<T> {
  decisionNo: number;
  key: string;
  value: T;
}

/**
 * The decision in force for each key at `cutoff`: the one with the highest number not above it.
 * A revision is a new entry, never an edit, so a run pinned on an older cutoff still sees what it
 * saw.
 */
export function effectiveDecisions<T>(
  journal: readonly DecisionEntry<T>[],
  cutoff: number
): Map<string, T> {
  if (!Number.isInteger(cutoff) || cutoff < 0) {
    throw new Error("cutoff must be an integer >= 0");
  }
  const numbers = new Set<number>();
  const latest = new Map<string, DecisionEntry<T>>();
  for (const entry of journal) {
    if (!Number.isInteger(entry.decisionNo) || entry.decisionNo < 1) {
      throw new Error("decisionNo must be an integer >= 1");
    }
    if (numbers.has(entry.decisionNo)) {
      throw new Error(`decisionNo ${entry.decisionNo} is used twice`);
    }
    numbers.add(entry.decisionNo);
    if (entry.decisionNo > cutoff) continue;
    const held = latest.get(entry.key);
    if (!held || held.decisionNo < entry.decisionNo) latest.set(entry.key, entry);
  }
  return new Map([...latest].map(([key, entry]) => [key, entry.value]));
}
