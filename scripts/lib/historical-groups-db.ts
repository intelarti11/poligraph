/**
 * Database access of the historical group tools (lot 5D, PR B).
 *
 * Two rules sit above everything else here:
 *
 * 1. The target is a disposable local database or nothing. `connectDisposable` refuses any other
 *    host, port, database or user, any URL the application itself uses, and any database that does
 *    not carry the `hg.disposable = 'yes'` marker. Nothing in this file reads `DATABASE_URL` or
 *    `DIRECT_URL`, except to refuse a URL equal to them.
 * 2. Each tool connects as the role that is meant to do its job. The importer cannot publish, the
 *    runner cannot write evidence, the reader cannot write at all: the permissions of the lot 5D
 *    migration are what enforce it, not this file.
 *
 * Dates are returned as the text the database holds (`YYYY-MM-DD`), never as a JavaScript Date:
 * a civil date has no time zone.
 */
import pg from "pg";
import type { RecordKind } from "@/lib/parlement/historical-groups/rows";
import { RECORD_IDENTITY } from "@/lib/parlement/historical-groups/rows";

export const DISPOSABLE = {
  host: "127.0.0.1",
  port: "55486",
  database: "hg_schema_test",
  owner: "hg_schema_test",
} as const;

export type ToolRole = "importer" | "runner" | "reader" | "owner";
const ROLE_NAME: Record<ToolRole, string> = {
  importer: "hg_importer",
  runner: "hg_runner",
  reader: "hg_reader",
  owner: DISPOSABLE.owner,
};
const LOT_ROLES = ["hg_importer", "hg_runner", "hg_reader"];

export class TargetRefusedError extends Error {
  constructor(detail: string) {
    super(`Target refused: ${detail}`);
    this.name = "TargetRefusedError";
  }
}

/** URL-level checks, before any connection. Throws `TargetRefusedError`. */
export function assertDisposableUrl(
  url: string,
  role: ToolRole,
  env: Record<string, string | undefined> = process.env
): void {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new TargetRefusedError("not a URL");
  }
  if (target.protocol !== "postgresql:" && target.protocol !== "postgres:") {
    throw new TargetRefusedError("not a PostgreSQL URL");
  }
  if (target.hostname !== DISPOSABLE.host) throw new TargetRefusedError("host is not 127.0.0.1");
  if (target.port !== DISPOSABLE.port)
    throw new TargetRefusedError(`port is not ${DISPOSABLE.port}`);
  if (target.pathname !== `/${DISPOSABLE.database}`) {
    throw new TargetRefusedError(`database is not ${DISPOSABLE.database}`);
  }
  if (decodeURIComponent(target.username) !== ROLE_NAME[role]) {
    throw new TargetRefusedError(`this tool connects as ${ROLE_NAME[role]}`);
  }
  for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
    if (env[name] !== undefined && env[name] === url) {
      throw new TargetRefusedError(`the URL is the one of ${name}`);
    }
  }
}

const dateAsText = (value: string): string => value;

export async function connectDisposable(
  url: string,
  role: ToolRole,
  env: Record<string, string | undefined> = process.env
): Promise<pg.Client> {
  assertDisposableUrl(url, role, env);
  const client = new pg.Client({
    connectionString: url,
    types: {
      getTypeParser: ((oid: number, format?: "text" | "binary") =>
        oid === 1082 ? dateAsText : pg.types.getTypeParser(oid, format as "text")) as never,
    },
  });
  await client.connect();
  try {
    const r = await client.query(
      `SELECT current_database() AS db, current_user AS usr,
              current_setting('hg.disposable', true) AS marker,
              (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS privileged`
    );
    const { db, usr, marker, privileged } = r.rows[0] as {
      db: string;
      usr: string;
      marker: string | null;
      privileged: boolean;
    };
    if (db !== DISPOSABLE.database || marker !== "yes") {
      throw new TargetRefusedError("the database does not carry the hg.disposable marker");
    }
    if (usr !== ROLE_NAME[role]) throw new TargetRefusedError(`connected as ${usr}`);
    if (role !== "owner" && (LOT_ROLES.indexOf(usr) === -1 || privileged)) {
      throw new TargetRefusedError(`${usr} must be a lot role without special attributes`);
    }
  } catch (error) {
    await client.end();
    throw error;
  }
  return client;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const KIND_TABLE: Record<RecordKind, string> = {
  OFFICIAL_ACTOR: "OfficialActor",
  OFFICIAL_ORGAN: "OfficialOrganRecord",
  GROUP_MEMBERSHIP: "GroupMembershipRecord",
  SEAT_MANDATE: "SeatMandateRecord",
  SCRUTIN_ATTESTATION: "ScrutinVoterAttestation",
  SCRUTIN_COUNT_CHECK: "ScrutinCountCheck",
  SCRUTIN_GROUP_COUNT_CHECK: "ScrutinGroupCountCheck",
};

export const STREAM_KINDS = {
  amo30: ["OFFICIAL_ACTOR", "OFFICIAL_ORGAN", "GROUP_MEMBERSHIP", "SEAT_MANDATE"],
  scrutins: ["SCRUTIN_ATTESTATION", "SCRUTIN_COUNT_CHECK", "SCRUTIN_GROUP_COUNT_CHECK"],
} as const satisfies Record<string, readonly RecordKind[]>;

export const kindsOfStream = (stream: string): readonly RecordKind[] =>
  stream === "AN_AMO30" ? STREAM_KINDS.amo30 : STREAM_KINDS.scrutins;

/**
 * The content columns of each table, in the order of the row. A test keeps them equal to the keys
 * of the rows `rows.ts` produces: a column added on one side only fails there.
 */
export const CONTENT_COLUMNS: Record<RecordKind, readonly string[]> = {
  OFFICIAL_ACTOR: ["officialId"],
  OFFICIAL_ORGAN: [
    "organeRef",
    "codeType",
    "legislature",
    "label",
    "abbreviation",
    "startDate",
    "endDate",
  ],
  GROUP_MEMBERSHIP: [
    "sourceRecordId",
    "officialId",
    "chamber",
    "groupRef",
    "legislature",
    "qualityCode",
    "isPrincipal",
    "precedence",
    "startDate",
    "startState",
    "endDate",
    "endState",
    "publicationDate",
  ],
  SEAT_MANDATE: [
    "sourceRecordId",
    "officialId",
    "legislature",
    "startDate",
    "startState",
    "endDate",
    "endState",
  ],
  SCRUTIN_ATTESTATION: [
    "scrutinExternalId",
    "officialId",
    "scrutinDate",
    "legislature",
    "publishedOrganRef",
    "publishedPosition",
    "byDelegation",
    "seatMandateRef",
  ],
  SCRUTIN_COUNT_CHECK: [
    "scrutinExternalId",
    "scrutinDate",
    "legislature",
    "countCoherence",
    "groupCount",
    "mismatchedGroups",
    "unverifiableGroups",
    "nominalPour",
    "nominalContre",
    "nominalAbstention",
    "nominalNonVotant",
    "officialPour",
    "officialContre",
    "officialAbstention",
    "officialNonVotant",
    "diffPour",
    "diffContre",
    "diffAbstention",
    "diffNonVotant",
    "miseAuPointListedVotants",
    "miseAuPointMalformedBlocks",
  ],
  SCRUTIN_GROUP_COUNT_CHECK: [
    "scrutinExternalId",
    "organRef",
    "organOrdinal",
    "groupCoherence",
    "nominalPour",
    "nominalContre",
    "nominalAbstention",
    "nominalNonVotant",
    "officialPour",
    "officialContre",
    "officialAbstention",
    "officialNonVotant",
    "diffPour",
    "diffContre",
    "diffAbstention",
    "diffNonVotant",
  ],
};

const q = (name: string) => `"${name}"`;
export const keyColumns = (kind: RecordKind): string[] =>
  RECORD_IDENTITY[kind] as unknown as string[];

export interface StoredRecord {
  kind: RecordKind;
  key: string;
  row: Record<string, unknown>;
  rawHash: string;
  memberHash: string;
  sourceMember: string;
}

const keyOfStored = (kind: RecordKind, row: Record<string, unknown>): string =>
  JSON.stringify(keyColumns(kind).map((c) => row[c]));

/**
 * The records of a table that hold at snapshot `seq` of a stream, in key order, by pages (keyset
 * pagination on the primary key: no cursor, no offset, a bounded page in memory).
 */
export async function* readRecordsAt(
  client: pg.Client,
  stream: string,
  seq: number,
  kind: RecordKind,
  pageSize = 20_000
): AsyncGenerator<StoredRecord> {
  const keys = keyColumns(kind);
  const columns = [...CONTENT_COLUMNS[kind], "rawHash", "memberHash", "sourceMember"];
  const keyList = keys.map(q).join(", ");
  let last: unknown[] | null = null;
  for (;;) {
    const after = last ? ` AND (${keyList}) > (${keys.map((_, i) => `$${i + 4}`).join(", ")})` : "";
    const result: pg.QueryResult = await client.query(
      `SELECT ${columns.map(q).join(", ")} FROM ${q(KIND_TABLE[kind])}
       WHERE "stream" = $1 AND "fromSeq" <= $2 AND ("toSeq" IS NULL OR "toSeq" > $2)${after}
       ORDER BY ${keyList} LIMIT $3`,
      [stream, seq, pageSize, ...(last ?? [])]
    );
    for (const raw of result.rows as Record<string, unknown>[]) {
      const row: Record<string, unknown> = {};
      for (const c of CONTENT_COLUMNS[kind]) row[c] = raw[c];
      yield {
        kind,
        key: keyOfStored(kind, row),
        row,
        rawHash: raw["rawHash"] as string,
        memberHash: raw["memberHash"] as string,
        sourceMember: raw["sourceMember"] as string,
      };
    }
    if (result.rows.length < pageSize) return;
    const tail = result.rows[result.rows.length - 1] as Record<string, unknown>;
    last = keys.map((c) => tail[c]);
  }
}

export interface SnapshotRow {
  id: string;
  stream: string;
  seq: number;
  artifactSha256: string;
  parserVersion: string;
  stateHash: string;
  integrity: string;
  sourceAsOf: Date | null;
  recordCounts: unknown;
}

const SNAPSHOT_COLUMNS = `"id","stream","seq","artifactSha256","parserVersion","stateHash","integrity","sourceAsOf","recordCounts"`;

export async function latestSnapshot(
  client: pg.Client,
  stream: string
): Promise<SnapshotRow | null> {
  const r = await client.query(
    `SELECT ${SNAPSHOT_COLUMNS} FROM "OfficialSourceSnapshot" WHERE "stream" = $1 ORDER BY "seq" DESC LIMIT 1`,
    [stream]
  );
  return (r.rows[0] as SnapshotRow | undefined) ?? null;
}

export async function snapshotAt(
  client: pg.Client,
  stream: string,
  seq: number
): Promise<SnapshotRow | null> {
  const r = await client.query(
    `SELECT ${SNAPSHOT_COLUMNS} FROM "OfficialSourceSnapshot" WHERE "stream" = $1 AND "seq" = $2`,
    [stream, seq]
  );
  return (r.rows[0] as SnapshotRow | undefined) ?? null;
}

export async function snapshotByArtifact(
  client: pg.Client,
  stream: string,
  sha256: string,
  parserVersion: string
): Promise<SnapshotRow | null> {
  const r = await client.query(
    `SELECT ${SNAPSHOT_COLUMNS} FROM "OfficialSourceSnapshot"
     WHERE "stream" = $1 AND "artifactSha256" = $2 AND "parserVersion" = $3`,
    [stream, sha256, parserVersion]
  );
  return (r.rows[0] as SnapshotRow | undefined) ?? null;
}

/** Status in force of a snapshot: the last decision, a revocation being final. */
export async function snapshotStatus(
  client: pg.Client,
  snapshotId: string
): Promise<"QUARANTINED" | "RELEASED" | "REVOKED"> {
  const r = await client.query(
    `SELECT "status" FROM "SnapshotDecision" WHERE "snapshotId" = $1 ORDER BY "decisionNo"`,
    [snapshotId]
  );
  const statuses = r.rows.map((x: { status: string }) => x.status);
  if (statuses.includes("REVOKED")) return "REVOKED";
  const last = statuses[statuses.length - 1];
  return (last as "QUARANTINED" | "RELEASED" | undefined) ?? "QUARANTINED";
}

/** Rows per INSERT: the protocol allows 65 535 parameters. */
export const maxRowsPerInsert = (columnCount: number): number =>
  Math.max(1, Math.floor(60_000 / columnCount));

export async function insertRows(
  client: pg.Client,
  table: string,
  columns: readonly string[],
  rows: readonly unknown[][]
): Promise<void> {
  const size = maxRowsPerInsert(columns.length);
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const values = chunk
      .map((_, r) => `(${columns.map((_c, c) => `$${r * columns.length + c + 1}`).join(", ")})`)
      .join(", ");
    await client.query(
      `INSERT INTO ${q(table)} (${columns.map(q).join(", ")}) VALUES ${values}`,
      chunk.flat()
    );
  }
}
