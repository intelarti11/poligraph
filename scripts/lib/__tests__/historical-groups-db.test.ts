// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RECORD_KINDS } from "@/lib/parlement/historical-groups/rows";
import { SAMPLE_ROWS } from "@/lib/parlement/historical-groups/__fixtures__/row-samples";
import {
  CONTENT_COLUMNS,
  KIND_TABLE,
  assertDisposableUrl,
  keyColumns,
  maxRowsPerInsert,
  TargetRefusedError,
} from "../historical-groups-db";

const OK = "postgresql://hg_importer:x@127.0.0.1:55486/hg_schema_test";

const refusal = (url: string, role: Parameters<typeof assertDisposableUrl>[1], env = {}) => {
  try {
    assertDisposableUrl(url, role, env);
  } catch (error) {
    if (error instanceof TargetRefusedError) return error.message;
    throw error;
  }
  return null;
};

describe("the target of the historical group tools", () => {
  it("accepts the disposable local database with the role of the tool", () => {
    expect(refusal(OK, "importer")).toBeNull();
    expect(refusal(OK.replace("hg_importer", "hg_runner"), "runner")).toBeNull();
    expect(refusal(OK.replace("hg_importer", "hg_schema_test"), "owner")).toBeNull();
  });

  it.each([
    ["another host", "postgresql://hg_importer:x@db.example.test:55486/hg_schema_test"],
    ["localhost spelled out", "postgresql://hg_importer:x@localhost:55486/hg_schema_test"],
    ["another port", "postgresql://hg_importer:x@127.0.0.1:5432/hg_schema_test"],
    ["another database", "postgresql://hg_importer:x@127.0.0.1:55486/postgres"],
    ["a hosted database", "postgresql://hg_importer:x@aws-0-eu.pooler.example.test:6543/postgres"],
    ["not a postgres url", "https://127.0.0.1:55486/hg_schema_test"],
    ["not a url", "hg_schema_test"],
  ])("refuses %s", (_label, url) => {
    expect(refusal(url, "importer")).toMatch(/^Target refused/);
  });

  it("refuses a tool that connects as another role than its own", () => {
    expect(refusal(OK, "runner")).toContain("hg_runner");
    expect(refusal(OK, "reader")).toContain("hg_reader");
    expect(refusal(OK, "owner")).toContain("hg_schema_test");
  });

  it("refuses a URL equal to one the application uses", () => {
    expect(refusal(OK, "importer", { DATABASE_URL: OK })).toContain("DATABASE_URL");
    expect(refusal(OK, "importer", { DIRECT_URL: OK })).toContain("DIRECT_URL");
    expect(refusal(OK, "importer", { DATABASE_URL: "postgresql://other" })).toBeNull();
  });
});

describe("the tables written by the import", () => {
  it("name every kind of record once, with the columns of the rows the parsers produce", () => {
    expect(Object.keys(KIND_TABLE).sort()).toEqual([...RECORD_KINDS].sort());
    for (const kind of RECORD_KINDS) {
      expect(CONTENT_COLUMNS[kind], kind).toEqual(Object.keys(SAMPLE_ROWS[kind]));
      for (const key of keyColumns(kind)) expect(CONTENT_COLUMNS[kind]).toContain(key);
    }
  });

  it("keeps an insert under the 65 535 parameters the protocol allows", () => {
    for (const kind of RECORD_KINDS) {
      const columns = CONTENT_COLUMNS[kind].length + 5;
      expect(maxRowsPerInsert(columns) * columns).toBeLessThanOrEqual(65_535);
    }
  });
});
