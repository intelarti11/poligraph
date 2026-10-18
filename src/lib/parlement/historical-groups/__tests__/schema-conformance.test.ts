// @vitest-environment node
/**
 * Static conformance of the lot 5B schema: the manual SQL, the Prisma models and the architecture
 * rules, checked from the text of the files. No database is touched.
 *
 * What this cannot prove: that PostgreSQL accepts the statements and enforces them as written. That
 * is the job of `schema.integration.test.ts` (disposable database, not run in CI without a decision)
 * and of the verification plan in docs/audits/parlement-historique-lot5b-schema.md.
 *
 * A check that cannot fail proves nothing, so `violations` is also run on damaged copies of the SQL
 * and must name each damage.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SQL_PATH = "prisma/migrations/manual/2026-10-18-historical-groups-schema.sql";
const ROLLBACK_PATH = "prisma/migrations/manual/2026-10-18-historical-groups-schema-rollback.sql";
const read = (path: string) => readFileSync(path, "utf8");

// ---------------------------------------------------------------------------
// Reading the SQL
// ---------------------------------------------------------------------------

interface Column {
  name: string;
  type: string;
  notNull: boolean;
  default: string | null;
}
interface Constraint {
  name: string;
  kind: "PRIMARY KEY" | "UNIQUE" | "FOREIGN KEY" | "CHECK" | "EXCLUDE";
  columns: string[];
  references?: { table: string; columns: string[] };
  text: string;
}
interface Table {
  name: string;
  columns: Column[];
  constraints: Constraint[];
}
interface Index {
  name: string;
  table: string;
  columns: string[];
  unique: boolean;
  where: string | null;
}
interface Trigger {
  name: string;
  table: string;
  timing: string;
  level: string;
  fn: string;
  always: boolean;
}

const idents = (list: string) => [...list.matchAll(/"(\w+)"/g)].map((m) => m[1] as string);

const REFERENCE_MARK =
  "-- hg:reference-build\nSET LOCAL search_path TO hg_reference, pg_catalog;\n";
const REAL_MARK = "-- hg:real-build\nSET LOCAL search_path TO public, pg_catalog;\n";
const PRECHECK_MARK = "-- hg:precheck\n";
const POSTCHECK_MARK = "-- hg:postcheck\n";

/** The DDL text built in the reference schema, before the real build. */
export function referenceBuildOf(sql: string): string {
  const start = sql.indexOf(REFERENCE_MARK);
  const end = sql.indexOf(`\n${PRECHECK_MARK.split("\n")[0]}`);
  return start === -1 || end === -1 ? "" : sql.slice(start + REFERENCE_MARK.length, end);
}

/** The DDL text built in the real schema. It is what the tables, triggers and indexes are read from. */
export function ddlOf(sql: string): string {
  const start = sql.indexOf(REAL_MARK);
  const end = sql.indexOf(`\n${POSTCHECK_MARK}`);
  return start === -1 || end === -1 ? "" : sql.slice(start + REAL_MARK.length, end);
}

export function parseTables(ddl: string): Table[] {
  const tables: Table[] = [];
  for (const m of ddl.matchAll(/CREATE TABLE IF NOT EXISTS "(\w+)" \(\n([\s\S]*?)\n\);/g)) {
    const columns: Column[] = [];
    const constraints: Constraint[] = [];
    for (const line of (m[2] as string).split("\n")) {
      const column = /^ {4}"(\w+)" ([A-Z0-9()]+)( NOT NULL)?(?: DEFAULT (.+?))?,?$/.exec(line);
      if (column && !line.includes("CONSTRAINT")) {
        columns.push({
          name: column[1] as string,
          type: column[2] as string,
          notNull: Boolean(column[3]),
          default: column[4] ?? null,
        });
        continue;
      }
      const constraint =
        /^ {4}CONSTRAINT "(\w+)" (PRIMARY KEY|UNIQUE|FOREIGN KEY|CHECK|EXCLUDE)(.*?),?$/.exec(line);
      if (!constraint) continue;
      const kind = constraint[2] as Constraint["kind"];
      const rest = constraint[3] as string;
      const entry: Constraint = {
        name: constraint[1] as string,
        kind,
        columns:
          kind === "CHECK" || kind === "EXCLUDE"
            ? []
            : idents(/^\s*\(([^)]*)\)/.exec(rest)?.[1] ?? ""),
        text: rest,
      };
      if (kind === "FOREIGN KEY") {
        const ref = /REFERENCES "(\w+)"\(([^)]*)\)/.exec(rest);
        if (ref) entry.references = { table: ref[1] as string, columns: idents(ref[2] as string) };
      }
      constraints.push(entry);
    }
    tables.push({ name: m[1] as string, columns, constraints });
  }
  return tables;
}

export function parseIndexes(ddl: string): Index[] {
  return [
    ...ddl.matchAll(
      /CREATE (UNIQUE )?INDEX IF NOT EXISTS "(\w+)" ON "(\w+)"\(([^)]*)\)(?: WHERE (.+?))?;/g
    ),
  ].map((m) => ({
    unique: Boolean(m[1]),
    name: m[2] as string,
    table: m[3] as string,
    columns: idents(m[4] as string),
    where: m[5] ?? null,
  }));
}

export function parseTriggers(ddl: string): Trigger[] {
  const always = new Set(
    [...ddl.matchAll(/ALTER TABLE "(\w+)" ENABLE ALWAYS TRIGGER "(\w+)";/g)].map(
      (m) => `${m[1]}.${m[2]}`
    )
  );
  return [
    ...ddl.matchAll(
      /CREATE OR REPLACE TRIGGER "(\w+)" (BEFORE [A-Z ]+?) ON "(\w+)" FOR EACH (ROW|STATEMENT) EXECUTE FUNCTION (\w+)\(\);/g
    ),
  ].map((m) => ({
    name: m[1] as string,
    timing: m[2] as string,
    table: m[3] as string,
    level: m[4] as string,
    fn: m[5] as string,
    always: always.has(`${m[3]}.${m[1]}`),
  }));
}

/** What remains of the SQL once comments and quoted text are blanked: only executable words. */
export function executableText(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\$fn\$[\s\S]*?\$fn\$/g, "$fn$$fn$");
}

// ---------------------------------------------------------------------------
// Reading the Prisma models
// ---------------------------------------------------------------------------

interface PrismaModel {
  name: string;
  columns: { name: string; type: string; notNull: boolean; hasDefaultNow: boolean }[];
  id: string[];
  uniques: { name: string; columns: string[] }[];
  indexes: { name: string; columns: string[] }[];
  relations: { name: string; columns: string[]; references: string[] }[];
}

const SCALARS: Record<string, string> = {
  String: "TEXT",
  Int: "INTEGER",
  BigInt: "BIGINT",
  Boolean: "BOOLEAN",
  Json: "JSONB",
};

export function parsePrismaModels(schema: string): Map<string, PrismaModel> {
  const models = new Map<string, PrismaModel>();
  for (const m of schema.matchAll(/^model (\w+) \{\n([\s\S]*?)\n\}/gm)) {
    const model: PrismaModel = {
      name: m[1] as string,
      columns: [],
      id: [],
      uniques: [],
      indexes: [],
      relations: [],
    };
    for (const raw of (m[2] as string).split("\n")) {
      const line = raw.trim();
      if (line.startsWith("//") || line === "") continue;
      const list = (text: string) => text.split(",").map((s) => s.trim());
      const blockId = /^@@id\(\[([^\]]*)\]/.exec(line);
      if (blockId) model.id = list(blockId[1] as string);
      const blockUnique = /^@@unique\(\[([^\]]*)\], map: "(\w+)"/.exec(line);
      if (blockUnique)
        model.uniques.push({
          name: blockUnique[2] as string,
          columns: list(blockUnique[1] as string),
        });
      const blockIndex = /^@@index\(\[([^\]]*)\], map: "(\w+)"/.exec(line);
      if (blockIndex)
        model.indexes.push({
          name: blockIndex[2] as string,
          columns: list(blockIndex[1] as string),
        });
      if (line.startsWith("@@")) continue;
      const field = /^(\w+)\s+(\w+)(\?|\[\])?(.*)$/.exec(line);
      if (!field) continue;
      const [, name, type, modifier, attrs] = field as unknown as [
        string,
        string,
        string,
        string | undefined,
        string,
      ];
      const relation =
        /@relation\((?:"\w+", )?fields: \[([^\]]*)\], references: \[([^\]]*)\], map: "(\w+)"/.exec(
          attrs
        );
      if (relation) {
        model.relations.push({
          name: relation[3] as string,
          columns: list(relation[1] as string),
          references: list(relation[2] as string),
        });
        continue;
      }
      if (modifier === "[]" || attrs.includes("@relation")) continue;
      let sqlType: string | undefined = SCALARS[type];
      if (type === "DateTime") sqlType = attrs.includes("@db.Date") ? "DATE" : "TIMESTAMPTZ(3)";
      if (type === "BigInt" && attrs.includes("autoincrement()")) sqlType = "BIGSERIAL";
      if (!sqlType) continue;
      model.columns.push({
        name,
        type: sqlType,
        notNull: modifier !== "?",
        hasDefaultNow: attrs.includes("@default(now())"),
      });
      if (/\s@id\b/.test(` ${attrs}`)) model.id = [name];
      const unique = /@unique\(map: "(\w+)"\)/.exec(attrs);
      if (unique) model.uniques.push({ name: unique[1] as string, columns: [name] });
    }
    models.set(model.name, model);
  }
  return models;
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

const VERSION_TABLES = [
  "OfficialActor",
  "OfficialOrganRecord",
  "GroupMembershipRecord",
  "SeatMandateRecord",
  "ScrutinVoterAttestation",
];

export function violations(sql: string, schema: string): string[] {
  const out: string[] = [];
  const ddl = ddlOf(sql);
  const tables = parseTables(ddl);
  const indexes = parseIndexes(ddl);
  const triggers = parseTriggers(ddl);
  const names = new Set(tables.map((t) => t.name));
  const byName = new Map(tables.map((t) => [t.name, t]));

  // Transaction and divergence guard: IF NOT EXISTS is not a guarantee, the comparison is.
  if (!/^BEGIN;$/m.test(sql) || !/^COMMIT;$/m.test(sql))
    out.push("script is not wrapped in one transaction");
  if (!sql.includes("CREATE SCHEMA hg_reference;")) out.push("no reference schema is built");
  if (ddl === "" || ddl !== referenceBuildOf(sql))
    out.push("the reference build and the real build are not the same text");
  if (
    !/CAST\(\s*'The existing historical groups schema differs from the expected definition/.test(
      sql
    )
  )
    out.push("no divergence error");
  // Order: the reference is built, then the real schema is compared BEFORE anything is written to
  // it, then built, then compared again. A check placed after the build could not stop a repair.
  const at = (mark: string) => sql.indexOf(mark.split("\n")[0] as string);
  if (
    !(
      at(REFERENCE_MARK) < at(PRECHECK_MARK) &&
      at(PRECHECK_MARK) < at(REAL_MARK) &&
      at(REAL_MARK) < at(POSTCHECK_MARK)
    )
  ) {
    out.push("the comparison before the real build is missing or out of order");
  }
  const precheck = sql.slice(at(PRECHECK_MARK), at(REAL_MARK));
  const postcheck = sql.slice(at(POSTCHECK_MARK));
  if (
    !/CAST\(\s*'The existing historical groups schema differs from the expected definition/.test(
      precheck
    )
  )
    out.push("no divergence error before the real build");
  if (!/CAST\(\s*'The historical groups schema built here differs/.test(postcheck))
    out.push("no divergence error after the real build");
  if (!precheck.includes("partial installation")) out.push("a partial installation is not refused");
  for (const kind of ["column", "constraint", "index", "trigger", "table", "acl", "function"]) {
    if (!precheck.includes(`'${kind}'`)) out.push(`the catalog comparison does not cover ${kind}s`);
  }
  // No repair: nothing in the pre-check section writes to the real schema.
  if (
    /\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|FUNCTION|TRIGGER)\b/i.test(
      precheck.replace(/CREATE TEMP TABLE hg_catalog_dump/, "")
    )
  )
    out.push("the comparison section changes the schema");
  // The repository's SEC-06 contract: plain SQL, no DO block, no dynamic SQL, no SECURITY DEFINER.
  const plain = executableText(sql);
  if (/\bDO\s+\$/i.test(plain) || /\bDO\s+'/i.test(plain))
    out.push("a DO block (forbidden by the SEC-06 source guard)");
  if (/\bEXECUTE\b(?!\s+FUNCTION\b)/i.test(plain))
    out.push("dynamic SQL (forbidden by the SEC-06 source guard)");
  if (/\bSECURITY\s+DEFINER\b/i.test(plain)) out.push("SECURITY DEFINER (forbidden by SEC-06)");

  // Identifier length: PostgreSQL truncates beyond 63 bytes without a word.
  for (const id of new Set(sql.match(/"[A-Za-z0-9_]+"/g) ?? [])) {
    if (Buffer.byteLength(id) - 2 > 63) out.push(`identifier longer than 63 bytes: ${id}`);
  }

  // Nothing existing is touched: no reference to a model that is not part of the lot.
  const managed = names;
  for (const model of parsePrismaModels(schema).keys()) {
    if (!managed.has(model) && new RegExp(`"${model}"`).test(sql))
      out.push(`the SQL names the existing model ${model}`);
  }
  const code = executableText(sql);
  for (const forbidden of [
    /\bDELETE\s+FROM\b/i,
    /\bTRUNCATE\s+TABLE\b/i,
    /\bUPDATE\s+"?\w+"?\s+SET\b/i,
    /\bDROP\s+(TABLE|INDEX|COLUMN|TRIGGER|FUNCTION|TYPE|EXTENSION)\b/i,
    /\bALTER\s+TABLE\s+"?\w+"?\s+(ADD|DROP|RENAME|ALTER)\b/i,
    /\bINSERT\s+INTO\s+"/i,
  ]) {
    if (forbidden.test(code)) out.push(`forbidden statement: ${forbidden.source}`);
  }
  if ((code.match(/DROP SCHEMA/g) ?? []).length !== 2)
    out.push("DROP SCHEMA must appear exactly twice, on hg_reference only");
  if (/DROP SCHEMA (?!IF EXISTS hg_reference|hg_reference)/.test(code))
    out.push("DROP SCHEMA on something other than hg_reference");
  if (/\bGRANT\b/i.test(code))
    out.push("a GRANT: the tables stay closed to every application role");

  for (const table of tables) {
    const pk = table.constraints.find((c) => c.kind === "PRIMARY KEY");
    if (!pk) out.push(`${table.name}: no primary key`);
    if (!new RegExp(`ALTER TABLE "${table.name}" ENABLE ROW LEVEL SECURITY;`).test(ddl))
      out.push(`${table.name}: RLS not enabled`);
    if (!triggers.some((t) => t.table === table.name && t.timing === "BEFORE TRUNCATE" && t.always))
      out.push(`${table.name}: TRUNCATE is not refused`);
    for (const t of triggers.filter((x) => x.table === table.name)) {
      if (!t.always)
        out.push(
          `${table.name}: trigger ${t.name} is not ENABLE ALWAYS (a replica session would bypass it)`
        );
    }
    const mutationGuarded = triggers.some(
      (t) =>
        (t.table === table.name &&
          /UPDATE/.test(t.timing) &&
          /DELETE|INSERT OR UPDATE/.test(t.timing + t.fn)) ||
        (t.table === table.name && /DELETE/.test(t.timing))
    );
    if (!mutationGuarded) out.push(`${table.name}: UPDATE and DELETE are not restricted`);
    if (!table.constraints.some((c) => c.kind === "CHECK"))
      out.push(`${table.name}: no CHECK constraint`);
    // Foreign keys: the target exists in the lot, and is backed by a PRIMARY KEY or UNIQUE constraint
    // on exactly the referenced columns (PostgreSQL refuses a foreign key otherwise).
    for (const fk of table.constraints.filter((c) => c.kind === "FOREIGN KEY")) {
      const target = fk.references ? byName.get(fk.references.table) : undefined;
      if (!fk.references || !target) {
        out.push(
          `${table.name}.${fk.name}: references a table outside the lot (${fk.references?.table})`
        );
        continue;
      }
      const same = (a: string[], b: string[]) =>
        a.length === b.length && a.every((x, i) => x === b[i]);
      const backed = target.constraints.some(
        (c) =>
          (c.kind === "PRIMARY KEY" || c.kind === "UNIQUE") &&
          same(c.columns, fk.references!.columns)
      );
      if (!backed)
        out.push(
          `${table.name}.${fk.name}: ${target.name}(${fk.references.columns.join(", ")}) has no PRIMARY KEY or UNIQUE constraint`
        );
      if (fk.columns.length !== fk.references.columns.length)
        out.push(`${table.name}.${fk.name}: column count differs from the target`);
      for (const [i, column] of fk.columns.entries()) {
        const here = table.columns.find((c) => c.name === column);
        const there = target.columns.find((c) => c.name === fk.references!.columns[i]);
        if (!here || !there || here.type !== there.type.replace("BIGSERIAL", "BIGINT"))
          out.push(`${table.name}.${fk.name}: column types differ on ${column}`);
      }
      if (!/ON DELETE RESTRICT ON UPDATE RESTRICT/.test(fk.text))
        out.push(`${table.name}.${fk.name}: not RESTRICT on delete and update`);
    }
  }

  // Version tables: the invariants of architecture 4.2, 4.3 and 4.6.
  for (const name of VERSION_TABLES) {
    const table = byName.get(name);
    if (!table) {
      out.push(`${name}: missing`);
      continue;
    }
    const has = (column: string, notNull?: boolean) => {
      const c = table.columns.find((x) => x.name === column);
      return c !== undefined && (notNull === undefined || c.notNull === notNull);
    };
    for (const column of ["stream", "fromSeq", "rawHash", "sourceMember"])
      if (!has(column, true)) out.push(`${name}: ${column} must exist and be NOT NULL`);
    if (!has("toSeq", false)) out.push(`${name}: toSeq must exist and be nullable`);
    const pk = table.constraints.find((c) => c.kind === "PRIMARY KEY");
    if (!pk || pk.columns[0] !== "stream" || pk.columns.at(-1) !== "fromSeq")
      out.push(`${name}: the key must be (stream, identity, fromSeq)`);
    const identity = (pk?.columns ?? []).slice(1, -1);
    const fks = table.constraints.filter((c) => c.kind === "FOREIGN KEY");
    for (const column of ["fromSeq", "toSeq"]) {
      if (
        !fks.some(
          (f) =>
            f.columns.join() === `stream,${column}` &&
            f.references?.table === "OfficialSourceSnapshot" &&
            f.references.columns.join() === "stream,seq"
        )
      )
        out.push(`${name}: no foreign key (stream, ${column}) to the snapshot`);
    }
    if (
      !table.constraints.some(
        (c) => c.kind === "CHECK" && /"toSeq" IS NULL OR "toSeq" > "fromSeq"/.test(c.text)
      )
    )
      out.push(`${name}: no CHECK toSeq > fromSeq`);
    if (
      !table.constraints.some(
        (c) => c.kind === "CHECK" && /"rawHash" ~ '\^\[0-9a-f\]\{64\}\$'/.test(c.text)
      )
    )
      out.push(`${name}: rawHash format is not checked`);
    const exclusion = table.constraints.find((c) => c.kind === "EXCLUDE");
    const wanted = ["stream", ...identity].map((c) => `"${c}" WITH =`).join(", ");
    if (
      !exclusion ||
      !exclusion.text.includes("USING gist") ||
      !exclusion.text.includes(wanted) ||
      !exclusion.text.includes(`int4range("fromSeq", "toSeq", '[)') WITH &&`)
    )
      out.push(`${name}: no exclusion constraint on (stream, identity, [fromSeq, toSeq))`);
    const active = indexes.find(
      (i) => i.table === name && i.unique && i.where === `"toSeq" IS NULL`
    );
    if (!active || active.columns.join() !== ["stream", ...identity].join())
      out.push(`${name}: no partial unique index on the active version of an identity`);
    const t = triggers.filter((x) => x.table === name);
    if (
      !t.some(
        (x) =>
          x.timing === "BEFORE INSERT OR UPDATE" &&
          x.fn === "historical_version_guard" &&
          x.level === "ROW"
      )
    )
      out.push(`${name}: no version guard`);
    if (!t.some((x) => x.timing === "BEFORE DELETE" && x.fn === "historical_refuse_mutation"))
      out.push(`${name}: DELETE is not refused`);
    if (table.columns.some((c) => /politician/i.test(c.name)))
      out.push(`${name}: evidence must not carry a Politician key`);
  }

  // Append-only logs.
  for (const name of [
    "SnapshotDecision",
    "OfficialActorLinkDecision",
    "OrganContinuityDecision",
    "OfficialSourceSnapshot",
    "HistoricalRunSnapshotPin",
    "RunExclusion",
  ]) {
    if (
      !triggers.some(
        (x) =>
          x.table === name &&
          x.timing === "BEFORE UPDATE OR DELETE" &&
          x.fn === "historical_refuse_mutation"
      )
    )
      out.push(`${name}: UPDATE and DELETE are not refused`);
  }
  if (!triggers.some((x) => x.table === "SourceArtifact" && x.fn === "historical_artifact_guard"))
    out.push("SourceArtifact: no guard on the one column that may change");
  if (
    !triggers.some((x) => x.table === "HistoricalResolutionRun" && x.fn === "historical_run_guard")
  )
    out.push("HistoricalResolutionRun: no guard on the inputs of a run");
  // Decisions: no link to Politician, a script cannot validate.
  const linkDecision = byName.get("OfficialActorLinkDecision");
  if (linkDecision?.constraints.some((c) => c.kind === "FOREIGN KEY"))
    out.push(
      "OfficialActorLinkDecision: must not hold a foreign key (the log outlives a person's record)"
    );
  for (const [name, fragment] of [
    ["OrganContinuityDecision", "only_proposals_by_script"],
    ["OfficialActorLinkDecision", "only_official_id_link_by_script"],
    ["SnapshotDecision", "release_and_revoke_by_human"],
  ] as const) {
    if (!byName.get(name)?.constraints.some((c) => c.name.endsWith(fragment)))
      out.push(`${name}: a script could write a validating decision`);
  }
  // Runs pin their inputs by rows that PostgreSQL can check.
  const pin = byName.get("HistoricalRunSnapshotPin");
  if (
    !pin?.constraints.some(
      (c) =>
        c.kind === "FOREIGN KEY" &&
        c.columns.join() === "stream,seq,stateHash" &&
        c.references?.table === "OfficialSourceSnapshot"
    )
  )
    out.push("a pin does not tie (stream, seq, stateHash) to the snapshot");
  for (const column of [
    "inputHash",
    "decisionsHash",
    "preparedInputsHash",
    "configHash",
    "parserVersion",
    "resolverVersion",
    "linkDecisionCutoff",
    "continuityDecisionCutoff",
  ]) {
    if (!byName.get("HistoricalResolutionRun")?.columns.some((c) => c.name === column && c.notNull))
      out.push(`HistoricalResolutionRun: ${column} must be NOT NULL`);
  }
  if (
    !byName
      .get("HistoricalResolutionRun")
      ?.constraints.some((c) => c.kind === "UNIQUE" && c.columns.join() === "inputHash")
  )
    out.push("HistoricalResolutionRun: inputHash is not UNIQUE");
  // Snapshots: contiguity and the two uniqueness constraints that foreign keys rely on.
  const snapshot = byName.get("OfficialSourceSnapshot");
  for (const key of ["stream,seq", "stream,seq,stateHash"]) {
    if (!snapshot?.constraints.some((c) => c.kind === "UNIQUE" && c.columns.join() === key))
      out.push(`OfficialSourceSnapshot: no UNIQUE (${key})`);
  }
  if (
    !triggers.some(
      (x) => x.table === "OfficialSourceSnapshot" && x.fn === "historical_snapshot_insert_guard"
    )
  )
    out.push("OfficialSourceSnapshot: no contiguity guard on seq");
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const SQL = read(SQL_PATH);
const SCHEMA = read("prisma/schema.prisma");
const COUNT_CHECK_PATH = "prisma/migrations/manual/2026-10-19-historical-groups-count-check.sql";
const COUNT_CHECK_SQL = read(COUNT_CHECK_PATH);

describe("lot 5B schema: static conformance", () => {
  it("respects every rule on the committed SQL", () => {
    expect(violations(SQL, SCHEMA)).toEqual([]);
  });

  it("creates the thirteen tables of the lot, and only those", () => {
    expect(parseTables(ddlOf(SQL)).map((t) => t.name)).toEqual([
      "SourceArtifact",
      "OfficialSourceSnapshot",
      "SnapshotDecision",
      "OfficialActor",
      "OfficialOrganRecord",
      "GroupMembershipRecord",
      "SeatMandateRecord",
      "ScrutinVoterAttestation",
      "OfficialActorLinkDecision",
      "OrganContinuityDecision",
      "HistoricalResolutionRun",
      "HistoricalRunSnapshotPin",
      "RunExclusion",
    ]);
  });

  it("agrees with the Prisma models: columns, keys, uniques, indexes and foreign keys", () => {
    const models = parsePrismaModels(SCHEMA);
    const ddl = ddlOf(SQL);
    const indexes = parseIndexes(ddl);
    const problems: string[] = [];
    for (const table of parseTables(ddl)) {
      const model = models.get(table.name);
      if (!model) {
        problems.push(`${table.name}: no Prisma model`);
        continue;
      }
      const sqlColumns = table.columns.map((c) => `${c.name}:${c.type}:${c.notNull}`);
      const prismaColumns = model.columns.map((c) => `${c.name}:${c.type}:${c.notNull}`);
      // BIGSERIAL is NOT NULL by nature; Prisma writes it as an autoincrement BigInt.
      if (sqlColumns.join("|") !== prismaColumns.join("|"))
        problems.push(
          `${table.name}: columns differ\n  sql    ${sqlColumns.join(" ")}\n  prisma ${prismaColumns.join(" ")}`
        );
      const pk = table.constraints.find((c) => c.kind === "PRIMARY KEY");
      if (pk?.columns.join() !== model.id.join())
        problems.push(`${table.name}: primary key differs`);
      const sqlUniques = table.constraints
        .filter((c) => c.kind === "UNIQUE")
        .map((c) => `${c.name}(${c.columns})`)
        .sort();
      const prismaUniques = model.uniques.map((u) => `${u.name}(${u.columns})`).sort();
      if (sqlUniques.join() !== prismaUniques.join())
        problems.push(`${table.name}: uniques differ`);
      // Partial and exclusion indexes cannot be written in Prisma: only plain ones are compared.
      const sqlIndexes = indexes
        .filter((i) => i.table === table.name && !i.where)
        .map((i) => `${i.name}(${i.columns})`)
        .sort();
      const prismaIndexes = model.indexes.map((i) => `${i.name}(${i.columns})`).sort();
      if (sqlIndexes.join() !== prismaIndexes.join())
        problems.push(`${table.name}: indexes differ`);
      const sqlFks = table.constraints
        .filter((c) => c.kind === "FOREIGN KEY")
        .map((c) => `${c.name}(${c.columns})->${c.references?.table}(${c.references?.columns})`)
        .sort();
      const prismaFks = model.relations.map((r) => `${r.name}(${r.columns})`).sort();
      if (sqlFks.map((f) => f.split("->")[0]).join() !== prismaFks.join())
        problems.push(`${table.name}: foreign keys differ`);
      for (const column of table.columns.filter((c) => c.default === "CURRENT_TIMESTAMP")) {
        if (!model.columns.find((c) => c.name === column.name)?.hasDefaultNow)
          problems.push(`${table.name}.${column.name}: default now() missing in Prisma`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("leaves the existing Prisma models alone: the lot adds models and removes nothing", () => {
    const models = [...parsePrismaModels(SCHEMA).keys()];
    const lot = [
      ...parseTables(ddlOf(SQL)).map((t) => t.name),
      // The lot 5C-0 tables belong to the same family, and point at the same snapshot table.
      ...parseTables(ddlOf(COUNT_CHECK_SQL)).map((t) => t.name),
    ];
    for (const name of lot) expect(models).toContain(name);
    for (const model of models) {
      if (lot.includes(model)) continue;
      const block =
        new RegExp(`^model ${model} \\{\\n([\\s\\S]*?)\\n\\}`, "m").exec(SCHEMA)?.[1] ?? "";
      for (const name of lot)
        expect(block, `${model} must not refer to ${name}`).not.toMatch(
          new RegExp(`\\b${name}\\b`)
        );
    }
  });

  it("has no Prisma relation to Politician, ParliamentaryGroup, AnOrgan, Mandate or Vote", () => {
    const lot = new Set(parseTables(ddlOf(SQL)).map((t) => t.name));
    for (const name of lot) {
      const block =
        new RegExp(`^model ${name} \\{\\n([\\s\\S]*?)\\n\\}`, "m").exec(SCHEMA)?.[1] ?? "";
      for (const forbidden of [
        "Politician",
        "ParliamentaryGroup",
        "AnOrgan",
        "Mandate",
        "Vote",
        "Scrutin",
      ]) {
        expect(block, `${name} -> ${forbidden}`).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
      }
    }
  });

  it("gives the run table every pin of the run contract", () => {
    const run = parseTables(ddlOf(SQL)).find((t) => t.name === "HistoricalResolutionRun");
    const columns = run?.columns.map((c) => c.name) ?? [];
    // `snapshotPins` and `snapshotStateHashes` of RunPins are the rows of HistoricalRunSnapshotPin.
    for (const field of [
      "linkDecisionCutoff",
      "continuityDecisionCutoff",
      "decisionsHash",
      "preparedInputsHash",
      "parserVersion",
      "resolverVersion",
    ]) {
      expect(columns).toContain(field);
    }
    const pin = parseTables(ddlOf(SQL)).find((t) => t.name === "HistoricalRunSnapshotPin");
    expect(pin?.columns.map((c) => c.name)).toEqual(["runId", "stream", "seq", "stateHash"]);
  });

  it("limits the domains the importer could otherwise bend", () => {
    const sqlText = SQL;
    for (const value of [
      "AN_AMO30",
      "AN_SCRUTINS_L15",
      "AN_SCRUTINS_L16",
      "AN_SCRUTINS_L17",
      "SENAT_HISTOGROUPES",
    ])
      expect(sqlText).toContain(`'${value}'`);
    for (const value of [
      "QUARANTINED",
      "RELEASED",
      "REVOKED",
      "OPEN_AT_SNAPSHOT",
      "RENAMED_SAME_GROUP",
      "LINKED_OFFICIAL_ID",
      "UNRESOLVED_IDENTITY",
    ])
      expect(sqlText).toContain(`'${value}'`);
  });

  it("has a rollback that stops before any DROP when a table holds a row, in plain SQL, with no CASCADE", () => {
    const rollback = read(ROLLBACK_PATH);
    const tables = parseTables(ddlOf(SQL)).map((t) => t.name);
    for (const name of tables) {
      expect(rollback, `${name} is checked`).toContain(`FROM "${name}";\n`);
      expect(rollback, `${name} check is not a constant`).toContain(
        `CAST(string_agg('${name} holds rows`
      );
    }
    // Every check comes before the first DROP, inside the one transaction.
    expect(rollback.lastIndexOf("CAST(string_agg(")).toBeLessThan(rollback.indexOf("DROP TABLE"));
    expect(rollback).toMatch(/^BEGIN;$/m);
    const code = executableText(rollback);
    expect(code).not.toMatch(/CASCADE/i);
    expect(code).not.toMatch(/DROP EXTENSION/i);
    expect(code).not.toMatch(/\bDO\s+\$/i);
    expect(code).not.toMatch(/\bEXECUTE\b/i);
    const dropped = [...rollback.matchAll(/^DROP TABLE "(\w+)";$/gm)].map((m) => m[1]);
    expect([...dropped].sort()).toEqual([...tables].sort());
    // Children before parents: a pin or an exclusion goes before its run.
    expect(dropped.indexOf("RunExclusion")).toBeLessThan(
      dropped.indexOf("HistoricalResolutionRun")
    );
    expect(dropped.indexOf("HistoricalRunSnapshotPin")).toBeLessThan(
      dropped.indexOf("OfficialSourceSnapshot")
    );
    expect(dropped.indexOf("OfficialSourceSnapshot")).toBeLessThan(
      dropped.indexOf("SourceArtifact")
    );
  });

  it("builds the reference schema and the real schema from the same text", () => {
    expect(ddlOf(SQL)).not.toBe("");
    expect(ddlOf(SQL)).toBe(referenceBuildOf(SQL));
    expect(parseTables(referenceBuildOf(SQL))).toEqual(parseTables(ddlOf(SQL)));
  });

  it("respects the SEC-06 source contract of the repository: no DO block, no dynamic SQL", () => {
    for (const path of [SQL_PATH, ROLLBACK_PATH]) {
      const code = executableText(read(path));
      expect(code, path).not.toMatch(/\bDO\s+\$/i);
      expect(code, path).not.toMatch(/\bEXECUTE\b(?!\s+FUNCTION\b)/i);
      expect(code, path).not.toMatch(/\bSECURITY\s+DEFINER\b/i);
    }
  });
});

describe("the conformance check can fail", () => {
  const damaged = (from: string | RegExp, to: string) => {
    // Both copies of the DDL (reference and real) carry the damage, as a real edit of the generator would.
    const result =
      typeof from === "string"
        ? SQL.split(from).join(to)
        : SQL.replace(new RegExp(from.source, `${from.flags}g`), to);
    expect(result, "the damage must change the SQL").not.toBe(SQL);
    return violations(result, SCHEMA);
  };

  it("names a reference build that is not the real build, a DO block and dynamic SQL", () => {
    const onlyReference = SQL.replace(
      '"GroupMembershipRecord_no_overlap" EXCLUDE',
      '"GroupMembershipRecord_other" EXCLUDE'
    );
    expect(onlyReference).not.toBe(SQL);
    expect(violations(onlyReference, SCHEMA).join("\n")).toContain("not the same text");
    expect(
      damaged(/\nCOMMIT;\n$/, "\nDO $x$ BEGIN PERFORM 1; END $x$;\nCOMMIT;\n").join("\n")
    ).toContain("a DO block");
    expect(damaged(/\nCOMMIT;\n$/, "\nEXECUTE 'select 1';\nCOMMIT;\n").join("\n")).toContain(
      "dynamic SQL"
    );
  });

  it("names a missing exclusion constraint", () => {
    const found = damaged(/    CONSTRAINT "GroupMembershipRecord_no_overlap" EXCLUDE[^\n]*\n/, "");
    expect(found.join("\n")).toContain("GroupMembershipRecord: no exclusion constraint");
  });

  it("names a missing partial unique index", () => {
    const found = damaged(
      /CREATE UNIQUE INDEX IF NOT EXISTS "SeatMandateRecord_active_key"[^\n]*\n/,
      ""
    );
    expect(found.join("\n")).toContain("SeatMandateRecord: no partial unique index");
  });

  it("names a foreign key that no UNIQUE constraint backs", () => {
    const found = damaged(
      /    CONSTRAINT "OfficialSourceSnapshot_stream_seq_key" UNIQUE \("stream", "seq"\),\n/,
      ""
    );
    expect(found.join("\n")).toContain("has no PRIMARY KEY or UNIQUE constraint");
  });

  it("names a foreign key to an existing table", () => {
    const found = damaged(
      /REFERENCES "SourceArtifact"\("sha256"\)/,
      'REFERENCES "Politician"("id")'
    );
    expect(found.join("\n")).toContain("references a table outside the lot (Politician)");
  });

  it("names a version table that lost its guard, and a trigger a replica session would bypass", () => {
    const noGuard = damaged(/CREATE OR REPLACE TRIGGER "OfficialActor_version_guard"[^\n]*\n/, "");
    expect(noGuard.join("\n")).toContain("OfficialActor: no version guard");
    const notAlways = damaged(
      /ALTER TABLE "RunExclusion" ENABLE ALWAYS TRIGGER "RunExclusion_no_truncate";\n/,
      ""
    );
    expect(notAlways.join("\n")).toContain(
      "RunExclusion: trigger RunExclusion_no_truncate is not ENABLE ALWAYS"
    );
  });

  it("names a table without RLS and a statement that deletes or alters existing data", () => {
    expect(
      damaged('ALTER TABLE "RunExclusion" ENABLE ROW LEVEL SECURITY;\n', "").join("\n")
    ).toContain("RunExclusion: RLS not enabled");
    expect(damaged(/\nCOMMIT;\n$/, '\nDELETE FROM "Vote";\nCOMMIT;\n').join("\n")).toContain(
      "forbidden statement"
    );
    expect(
      damaged(/\nCOMMIT;\n$/, '\nALTER TABLE "Politician" ADD COLUMN x TEXT;\nCOMMIT;\n').join("\n")
    ).toContain("forbidden statement");
  });

  it("names a grant, an identifier that PostgreSQL would truncate, and an IF NOT EXISTS with no comparison", () => {
    expect(
      damaged(/\nCOMMIT;\n$/, '\nGRANT SELECT ON "RunExclusion" TO anon;\nCOMMIT;\n').join("\n")
    ).toContain("a GRANT");
    const long = '"' + "x".repeat(64) + '"';
    expect(damaged(/\nCOMMIT;\n$/, `\nSELECT ${long};\nCOMMIT;\n`).join("\n")).toContain(
      "longer than 63 bytes"
    );
    expect(damaged("CREATE SCHEMA hg_reference;", "SELECT 1;").join("\n")).toContain(
      "no reference schema is built"
    );
    expect(
      damaged(
        "The existing historical groups schema differs from the expected definition. Nothing was changed.'\n  ||",
        "Something else.'\n  ||"
      ).join("\n")
    ).toContain("no divergence error before the real build");
  });

  it("names a Politician key in the evidence, and a decision a script could validate", () => {
    expect(
      damaged(
        '    "officialId" TEXT NOT NULL,\n    "chamber"',
        '    "officialId" TEXT NOT NULL,\n    "politicianId" TEXT,\n    "chamber"'
      ).join("\n")
    ).toContain("evidence must not carry a Politician key");
    expect(
      damaged(/    CONSTRAINT "OrganContinuityDecision_only_proposals_by_script"[^\n]*\n/, "").join(
        "\n"
      )
    ).toContain("OrganContinuityDecision: a script could write a validating decision");
  });
});

// ---------------------------------------------------------------------------------------------
// Lot 5C-0: the count-coherence tables, on top of the lot 5B schema.
// ---------------------------------------------------------------------------------------------

const COUNT_TABLES = ["ScrutinCountCheck", "ScrutinGroupCountCheck"] as const;
const SECTION = (name: string) => `-- hg:${name}\n`;
const REFERENCE_5C = "SET LOCAL search_path TO hg_reference, public, pg_catalog;\n";

function referenceBuild5c(sql: string): string {
  const start = sql.indexOf(SECTION("reference-build"));
  const end = sql.indexOf(`\n${SECTION("precheck").trim()}`);
  if (start === -1 || end === -1) return "";
  const body = sql.slice(start + SECTION("reference-build").length);
  const cut = body.indexOf(REFERENCE_5C);
  return cut === -1
    ? ""
    : body.slice(cut + REFERENCE_5C.length, end - start - SECTION("reference-build").length);
}

export function violations5c(sql: string, schema: string, baseSql: string): string[] {
  const out: string[] = [];
  const ddl = ddlOf(sql);
  const tables = parseTables(ddl);
  const baseTables = parseTables(ddlOf(baseSql));
  const baseFunctions = new Set(
    [...ddlOf(baseSql).matchAll(/CREATE OR REPLACE FUNCTION (\w+)\(/g)].map((m) => m[1])
  );
  const indexes = parseIndexes(ddl);
  const triggers = parseTriggers(ddl);
  // With the newline: a marker that only starts like the right one does not count.
  const at = (name: string) => sql.indexOf(SECTION(name));
  const plain = executableText(sql);

  if (!/^BEGIN;$/m.test(sql) || !/^COMMIT;$/m.test(sql))
    out.push("script is not wrapped in one transaction");
  const order = ["prerequisites", "reference-build", "precheck", "real-build", "postcheck"].map(at);
  if (order.some((n) => n === -1) || order.some((n, i) => i > 0 && (order[i - 1] as number) >= n)) {
    out.push(
      "the sections are missing or out of order (prerequisites, reference, pre-check, build, post-check)"
    );
  }
  const prerequisites = sql.slice(at("prerequisites"), at("reference-build"));
  if (
    !/CAST\(\s*'The prerequisites of the count-check schema are missing/.test(prerequisites) ||
    !prerequisites.includes("string_agg(")
  ) {
    out.push(
      "no prerequisite check (it must aggregate, or the cast is folded into a constant and always fails)"
    );
  }
  for (const needed of [
    "13 tables",
    "historical_version_guard",
    "historical_refuse_mutation",
    "historical_refuse_truncate",
    "btree_gist",
  ]) {
    if (!prerequisites.includes(needed)) out.push(`the prerequisites do not check ${needed}`);
  }
  if (at("prerequisites") > sql.indexOf("CREATE SCHEMA hg_reference"))
    out.push("the prerequisites come after the reference schema is built");
  const precheck = sql.slice(at("precheck"), at("real-build"));
  if (!/CAST\(\s*'The count-check schema differs from the expected definition/.test(precheck))
    out.push("no divergence error before the build");
  if (!precheck.includes("partial installation")) out.push("a partial installation is not refused");
  if (!/CAST\(\s*'The count-check schema built here differs/.test(sql.slice(at("postcheck"))))
    out.push("no divergence error after the build");
  for (const kind of ["column", "constraint", "index", "trigger", "table", "acl"]) {
    if (!precheck.includes(`'${kind}'`)) out.push(`the catalog comparison does not cover ${kind}s`);
  }
  if (ddl === "" || ddl !== referenceBuild5c(sql))
    out.push("the reference build and the real build are not the same text");

  if (/\bDO\s+\$/i.test(plain) || /\bEXECUTE\b(?!\s+FUNCTION\b)/i.test(plain))
    out.push("a DO block or dynamic SQL (SEC-06)");
  if (/\bSECURITY\s+DEFINER\b/i.test(plain)) out.push("SECURITY DEFINER (SEC-06)");
  if (/\bGRANT\b/i.test(plain)) out.push("a GRANT");
  if (/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(plain))
    out.push("a function: the guards belong to the lot 5B and are reused");
  for (const forbidden of [
    /\bDELETE\s+FROM\b/i,
    /\bTRUNCATE\s+TABLE\b/i,
    /\bUPDATE\s+"?\w+"?\s+SET\b/i,
    /\bDROP\s+(TABLE|INDEX|COLUMN|TRIGGER|FUNCTION|TYPE|EXTENSION)\b/i,
    /\bINSERT\s+INTO\s+"/i,
  ]) {
    if (forbidden.test(plain)) out.push(`forbidden statement: ${forbidden.source}`);
  }
  if ((plain.match(/DROP SCHEMA/g) ?? []).length !== 2)
    out.push("DROP SCHEMA must appear exactly twice, on hg_reference only");
  for (const alter of plain.matchAll(/ALTER\s+TABLE\s+"(\w+)"\s+(\w+)/gi)) {
    if (!(COUNT_TABLES as readonly string[]).includes(alter[1] as string))
      out.push(`ALTER TABLE on a table of another lot: ${alter[1]}`);
    if (!/^ENABLE$/i.test(alter[2] as string)) out.push(`ALTER TABLE ${alter[1]} ${alter[2]}`);
  }
  for (const id of new Set(sql.match(/"[A-Za-z0-9_]+"/g) ?? [])) {
    if (Buffer.byteLength(id) - 2 > 63) out.push(`identifier longer than 63 bytes: ${id}`);
  }
  for (const model of parsePrismaModels(schema).keys()) {
    const ours = (COUNT_TABLES as readonly string[]).includes(model);
    const base = baseTables.some((t) => t.name === model);
    if (!ours && !base && new RegExp(`"${model}"`).test(sql))
      out.push(`the SQL names the existing model ${model}`);
  }
  if (tables.map((t) => t.name).join() !== COUNT_TABLES.join())
    out.push("the tables are not exactly the two of the lot");

  for (const table of tables) {
    const has = (c: string, notNull?: boolean) => {
      const found = table.columns.find((x) => x.name === c);
      return found !== undefined && (notNull === undefined || found.notNull === notNull);
    };
    for (const c of [
      "stream",
      "fromSeq",
      "rawHash",
      "sourceMember",
      "memberHash",
      "scrutinExternalId",
      "legislature",
    ]) {
      if (c !== "legislature" && !has(c, true))
        out.push(`${table.name}: ${c} must exist and be NOT NULL`);
    }
    if (!has("toSeq", false)) out.push(`${table.name}: toSeq must exist and be nullable`);
    for (const forbidden of table.columns.filter((c) =>
      /politician|^name$|^nom$|prenom|lastName|firstName/i.test(c.name)
    )) {
      out.push(`${table.name}: column ${forbidden.name} could carry a person's name or key`);
    }
    const pk = table.constraints.find((c) => c.kind === "PRIMARY KEY");
    if (!pk || pk.columns[0] !== "stream" || pk.columns.at(-1) !== "fromSeq")
      out.push(`${table.name}: the key must be (stream, identity, fromSeq)`);
    const identity = (pk?.columns ?? []).slice(1, -1);
    for (const column of ["fromSeq", "toSeq"]) {
      const fk = table.constraints.find(
        (c) => c.kind === "FOREIGN KEY" && c.columns.join() === `stream,${column}`
      );
      if (
        !fk ||
        fk.references?.table !== "OfficialSourceSnapshot" ||
        fk.references.columns.join() !== "stream,seq"
      ) {
        out.push(`${table.name}: no foreign key (stream, ${column}) to the snapshot`);
        continue;
      }
      const target = baseTables.find((t) => t.name === "OfficialSourceSnapshot");
      const backed = target?.constraints.some(
        (c) =>
          (c.kind === "PRIMARY KEY" || c.kind === "UNIQUE") && c.columns.join() === "stream,seq"
      );
      if (!backed)
        out.push(`${table.name}: the snapshot has no UNIQUE (stream, seq) for this foreign key`);
      if (!/ON DELETE RESTRICT ON UPDATE RESTRICT/.test(fk.text))
        out.push(`${table.name}: ${column} foreign key is not RESTRICT`);
    }
    if (
      table.constraints.some(
        (c) => c.kind === "FOREIGN KEY" && c.references?.table !== "OfficialSourceSnapshot"
      )
    )
      out.push(`${table.name}: a foreign key to something other than the snapshot`);
    const exclusion = table.constraints.find((c) => c.kind === "EXCLUDE");
    const wanted = ["stream", ...identity].map((c) => `"${c}" WITH =`).join(", ");
    if (
      !exclusion ||
      !exclusion.text.includes("USING gist") ||
      !exclusion.text.includes(wanted) ||
      !exclusion.text.includes(`int4range("fromSeq", "toSeq", '[)') WITH &&`)
    )
      out.push(`${table.name}: no exclusion constraint on (stream, identity, [fromSeq, toSeq))`);
    const active = indexes.find(
      (i) => i.table === table.name && i.unique && i.where === `"toSeq" IS NULL`
    );
    if (!active || active.columns.join() !== ["stream", ...identity].join())
      out.push(`${table.name}: no partial unique index on the active version`);
    if (
      !table.constraints.some(
        (c) => c.kind === "CHECK" && /"toSeq" IS NULL OR "toSeq" > "fromSeq"/.test(c.text)
      )
    )
      out.push(`${table.name}: no CHECK toSeq > fromSeq`);
    if (
      !table.constraints.some(
        (c) => c.kind === "CHECK" && /"rawHash" ~ '\^\[0-9a-f\]\{64\}\$'/.test(c.text)
      )
    )
      out.push(`${table.name}: rawHash format is not checked`);
    const derived = table.constraints.find((c) => c.kind === "CHECK" && /_derived$/.test(c.name));
    if (
      !derived ||
      !/CASE/.test(derived.text) ||
      !/COUNT_MISMATCH/.test(derived.text) ||
      !/UNVERIFIABLE/.test(derived.text) ||
      !/COHERENT/.test(derived.text)
    ) {
      out.push(
        `${table.name}: the coherence status is not derived from the stored numbers by a CHECK`
      );
    }
    for (const position of ["Pour", "Contre", "Abstention", "NonVotant"]) {
      for (const family of ["nominal", "official", "diff"]) {
        if (!has(`${family}${position}`))
          out.push(`${table.name}: ${family}${position} is missing`);
      }
      if (
        !table.constraints.some(
          (c) => c.kind === "CHECK" && c.name.endsWith(`diff${position}_consistent`)
        )
      )
        out.push(`${table.name}: diff${position} is not tied to nominal minus official`);
    }
    for (const family of ["nominal"])
      for (const position of ["Pour", "Contre", "Abstention", "NonVotant"])
        if (!has(`${family}${position}`, true))
          out.push(`${table.name}: nominal${position} must be NOT NULL`);
    for (const position of ["Pour", "Contre", "Abstention", "NonVotant"])
      if (!has(`official${position}`, false))
        out.push(
          `${table.name}: official${position} must be nullable (an absent official count is kept as absent)`
        );
    const mine = triggers.filter((t) => t.table === table.name);
    for (const [timing, fn] of [
      ["BEFORE INSERT OR UPDATE", "historical_version_guard"],
      ["BEFORE DELETE", "historical_refuse_mutation"],
      ["BEFORE TRUNCATE", "historical_refuse_truncate"],
    ] as const) {
      const found = mine.find((t) => t.timing === timing && t.fn === fn);
      if (!found) out.push(`${table.name}: no ${fn} on ${timing}`);
      else if (!found.always) out.push(`${table.name}: ${fn} is not ENABLE ALWAYS`);
      if (!baseFunctions.has(fn)) out.push(`${fn} does not exist in the lot 5B`);
    }
    if (!new RegExp(`ALTER TABLE "${table.name}" ENABLE ROW LEVEL SECURITY;`).test(ddl))
      out.push(`${table.name}: RLS not enabled`);
    if (
      !new RegExp(
        `REVOKE ALL ON TABLE[^;]*"${table.name}"[^;]*FROM PUBLIC, anon, authenticated;`
      ).test(ddl)
    )
      out.push(`${table.name}: privileges are not revoked`);
  }
  const group = tables.find((t) => t.name === "ScrutinGroupCountCheck");
  const groupKey = group?.constraints.find((c) => c.kind === "PRIMARY KEY")?.columns.join();
  if (groupKey !== "stream,scrutinExternalId,organRef,organOrdinal,fromSeq")
    out.push(
      "a group is identified by (scrutin, organ, ordinal): the placeholder organ repeats inside a scrutin"
    );
  return out;
}

describe("lot 5C-0 count-check schema: static conformance", () => {
  it("respects every rule on the committed SQL", () => {
    expect(violations5c(COUNT_CHECK_SQL, SCHEMA, SQL)).toEqual([]);
  });

  it("agrees with the Prisma models: columns, key, uniques, indexes and foreign keys", () => {
    const models = parsePrismaModels(SCHEMA);
    const indexes = parseIndexes(ddlOf(COUNT_CHECK_SQL));
    const problems: string[] = [];
    for (const table of parseTables(ddlOf(COUNT_CHECK_SQL))) {
      const model = models.get(table.name);
      if (!model) {
        problems.push(`${table.name}: no Prisma model`);
        continue;
      }
      const sqlColumns = table.columns.map((c) => `${c.name}:${c.type}:${c.notNull}`).join("|");
      const prismaColumns = model.columns.map((c) => `${c.name}:${c.type}:${c.notNull}`).join("|");
      if (sqlColumns !== prismaColumns) problems.push(`${table.name}: columns differ`);
      const pk = table.constraints.find((c) => c.kind === "PRIMARY KEY");
      if (pk?.columns.join() !== model.id.join())
        problems.push(`${table.name}: primary key differs`);
      const sqlIndexes = indexes
        .filter((i) => i.table === table.name && !i.where)
        .map((i) => `${i.name}(${i.columns})`)
        .sort();
      if (
        sqlIndexes.join() !==
        model.indexes
          .map((i) => `${i.name}(${i.columns})`)
          .sort()
          .join()
      )
        problems.push(`${table.name}: indexes differ`);
      const sqlFks = table.constraints
        .filter((c) => c.kind === "FOREIGN KEY")
        .map((c) => `${c.name}(${c.columns})`)
        .sort();
      if (
        sqlFks.join() !==
        model.relations
          .map((r) => `${r.name}(${r.columns})`)
          .sort()
          .join()
      )
        problems.push(`${table.name}: foreign keys differ`);
    }
    expect(problems).toEqual([]);
  });

  it("only adds to the lot 5B models: the snapshot gains four inverse relation fields and nothing is removed", () => {
    const block = /^model OfficialSourceSnapshot \{\n([\s\S]*?)\n\}/m.exec(SCHEMA)?.[1] ?? "";
    for (const field of [
      "scrutinCountCheckFromSnapshot",
      "scrutinCountCheckToSnapshot",
      "scrutinGroupCountCheckFromSnapshot",
      "scrutinGroupCountCheckToSnapshot",
    ]) {
      expect(block).toContain(field);
    }
    for (const required of [
      "historicalRunSnapshotPinSnapshot",
      "groupMembershipRecordFromSnapshot",
      "artifact ",
    ])
      expect(block).toContain(required);
  });

  it("builds the reference and the real schema from the same text", () => {
    expect(ddlOf(COUNT_CHECK_SQL)).not.toBe("");
    expect(ddlOf(COUNT_CHECK_SQL)).toBe(referenceBuild5c(COUNT_CHECK_SQL));
  });

  it("leaves the lot 5B script untouched: it is the same file as before, and still passes its own rules", () => {
    expect(violations(SQL, SCHEMA)).toEqual([]);
  });

  describe("the check can fail", () => {
    const damaged = (from: string | RegExp, to: string) => {
      const result =
        typeof from === "string"
          ? COUNT_CHECK_SQL.split(from).join(to)
          : COUNT_CHECK_SQL.replace(new RegExp(from.source, `${from.flags}g`), to);
      expect(result, "the damage must change the SQL").not.toBe(COUNT_CHECK_SQL);
      return violations5c(result, SCHEMA, SQL).join("\n");
    };

    it("names a missing exclusion constraint and a missing partial unique index", () => {
      expect(
        damaged(/    CONSTRAINT "ScrutinCountCheck_no_overlap" EXCLUDE[^\n]*\n/, "")
      ).toContain("ScrutinCountCheck: no exclusion constraint");
      expect(
        damaged(/CREATE UNIQUE INDEX IF NOT EXISTS "ScrutinGroupCountCheck_active_key"[^\n]*\n/, "")
      ).toContain("ScrutinGroupCountCheck: no partial unique index");
    });

    it("names a status that is not derived from the numbers", () => {
      expect(
        damaged(
          /    CONSTRAINT "ScrutinCountCheck_countCoherence_derived" CHECK[\s\S]*?\n(?=    CONSTRAINT)/,
          ""
        )
      ).toContain("the coherence status is not derived");
    });

    it("names a group identity that forgets the ordinal", () => {
      expect(
        damaged(
          'PRIMARY KEY ("stream", "scrutinExternalId", "organRef", "organOrdinal", "fromSeq")',
          'PRIMARY KEY ("stream", "scrutinExternalId", "organRef", "fromSeq")'
        )
      ).toContain("identified by (scrutin, organ, ordinal)");
    });

    it("names the prerequisites that were dropped or moved after the construction", () => {
      expect(damaged("'historical_refuse_truncate'", "'historical_other'")).toContain(
        "the prerequisites do not check historical_refuse_truncate"
      );
      expect(damaged(/-- hg:prerequisites\n/, "-- hg:prerequisites-removed\n")).toContain(
        "the sections are missing or out of order"
      );
    });

    it("names a function, a DO block, a grant and a statement on a table of the lot 5B", () => {
      expect(
        damaged(
          /\nCOMMIT;\n$/,
          "\nCREATE FUNCTION historical_x() RETURNS int LANGUAGE sql AS 'SELECT 1';\nCOMMIT;\n"
        )
      ).toContain("a function");
      expect(damaged(/\nCOMMIT;\n$/, "\nDO $x$ BEGIN PERFORM 1; END $x$;\nCOMMIT;\n")).toContain(
        "a DO block or dynamic SQL"
      );
      expect(
        damaged(/\nCOMMIT;\n$/, '\nGRANT SELECT ON "ScrutinCountCheck" TO anon;\nCOMMIT;\n')
      ).toContain("a GRANT");
      expect(
        damaged(/\nCOMMIT;\n$/, '\nALTER TABLE "SnapshotDecision" ADD COLUMN x TEXT;\nCOMMIT;\n')
      ).toContain("ALTER TABLE on a table of another lot");
    });

    it("names a column that could carry a person's name or key", () => {
      expect(
        damaged(
          '    "groupCount" INTEGER NOT NULL,',
          '    "groupCount" INTEGER NOT NULL,\n    "politicianId" TEXT,'
        )
      ).toContain("could carry a person's name or key");
    });

    it("names a reference build that is not the real build", () => {
      const only = COUNT_CHECK_SQL.replace(
        '"ScrutinCountCheck_stream_countCoherence_idx"',
        '"ScrutinCountCheck_other_idx"'
      );
      expect(only).not.toBe(COUNT_CHECK_SQL);
      expect(violations5c(only, SCHEMA, SQL).join("\n")).toContain("not the same text");
    });
  });
});
