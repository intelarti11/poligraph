// @vitest-environment node
/**
 * What PostgreSQL really enforces for the lot 5C-0 tables (`ScrutinCountCheck`,
 * `ScrutinGroupCountCheck`), on top of the lot 5B schema. Same container, same guards, same refusals
 * as `schema.integration.test.ts`: read its header for the setup.
 *
 * Nothing official is loaded: every row is invented. Not run by default, not wired into CI.
 */
import { readFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 900_000 });

const url = process.env.HISTORICAL_SCHEMA_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (
    target.hostname !== "127.0.0.1" ||
    target.port !== "55486" ||
    target.pathname !== "/hg_schema_test" ||
    target.username !== "hg_schema_test"
  ) {
    throw new Error("A dedicated local hg_schema_test database (127.0.0.1:55486) is required");
  }
}
// Only this variable is read: never DATABASE_URL or DIRECT_URL, which point at production.
if (url && (url === process.env.DATABASE_URL || url === process.env.DIRECT_URL)) {
  throw new Error("The test URL must not be a connection string of the application");
}
const describeDb = url ? describe : describe.skip;

const MANUAL = "prisma/migrations/manual/";
const SQL_5B = readFileSync(`${MANUAL}2026-10-18-historical-groups-schema.sql`, "utf8");
const SQL_5B_ROLLBACK = readFileSync(
  `${MANUAL}2026-10-18-historical-groups-schema-rollback.sql`,
  "utf8"
);
const SQL_5C0 = readFileSync(`${MANUAL}2026-10-19-historical-groups-count-check.sql`, "utf8");
const SQL_5C0_ROLLBACK = readFileSync(
  `${MANUAL}2026-10-19-historical-groups-count-check-rollback.sql`,
  "utf8"
);

const H = (c: string) => c.repeat(64);
const SHA_A = H("a");
const SHA_B = H("b");
const STREAM = "AN_SCRUTINS_L16";

const RESTRICT = "23001";
const UNIQUE = "23505";
const EXCLUSION = "23P01";
const CHECK = "23514";

async function stateOf(run: Promise<unknown>): Promise<string | null> {
  try {
    await run;
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "no-code";
  }
}

type Cols = Record<string, unknown>;

describeDb("lot 5C-0 count-check tables on a disposable PostgreSQL", () => {
  let pool: Pool;
  const q = (text: string, values?: unknown[]) => pool.query(text, values);

  async function assertDisposable() {
    const r = await q(
      `SELECT current_database() AS db, current_user AS usr, current_setting('hg.disposable', true) AS marker`
    );
    const { db, usr, marker } = r.rows[0];
    if (db !== "hg_schema_test" || usr !== "hg_schema_test" || marker !== "yes") {
      throw new Error(
        `Refusing to run: not the disposable container (${db}, ${usr}, marker ${marker})`
      );
    }
  }
  async function reset() {
    await assertDisposable();
    await q("DROP SCHEMA IF EXISTS hg_reference CASCADE");
    await q("DROP SCHEMA public CASCADE");
    await q("CREATE SCHEMA public");
    await q(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
    END $$`);
    await q("CREATE EXTENSION IF NOT EXISTS btree_gist");
  }
  const apply5b = () => q(SQL_5B);
  const apply5c0 = () => q(SQL_5C0);

  async function insert(table: string, cols: Cols) {
    const names = Object.keys(cols);
    return q(
      `INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})`,
      names.map((n) => cols[n])
    );
  }
  const artifact = (sha = SHA_A) =>
    q(
      `INSERT INTO "SourceArtifact"("sha256","byteSize","mediaType","storageKind","storageRef","storedAt","storedBy")
       VALUES ($1, 100, 'application/zip', 'LOCAL_OFFLINE', 'artifacts/x', now(), 'test')`,
      [sha]
    );
  const snapshot = (
    id: string,
    seq: number,
    opts: { sha?: string; state?: string; integrity?: string } = {}
  ) =>
    q(
      `INSERT INTO "OfficialSourceSnapshot"("id","stream","seq","artifactSha256","url","fetchedAt","integrity","parserVersion","stateHash","recordCounts","importedBy")
       VALUES ($1, $2, $3, $4, 'https://example.test/a.zip', now(), $5, '5C-0.1', $6, '{}', 'test')`,
      [id, STREAM, seq, opts.sha ?? SHA_A, opts.integrity ?? "VERIFIED", opts.state ?? H("1")]
    );
  const decision = (snapshotId: string, status: string) =>
    q(
      `INSERT INTO "SnapshotDecision"("snapshotId","status","reason","decidedBy","decidedByKind") VALUES ($1, $2, 't', 't', 'HUMAN')`,
      [snapshotId, status]
    );
  const secondSnapshot = async () => {
    await artifact(SHA_B);
    await snapshot("s2", 2, { sha: SHA_B, state: H("2") });
  };

  /** A coherent scrutin: two groups, a summary, nothing differs. Overrides replace columns. */
  const check = (id: string, over: Cols = {}, fromSeq = 1): Cols => ({
    stream: STREAM,
    scrutinExternalId: id,
    fromSeq,
    scrutinDate: "2023-03-14",
    legislature: 16,
    countCoherence: "COHERENT",
    groupCount: 2,
    mismatchedGroups: 0,
    unverifiableGroups: 0,
    nominalPour: 10,
    nominalContre: 5,
    nominalAbstention: 2,
    nominalNonVotant: 1,
    officialPour: 10,
    officialContre: 5,
    officialAbstention: 2,
    officialNonVotant: 1,
    diffPour: 0,
    diffContre: 0,
    diffAbstention: 0,
    diffNonVotant: 0,
    miseAuPointListedVotants: 0,
    miseAuPointMalformedBlocks: 0,
    sourceMember: "json/VTANR5L16V1.json",
    memberHash: H("a"),
    rawHash: H("b"),
    ...over,
  });
  /** Everything a summary-less scrutin sets. */
  const NO_SUMMARY: Cols = {
    officialPour: null,
    officialContre: null,
    officialAbstention: null,
    officialNonVotant: null,
    diffPour: null,
    diffContre: null,
    diffAbstention: null,
    diffNonVotant: null,
  };
  const group = (
    id: string,
    organRef: string,
    over: Cols = {},
    ordinal = 0,
    fromSeq = 1
  ): Cols => ({
    stream: STREAM,
    scrutinExternalId: id,
    organRef,
    organOrdinal: ordinal,
    fromSeq,
    groupCoherence: "COHERENT",
    nominalPour: 4,
    nominalContre: 1,
    nominalAbstention: 0,
    nominalNonVotant: 0,
    officialPour: 4,
    officialContre: 1,
    officialAbstention: 0,
    officialNonVotant: 0,
    diffPour: 0,
    diffContre: 0,
    diffAbstention: 0,
    diffNonVotant: 0,
    sourceMember: "json/VTANR5L16V1.json",
    memberHash: H("a"),
    rawHash: H("c"),
    ...over,
  });

  // Both integration files reset the same database. Vitest runs files in parallel, so each one takes
  // this lock for its whole duration: they queue instead of dropping each other's schema.
  let lockClient: PoolClient | undefined;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    lockClient = await pool.connect();
    await lockClient.query("SELECT pg_advisory_lock(5330001)");
    await assertDisposable();
  });
  afterAll(async () => {
    if (lockClient) {
      await lockClient.query("SELECT pg_advisory_unlock(5330001)");
      lockClient.release();
    }
    await pool?.end();
  });
  beforeEach(async () => {
    await reset();
    await apply5b();
    await apply5c0();
  });

  // ------------------------------------------------------------------------------------------
  describe("the script", () => {
    it("lists what is missing, before building anything, on a database without the lot 5B", async () => {
      await reset();
      const error = await apply5c0().then(
        () => null,
        (e: Error) => e
      );
      expect(error?.message).toContain("The prerequisites of the count-check schema are missing");
      expect(error?.message).toContain("the lot 5B schema is missing or partial: 0 of 13 tables");
      expect(error?.message).toContain("the lot 5B guard functions are missing: 0 of 3");
      expect((await q(`SELECT 1 FROM pg_namespace WHERE nspname = 'hg_reference'`)).rowCount).toBe(
        0
      );
    });

    it("refuses over a partial lot 5B, naming the count", async () => {
      await q(`DROP TABLE "RunExclusion"`);
      await q(`DROP TABLE "ScrutinGroupCountCheck"; DROP TABLE "ScrutinCountCheck"`);
      const error = await apply5c0().then(
        () => null,
        (e: Error) => e
      );
      expect(error?.message).toContain("the lot 5B schema is missing or partial: 12 of 13 tables");
    });

    it("refuses without btree_gist", async () => {
      await q(`DROP TABLE "ScrutinGroupCountCheck"; DROP TABLE "ScrutinCountCheck"`);
      await q(`DROP EXTENSION btree_gist CASCADE`);
      const error = await apply5c0().then(
        () => null,
        (e: Error) => e
      );
      expect(error?.message).toContain("the btree_gist extension is not installed");
    });

    it("creates the two tables, no function, and 6 triggers that are all ENABLE ALWAYS", async () => {
      const tables = await q(
        `SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname LIKE 'Scrutin%CountCheck' ORDER BY 1`
      );
      expect(tables.rows).toEqual([
        { relname: "ScrutinCountCheck", relrowsecurity: true },
        { relname: "ScrutinGroupCountCheck", relrowsecurity: true },
      ]);
      expect(
        (
          await q(
            `SELECT count(*)::int AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'historical%'`
          )
        ).rows[0].n
      ).toBe(9);
      const triggers = await q(
        `SELECT t.tgname, t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal AND c.relname LIKE 'Scrutin%CountCheck' ORDER BY 1`
      );
      expect(triggers.rows).toHaveLength(6);
      expect(triggers.rows.every((r) => r.tgenabled === "A")).toBe(true);
    });

    const fingerprint = async () =>
      (
        await q(`SELECT md5(string_agg(x, E'\\n' ORDER BY x)) AS h, count(*)::int AS n FROM (
          SELECT 'c|' || conrelid::regclass::text || '|' || conname || '|' || pg_get_constraintdef(oid) AS x FROM pg_constraint WHERE connamespace = 'public'::regnamespace
          UNION ALL SELECT 'i|' || indexdef FROM pg_indexes WHERE schemaname = 'public'
          UNION ALL SELECT 't|' || pg_get_triggerdef(t.oid) || '|' || t.tgenabled::text FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal
          UNION ALL SELECT 'f|' || pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'historical%'
          UNION ALL SELECT 'a|' || c.relname || '|' || COALESCE(c.relacl::text, '') || '|' || c.relrowsecurity::text FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'S')
        ) s`)
      ).rows[0];

    it("applies again without a difference, and leaves the catalog byte for byte identical", async () => {
      const before = await fingerprint();
      await apply5c0();
      await apply5c0();
      expect(await fingerprint()).toEqual(before);
      expect((await q(`SELECT 1 FROM pg_namespace WHERE nspname = 'hg_reference'`)).rowCount).toBe(
        0
      );
    });

    it("lets the lot 5B script run again over it, and the lot 5B tables keep their definition", async () => {
      const before = await fingerprint();
      await apply5b();
      expect(await fingerprint()).toEqual(before);
    });

    const divergences: [string, string, string][] = [
      [
        "a dropped derived CHECK",
        `ALTER TABLE "ScrutinCountCheck" DROP CONSTRAINT "ScrutinCountCheck_countCoherence_derived"`,
        `SELECT 1 FROM pg_constraint WHERE conname = 'ScrutinCountCheck_countCoherence_derived'`,
      ],
      [
        "a dropped exclusion constraint",
        `ALTER TABLE "ScrutinGroupCountCheck" DROP CONSTRAINT "ScrutinGroupCountCheck_no_overlap"`,
        `SELECT 1 FROM pg_constraint WHERE conname = 'ScrutinGroupCountCheck_no_overlap'`,
      ],
      [
        "an extra column",
        `ALTER TABLE "ScrutinCountCheck" ADD COLUMN "extra" TEXT`,
        `SELECT 1 FROM information_schema.columns WHERE column_name = 'extra'`,
      ],
      [
        "a changed column type",
        `ALTER TABLE "ScrutinGroupCountCheck" ALTER COLUMN "groupCoherence" TYPE VARCHAR(20)`,
        `SELECT 1 FROM information_schema.columns WHERE table_name = 'ScrutinGroupCountCheck' AND column_name = 'groupCoherence' AND data_type = 'text'`,
      ],
      [
        "a dropped stand-alone index",
        `DROP INDEX "ScrutinCountCheck_stream_countCoherence_idx"`,
        `SELECT 1 FROM pg_indexes WHERE indexname = 'ScrutinCountCheck_stream_countCoherence_idx'`,
      ],
      [
        "an extra index",
        `CREATE INDEX "extra_idx" ON "ScrutinCountCheck"("rawHash")`,
        `SELECT 1 FROM pg_indexes WHERE indexname = 'extra_idx'`,
      ],
      [
        "an extra trigger",
        `CREATE TRIGGER "extra_trg" BEFORE INSERT ON "ScrutinCountCheck" FOR EACH ROW EXECUTE FUNCTION historical_refuse_truncate()`,
        `SELECT 1 FROM pg_trigger WHERE tgname = 'extra_trg'`,
      ],
      [
        "a disabled trigger",
        `ALTER TABLE "ScrutinCountCheck" DISABLE TRIGGER "ScrutinCountCheck_version_guard"`,
        `SELECT 1 FROM pg_trigger WHERE tgname = 'ScrutinCountCheck_version_guard' AND tgenabled = 'D'`,
      ],
      [
        "a trigger that is not ENABLE ALWAYS",
        `ALTER TABLE "ScrutinGroupCountCheck" ENABLE TRIGGER "ScrutinGroupCountCheck_no_delete"`,
        `SELECT 1 FROM pg_trigger WHERE tgname = 'ScrutinGroupCountCheck_no_delete' AND tgenabled = 'O'`,
      ],
      [
        "a dropped trigger",
        `DROP TRIGGER "ScrutinCountCheck_no_truncate" ON "ScrutinCountCheck"`,
        `SELECT 1 FROM pg_trigger WHERE tgname = 'ScrutinCountCheck_no_truncate' ORDER BY 1 LIMIT 0`,
      ],
      [
        "a table without row level security",
        `ALTER TABLE "ScrutinCountCheck" DISABLE ROW LEVEL SECURITY`,
        `SELECT 1 FROM pg_class WHERE relname = 'ScrutinCountCheck' AND NOT relrowsecurity`,
      ],
      [
        "a grant to anon",
        `GRANT SELECT ON "ScrutinGroupCountCheck" TO anon`,
        `SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.relname = 'ScrutinGroupCountCheck' AND a.privilege_type = 'SELECT' AND a.grantee = 'anon'::regrole`,
      ],
      [
        "a missing table (partial installation)",
        `DROP TABLE "ScrutinGroupCountCheck"`,
        `SELECT 1 FROM pg_class WHERE relname = 'ScrutinGroupCountCheck' ORDER BY 1 LIMIT 0`,
      ],
    ];
    it.each(divergences)(
      "refuses to run over %s, changes nothing, and names the difference",
      async (_label, damage, stillThere) => {
        await q(damage);
        const state = async () => JSON.stringify((await q(stillThere)).rows);
        const before = await state();
        const error = await apply5c0().then(
          () => null,
          (e: Error) => e
        );
        expect(error?.message).toContain("differs from the expected definition");
        expect(error?.message).toMatch(
          /only in the (reference build|real schema)|partial installation/
        );
        expect(await state()).toBe(before);
        expect(
          (await q(`SELECT 1 FROM pg_namespace WHERE nspname = 'hg_reference'`)).rowCount
        ).toBe(0);
      }
    );

    it("has a rollback that stops on a row, drops only its two tables when empty, and leaves the lot 5B whole", async () => {
      await artifact();
      await snapshot("s1", 1);
      await insert("ScrutinCountCheck", check("V1"));
      const refused = await q(SQL_5C0_ROLLBACK).then(
        () => null,
        (e: Error) => e
      );
      expect(refused?.message).toContain("ScrutinCountCheck holds rows");
      expect((await q(`SELECT 1 FROM "ScrutinCountCheck"`)).rowCount).toBe(1);
      expect(
        (await q(`SELECT 1 FROM pg_class WHERE relname = 'ScrutinGroupCountCheck'`)).rowCount
      ).toBe(1);

      await reset();
      await apply5b();
      await apply5c0();
      const before5b = (
        await q(
          `SELECT count(*)::int AS n FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'`
        )
      ).rows[0].n;
      await q(SQL_5C0_ROLLBACK);
      const after = (
        await q(
          `SELECT count(*)::int AS n FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'`
        )
      ).rows[0].n;
      expect(before5b - after).toBe(2);
      expect(
        (
          await q(
            `SELECT count(*)::int AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'historical%'`
          )
        ).rows[0].n
      ).toBe(9);
      // And the 5B rollback still works afterwards (its own tables are empty).
      await q(SQL_5B_ROLLBACK);
    });
  });

  // ------------------------------------------------------------------------------------------
  describe("the status is what the stored numbers say", () => {
    beforeEach(async () => {
      await artifact();
      await snapshot("s1", 1);
    });
    let n = 0;
    const accept = (over: Cols) => stateOf(insert("ScrutinCountCheck", check(`V${++n}`, over)));

    it("accepts a coherent scrutin", async () => {
      expect(await accept({})).toBeNull();
    });
    it("accepts a mismatch shown by the summary, with the difference stored", async () => {
      expect(
        await accept({ countCoherence: "COUNT_MISMATCH", officialPour: 12, diffPour: -2 })
      ).toBeNull();
    });
    it("accepts a mismatch shown by a group alone", async () => {
      expect(await accept({ countCoherence: "COUNT_MISMATCH", mismatchedGroups: 1 })).toBeNull();
    });
    it("accepts a mismatch on the non-voters alone", async () => {
      expect(
        await accept({ countCoherence: "COUNT_MISMATCH", officialNonVotant: 3, diffNonVotant: -2 })
      ).toBeNull();
    });
    it("accepts a scrutin without a summary as UNVERIFIABLE, with the official counts and differences kept absent", async () => {
      expect(await accept({ countCoherence: "UNVERIFIABLE", ...NO_SUMMARY })).toBeNull();
    });
    it("accepts a scrutin with an unverified group as UNVERIFIABLE", async () => {
      expect(await accept({ countCoherence: "UNVERIFIABLE", unverifiableGroups: 1 })).toBeNull();
    });
    it("lets a mismatch outrank an unverifiable count, and refuses the reverse", async () => {
      expect(
        await accept({ countCoherence: "COUNT_MISMATCH", mismatchedGroups: 1, ...NO_SUMMARY })
      ).toBeNull();
      expect(
        await accept({ countCoherence: "UNVERIFIABLE", mismatchedGroups: 1, ...NO_SUMMARY })
      ).toBe(CHECK);
      expect(
        await accept({ countCoherence: "UNVERIFIABLE", mismatchedGroups: 1, unverifiableGroups: 1 })
      ).toBe(CHECK);
    });

    it.each([
      ["COHERENT while a difference is stored", { officialPour: 12, diffPour: -2 }],
      ["COHERENT while a group disagrees", { mismatchedGroups: 1 }],
      ["COHERENT while a group is unverified", { unverifiableGroups: 1 }],
      ["COHERENT without a summary", { ...NO_SUMMARY }],
      ["COUNT_MISMATCH with nothing that differs", { countCoherence: "COUNT_MISMATCH" }],
      ["UNVERIFIABLE with a summary and every group verified", { countCoherence: "UNVERIFIABLE" }],
      ["a status that is not one of the three", { countCoherence: "MOSTLY_COHERENT" }],
      [
        "a difference that is not nominal minus official",
        { officialPour: 12, diffPour: 7, countCoherence: "COUNT_MISMATCH" },
      ],
      ["a summary with one position missing", { officialContre: null, diffContre: null }],
      ["a difference kept where there is no official count", { officialPour: null, diffPour: 3 }],
      ["no group", { groupCount: 0 }],
      [
        "more disagreeing and unverified groups than groups",
        {
          groupCount: 2,
          mismatchedGroups: 2,
          unverifiableGroups: 1,
          countCoherence: "COUNT_MISMATCH",
        },
      ],
      [
        "a negative nominal count",
        { nominalPour: -1, diffPour: -11, officialPour: 10, countCoherence: "COUNT_MISMATCH" },
      ],
      [
        "a negative official count",
        { officialPour: -1, diffPour: 11, countCoherence: "COUNT_MISMATCH" },
      ],
      ["a malformed file hash", { memberHash: "not-a-hash" }],
      ["a malformed row hash", { rawHash: H("g") }],
      ["a negative number of listed correction voters", { miseAuPointListedVotants: -1 }],
    ])("refuses %s", async (_label, over) => {
      expect(await accept(over)).toBe(CHECK);
    });

    it("refuses a stream that is not a scrutins stream", async () => {
      await q(`DELETE FROM "OfficialSourceSnapshot" WHERE false`);
      expect(
        await stateOf(insert("ScrutinCountCheck", check("VX", { stream: "AN_AMO30" })))
      ).not.toBeNull();
    });
  });

  describe("the status of a group", () => {
    beforeEach(async () => {
      await artifact();
      await snapshot("s1", 1);
    });
    it.each([
      ["coherent", {}, null],
      ["a difference", { groupCoherence: "COUNT_MISMATCH", officialPour: 5, diffPour: -1 }, null],
      [
        "no official count",
        {
          groupCoherence: "UNVERIFIABLE",
          officialPour: null,
          officialContre: null,
          officialAbstention: null,
          officialNonVotant: null,
          diffPour: null,
          diffContre: null,
          diffAbstention: null,
          diffNonVotant: null,
        },
        null,
      ],
      ["COHERENT while a difference is stored", { officialPour: 5, diffPour: -1 }, CHECK],
      ["COUNT_MISMATCH with no difference", { groupCoherence: "COUNT_MISMATCH" }, CHECK],
      ["UNVERIFIABLE with an official count", { groupCoherence: "UNVERIFIABLE" }, CHECK],
    ])("%s", async (_label, over, expected) => {
      expect(
        await stateOf(insert("ScrutinGroupCountCheck", group("V1", "PO1", over as Cols)))
      ).toBe(expected);
    });

    it("keeps the placeholder group twice in one scrutin, each with its own rank", async () => {
      await insert("ScrutinGroupCountCheck", group("V1", "PO0", {}, 0));
      await insert("ScrutinGroupCountCheck", group("V1", "PO0", {}, 1));
      await insert("ScrutinGroupCountCheck", group("V1", "PO1", {}, 0));
      expect(
        (
          await q(
            `SELECT count(*)::int AS n FROM "ScrutinGroupCountCheck" WHERE "organRef" = 'PO0'`
          )
        ).rows[0].n
      ).toBe(2);
    });

    it("refuses two groups with the same organ and the same rank, and a negative rank", async () => {
      await insert("ScrutinGroupCountCheck", group("V1", "PO0", {}, 0));
      expect([UNIQUE, EXCLUSION]).toContain(
        await stateOf(insert("ScrutinGroupCountCheck", group("V1", "PO0", {}, 0)))
      );
      expect(await stateOf(insert("ScrutinGroupCountCheck", group("V1", "PO0", {}, -1)))).toBe(
        CHECK
      );
    });
  });

  // ------------------------------------------------------------------------------------------
  describe("the guards of the lot 5B apply to the new tables", () => {
    const tables: [string, (id: string, fromSeq?: number) => Cols, string][] = [
      [
        "ScrutinCountCheck",
        (id, fromSeq = 1) => check(id, {}, fromSeq),
        `"countCoherence" = 'UNVERIFIABLE'`,
      ],
      [
        "ScrutinGroupCountCheck",
        (id, fromSeq = 1) => group(id, "PO1", {}, 0, fromSeq),
        `"groupCoherence" = 'UNVERIFIABLE'`,
      ],
    ];
    beforeEach(async () => {
      await artifact();
      await snapshot("s1", 1);
    });

    it.each(tables)(
      "%s: refuses a content change and a DELETE, closes a version once",
      async (table, row, change) => {
        await insert(table, row("V1"));
        expect(await stateOf(q(`UPDATE "${table}" SET ${change}`))).toBe(RESTRICT);
        expect(await stateOf(q(`DELETE FROM "${table}"`))).toBe(RESTRICT);
        expect(await stateOf(q(`TRUNCATE "${table}"`))).toBe(RESTRICT);
        expect(await stateOf(q(`UPDATE "${table}" SET "toSeq" = 2`))).toBe(RESTRICT);
        await secondSnapshot();
        expect(await stateOf(q(`UPDATE "${table}" SET "toSeq" = 2`))).toBeNull();
        expect(await stateOf(q(`UPDATE "${table}" SET "toSeq" = 2`))).toBe(RESTRICT);
        expect(await stateOf(q(`DELETE FROM "${table}"`))).toBe(RESTRICT);
      }
    );

    it.each(tables)("%s: refuses a second active version of an identity", async (table, row) => {
      await insert(table, row("V1"));
      expect([UNIQUE, EXCLUSION]).toContain(await stateOf(insert(table, row("V1"))));
      await secondSnapshot();
      expect([UNIQUE, EXCLUSION]).toContain(await stateOf(insert(table, row("V1", 2))));
    });

    it.each(tables)(
      "%s: refuses a write once the snapshot is released, or is not the latest, or failed",
      async (table, row) => {
        await decision("s1", "RELEASED");
        expect(await stateOf(insert(table, row("V1")))).toBe(RESTRICT);
        await reset();
        await apply5b();
        await apply5c0();
        await artifact();
        await snapshot("s1", 1);
        await secondSnapshot();
        expect(await stateOf(insert(table, row("V1")))).toBe(RESTRICT);
        await reset();
        await apply5b();
        await apply5c0();
        await artifact();
        await snapshot("s1", 1, { integrity: "FAILED" });
        expect(await stateOf(insert(table, row("V1")))).toBe(RESTRICT);
      }
    );

    it.each(tables)("%s: refuses a version inserted already closed", async (table, row) => {
      expect(await stateOf(insert(table, { ...row("V1"), toSeq: 2 }))).toBe(RESTRICT);
    });
  });

  // ------------------------------------------------------------------------------------------
  describe("a retroactive correction of the official counts", () => {
    /** The question the publication of the lot 5F asks: which scrutins agree, at snapshot S. */
    const GATE = `SELECT c."scrutinExternalId" AS id FROM "ScrutinCountCheck" c
      WHERE c."stream" = $1 AND c."fromSeq" <= $2 AND (c."toSeq" IS NULL OR $2 < c."toSeq") AND c."countCoherence" = 'COHERENT' ORDER BY 1`;
    /** The same, from the side of the votes: a scrutin with attestations and no check is not publishable. */
    const GATE_FROM_VOTES = `SELECT DISTINCT a."scrutinExternalId" AS id FROM "ScrutinVoterAttestation" a
      LEFT JOIN "ScrutinCountCheck" c ON c."stream" = a."stream" AND c."scrutinExternalId" = a."scrutinExternalId"
        AND c."fromSeq" <= $2 AND (c."toSeq" IS NULL OR $2 < c."toSeq")
      WHERE a."stream" = $1 AND a."fromSeq" <= $2 AND (a."toSeq" IS NULL OR $2 < a."toSeq")
        AND c."countCoherence" IS NOT DISTINCT FROM 'COHERENT' ORDER BY 1`;
    const attestation = (scrutin: string, officialId: string, fromSeq = 1): Cols => ({
      stream: STREAM,
      scrutinExternalId: scrutin,
      officialId,
      fromSeq,
      scrutinDate: "2023-03-14",
      legislature: 16,
      publishedOrganRef: "PO1",
      publishedPosition: "pour",
      sourceMember: "json/x.json",
      memberHash: H("a"),
      rawHash: H("d"),
    });

    beforeEach(async () => {
      await artifact();
      await snapshot("s1", 1);
      await insert("ScrutinCountCheck", check("V1"));
      await insert(
        "ScrutinCountCheck",
        check("V2", { countCoherence: "COUNT_MISMATCH", mismatchedGroups: 1 })
      );
      await insert(
        "ScrutinCountCheck",
        check("V3", { countCoherence: "UNVERIFIABLE", ...NO_SUMMARY })
      );
      await insert("ScrutinCountCheck", check("V4"));
      await decision("s1", "RELEASED");
    });

    it("lets only the coherent scrutins through the gate", async () => {
      expect((await q(GATE, [STREAM, 1])).rows.map((r) => r.id)).toEqual(["V1", "V4"]);
    });

    it("keeps the earlier answer when a scrutin is corrected: both versions stay, each at its own snapshot", async () => {
      await secondSnapshot();
      // V2 now agrees, V1 now disagrees.
      await q(
        `UPDATE "ScrutinCountCheck" SET "toSeq" = 2 WHERE "scrutinExternalId" IN ('V1', 'V2')`
      );
      await insert(
        "ScrutinCountCheck",
        check("V1", { countCoherence: "COUNT_MISMATCH", mismatchedGroups: 1, rawHash: H("e") }, 2)
      );
      await insert("ScrutinCountCheck", check("V2", { rawHash: H("f") }, 2));
      expect((await q(GATE, [STREAM, 1])).rows.map((r) => r.id)).toEqual(["V1", "V4"]);
      expect((await q(GATE, [STREAM, 2])).rows.map((r) => r.id)).toEqual(["V2", "V4"]);
      const versions = await q(
        `SELECT "scrutinExternalId" AS id, "fromSeq", "toSeq", "countCoherence" FROM "ScrutinCountCheck" WHERE "scrutinExternalId" IN ('V1', 'V2') ORDER BY 1, 2`
      );
      expect(versions.rows).toEqual([
        { id: "V1", fromSeq: 1, toSeq: 2, countCoherence: "COHERENT" },
        { id: "V1", fromSeq: 2, toSeq: null, countCoherence: "COUNT_MISMATCH" },
        { id: "V2", fromSeq: 1, toSeq: 2, countCoherence: "COUNT_MISMATCH" },
        { id: "V2", fromSeq: 2, toSeq: null, countCoherence: "COHERENT" },
      ]);
    });

    it("refuses to rewrite the answer in place, and to write into the released snapshot", async () => {
      expect(
        await stateOf(
          q(
            `UPDATE "ScrutinCountCheck" SET "countCoherence" = 'COHERENT', "mismatchedGroups" = 0 WHERE "scrutinExternalId" = 'V2'`
          )
        )
      ).toBe(RESTRICT);
      expect(await stateOf(insert("ScrutinCountCheck", check("V5")))).toBe(RESTRICT);
    });

    it("does not let a scrutin through when it has votes and no check at all", async () => {
      await reset();
      await apply5b();
      await apply5c0();
      await artifact();
      await snapshot("s1", 1);
      await insert("ScrutinCountCheck", check("V1"));
      await insert(
        "ScrutinCountCheck",
        check("V2", { countCoherence: "COUNT_MISMATCH", mismatchedGroups: 1 })
      );
      await insert("ScrutinVoterAttestation", attestation("V1", "PA1"));
      await insert("ScrutinVoterAttestation", attestation("V2", "PA2"));
      await insert("ScrutinVoterAttestation", attestation("V3", "PA3"));
      await decision("s1", "RELEASED");
      expect((await q(GATE_FROM_VOTES, [STREAM, 1])).rows.map((r) => r.id)).toEqual(["V1"]);
    });

    it("keeps the votes of a discordant scrutin: nothing is dropped, the gate is what holds them back", async () => {
      await reset();
      await apply5b();
      await apply5c0();
      await artifact();
      await snapshot("s1", 1);
      await insert(
        "ScrutinCountCheck",
        check("V2", { countCoherence: "COUNT_MISMATCH", mismatchedGroups: 1 })
      );
      await insert("ScrutinVoterAttestation", attestation("V2", "PA1"));
      await insert("ScrutinVoterAttestation", attestation("V2", "PA2"));
      expect(
        (
          await q(
            `SELECT count(*)::int AS n FROM "ScrutinVoterAttestation" WHERE "scrutinExternalId" = 'V2'`
          )
        ).rows[0].n
      ).toBe(2);
      expect((await q(GATE_FROM_VOTES, [STREAM, 1])).rows).toEqual([]);
    });
  });

  // ------------------------------------------------------------------------------------------
  describe("privileges and concurrency", () => {
    async function asRole<T>(role: string, work: (c: PoolClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query(`SET ROLE ${role}`);
        return await work(client);
      } finally {
        await client.query("RESET ROLE");
        client.release();
      }
    }

    it("closes both tables to anon and authenticated, with or without a grant, and to PUBLIC", async () => {
      await artifact();
      await snapshot("s1", 1);
      await insert("ScrutinCountCheck", check("V1"));
      await q(`GRANT USAGE ON SCHEMA public TO anon, authenticated`);
      for (const role of ["anon", "authenticated"]) {
        for (const table of ["ScrutinCountCheck", "ScrutinGroupCountCheck"]) {
          const denied = await asRole(
            role,
            async (c) =>
              (await c.query(`SELECT * FROM "${table}"`).then(
                () => null,
                (e: { code?: string }) => e.code
              )) ?? "allowed"
          );
          expect(denied, `${role} on ${table}`).toBe("42501");
        }
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(`GRANT SELECT ON "ScrutinCountCheck" TO ${role}`);
          await client.query(`SET LOCAL ROLE ${role}`);
          expect(
            (await client.query(`SELECT * FROM "ScrutinCountCheck"`)).rowCount,
            `${role} with a grant`
          ).toBe(0);
        } finally {
          await client.query("ROLLBACK");
          client.release();
        }
      }
    });

    it("makes a release wait for a writer of a count check, and refuses the writer that comes after", async () => {
      await artifact();
      await snapshot("s1", 1);
      const writer = await pool.connect();
      await writer.query("BEGIN");
      const cols = check("V1");
      const names = Object.keys(cols);
      await writer.query(
        `INSERT INTO "ScrutinCountCheck" (${names.map((n) => `"${n}"`).join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})`,
        names.map((n) => cols[n])
      );
      const release = decision("s1", "RELEASED");
      const settled = await Promise.race([
        release.then(
          () => true,
          () => true
        ),
        new Promise<boolean>((r) => setTimeout(() => r(false), 400)),
      ]);
      expect(settled, "the release waits for the writer").toBe(false);
      await writer.query("COMMIT");
      writer.release();
      await release;
      expect(await stateOf(insert("ScrutinCountCheck", check("V2")))).toBe(RESTRICT);
      expect((await q(`SELECT count(*)::int AS n FROM "ScrutinCountCheck"`)).rows[0].n).toBe(1);
    });
  });

  // ------------------------------------------------------------------------------------------
  describe("the volume the official files would bring", () => {
    it("holds 17 399 scrutins and about 190 000 group rows, with a reasonable cost, all invented", async () => {
      await artifact();
      await snapshot("s1", 1);
      const started = Date.now();
      await q(
        `INSERT INTO "ScrutinCountCheck"("stream","scrutinExternalId","fromSeq","scrutinDate","legislature","countCoherence","groupCount","mismatchedGroups","unverifiableGroups",
           "nominalPour","nominalContre","nominalAbstention","nominalNonVotant","officialPour","officialContre","officialAbstention","officialNonVotant",
           "diffPour","diffContre","diffAbstention","diffNonVotant","miseAuPointListedVotants","miseAuPointMalformedBlocks","sourceMember","memberHash","rawHash")
         SELECT $1, 'V' || g, 1, DATE '2023-01-01' + (g % 500), 16, 'COHERENT', 11, 0, 0, 100, 50, 10, 3, 100, 50, 10, 3, 0, 0, 0, 0, 0, 0, 'json/V' || g || '.json',
                md5('m' || g) || md5('M' || g), md5('r' || g) || md5('R' || g)
         FROM generate_series(1, 17399) g`,
        [STREAM]
      );
      await q(
        `INSERT INTO "ScrutinGroupCountCheck"("stream","scrutinExternalId","organRef","organOrdinal","fromSeq","groupCoherence",
           "nominalPour","nominalContre","nominalAbstention","nominalNonVotant","officialPour","officialContre","officialAbstention","officialNonVotant",
           "diffPour","diffContre","diffAbstention","diffNonVotant","sourceMember","memberHash","rawHash")
         SELECT $1, 'V' || g, 'PO' || k, 0, 1, 'COHERENT', 9, 4, 1, 0, 9, 4, 1, 0, 0, 0, 0, 0, 'json/V' || g || '.json',
                md5('m' || g) || md5('M' || g), md5('r' || g || k) || md5('R' || g || k)
         FROM generate_series(1, 17399) g, generate_series(1, 11) k`,
        [STREAM]
      );
      const seconds = (Date.now() - started) / 1000;
      const sizes = await q(
        `SELECT pg_total_relation_size('"ScrutinCountCheck"') AS a, pg_total_relation_size('"ScrutinGroupCountCheck"') AS b`
      );
      // The figures are the point of this test: a log line is how they reach the report.
      // eslint-disable-next-line no-console
      console.info(
        `count-check volume: 17399 scrutin rows + 191389 group rows in ${seconds.toFixed(1)} s, ` +
          `${Math.round(Number(sizes.rows[0].a) / 1048576)} MB and ${Math.round(Number(sizes.rows[0].b) / 1048576)} MB`
      );
      expect(seconds).toBeLessThan(110);
    });
  });
});
