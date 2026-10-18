// @vitest-environment node
/**
 * Static conformance of the lot 5D (PR A) SQL: read from the text of the files, no database.
 * What PostgreSQL really enforces is `roles-positions.integration.test.ts`.
 *
 * A check that cannot fail proves nothing: `violations` is also run on damaged copies of the SQL and
 * must name each damage.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXPECTED, ROLES } from "../__fixtures__/role-matrix";

const SQL_PATH = "prisma/migrations/manual/2026-10-20-historical-groups-roles-positions.sql";
const ROLLBACK_PATH =
  "prisma/migrations/manual/2026-10-20-historical-groups-roles-positions-rollback.sql";
const SQL = readFileSync(SQL_PATH, "utf8");
const ROLLBACK = readFileSync(ROLLBACK_PATH, "utf8");
const SCHEMA = readFileSync("prisma/schema.prisma", "utf8");

const REFERENCE_MARK = "-- hg:reference-build\n";
const REAL_MARK = "-- hg:real-build\nSET LOCAL search_path TO public, pg_catalog;\n";

/** The shared construction text: everything after the search_path line of each build. */
function buildTexts(sql: string): { reference: string; real: string } {
  const ref = sql.indexOf(REFERENCE_MARK);
  const refBody = sql.indexOf("\n\n", sql.indexOf("SET LOCAL search_path TO hg_reference", ref));
  const refEnd = sql.indexOf("\n-- hg:precheck");
  const real = sql.indexOf(REAL_MARK);
  const realEnd = sql.indexOf("\n-- hg:postcheck");
  const reference = sql.slice(refBody, refEnd);
  const realText = sql.slice(real + REAL_MARK.length, realEnd);
  // The reference build starts with the shells of the existing tables; the shared text follows them.
  const marker = "CREATE OR REPLACE FUNCTION historical_position_guard()";
  return {
    reference: reference.slice(reference.indexOf(marker)),
    real: realText.slice(realText.indexOf(marker)),
  };
}

function violations(sql: string): string[] {
  const out: string[] = [];
  const code = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  if (/\bDO\s+\$/i.test(code)) out.push("a DO block");
  if (/\bEXECUTE\s+(?!FUNCTION)/i.test(code)) out.push("dynamic SQL");
  if (/SECURITY\s+DEFINER/i.test(code)) out.push("SECURITY DEFINER");
  if (/CREATE\s+ROLE|ALTER\s+ROLE/i.test(code)) out.push("a role is created or altered");
  if (/GRANT\b[^;]*\bTO\b[^;]*\b(anon|authenticated|PUBLIC)\b/i.test(code))
    out.push("a grant to anon, authenticated or PUBLIC");
  if (/GRANT\s+(ALL|DELETE|TRUNCATE|REFERENCES|TRIGGER)\b/i.test(code))
    out.push("a grant of ALL, DELETE, TRUNCATE, REFERENCES or TRIGGER");
  if (/GRANT\s+(INSERT|UPDATE|SELECT)\b[^;]*\bON\s+ALL\s+TABLES/i.test(code))
    out.push("a grant on all tables");
  if (/\bFORCE ROW LEVEL SECURITY\b|\bDISABLE ROW LEVEL SECURITY\b/i.test(code))
    out.push("RLS forced or disabled");
  const { reference, real } = buildTexts(sql);
  if (reference === "" || reference !== real) out.push("the reference and real builds differ");
  return out;
}

/** Parses `GRANT <privilege> [(cols)] ON TABLE "T" TO <role>;` lines of the real build. */
function grantsOf(
  sql: string
): Record<string, { select: string[]; insert: string[]; update: Record<string, string[]> }> {
  const out: Record<
    string,
    { select: string[]; insert: string[]; update: Record<string, string[]> }
  > = {};
  for (const role of ROLES) out[role] = { select: [], insert: [], update: {} };
  const { real } = buildTexts(sql);
  for (const m of real.matchAll(
    /^GRANT (SELECT|INSERT|UPDATE)(?: \(([^)]*)\))? ON TABLE "(\w+)" TO (\w+);$/gm
  )) {
    const [, privilege, columns, table, role] = m as unknown as [
      string,
      string,
      string | undefined,
      string,
      string,
    ];
    const entry = out[role];
    if (!entry) continue;
    if (privilege === "SELECT") entry.select.push(table);
    else if (privilege === "INSERT") entry.insert.push(table);
    else
      entry.update[table] = (columns ?? "")
        .split(",")
        .map((c) => c.trim().replaceAll('"', ""))
        .sort();
  }
  return out;
}

describe("lot 5D (PR A) SQL: static conformance", () => {
  it("is plain SQL: no DO, no dynamic SQL, no SECURITY DEFINER, no role creation or alteration, no broad grant", () => {
    expect(violations(SQL)).toEqual([]);
    expect(violations(ROLLBACK.replace(/-- hg:[\s\S]*/, ""))).not.toContain("SECURITY DEFINER");
  });

  it("builds the same text in the reference schema and in the real schema", () => {
    const { reference, real } = buildTexts(SQL);
    expect(real.length).toBeGreaterThan(5000);
    expect(reference).toBe(real);
  });

  it("grants each role exactly the hand-written matrix", () => {
    const grants = grantsOf(SQL);
    for (const role of ROLES) {
      const wanted = EXPECTED[role];
      expect(grants[role]?.select.sort(), `${role} select`).toEqual([...wanted.select].sort());
      expect(grants[role]?.insert.sort(), `${role} insert`).toEqual([...wanted.insert].sort());
      expect(grants[role]?.update, `${role} update`).toEqual(
        Object.fromEntries(Object.entries(wanted.update).map(([t, c]) => [t, [...c].sort()]))
      );
    }
  });

  it("writes a policy for every privilege it grants, and only those", () => {
    const { real } = buildTexts(SQL);
    const policies = [
      ...real.matchAll(/^CREATE POLICY "(\w+)" ON "(\w+)" FOR (SELECT|INSERT|UPDATE) TO (\w+)/gm),
    ].map((m) => `${m[4]}|${m[2]}|${m[3]}`);
    const wanted = ROLES.flatMap((role) => [
      ...EXPECTED[role].select.map((t) => `${role}|${t}|SELECT`),
      ...EXPECTED[role].insert.map((t) => `${role}|${t}|INSERT`),
      ...Object.keys(EXPECTED[role].update).map((t) => `${role}|${t}|UPDATE`),
    ]);
    expect(policies.sort()).toEqual(wanted.sort());
  });

  it("lets the importer record a decision only as QUARANTINED, by a script", () => {
    const { real } = buildTexts(SQL);
    const policy =
      /CREATE POLICY "hg_importer_insert" ON "SnapshotDecision"[^;]*;/.exec(real)?.[0] ?? "";
    expect(policy).toContain(`"status" = 'QUARANTINED'`);
    expect(policy).toContain(`"decidedByKind" = 'SCRIPT'`);
  });

  it("lets the importer touch only the open versions of a record table, to close them", () => {
    const { real } = buildTexts(SQL);
    const policy =
      /CREATE POLICY "hg_importer_update" ON "OfficialActor"[^;]*;/.exec(real)?.[0] ?? "";
    expect(policy).toContain(`USING ("toSeq" IS NULL)`);
    expect(policy).toContain(`WITH CHECK ("toSeq" IS NOT NULL)`);
  });

  it("guards the publication of a position in the database", () => {
    const { real } = buildTexts(SQL);
    const guard =
      /CREATE OR REPLACE FUNCTION historical_position_guard\(\)[\s\S]*?\$fn\$;/.exec(real)?.[0] ??
      "";
    for (const part of [
      "'RUNNING'",
      "placeholderOrganRefs",
      "maxExcludedPerGroup",
      '"HistoricalRunSnapshotPin"',
      '"ScrutinCountCheck"',
      "'COHERENT'",
    ])
      expect(guard, part).toContain(part);
    expect(real).toContain('ENABLE ALWAYS TRIGGER "ScrutinOrganPosition_insert_guard"');
    // No majority position: the table carries counts and a reason, nothing derived.
    expect(real).not.toMatch(/majority|majorit/i);
  });

  it("adds memberHash to the four tables, NOT NULL, with a hex-64 check, without a default", () => {
    for (const table of [
      "OfficialActor",
      "OfficialOrganRecord",
      "GroupMembershipRecord",
      "SeatMandateRecord",
    ]) {
      expect(buildTexts(SQL).real).toContain(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "memberHash" TEXT NOT NULL CONSTRAINT "${table}_memberHash_format" CHECK ("memberHash" ~ '^[0-9a-f]{64}$');`
      );
      const model =
        new RegExp(`^model ${table} \\{\\n([\\s\\S]*?)\\n\\}`, "m").exec(SCHEMA)?.[1] ?? "";
      expect(model).toMatch(/\n\s+memberHash\s+String\b/);
    }
  });

  it("has a Prisma model for the positions table, related to the run only", () => {
    const model = /^model ScrutinOrganPosition \{\n([\s\S]*?)\n\}/m.exec(SCHEMA)?.[1] ?? "";
    expect(model).toContain("@@id([runId, scrutinExternalId, organRef])");
    expect(model).not.toMatch(/Politician|ParliamentaryGroup|Mandate|\bVote\b/);
    expect(model).toMatch(/run\s+HistoricalResolutionRun\s+@relation/);
  });

  it("refuses a populated table before it changes anything, and a partial installation", () => {
    expect(SQL).toContain("memberHash cannot be added to a table that already holds rows");
    expect(SQL).toContain("partial installation");
    expect(SQL).toContain("the role ' || rolname || ' must not be SUPERUSER, BYPASSRLS");
  });

  describe("the checks can fail", () => {
    const damaged = (from: string | RegExp, to: string) => {
      const text = SQL.replace(from, to);
      expect(text).not.toBe(SQL);
      return text;
    };
    it("names a DO block, SECURITY DEFINER, a broad grant and a grant to anon", () => {
      expect(violations(damaged("BEGIN;", "BEGIN;\nDO $$ BEGIN END $$;"))).toContain("a DO block");
      expect(
        violations(
          damaged("AS $fn$\nDECLARE\n  v_status", "SECURITY DEFINER AS $fn$\nDECLARE\n  v_status")
        )
      ).toContain("SECURITY DEFINER");
      expect(
        violations(
          damaged(
            /GRANT SELECT ON TABLE "SourceArtifact" TO hg_reader;/g,
            'GRANT DELETE ON TABLE "SourceArtifact" TO hg_reader;'
          )
        )
      ).toContain("a grant of ALL, DELETE, TRUNCATE, REFERENCES or TRIGGER");
      expect(
        violations(
          damaged(
            /GRANT SELECT ON TABLE "SourceArtifact" TO hg_reader;/g,
            'GRANT SELECT ON TABLE "SourceArtifact" TO anon;'
          )
        )
      ).toContain("a grant to anon, authenticated or PUBLIC");
    });
    it("names a real build that drifts from the reference", () => {
      const at = SQL.lastIndexOf(
        'GRANT USAGE ON SEQUENCE "SnapshotDecision_decisionNo_seq" TO hg_importer;'
      );
      const text = SQL.slice(0, at) + "-- drift\n" + SQL.slice(at + 1);
      expect(violations(text)).toContain("the reference and real builds differ");
    });
  });
});
