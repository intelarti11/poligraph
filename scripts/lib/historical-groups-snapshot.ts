/**
 * From an official archive to the rows of one snapshot (lot 5D, PR B).
 *
 * Reads the archive in memory, one entry at a time, parses it with the lot 5 parsers and yields the
 * hashed rows of `rows.ts`, each with the member it came from and the hash of that member. No
 * database, no network, no name written anywhere. The archive is untrusted: `openArchiveBytes`
 * already refused the shapes that do not belong to an archive.
 *
 * `sourceMember` is the entry name. `memberHash` is the SHA-256 of the bytes of that entry, so that
 * a correction elsewhere in a shared file is visible without rewriting rows (see `rows.ts`).
 */
import { createHash } from "node:crypto";
import {
  stateHashOfRecords,
  type HashedRecord,
  type RecordKind,
} from "@/lib/parlement/historical-groups/rows";
import { organRow, recordsOfActor, recordsOfScrutin } from "@/lib/parlement/historical-groups/rows";
import {
  buildRecordCounts,
  type RecordCounts,
} from "@/lib/parlement/historical-groups/record-counts";
import { parseActeur, parseOrgane } from "@/lib/parlement/historical-groups/parse-amo30";
import { parseScrutin } from "@/lib/parlement/historical-groups/parse-scrutin";
import { ArchiveIntegrityError, type OpenedArchive } from "./historical-groups-archive";

export const AMO30_STREAM = "AN_AMO30";
export const SCRUTIN_STREAMS = ["AN_SCRUTINS_L15", "AN_SCRUTINS_L16", "AN_SCRUTINS_L17"] as const;

const AMO30_FOLDERS = new Set(["json/acteur", "json/organe", "json/deport"]);
const SCRUTIN_FOLDERS = new Set(["json"]);

export interface SourcedRecord extends HashedRecord {
  sourceMember: string;
  memberHash: string;
}

export interface ScanStats {
  total: number;
  accepted: number;
  outOfScope: number;
  rejected: number;
  rejectedByReason: Record<string, number>;
}

const jsonOrNull = (data: Buffer): unknown => {
  try {
    return JSON.parse(data.toString("utf8"));
  } catch {
    return null;
  }
};

function requireFolders(archive: OpenedArchive, allowed: ReadonlySet<string>, label: string): void {
  for (const folder of Object.keys(archive.entriesByFolder)) {
    if (!allowed.has(folder)) {
      throw new ArchiveIntegrityError(
        "ENTRY_NAME_REFUSED",
        `${label}: unexpected folder ${JSON.stringify(folder)}`
      );
    }
  }
}

export const isScrutinStream = (stream: string): boolean => stream.startsWith("AN_SCRUTINS_");

/**
 * The records of an archive, lazily. `stats` is filled while the generator is consumed and complete
 * once it is exhausted.
 */
export function scanArchive(
  stream: string,
  archive: OpenedArchive
): { stats: ScanStats; records: Generator<SourcedRecord> } {
  const amo30 = stream === AMO30_STREAM;
  if (!amo30 && !isScrutinStream(stream)) throw new Error(`stream not handled: ${stream}`);
  requireFolders(archive, amo30 ? AMO30_FOLDERS : SCRUTIN_FOLDERS, stream);
  const stats: ScanStats = {
    total: 0,
    accepted: 0,
    outOfScope: 0,
    rejected: 0,
    rejectedByReason: {},
  };
  const reject = (reason: string) => {
    stats.rejected += 1;
    stats.rejectedByReason[reason] = (stats.rejectedByReason[reason] ?? 0) + 1;
  };
  function* records(): Generator<SourcedRecord> {
    for (const entry of archive.entries()) {
      stats.total += 1;
      const memberHash = createHash("sha256").update(entry.data).digest("hex");
      const tag = (list: HashedRecord[]): SourcedRecord[] =>
        list.map((r) => ({ ...r, sourceMember: entry.name, memberHash }));
      if (amo30) {
        if (entry.name.startsWith("json/organe/")) {
          const parsed = parseOrgane(jsonOrNull(entry.data));
          if (parsed.status === "ACCEPTED") {
            stats.accepted += 1;
            yield* tag([organRow(parsed.organ)]);
          } else if (parsed.status === "OUT_OF_SCOPE") stats.outOfScope += 1;
          else reject(parsed.reason);
        } else if (entry.name.startsWith("json/acteur/")) {
          const parsed = parseActeur(jsonOrNull(entry.data));
          if (parsed.status === "ACCEPTED") {
            stats.accepted += 1;
            yield* tag(recordsOfActor(parsed));
          } else reject(parsed.reason);
        } else stats.outOfScope += 1;
      } else {
        const parsed = parseScrutin(jsonOrNull(entry.data));
        if (parsed.status === "AN") {
          stats.accepted += 1;
          yield* tag(recordsOfScrutin(parsed.scrutin));
        } else if (parsed.status === "CONGRES") stats.outOfScope += 1;
        else reject(parsed.reason);
      }
    }
  }
  return { stats, records: records() };
}

export interface SnapshotIndex {
  stateHash: string;
  recordCounts: RecordCounts;
  /** kind -> key -> rawHash. Hashes only: the rows are read again when they are written. */
  hashes: Map<RecordKind, Map<string, string>>;
  archiveSha256: string;
}

/** First pass: everything needed to decide and to declare, without keeping a row. */
export function indexArchive(stream: string, archive: OpenedArchive): SnapshotIndex {
  const { stats, records } = scanArchive(stream, archive);
  const hashes = new Map<RecordKind, Map<string, string>>();
  const entries: { kind: RecordKind; key: string; rawHash: string }[] = [];
  const lightweight: HashedRecord[] = [];
  for (const record of records) {
    let byKey = hashes.get(record.kind);
    if (!byKey) hashes.set(record.kind, (byKey = new Map()));
    if (byKey.has(record.key))
      throw new Error(`${stream}: two records share ${record.kind} ${record.key}`);
    byKey.set(record.key, record.rawHash);
    entries.push({ kind: record.kind, key: record.key, rawHash: record.rawHash });
    // buildRecordCounts reads the kind and two columns only: keep just those.
    lightweight.push(
      record.kind === "SCRUTIN_COUNT_CHECK"
        ? record
        : record.kind === "SCRUTIN_ATTESTATION"
          ? {
              kind: record.kind,
              key: record.key,
              rawHash: record.rawHash,
              row: {
                publishedOrganRef: (record.row as { publishedOrganRef: string }).publishedOrganRef,
              } as never,
            }
          : { kind: record.kind, key: record.key, rawHash: record.rawHash, row: null as never }
    );
  }
  const recordCounts = buildRecordCounts({
    files: {
      total: stats.total,
      accepted: stats.accepted,
      outOfScope: stats.outOfScope,
      rejected: stats.rejected,
      rejectedByReason: stats.rejectedByReason,
    },
    records: lightweight,
  });
  return {
    stateHash: stateHashOfRecords(lightweight),
    recordCounts,
    hashes,
    archiveSha256: archive.sha256,
  };
}
