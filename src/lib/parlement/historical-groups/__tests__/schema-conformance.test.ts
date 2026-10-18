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
const COMPARE_MARK = "-- hg:compare\n";

/** The DDL text built in the reference schema, before the real build. */
export function referenceBuildOf(sql: string): string {
  const start = sql.indexOf(REFERENCE_MARK);
  const end = sql.indexOf(`\n${REAL_MARK.split("\n")[0]}`);
  return start === -1 || end === -1 ? "" : sql.slice(start + REFERENCE_MARK.length, end);
}

/** The DDL text built in the real schema. It is what the tables, triggers and indexes are read from. */
export function ddlOf(sql: string): string {
  const start = sql.indexOf(REAL_MARK);
  const end = sql.indexOf(`\n${COMPARE_MARK}`);
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
  const compare = sql.slice(sql.indexOf(COMPARE_MARK));
  for (const kind of ["column", "constraint", "index", "trigger", "table", "acl", "function"]) {
    if (!compare.includes(`'${kind}'`)) out.push(`the catalog comparison does not cover ${kind}s`);
  }
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
    const lot = parseTables(ddlOf(SQL)).map((t) => t.name);
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
      expect(rollback, `${name} is checked`).toContain(`WHERE EXISTS (SELECT 1 FROM "${name}");`);
    }
    // Every check comes before the first DROP, inside the one transaction.
    expect(rollback.lastIndexOf("WHERE EXISTS")).toBeLessThan(rollback.indexOf("DROP TABLE"));
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
    ).toContain("no divergence error");
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
