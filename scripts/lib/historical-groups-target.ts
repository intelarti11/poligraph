/**
 * The explicitly authorised shared target of the historical group tools (lot 5D).
 *
 * The default of the tools stays the disposable local database (`historical-groups-db.ts`). A shared
 * database is reachable only through the checks below, and every one of them must pass:
 *
 *  1. The target is NAMED: `HG_TARGET=shared`. A URL alone never selects it.
 *  2. The URL is a direct PostgreSQL connection: not a pooler (port 6543, a pooler host, a
 *     `role.project` user name), and the server is authenticated by TLS: `sslmode=verify-full`, with the
 *     provider's CA certificate in `HG_TARGET_CA_FILE`. Certificate chain AND host name are verified.
 *     `require` and `verify-ca` are refused: depending on the library they check the chain, the name,
 *     both or neither, and a connection that "uses TLS" without authenticating the server is not enough.
 *  3. The host fingerprint equals the expected one (`HG_EXPECTED_TARGET_FINGERPRINT`).
 *  4. The user is the role of the tool, and that role has no special attribute.
 *  5. Once connected, the identity of the PROJECT is checked inside the database, not from the URL:
 *     the system identifier of the cluster must equal `HG_EXPECTED_SYSTEM_IDENTIFIER`. A host name can
 *     be aliased or reused, the identifier of the cluster cannot. A database that does not let it be
 *     read is refused.
 *  6. The session is a real session (a pooler that swaps backends between statements is detected), over
 *     TLS, on a primary that is not in recovery.
 *  7. The execution mode is declared. `plan` is read only. `apply` also needs the written
 *     acknowledgement of this very target (`HG_ALLOW_SHARED_WRITE` = the start of its fingerprint),
 *     and, in the CLI, the hash of the plan being applied.
 *
 * No value read from the environment is ever written to a log or an error message.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import { TargetRefusedError, type ToolRole } from "./historical-groups-db";

export type Execution = "plan" | "apply";

const ROLE_NAME: Record<Exclude<ToolRole, "owner">, string> = {
  importer: "hg_importer",
  runner: "hg_runner",
  reader: "hg_reader",
};
const LOT_ROLES = Object.values(ROLE_NAME);

/** Fingerprint of where a URL points: host, port and database, nothing else. Safe to print. */
export function targetFingerprint(url: string): string {
  const target = new URL(url);
  return createHash("sha256")
    .update(`${target.hostname.toLowerCase()}:${target.port || "5432"}/${target.pathname.slice(1)}`)
    .digest("hex");
}

export interface SharedTarget {
  url: string;
  role: ToolRole;
  expectedFingerprint: string;
  expectedSystemIdentifier: string;
  execution: Execution;
  /** The role name of the owner, only for the human gesture `release`. */
  ownerRole: string | null;
  /** PEM file of the CA that signs the server certificate. */
  caFile: string;
}

type Env = Record<string, string | undefined>;

const POOLER_HOST = /pooler|supavisor|pgbouncer/i;
const POOLER_PORTS = new Set(["6543"]);

/**
 * Everything that can be refused from the configuration alone, before any connection.
 * Returns the target to connect to; throws `TargetRefusedError` otherwise.
 */
export function resolveSharedTarget(
  url: string,
  role: ToolRole,
  execution: Execution,
  env: Env
): SharedTarget {
  if (env["HG_TARGET"] !== "shared") {
    throw new TargetRefusedError("the shared target is not named (HG_TARGET=shared)");
  }
  const expectedFingerprint = env["HG_EXPECTED_TARGET_FINGERPRINT"];
  const expectedSystemIdentifier = env["HG_EXPECTED_SYSTEM_IDENTIFIER"];
  if (!expectedFingerprint || !/^[0-9a-f]{64}$/.test(expectedFingerprint)) {
    throw new TargetRefusedError("the expected fingerprint of the target is not configured");
  }
  if (!expectedSystemIdentifier || !/^\d{10,25}$/.test(expectedSystemIdentifier)) {
    throw new TargetRefusedError("the expected system identifier of the project is not configured");
  }
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new TargetRefusedError("not a URL");
  }
  if (target.protocol !== "postgresql:" && target.protocol !== "postgres:") {
    throw new TargetRefusedError("not a PostgreSQL URL");
  }
  const mode = env["HG_CONNECTION_MODE"] ?? "direct";
  if (mode !== "direct" && mode !== "session-pooler") {
    throw new TargetRefusedError("HG_CONNECTION_MODE is direct or session-pooler");
  }
  // The transactional port of a pooler is refused in every mode: it hands a backend to each statement.
  if (POOLER_PORTS.has(target.port)) {
    throw new TargetRefusedError(
      "a transactional pooler is refused: a direct or session-mode connection is required"
    );
  }
  const rawUser = decodeURIComponent(target.username);
  let user = rawUser;
  if (mode === "direct") {
    if (POOLER_HOST.test(target.hostname)) {
      throw new TargetRefusedError(
        "a pooler is refused in direct mode: a direct connection is required (or HG_CONNECTION_MODE=session-pooler)"
      );
    }
    if (rawUser.includes(".")) {
      throw new TargetRefusedError(
        "a pooled user name (role.project) is refused: a direct connection is required"
      );
    }
  } else {
    // Session mode of a pooler: a real session (the in-database probe still proves it), on the session
    // port, with the pooler's `role.project` user name. The role is what precedes the dot.
    if (!POOLER_HOST.test(target.hostname)) {
      throw new TargetRefusedError("the session-pooler mode expects a pooler host");
    }
    if (target.port !== "5432") {
      throw new TargetRefusedError("the session-pooler mode uses the session port 5432");
    }
    const parts = rawUser.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new TargetRefusedError(
        "the session-pooler mode expects a user name of the form role.project"
      );
    }
    user = parts[0];
  }
  if (target.searchParams.get("sslmode") !== "verify-full") {
    throw new TargetRefusedError(
      "the server must be authenticated: sslmode=verify-full is required"
    );
  }
  const caFile = env["HG_TARGET_CA_FILE"];
  if (!caFile) {
    throw new TargetRefusedError(
      "the CA certificate of the server is not configured (HG_TARGET_CA_FILE)"
    );
  }
  let pem: string;
  try {
    pem = fs.readFileSync(caFile, "utf8");
  } catch {
    throw new TargetRefusedError("the CA certificate file cannot be read");
  }
  if (!/-----BEGIN CERTIFICATE-----[\s\S]*-----END CERTIFICATE-----/.test(pem)) {
    throw new TargetRefusedError("the CA certificate file holds no certificate");
  }
  for (const name of ["DATABASE_URL"]) {
    if (env[name] !== undefined && env[name] === url) {
      throw new TargetRefusedError(
        `the URL is the one of ${name}, the application's pooled connection`
      );
    }
  }
  const fingerprint = targetFingerprint(url);
  if (fingerprint !== expectedFingerprint) {
    throw new TargetRefusedError("the host fingerprint is not the expected one");
  }
  let ownerRole: string | null = null;
  if (role === "owner") {
    ownerRole = env["HG_SHARED_OWNER_ROLE"] ?? null;
    if (!ownerRole || LOT_ROLES.includes(ownerRole)) {
      throw new TargetRefusedError("the owner role of the human gesture is not configured");
    }
    if (user !== ownerRole)
      throw new TargetRefusedError("this tool connects as the configured owner role");
  } else if (user !== ROLE_NAME[role]) {
    throw new TargetRefusedError(`this tool connects as ${ROLE_NAME[role]}`);
  }
  if (execution === "apply") {
    const acknowledgement = env["HG_ALLOW_SHARED_WRITE"];
    if (!acknowledgement) {
      throw new TargetRefusedError("a write on the shared target needs HG_ALLOW_SHARED_WRITE");
    }
    if (acknowledgement !== fingerprint.slice(0, 16)) {
      throw new TargetRefusedError("HG_ALLOW_SHARED_WRITE does not acknowledge this target");
    }
  }
  return { url, role, expectedFingerprint, expectedSystemIdentifier, execution, ownerRole, caFile };
}

/** What `verifyConnectedTarget` needs from a client. A stub implements it in the tests. */
export interface QueryClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

const LOCK_KEY = "hg-target-session-check";

/** Checks made once connected. Throws `TargetRefusedError`; the caller closes the connection. */
export async function verifyConnectedTarget(
  client: QueryClient,
  target: SharedTarget
): Promise<void> {
  const first = await client.query(
    `SELECT current_user AS usr, pg_backend_pid() AS pid, pg_is_in_recovery() AS recovery,
            (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl,
            (SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb FROM pg_roles WHERE rolname = current_user) AS privileged`
  );
  const row = first.rows[0] as {
    usr: string;
    pid: number;
    recovery: boolean;
    ssl: boolean | null;
    privileged: boolean | null;
  };
  const expectedUser = target.role === "owner" ? target.ownerRole : ROLE_NAME[target.role];
  if (row.usr !== expectedUser)
    throw new TargetRefusedError(`connected as another role than ${expectedUser}`);
  if (target.role !== "owner" && row.privileged !== false) {
    throw new TargetRefusedError(
      "the role has a special attribute (superuser, bypass RLS, create role or database)"
    );
  }
  if (row.ssl !== true) throw new TargetRefusedError("the session is not over TLS");
  if (row.recovery !== false)
    throw new TargetRefusedError("the server is in recovery: not a primary");

  let identifier: string | null = null;
  try {
    const r = await client.query("SELECT system_identifier::text AS id FROM pg_control_system()");
    identifier = (r.rows[0] as { id?: string } | undefined)?.id ?? null;
  } catch {
    identifier = null;
  }
  if (identifier === null)
    throw new TargetRefusedError("the identity of the project cannot be read");
  if (identifier !== target.expectedSystemIdentifier) {
    throw new TargetRefusedError("this is not the expected project (system identifier differs)");
  }

  // A transactional pooler hands a different backend to each statement, so a session lock taken
  // by one statement is not seen by the next. Three rounds, and the backend must never change.
  await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [LOCK_KEY]);
  try {
    for (let round = 0; round < 3; round += 1) {
      const probe = await client.query(
        `SELECT pg_backend_pid() AS pid,
                (SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted)::int AS held`
      );
      const p = probe.rows[0] as { pid: number; held: number };
      if (p.pid !== row.pid || p.held < 1) {
        throw new TargetRefusedError(
          "the connection is pooled (the session changed between statements)"
        );
      }
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [LOCK_KEY])
      .catch(() => undefined);
  }
}

export async function connectShared(
  url: string,
  role: ToolRole,
  execution: Execution,
  env: Env = process.env
): Promise<pg.Client> {
  const target = resolveSharedTarget(url, role, execution, env);
  // The parts of the URL are passed one by one, with an explicit TLS configuration: a connection string
  // carrying `sslmode` would override it, and libraries differ on what each mode verifies.
  const parsed = new URL(target.url);
  const client = new pg.Client({
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.slice(1),
    ssl: {
      ca: fs.readFileSync(target.caFile, "utf8"),
      rejectUnauthorized: true,
      servername: parsed.hostname,
    },
    types: {
      getTypeParser: ((oid: number, format?: "text" | "binary") =>
        oid === 1082 ? (v: string) => v : pg.types.getTypeParser(oid, format as "text")) as never,
    },
  });
  await client.connect();
  try {
    await verifyConnectedTarget(client, target);
  } catch (error) {
    await client.end();
    throw error;
  }
  return client;
}
