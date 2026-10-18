/**
 * Import of one official archive as a new snapshot (lot 5D, PR B).
 *
 * What it does, in this order, and nothing else:
 *   plan   read-only. Parses the archive, compares it with the open versions of the stream, and
 *          reports what would change. Writes nothing. The report has a hash.
 *   apply  only with the hash of a plan (`--confirm`), in ONE transaction per stream. It plans again
 *          inside the transaction and refuses if the plan is not the confirmed one. It writes the
 *          artifact, the snapshot, a QUARANTINED decision, closes the corrected and removed versions,
 *          opens the added and corrected ones, then reads everything back and checks that the state
 *          hash of the database is the one declared. Any difference rolls the whole transaction back.
 *
 * It never releases a snapshot and never publishes: the role it connects as cannot (see the lot 5D
 * migration). A snapshot it writes waits QUARANTINED for a human decision.
 */
import { hashOf } from "@/lib/parlement/historical-groups/canonical";
import { PARSER_VERSION } from "@/lib/parlement/historical-groups/parser-version";
import {
  rawHashOf,
  stateHashOfRecords,
  type HashedRecord,
  type RecordKind,
  type RowOf,
} from "@/lib/parlement/historical-groups/rows";
import {
  exceedsRemovalGuard,
  type SnapshotDiff,
} from "@/lib/parlement/historical-groups/versioning";
import type pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { openArchiveBytes, type OpenedArchive } from "./historical-groups-archive";
import {
  CONTENT_COLUMNS,
  KIND_TABLE,
  insertRows,
  keyColumns,
  kindsOfStream,
  latestSnapshot,
  readRecordsAt,
  snapshotByArtifact,
} from "./historical-groups-db";
import { indexArchive, scanArchive, type SnapshotIndex } from "./historical-groups-snapshot";
import {
  checkOfflineCopy,
  depositArtifact,
  type ArtifactStore,
  type Deposit,
} from "./historical-groups-storage";

// ---------------------------------------------------------------------------
// Manifest of the archives kept outside the repository
// ---------------------------------------------------------------------------

export interface ManifestEntry {
  stream: string;
  sha256: string;
  sizeBytes: number;
  file: string;
  url: string;
  serverLastModified: string | null;
  sourceAsOf: string | null;
}

export function readManifest(dir: string): ManifestEntry[] {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as {
    archives: ManifestEntry[];
  };
  return manifest.archives;
}

/** The bytes of the archive of a manifest entry, refused if they are not the ones declared. */
export function readArchiveBytes(dir: string, entry: ManifestEntry): Buffer {
  const bytes = fs.readFileSync(path.join(dir, entry.file));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== entry.sha256 || bytes.length !== entry.sizeBytes) {
    throw new Error(`${entry.stream}: the archive on disk is not the one the manifest declares`);
  }
  return bytes;
}

/** Opens the archive of a manifest entry, refusing it if its bytes are not the ones declared. */
export function openVerified(dir: string, entry: ManifestEntry): OpenedArchive {
  return openArchiveBytes(readArchiveBytes(dir, entry));
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface KindDiff {
  added: number;
  corrected: number;
  removed: number;
  unchanged: number;
}

export interface ImportPlan {
  stream: string;
  archiveSha256: string;
  parserVersion: string;
  /** `ALREADY_IMPORTED`: this archive, read by this parser, is already a snapshot. */
  status: "NEW" | "ALREADY_IMPORTED" | "BLOCKED_BY_REMOVAL_GUARD";
  nextSeq: number;
  previousSeq: number | null;
  previousStateHash: string | null;
  stateHash: string;
  recordCounts: unknown;
  diff: Partial<Record<RecordKind, KindDiff>>;
}

export interface PlannedChanges {
  plan: ImportPlan;
  index: SnapshotIndex;
  /** Keys (JSON arrays) to close, and to open. Kept out of the hashed plan: only counts are in it. */
  close: Map<RecordKind, string[]>;
  open: Map<RecordKind, Set<string>>;
}

export const planHashOf = (plan: ImportPlan): string => hashOf(plan);

async function openHashes(
  client: pg.Client,
  stream: string,
  kind: RecordKind
): Promise<Map<string, string>> {
  const keys = keyColumns(kind);
  const r = await client.query(
    `SELECT ${keys.map((c) => `"${c}"`).join(", ")}, "rawHash" FROM "${KIND_TABLE[kind]}"
     WHERE "stream" = $1 AND "toSeq" IS NULL`,
    [stream]
  );
  const out = new Map<string, string>();
  for (const row of r.rows as Record<string, unknown>[]) {
    out.set(JSON.stringify(keys.map((c) => row[c])), row["rawHash"] as string);
  }
  return out;
}

export async function planImport(
  client: pg.Client,
  stream: string,
  archive: OpenedArchive
): Promise<PlannedChanges> {
  const index = indexArchive(stream, archive);
  const already = await snapshotByArtifact(client, stream, archive.sha256, PARSER_VERSION);
  const latest = await latestSnapshot(client, stream);
  const diff: ImportPlan["diff"] = {};
  const close = new Map<RecordKind, string[]>();
  const open = new Map<RecordKind, Set<string>>();
  let blocked = false;
  for (const kind of kindsOfStream(stream)) {
    const current = await openHashes(client, stream, kind);
    const incoming = index.hashes.get(kind) ?? new Map<string, string>();
    const d: SnapshotDiff = { added: [], unchanged: [], corrected: [], removed: [] };
    for (const [key, hash] of incoming) {
      const held = current.get(key);
      if (held === undefined) d.added.push(key);
      else if (held === hash) d.unchanged.push(key);
      else d.corrected.push(key);
    }
    for (const key of current.keys()) if (!incoming.has(key)) d.removed.push(key);
    if (exceedsRemovalGuard(d, current.size)) blocked = true;
    diff[kind] = {
      added: d.added.length,
      corrected: d.corrected.length,
      removed: d.removed.length,
      unchanged: d.unchanged.length,
    };
    close.set(kind, [...d.corrected, ...d.removed]);
    open.set(kind, new Set([...d.added, ...d.corrected]));
  }
  const plan: ImportPlan = {
    stream,
    archiveSha256: archive.sha256,
    parserVersion: PARSER_VERSION,
    status: already ? "ALREADY_IMPORTED" : blocked ? "BLOCKED_BY_REMOVAL_GUARD" : "NEW",
    nextSeq: latest ? latest.seq + 1 : 1,
    previousSeq: latest?.seq ?? null,
    previousStateHash: latest?.stateHash ?? null,
    stateHash: index.stateHash,
    recordCounts: index.recordCounts,
    diff,
  };
  return { plan, index, close, open };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export interface ApplyResult {
  stream: string;
  outcome: "IMPORTED" | "ALREADY_IMPORTED";
  seq: number;
  rowsWritten: number;
  rowsClosed: number;
  millis: number;
}

const keyValues = (key: string): unknown[] => JSON.parse(key) as unknown[];

async function closeVersions(
  client: pg.Client,
  stream: string,
  kind: RecordKind,
  keys: readonly string[],
  seq: number
): Promise<number> {
  const cols = keyColumns(kind);
  let closed = 0;
  const per = Math.max(1, Math.floor(30_000 / cols.length));
  for (let i = 0; i < keys.length; i += per) {
    const chunk = keys.slice(i, i + per);
    const tuples = chunk
      .map((_, r) => `(${cols.map((_c, c) => `$${3 + r * cols.length + c}`).join(", ")})`)
      .join(", ");
    const result = await client.query(
      `UPDATE "${KIND_TABLE[kind]}" SET "toSeq" = $1
       WHERE "stream" = $2 AND "toSeq" IS NULL AND (${cols.map((c) => `"${c}"`).join(", ")}) IN (${tuples})`,
      [seq, stream, ...chunk.flatMap(keyValues)]
    );
    closed += result.rowCount ?? 0;
  }
  if (closed !== keys.length) {
    throw new Error(`${stream} ${kind}: ${keys.length} versions to close, ${closed} closed`);
  }
  return closed;
}

/**
 * Reads the snapshot back and recomputes every raw hash and the state hash. The raw hash of a row is
 * recomputed from its columns, not read: a column rewritten behind the import's back shows here.
 */
export async function recomputeState(
  client: pg.Client,
  stream: string,
  seq: number,
  onProblem: (problem: string) => void = () => undefined
): Promise<{ stateHash: string; rows: Record<string, number> }> {
  const records: HashedRecord[] = [];
  const rows: Record<string, number> = {};
  for (const kind of kindsOfStream(stream)) {
    rows[kind] = 0;
    for await (const stored of readRecordsAt(client, stream, seq, kind)) {
      rows[kind] += 1;
      const recomputed = rawHashOf(kind, stored.row as unknown as RowOf[typeof kind]);
      if (recomputed !== stored.rawHash) {
        onProblem(`${kind} ${stored.key}: the stored rawHash is not the hash of the columns`);
      }
      records.push({ kind, key: stored.key, row: null as never, rawHash: stored.rawHash });
    }
  }
  return { stateHash: stateHashOfRecords(records), rows };
}

export async function applyImport(
  client: pg.Client,
  stream: string,
  archive: OpenedArchive,
  entry: ManifestEntry,
  confirm: string,
  log: (line: string) => void = () => undefined,
  deposit: Deposit | null = null
): Promise<ApplyResult> {
  const started = Date.now();
  await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [`hg-import:${stream}`]);
  try {
    await client.query("BEGIN");
    try {
      const planned = await planImport(client, stream, archive);
      if (planHashOf(planned.plan) !== confirm) {
        throw new Error(
          `${stream}: the plan is not the confirmed one (state changed, or wrong hash)`
        );
      }
      const { plan, index } = planned;
      if (plan.status === "ALREADY_IMPORTED") {
        await client.query("ROLLBACK");
        return {
          stream,
          outcome: "ALREADY_IMPORTED",
          seq: plan.previousSeq ?? 0,
          rowsWritten: 0,
          rowsClosed: 0,
          millis: Date.now() - started,
        };
      }
      if (plan.status !== "NEW") throw new Error(`${stream}: ${plan.status}`);
      const seq = plan.nextSeq;
      const have = await client.query(`SELECT 1 FROM "SourceArtifact" WHERE "sha256" = $1`, [
        archive.sha256,
      ]);
      if (have.rowCount === 0) {
        await client.query(
          `INSERT INTO "SourceArtifact"("sha256","byteSize","mediaType","storageKind","storageRef","storedAt","storedBy")
           VALUES ($1, $2, 'application/zip', $3, $4, now(), 'import-an')`,
          [
            archive.sha256,
            archive.sizeBytes,
            deposit?.storageKind ?? "LOCAL_OFFLINE",
            deposit?.storageRef ?? entry.file,
          ]
        );
      }
      const snapshotId = `hg-${stream}-${seq}`;
      await client.query(
        `INSERT INTO "OfficialSourceSnapshot"("id","stream","seq","artifactSha256","url","fetchedAt","sourceAsOf","integrity","parserVersion","stateHash","recordCounts","importedBy")
         VALUES ($1, $2, $3, $4, $5, now(), $6, 'VERIFIED', $7, $8, $9::jsonb, 'import-an')`,
        [
          snapshotId,
          stream,
          seq,
          archive.sha256,
          entry.url,
          entry.sourceAsOf,
          PARSER_VERSION,
          index.stateHash,
          JSON.stringify(index.recordCounts),
        ]
      );
      await client.query(
        `INSERT INTO "SnapshotDecision"("snapshotId","status","reason","decidedBy","decidedByKind")
         VALUES ($1, 'QUARANTINED', 'imported, awaiting verification and a human decision', 'import-an', 'SCRIPT')`,
        [snapshotId]
      );

      let rowsClosed = 0;
      for (const [kind, keys] of planned.close) {
        if (keys.length) rowsClosed += await closeVersions(client, stream, kind, keys, seq);
      }

      let rowsWritten = 0;
      const buffers = new Map<RecordKind, unknown[][]>();
      const flush = async (kind: RecordKind, force: boolean) => {
        const buffer = buffers.get(kind) ?? [];
        if (buffer.length === 0 || (!force && buffer.length < 5000)) return;
        const columns = [
          "stream",
          ...CONTENT_COLUMNS[kind],
          "fromSeq",
          "sourceMember",
          "rawHash",
          "memberHash",
        ];
        await insertRows(client, KIND_TABLE[kind], columns, buffer);
        rowsWritten += buffer.length;
        buffers.set(kind, []);
      };
      const { records } = scanArchive(stream, archive);
      for (const record of records) {
        if (!planned.open.get(record.kind)?.has(record.key)) continue;
        const buffer = buffers.get(record.kind) ?? [];
        buffer.push([
          stream,
          ...CONTENT_COLUMNS[record.kind].map(
            (c) => (record.row as unknown as Record<string, unknown>)[c]
          ),
          seq,
          record.sourceMember,
          record.rawHash,
          record.memberHash,
        ]);
        buffers.set(record.kind, buffer);
        await flush(record.kind, false);
      }
      for (const kind of buffers.keys()) await flush(kind, true);
      log(`${stream}: ${rowsWritten} rows written, ${rowsClosed} versions closed; reading back`);

      const problems: string[] = [];
      const back = await recomputeState(
        client,
        stream,
        seq,
        (p) => problems.length < 20 && problems.push(p)
      );
      if (problems.length) throw new Error(`${stream}: ${problems.join("; ")}`);
      if (back.stateHash !== index.stateHash) {
        throw new Error(`${stream}: the state hash read back is not the declared one`);
      }
      await client.query("COMMIT");
      return {
        stream,
        outcome: "IMPORTED",
        seq,
        rowsWritten,
        rowsClosed,
        millis: Date.now() - started,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
      `hg-import:${stream}`,
    ]);
  }
}

/**
 * `applyImport` with the archive deposited first: the independent offline copy is checked, the archive
 * is put in the private store (by hash), read back and hashed again, and only then does the import open
 * its transaction. Any failure here writes nothing to the database.
 */
export async function applyImportWithStorage(
  client: pg.Client,
  stream: string,
  archive: OpenedArchive,
  entry: ManifestEntry,
  confirm: string,
  storage: { store: ArtifactStore; bytes: Buffer; archiveDir: string; offlineDir: string },
  log: (line: string) => void = () => undefined
): Promise<ApplyResult> {
  checkOfflineCopy(storage.archiveDir, storage.offlineDir, archive.sha256);
  const deposit = await depositArtifact(storage.store, storage.bytes, archive.sha256);
  log(`${stream}: archive stored as ${deposit.storageRef}`);
  return applyImport(client, stream, archive, entry, confirm, log, deposit);
}
