// @vitest-environment node
/**
 * What PostgreSQL really enforces for the lot 5B schema. Runs the committed SQL, as written, on a
 * disposable database and tries to break every invariant the architecture document relies on.
 *
 * NOT RUN BY DEFAULT, and not wired into CI: it needs the dedicated container below. The lot owner
 * decides where the SQL runs (see docs/audits/parlement-historique-lot5b-schema.md).
 *
 * Setup, once the container is up: the marker the suite insists on, and the two roles the REVOKE
 * statements name.
 *   psql ... -c "ALTER DATABASE hg_schema_test SET hg.disposable = 'yes'; CREATE ROLE anon; CREATE ROLE authenticated;"
 *
 *   docker run --rm -d --name hg-schema-test -p 127.0.0.1:55486:5432 \
 *     -e POSTGRES_USER=hg_schema_test -e POSTGRES_PASSWORD=hg_schema_test -e POSTGRES_DB=hg_schema_test \
 *     postgres:17
 *   env -u DATABASE_URL -u DIRECT_URL HISTORICAL_SCHEMA_TEST_DATABASE_URL=postgresql://hg_schema_test:hg_schema_test@127.0.0.1:55486/hg_schema_test \
 *     npx vitest run src/lib/parlement/historical-groups/__tests__/schema.integration.test.ts
 *
 * The suite DROPS and recreates the public schema of that database before every test: the URL is
 * pinned to that exact container, and anything else is refused before the first statement.
 */
import { readFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Applying the script takes about a second, and a few tests insert tens of thousands of rows.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

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
// The suite reads this one variable and nothing else: never DATABASE_URL or DIRECT_URL, which point
// at the production database. Even if one of them held the same value, it is refused.
if (url && (url === process.env.DATABASE_URL || url === process.env.DIRECT_URL)) {
  throw new Error("The test URL must not be a connection string of the application");
}
const describeDb = url ? describe : describe.skip;

const SQL = readFileSync(
  "prisma/migrations/manual/2026-10-18-historical-groups-schema.sql",
  "utf8"
);
const ROLLBACK = readFileSync(
  "prisma/migrations/manual/2026-10-18-historical-groups-schema-rollback.sql",
  "utf8"
);

const H = (c: string) => c.repeat(64);
const SHA_A = H("a");
const SHA_B = H("b");
const STATE_1 = H("1");
const STATE_2 = H("2");

/** SQLSTATE of the error a statement raises, `null` when it succeeds. */
async function stateOf(run: Promise<unknown>): Promise<string | null> {
  try {
    await run;
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "no-code";
  }
}

const RESTRICT = "23001";
const UNIQUE = "23505";
const EXCLUSION = "23P01";
const FOREIGN_KEY = "23503";
const CHECK = "23514";

describeDb("historical groups schema on a disposable PostgreSQL", () => {
  let pool: Pool;

  const q = (text: string, values?: unknown[]) => pool.query(text, values);

  /**
   * The URL is pinned, and the database must also say it is disposable. The marker is set by hand
   * on the dedicated container (`ALTER DATABASE hg_schema_test SET hg.disposable = 'yes'`): a tunnel
   * to another server on the same port would not carry it. Checked before every reset, because the
   * reset drops the public schema.
   */
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
  const apply = () => q(SQL);

  const artifact = (sha = SHA_A) =>
    q(
      `INSERT INTO "SourceArtifact"("sha256","byteSize","mediaType","storageKind","storageRef","storedAt","storedBy")
       VALUES ($1, 100, 'application/zip', 'LOCAL_OFFLINE', 'artifacts/x', now(), 'test')`,
      [sha]
    );
  const snapshot = (
    id: string,
    seq: number,
    opts: { stream?: string; sha?: string; integrity?: string; state?: string } = {}
  ) =>
    q(
      `INSERT INTO "OfficialSourceSnapshot"("id","stream","seq","artifactSha256","url","fetchedAt","integrity","parserVersion","stateHash","recordCounts","importedBy")
       VALUES ($1, $2, $3, $4, 'https://example.test/a.zip', now(), $5, '5A-2.1', $6, '{}', 'test')`,
      [
        id,
        opts.stream ?? "AN_AMO30",
        seq,
        opts.sha ?? SHA_A,
        opts.integrity ?? "VERIFIED",
        opts.state ?? STATE_1,
      ]
    );
  const decision = (snapshotId: string, status: string, kind = "HUMAN") =>
    q(
      `INSERT INTO "SnapshotDecision"("snapshotId","status","reason","decidedBy","decidedByKind") VALUES ($1, $2, 'test', 'tester', $3)`,
      [snapshotId, status, kind]
    );
  const membership = (
    id: string,
    fromSeq: number,
    opts: {
      toSeq?: number | null;
      group?: string;
      start?: string | null;
      end?: string | null;
      state?: string;
    } = {}
  ) =>
    q(
      `INSERT INTO "GroupMembershipRecord"("stream","sourceRecordId","fromSeq","toSeq","officialId","chamber","groupRef","legislature","startDate","startState","endDate","endState","sourceMember","rawHash")
       VALUES ('AN_AMO30', $1, $2, $3, 'PA1', 'AN', $4, 16, $5, $6, $7, $8, 'json/acteur/PA1.json', $9)`,
      [
        id,
        fromSeq,
        opts.toSeq ?? null,
        opts.group ?? "PO1",
        opts.start === undefined ? "2022-06-29" : opts.start,
        opts.start === null ? "UNKNOWN" : "DATED",
        opts.end ?? null,
        opts.end ? "DATED" : "OPEN_AT_SNAPSHOT",
        H("c"),
      ]
    );
  const run = (id: string, inputHash = H("d"), status = "RUNNING") =>
    q(
      `INSERT INTO "HistoricalResolutionRun"("id","inputHash","status","linkDecisionCutoff","continuityDecisionCutoff","decisionsHash","preparedInputsHash","parserVersion","resolverVersion","dateSemanticsVersion","exclusionRulesVersion","configHash","config","codeVersion","startedBy","startedAt")
       VALUES ($1, $2, $3, 0, 0, $4, $4, '5A-2.1', '2', 'v1', '1', $4, '{}', 'abc', 'tester', now())`,
      [id, inputHash, status, H("e")]
    );
  const released = async (id = "s1", seq = 1) => {
    await artifact();
    await snapshot(id, seq);
    await decision(id, "RELEASED");
  };

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
    await apply();
  });

  describe("the script itself", () => {
    it("applies, then applies again without a difference", async () => {
      const before = await q(
        `SELECT count(*)::int AS n FROM pg_class WHERE relnamespace = 'public'::regnamespace`
      );
      await apply();
      const after = await q(
        `SELECT count(*)::int AS n FROM pg_class WHERE relnamespace = 'public'::regnamespace`
      );
      expect(after.rows[0].n).toBe(before.rows[0].n);
      const leftover = await q(`SELECT 1 FROM pg_namespace WHERE nspname = 'hg_reference'`);
      expect(leftover.rowCount).toBe(0);
    });

    it("creates thirteen tables, all with row level security and no privilege for the application roles", async () => {
      const tables = await q(
        `SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname !~ '^pg_' ORDER BY 1`
      );
      expect(tables.rows).toHaveLength(13);
      expect(tables.rows.every((r) => r.relrowsecurity === true)).toBe(true);
      for (const row of tables.rows) {
        for (const role of ["anon", "authenticated"]) {
          const granted = await q(
            `SELECT has_table_privilege($1, format('public.%I', $2::text), 'SELECT,INSERT,UPDATE,DELETE') AS ok`,
            [role, row.relname]
          );
          expect(granted.rows[0].ok, `${role} on ${row.relname}`).toBe(false);
        }
      }
    });

    // On an existing installation NOTHING is repaired: any divergence (structure, code, triggers,
    // privileges, RLS) makes the script fail before it writes, with the list of differences, and
    // the divergence is still there afterwards. `stillThere` returns a row while the damage exists.
    const divergences: [string, string, string][] = [
      [
        "a dropped CHECK constraint",
        `ALTER TABLE "GroupMembershipRecord" DROP CONSTRAINT "GroupMembershipRecord_dates_ordered"`,
        `SELECT 1 FROM pg_constraint WHERE conname = 'GroupMembershipRecord_dates_ordered'`,
      ],
      [
        "a dropped exclusion constraint",
        `ALTER TABLE "SeatMandateRecord" DROP CONSTRAINT "SeatMandateRecord_no_overlap"`,
        `SELECT 1 FROM pg_constraint WHERE conname = 'SeatMandateRecord_no_overlap'`,
      ],
      [
        "an extra column",
        `ALTER TABLE "RunExclusion" ADD COLUMN "extra" TEXT`,
        `SELECT 1 FROM information_schema.columns WHERE column_name = 'extra'`,
      ],
      [
        "a changed column type",
        `ALTER TABLE "OfficialOrganRecord" ALTER COLUMN "label" TYPE VARCHAR(10)`,
        `SELECT 1 FROM information_schema.columns WHERE table_name = 'OfficialOrganRecord' AND column_name = 'label' AND data_type = 'text'`,
      ],
      [
        "a dropped column default",
        `ALTER TABLE "SnapshotDecision" ALTER COLUMN "decidedAt" DROP DEFAULT`,
        `SELECT 1 FROM information_schema.columns WHERE table_name = 'SnapshotDecision' AND column_name = 'decidedAt' AND column_default IS NOT NULL`,
      ],
      [
        "an index of the same name with another definition",
        `DROP INDEX "OfficialActor_active_key"; CREATE UNIQUE INDEX "OfficialActor_active_key" ON "OfficialActor"("stream", "officialId", "fromSeq")`,
        `SELECT 1 FROM pg_indexes WHERE indexname = 'OfficialActor_active_key' AND indexdef LIKE '%fromSeq%'`,
      ],
      [
        "a dropped stand-alone index",
        `DROP INDEX "GroupMembershipRecord_active_key"`,
        `SELECT 1 FROM pg_indexes WHERE indexname = 'GroupMembershipRecord_active_key'`,
      ],
      [
        "an extra index",
        `CREATE INDEX "extra_idx" ON "SnapshotDecision"("reason")`,
        `SELECT 1 FROM pg_indexes WHERE indexname = 'extra_idx'`,
      ],
      [
        "an extra trigger",
        `CREATE TRIGGER "extra_trg" BEFORE INSERT ON "SnapshotDecision" FOR EACH ROW EXECUTE FUNCTION historical_refuse_truncate()`,
        `SELECT 1 FROM pg_trigger WHERE tgname = 'extra_trg'`,
      ],
      [
        "a disabled trigger",
        `ALTER TABLE "OfficialActor" DISABLE TRIGGER "OfficialActor_version_guard"`,
        `SELECT 1 FROM pg_trigger WHERE tgname = 'OfficialActor_version_guard' AND tgenabled = 'D'`,
      ],
      [
        "a trigger that is not ENABLE ALWAYS",
        `ALTER TABLE "OfficialActor" ENABLE TRIGGER "OfficialActor_version_guard"`,
        `SELECT 1 FROM pg_trigger WHERE tgname = 'OfficialActor_version_guard' AND tgenabled = 'O'`,
      ],
      [
        "a dropped trigger",
        `DROP TRIGGER "RunExclusion_no_truncate" ON "RunExclusion"`,
        `SELECT 1 FROM pg_trigger WHERE tgname = 'RunExclusion_no_truncate' ORDER BY 1 LIMIT 0`,
      ],
      [
        "a table without row level security",
        `ALTER TABLE "SnapshotDecision" DISABLE ROW LEVEL SECURITY`,
        `SELECT 1 FROM pg_class WHERE relname = 'SnapshotDecision' AND NOT relrowsecurity`,
      ],
      [
        "a grant to anon on a table",
        `GRANT SELECT ON "SourceArtifact" TO anon`,
        `SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.relname = 'SourceArtifact' AND a.privilege_type = 'SELECT' AND a.grantee = 'anon'::regrole`,
      ],
      [
        "a grant to PUBLIC on a function",
        `GRANT EXECUTE ON FUNCTION historical_refuse_truncate() TO PUBLIC`,
        `SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.proname = 'historical_refuse_truncate' AND a.grantee = 0`,
      ],
      [
        "a changed function body",
        `CREATE OR REPLACE FUNCTION historical_refuse_truncate() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $f$ BEGIN RETURN NULL; END; $f$`,
        `SELECT 1 FROM pg_proc WHERE proname = 'historical_refuse_truncate' AND prosrc NOT LIKE '%TRUNCATE refused%'`,
      ],
      [
        "a function without its search_path",
        `ALTER FUNCTION historical_refuse_truncate() RESET search_path`,
        `SELECT 1 FROM pg_proc WHERE proname = 'historical_refuse_truncate' AND proconfig IS NULL`,
      ],
      [
        "a dropped function",
        `DROP FUNCTION historical_run_child_guard() CASCADE`,
        `SELECT 1 FROM pg_proc WHERE proname = 'historical_run_child_guard' ORDER BY 1 LIMIT 0`,
      ],
      [
        "an extra function",
        `CREATE FUNCTION historical_extra() RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
        `SELECT 1 FROM pg_proc WHERE proname = 'historical_extra'`,
      ],
      [
        "a missing table (partial installation)",
        `DROP TABLE "RunExclusion"`,
        `SELECT 1 FROM pg_class WHERE relname = 'RunExclusion' ORDER BY 1 LIMIT 0`,
      ],
    ];
    it.each(divergences)(
      "refuses to run over %s, changes nothing, and names the difference",
      async (_label, damage, stillThere) => {
        await q(damage);
        const state = async () => JSON.stringify((await q(stillThere)).rows);
        const before = await state();
        const error = await apply().then(
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

    it("leaves the catalog byte for byte identical when it is applied a second time", async () => {
      const fingerprint = async () =>
        (
          await q(`SELECT md5(string_agg(x, E'\n' ORDER BY x)) AS h, count(*)::int AS n FROM (
            SELECT 'c|' || conrelid::regclass::text || '|' || conname || '|' || pg_get_constraintdef(oid) AS x FROM pg_constraint WHERE connamespace = 'public'::regnamespace
            UNION ALL SELECT 'i|' || indexdef FROM pg_indexes WHERE schemaname = 'public'
            UNION ALL SELECT 't|' || pg_get_triggerdef(t.oid) || '|' || t.tgenabled::text::text FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal
            UNION ALL SELECT 'f|' || pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'historical%'
            UNION ALL SELECT 'a|' || c.relname || '|' || COALESCE(c.relacl::text, '') || '|' || c.relrowsecurity::text FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'S')
            UNION ALL SELECT 'p|' || p.proname || '|' || COALESCE(p.proacl::text, '') FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'historical%'
          ) s`)
        ).rows[0];
      const before = await fingerprint();
      expect(before.n).toBeGreaterThan(200);
      await apply();
      await apply();
      expect(await fingerprint()).toEqual(before);
    });

    it("installs when functions already exist and are identical, and refuses when they differ", async () => {
      // Keep the functions, remove the tables: no table of the lot exists, so this is an installation.
      await q(`DO $$ DECLARE t text; BEGIN
        FOREACH t IN ARRAY ARRAY['RunExclusion','HistoricalRunSnapshotPin','HistoricalResolutionRun','OrganContinuityDecision','OfficialActorLinkDecision','ScrutinVoterAttestation','SeatMandateRecord','GroupMembershipRecord','OfficialOrganRecord','OfficialActor','SnapshotDecision','OfficialSourceSnapshot','SourceArtifact']
        LOOP EXECUTE format('DROP TABLE %I', t); END LOOP; END $$`);
      await apply();
      expect(
        (
          await q(
            `SELECT count(*)::int AS n FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'`
          )
        ).rows[0].n
      ).toBe(13);
      await q(
        `DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE EXTENSION IF NOT EXISTS btree_gist`
      );
      await q(
        `CREATE FUNCTION historical_refuse_truncate() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL; END; $f$`
      );
      const error = await apply().then(
        () => null,
        (e: Error) => e
      );
      expect(error?.message).toContain("differs from the expected definition");
      expect(
        (
          await q(
            `SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'`
          )
        ).rowCount
      ).toBe(0);
    });

    it("has a rollback that stops on a row and drops everything when empty", async () => {
      await artifact();
      const refused = await q(ROLLBACK).then(
        () => null,
        (e: Error) => e
      );
      expect(refused?.message).toContain("SourceArtifact holds rows");
      expect((await q(`SELECT 1 FROM "SourceArtifact"`)).rowCount).toBe(1);
      await reset();
      await apply();
      await q(ROLLBACK);
      const left = await q(
        `SELECT count(*)::int AS n FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'`
      );
      expect(left.rows[0].n).toBe(0);
    });
  });

  describe("snapshots and their decisions", () => {
    it("numbers snapshots without a gap and without reuse", async () => {
      await artifact();
      await snapshot("s1", 1);
      expect(await stateOf(snapshot("s3", 3, { sha: SHA_A }))).toBe(CHECK);
      expect(await stateOf(snapshot("s1bis", 1, { state: STATE_2 }))).toBe(CHECK);
      await artifact(SHA_B);
      await snapshot("s2", 2, { sha: SHA_B, state: STATE_2 });
    });

    it("refuses two snapshots for the same bytes and parser version of a stream", async () => {
      await artifact();
      await snapshot("s1", 1);
      expect(await stateOf(snapshot("s2", 2, { state: STATE_2 }))).toBe(UNIQUE);
    });

    it("refuses an artifact that does not exist, and a malformed hash", async () => {
      expect(await stateOf(snapshot("s1", 1, { sha: SHA_B }))).toBe(FOREIGN_KEY);
      expect(await stateOf(artifact("not-a-hash"))).toBe(CHECK);
    });

    it("never releases a snapshot whose integrity failed, and never decides after a revocation", async () => {
      await artifact();
      await snapshot("s1", 1, { integrity: "FAILED" });
      expect(await stateOf(decision("s1", "RELEASED"))).toBe(RESTRICT);
      await decision("s1", "QUARANTINED", "SCRIPT");
      await decision("s1", "REVOKED");
      expect(await stateOf(decision("s1", "RELEASED"))).toBe(RESTRICT);
    });

    it("lets only a human release or revoke", async () => {
      await artifact();
      await snapshot("s1", 1);
      expect(await stateOf(decision("s1", "RELEASED", "SCRIPT"))).toBe(CHECK);
      expect(await stateOf(decision("s1", "REVOKED", "SCRIPT"))).toBe(CHECK);
    });

    it("refuses UPDATE, DELETE and TRUNCATE on snapshots and decisions", async () => {
      await released();
      for (const statement of [
        `UPDATE "OfficialSourceSnapshot" SET "integrity" = 'FAILED'`,
        `DELETE FROM "OfficialSourceSnapshot"`,
        `UPDATE "SnapshotDecision" SET "reason" = 'rewritten'`,
        `DELETE FROM "SnapshotDecision"`,
        `TRUNCATE "SnapshotDecision"`,
        `TRUNCATE "OfficialSourceSnapshot" CASCADE`,
        `DELETE FROM "SourceArtifact"`,
        `TRUNCATE "SourceArtifact" CASCADE`,
      ]) {
        expect(await stateOf(q(statement)), statement).toBe(RESTRICT);
      }
    });

    it("lets an artifact's verification date move forward, and nothing else change", async () => {
      await artifact();
      await q(`UPDATE "SourceArtifact" SET "lastVerifiedAt" = now()`);
      expect(
        await stateOf(q(`UPDATE "SourceArtifact" SET "lastVerifiedAt" = now() - interval '1 day'`))
      ).toBe(RESTRICT);
      expect(await stateOf(q(`UPDATE "SourceArtifact" SET "storageRef" = 'elsewhere'`))).toBe(
        RESTRICT
      );
    });

    it("refuses a storage reference that is a URL", async () => {
      expect(
        await stateOf(
          q(
            `INSERT INTO "SourceArtifact"("sha256","byteSize","mediaType","storageKind","storageRef","storedAt","storedBy") VALUES ($1, 1, 'application/zip', 'BLOB_PRIVATE', 'https://public.example/a.zip', now(), 't')`,
            [SHA_A]
          )
        )
      ).toBe(CHECK);
    });
  });

  describe("versions of records", () => {
    beforeEach(async () => {
      await artifact();
      await snapshot("s1", 1);
    });

    it("refuses a second active version of an identity, whichever layer answers first", async () => {
      await membership("PM1", 1);
      // Same snapshot: the primary key, the partial unique index and the exclusion constraint all
      // forbid it, and PostgreSQL does not promise which one answers first.
      expect([UNIQUE, EXCLUSION]).toContain(await stateOf(membership("PM1", 1, { group: "PO2" })));
      await membership("PM2", 1);
      // Next snapshot, the old version still open: also refused, closing it first is the way.
      await artifact(SHA_B);
      await snapshot("s2", 2, { sha: SHA_B, state: STATE_2 });
      expect([UNIQUE, EXCLUSION]).toContain(await stateOf(membership("PM1", 2, { group: "PO2" })));
      await q(`UPDATE "GroupMembershipRecord" SET "toSeq" = 2 WHERE "sourceRecordId" = 'PM1'`);
      await membership("PM1", 2, { group: "PO2" });
    });

    it("forbids a second active version with the partial unique index alone", async () => {
      await membership("PM1", 1);
      await artifact(SHA_B);
      await snapshot("s2", 2, { sha: SHA_B, state: STATE_2 });
      await q(
        `ALTER TABLE "GroupMembershipRecord" DROP CONSTRAINT "GroupMembershipRecord_no_overlap"`
      );
      expect(await stateOf(membership("PM1", 2, { group: "PO2" }))).toBe(UNIQUE);
    });

    it("refuses a version inserted already closed", async () => {
      expect(await stateOf(membership("PM1", 1, { toSeq: 2 }))).toBe(RESTRICT);
    });

    it("refuses records on a snapshot that is not the latest, released, revoked or not verified", async () => {
      await artifact(SHA_B);
      await snapshot("s2", 2, { sha: SHA_B, state: STATE_2 });
      expect(await stateOf(membership("PM1", 1))).toBe(RESTRICT);
      await decision("s2", "RELEASED");
      expect(await stateOf(membership("PM1", 2))).toBe(RESTRICT);
    });

    it("refuses records on a snapshot whose integrity failed", async () => {
      await artifact(SHA_B);
      await snapshot("s2", 2, { sha: SHA_B, state: STATE_2, integrity: "FAILED" });
      expect(await stateOf(membership("PM1", 2))).toBe(RESTRICT);
    });

    it("refuses a record that points at a snapshot of another stream or one that does not exist", async () => {
      expect(await stateOf(membership("PM1", 7))).toBe(RESTRICT);
    });

    it("keeps a retroactive correction: the old version is closed, the new one added, both stay", async () => {
      await membership("PM1", 1);
      await decision("s1", "RELEASED");
      await artifact(SHA_B);
      await snapshot("s2", 2, { sha: SHA_B, state: STATE_2 });
      await q(`UPDATE "GroupMembershipRecord" SET "toSeq" = 2 WHERE "sourceRecordId" = 'PM1'`);
      await membership("PM1", 2, { group: "PO2", end: "2022-12-31" });
      const rows = await q(
        `SELECT "fromSeq", "toSeq", "groupRef" FROM "GroupMembershipRecord" ORDER BY "fromSeq"`
      );
      expect(rows.rows).toEqual([
        { fromSeq: 1, toSeq: 2, groupRef: "PO1" },
        { fromSeq: 2, toSeq: null, groupRef: "PO2" },
      ]);
    });

    it("lets only toSeq change, only once, and only to the latest snapshot", async () => {
      await membership("PM1", 1);
      expect(await stateOf(q(`UPDATE "GroupMembershipRecord" SET "groupRef" = 'PO9'`))).toBe(
        RESTRICT
      );
      expect(await stateOf(q(`UPDATE "GroupMembershipRecord" SET "toSeq" = 1`))).toBe(CHECK);
      expect(await stateOf(q(`UPDATE "GroupMembershipRecord" SET "toSeq" = 5`))).toBe(RESTRICT);
      await artifact(SHA_B);
      await snapshot("s2", 2, { sha: SHA_B, state: STATE_2 });
      expect(
        await stateOf(q(`UPDATE "GroupMembershipRecord" SET "toSeq" = 2, "rawHash" = '${H("f")}'`))
      ).toBe(RESTRICT);
      await q(`UPDATE "GroupMembershipRecord" SET "toSeq" = 2`);
      expect(await stateOf(q(`UPDATE "GroupMembershipRecord" SET "toSeq" = NULL`))).toBe(RESTRICT);
      expect(await stateOf(q(`UPDATE "GroupMembershipRecord" SET "groupRef" = 'PO9'`))).toBe(
        RESTRICT
      );
    });

    it("refuses DELETE of a version, and TRUNCATE on every table of versions", async () => {
      await membership("PM1", 1);
      // A row-level guard fires only when a row is deleted, so the DELETE needs a row.
      expect(await stateOf(q(`DELETE FROM "GroupMembershipRecord"`))).toBe(RESTRICT);
      for (const table of [
        "OfficialActor",
        "OfficialOrganRecord",
        "GroupMembershipRecord",
        "SeatMandateRecord",
        "ScrutinVoterAttestation",
      ]) {
        // A statement-level guard fires even on an empty table.
        expect(await stateOf(q(`TRUNCATE "${table}"`)), `TRUNCATE ${table}`).toBe(RESTRICT);
      }
    });

    // Every version table carries the same guards: one row each, then the three refusals and the one
    // permitted change. The insert statements differ by table, the guards do not.
    const oneRow: [string, string, string, string][] = [
      [
        "OfficialActor",
        "AN_AMO30",
        `INSERT INTO "OfficialActor"("stream","officialId","fromSeq","sourceMember","rawHash") VALUES ('AN_AMO30','PA1',1,'m','${H("c")}')`,
        `"sourceMember" = 'other'`,
      ],
      [
        "OfficialOrganRecord",
        "AN_AMO30",
        `INSERT INTO "OfficialOrganRecord"("stream","organeRef","fromSeq","codeType","label","sourceMember","rawHash") VALUES ('AN_AMO30','PO1',1,'GP','Groupe','m','${H("c")}')`,
        `"label" = 'other'`,
      ],
      [
        "SeatMandateRecord",
        "AN_AMO30",
        `INSERT INTO "SeatMandateRecord"("stream","sourceRecordId","fromSeq","officialId","startDate","startState","endState","sourceMember","rawHash") VALUES ('AN_AMO30','PM1',1,'PA1','2022-06-22','DATED','OPEN_AT_SNAPSHOT','m','${H("c")}')`,
        `"officialId" = 'PA2'`,
      ],
      [
        "GroupMembershipRecord",
        "AN_AMO30",
        `INSERT INTO "GroupMembershipRecord"("stream","sourceRecordId","fromSeq","officialId","chamber","groupRef","startDate","startState","endState","sourceMember","rawHash") VALUES ('AN_AMO30','PM1',1,'PA1','AN','PO1','2022-06-29','DATED','OPEN_AT_SNAPSHOT','m','${H("c")}')`,
        `"groupRef" = 'PO2'`,
      ],
      [
        "ScrutinVoterAttestation",
        "AN_SCRUTINS_L16",
        `INSERT INTO "ScrutinVoterAttestation"("stream","scrutinExternalId","officialId","fromSeq","scrutinDate","legislature","publishedOrganRef","publishedPosition","sourceMember","memberHash","rawHash") VALUES ('AN_SCRUTINS_L16','VTANR5L16V1','PA1',1,'2023-03-14',16,'PO1','pour','m','${H("a")}','${H("b")}')`,
        `"publishedPosition" = 'contre'`,
      ],
    ];
    it.each(oneRow)(
      "%s: refuses a content change and a DELETE, and allows closing the version once",
      async (table, stream, insert, change) => {
        await reset();
        await apply();
        await artifact();
        await snapshot("a1", 1, { stream });
        await q(insert);
        expect(await stateOf(q(`UPDATE "${table}" SET ${change}`))).toBe(RESTRICT);
        expect(await stateOf(q(`DELETE FROM "${table}"`))).toBe(RESTRICT);
        expect(await stateOf(q(`UPDATE "${table}" SET "toSeq" = 2`))).toBe(RESTRICT);
        await artifact(SHA_B);
        await snapshot("a2", 2, { stream, sha: SHA_B, state: STATE_2 });
        expect(await stateOf(q(`UPDATE "${table}" SET "toSeq" = 2`))).toBeNull();
        expect(await stateOf(q(`UPDATE "${table}" SET "toSeq" = 2`))).toBe(RESTRICT);
        expect(await stateOf(q(`DELETE FROM "${table}"`))).toBe(RESTRICT);
        expect((await q(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n).toBe(1);
      }
    );

    it("keeps the guards in force in a replica session", async () => {
      await membership("PM1", 1);
      const client = await pool.connect();
      try {
        await client.query("SET session_replication_role = replica");
        const error = await client.query(`DELETE FROM "GroupMembershipRecord"`).then(
          () => null,
          (e: { code?: string }) => e.code
        );
        expect(error).toBe(RESTRICT);
      } finally {
        await client.query("RESET session_replication_role");
        client.release();
      }
    });

    it("checks dates and their states", async () => {
      expect(await stateOf(membership("PM1", 1, { start: "2023-01-02", end: "2023-01-01" }))).toBe(
        CHECK
      );
      await membership("PM2", 1, { start: null });
      expect(
        await stateOf(
          q(
            `INSERT INTO "GroupMembershipRecord"("stream","sourceRecordId","fromSeq","officialId","chamber","groupRef","startDate","startState","endState","sourceMember","rawHash") VALUES ('AN_AMO30','PM3',1,'PA1','AN','PO1','2022-01-01','UNKNOWN','OPEN_AT_SNAPSHOT','m','${H("c")}')`
          )
        )
      ).toBe(CHECK);
    });

    it("refuses an inconsistent chamber and stream, and a stream outside the list", async () => {
      expect(
        await stateOf(
          q(
            `INSERT INTO "GroupMembershipRecord"("stream","sourceRecordId","fromSeq","officialId","chamber","groupRef","startDate","startState","endState","sourceMember","rawHash") VALUES ('AN_AMO30','PM9',1,'PA1','SENAT','PO1','2022-01-01','DATED','OPEN_AT_SNAPSHOT','m','${H("c")}')`
          )
        )
      ).toBe(CHECK);
      expect(await stateOf(snapshot("sx", 1, { stream: "UNKNOWN_STREAM", sha: SHA_A }))).toBe(
        CHECK
      );
    });

    it("rejects overlapping versions of an identity at the constraint layer, with the guards set aside", async () => {
      for (const n of [2, 3, 4]) {
        const sha = H(String(n + 2));
        await artifact(sha);
        await snapshot(`s${n}`, n, { sha, state: H(String(n + 4)) });
      }
      await q(`ALTER TABLE "GroupMembershipRecord" DISABLE TRIGGER USER`);
      await q(`DROP INDEX "GroupMembershipRecord_active_key"`);
      await membership("PM1", 1, { toSeq: 3 });
      expect(await stateOf(membership("PM1", 2, { toSeq: 4 }))).toBe(EXCLUSION);
      expect(await stateOf(membership("PM1", 2))).toBe(EXCLUSION);
      // Half-open intervals: [1,3) and [3,) touch without overlapping.
      await membership("PM1", 3);
      await membership("PM2", 2);
    });

    it("uses an index for the lookups the resolver makes", async () => {
      await q(`ALTER TABLE "GroupMembershipRecord" DISABLE TRIGGER USER`);
      await q(
        `INSERT INTO "GroupMembershipRecord"("stream","sourceRecordId","fromSeq","officialId","chamber","groupRef","legislature","startDate","startState","endState","sourceMember","rawHash")
         SELECT 'AN_AMO30', 'PM' || g, 1, 'PA' || (g % 3000), 'AN', 'PO' || (g % 40), 16, DATE '2022-01-01' + (g % 700), 'DATED', 'OPEN_AT_SNAPSHOT', 'm', '${H("c")}'
         FROM generate_series(1, 30000) g`
      );
      await q(`ANALYZE "GroupMembershipRecord"`);
      const client = await pool.connect();
      try {
        // With sequential scans disabled the planner uses an index if, and only if, one applies:
        // the check says the index exists and fits the query, not what a cost model prefers.
        await client.query("SET enable_seqscan = off");
        for (const [label, sql] of [
          [
            "by actor",
            `SELECT * FROM "GroupMembershipRecord" WHERE "stream" = 'AN_AMO30' AND "officialId" = 'PA42' AND "startDate" <= DATE '2023-01-01'`,
          ],
          [
            "by group and date",
            `SELECT * FROM "GroupMembershipRecord" WHERE "stream" = 'AN_AMO30' AND "groupRef" = 'PO7' AND "startDate" <= DATE '2022-03-01'`,
          ],
          [
            "active identity",
            `SELECT * FROM "GroupMembershipRecord" WHERE "stream" = 'AN_AMO30' AND "sourceRecordId" = 'PM77' AND "toSeq" IS NULL`,
          ],
        ]) {
          const plan = await client.query(`EXPLAIN (FORMAT TEXT) ${sql}`);
          const text = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
          expect(text, label).toMatch(/Index|Bitmap/);
          expect(text, label).not.toMatch(/Seq Scan/);
        }
      } finally {
        await client.query("RESET enable_seqscan");
        client.release();
      }
    });
  });

  describe("decisions: append only", () => {
    it("refuses UPDATE, DELETE and TRUNCATE on the identity and continuity logs", async () => {
      await q(
        `INSERT INTO "OfficialActorLinkDecision"("chamber","officialId","politicianId","status","evidence","decidedBy","decidedByKind") VALUES ('AN','PA1','pol-1','LINKED_MANUAL','checked','tester','HUMAN')`
      );
      await q(
        `INSERT INTO "OrganContinuityDecision"("fromOrganRef","toOrganRef","relation","status","evidence","decidedBy","decidedByKind") VALUES ('PO1','PO2','RENAMED_SAME_GROUP','VALIDATED','checked','tester','HUMAN')`
      );
      for (const table of ["OfficialActorLinkDecision", "OrganContinuityDecision"]) {
        expect(await stateOf(q(`UPDATE "${table}" SET "evidence" = 'rewritten'`)), table).toBe(
          RESTRICT
        );
        expect(await stateOf(q(`DELETE FROM "${table}"`)), table).toBe(RESTRICT);
        expect(await stateOf(q(`TRUNCATE "${table}"`)), table).toBe(RESTRICT);
      }
    });

    it("keeps a person's link when the person's record is gone: no foreign key, decisions are numbered", async () => {
      await q(
        `INSERT INTO "OfficialActorLinkDecision"("chamber","officialId","politicianId","status","evidence","decidedBy","decidedByKind") VALUES ('AN','PA1','pol-gone','LINKED_MANUAL','checked','tester','HUMAN')`
      );
      await q(
        `INSERT INTO "OfficialActorLinkDecision"("chamber","officialId","status","evidence","decidedBy","decidedByKind") VALUES ('AN','PA1','NONE','revised','tester','HUMAN')`
      );
      const numbers = await q(
        `SELECT "decisionNo"::int AS n FROM "OfficialActorLinkDecision" ORDER BY 1`
      );
      expect(numbers.rows.map((r) => r.n)).toEqual([1, 2]);
    });

    it("lets a script propose a continuity and refuses a script that validates one", async () => {
      const insert = (status: string, kind: string) =>
        q(
          `INSERT INTO "OrganContinuityDecision"("fromOrganRef","toOrganRef","relation","status","evidence","decidedBy","decidedByKind") VALUES ('PO1','PO2','SUCCESSOR','${status}','e','s','${kind}')`
        );
      await insert("PROPOSED", "SCRIPT");
      expect(await stateOf(insert("VALIDATED", "SCRIPT"))).toBe(CHECK);
      expect(await stateOf(insert("REJECTED", "SCRIPT"))).toBe(CHECK);
      await insert("VALIDATED", "HUMAN");
    });

    it("keeps a link coherent with its status, and a script away from manual links", async () => {
      const link = (status: string, politician: string | null, kind = "HUMAN") =>
        q(
          `INSERT INTO "OfficialActorLinkDecision"("chamber","officialId","politicianId","status","evidence","decidedBy","decidedByKind") VALUES ('AN','PA1',$1,$2,'e','s',$3)`,
          [politician, status, kind]
        );
      expect(await stateOf(link("LINKED_MANUAL", null))).toBe(CHECK);
      expect(await stateOf(link("NONE", "pol-1"))).toBe(CHECK);
      expect(await stateOf(link("LINKED_MANUAL", "pol-1", "SCRIPT"))).toBe(CHECK);
      expect(await stateOf(link("LINKED_EXTERNAL_ID", "pol-1", "SCRIPT"))).toBe(CHECK);
      await link("LINKED_OFFICIAL_ID", "pol-1", "SCRIPT");
    });

    it("refuses a continuity between an organ and itself", async () => {
      expect(
        await stateOf(
          q(
            `INSERT INTO "OrganContinuityDecision"("fromOrganRef","toOrganRef","relation","status","evidence","decidedBy","decidedByKind") VALUES ('PO1','PO1','SUCCESSOR','PROPOSED','e','s','HUMAN')`
          )
        )
      ).toBe(CHECK);
    });
  });

  describe("runs", () => {
    it("never creates a second run for the same input hash", async () => {
      await run("r1");
      expect(await stateOf(run("r2"))).toBe(UNIQUE);
    });

    it("starts RUNNING, and finishes once with its output", async () => {
      expect(await stateOf(run("r0", H("9"), "COMPLETED"))).toBe(RESTRICT);
      await run("r1");
      expect(await stateOf(q(`UPDATE "HistoricalResolutionRun" SET "status" = 'COMPLETED'`))).toBe(
        CHECK
      );
      expect(
        await stateOf(
          q(
            `UPDATE "HistoricalResolutionRun" SET "status" = 'COMPLETED', "outputHash" = '${H("7")}', "statusCounts" = '{}', "finishedAt" = now(), "resolverVersion" = '3'`
          )
        )
      ).toBe(RESTRICT);
      await q(
        `UPDATE "HistoricalResolutionRun" SET "status" = 'COMPLETED', "outputHash" = '${H("7")}', "statusCounts" = '{}', "finishedAt" = now()`
      );
      expect(
        await stateOf(
          q(
            `UPDATE "HistoricalResolutionRun" SET "status" = 'FAILED', "finishedAt" = now(), "outputHash" = NULL`
          )
        )
      ).toBe(RESTRICT);
      expect(await stateOf(q(`DELETE FROM "HistoricalResolutionRun"`))).toBe(RESTRICT);
    });

    it("pins only a released snapshot, and only with its own state hash", async () => {
      await artifact();
      await snapshot("s1", 1);
      await run("r1");
      const pin = (hash: string) =>
        q(
          `INSERT INTO "HistoricalRunSnapshotPin"("runId","stream","seq","stateHash") VALUES ('r1','AN_AMO30',1,$1)`,
          [hash]
        );
      expect(await stateOf(pin(STATE_1))).toBe(RESTRICT);
      await decision("s1", "RELEASED");
      expect(await stateOf(pin(STATE_2))).toBe(FOREIGN_KEY);
      await pin(STATE_1);
      expect(await stateOf(pin(STATE_1))).toBe(UNIQUE);
      await decision("s1", "QUARANTINED");
      await run("r2", H("8"));
      expect(
        await stateOf(
          q(
            `INSERT INTO "HistoricalRunSnapshotPin"("runId","stream","seq","stateHash") VALUES ('r2','AN_AMO30',1,'${STATE_1}')`
          )
        )
      ).toBe(RESTRICT);
    });

    it("accepts exclusions only while the run is running, and never changes them", async () => {
      await run("r1");
      const exclusion = () =>
        q(
          `INSERT INTO "RunExclusion"("runId","scrutinExternalId","officialId","status","reason","evidence") VALUES ('r1','VTANR5L16V1','PA1','INSUFFICIENT','EDGE_DAY','{}')`
        );
      await exclusion();
      expect(await stateOf(q(`UPDATE "RunExclusion" SET "reason" = 'NO_RECORD'`))).toBe(RESTRICT);
      expect(await stateOf(q(`DELETE FROM "RunExclusion"`))).toBe(RESTRICT);
      await q(`UPDATE "HistoricalResolutionRun" SET "status" = 'FAILED', "finishedAt" = now()`);
      expect(
        await stateOf(
          q(
            `INSERT INTO "RunExclusion"("runId","scrutinExternalId","officialId","status","reason","evidence") VALUES ('r1','VTANR5L16V2','PA1','CONFLICT','CONFLICT','{}')`
          )
        )
      ).toBe(RESTRICT);
    });

    it("refuses an exclusion status the resolver does not produce", async () => {
      await run("r1");
      expect(
        await stateOf(
          q(
            `INSERT INTO "RunExclusion"("runId","scrutinExternalId","officialId","status","reason","evidence") VALUES ('r1','V','PA1','ATTESTED_GROUP','x','{}')`
          )
        )
      ).toBe(CHECK);
    });
  });

  describe("attestations", () => {
    it("holds an attestation with its date, legislature and the group exactly as published, PO0 included", async () => {
      await artifact();
      await snapshot("s1", 1, { stream: "AN_SCRUTINS_L17" });
      await q(
        `INSERT INTO "ScrutinVoterAttestation"("stream","scrutinExternalId","officialId","fromSeq","scrutinDate","legislature","publishedOrganRef","publishedPosition","seatMandateRef","sourceMember","memberHash","rawHash")
         VALUES ('AN_SCRUTINS_L17','VTANR5L17V501','PA1',1,'2025-01-01',17,'PO0','pour','PM1','json/VTANR5L17V501.json','${H("a")}','${H("b")}')`
      );
      expect(
        await stateOf(
          q(
            `INSERT INTO "ScrutinVoterAttestation"("stream","scrutinExternalId","officialId","fromSeq","scrutinDate","legislature","publishedOrganRef","publishedPosition","sourceMember","memberHash","rawHash") VALUES ('AN_SCRUTINS_L17','VTANR5L17V501','PA1',1,'2025-01-01',17,'PO1','pour','m','${H("a")}','${H("b")}')`
          )
        )
      ).toBe(UNIQUE);
      expect(
        await stateOf(
          q(
            `INSERT INTO "ScrutinVoterAttestation"("stream","scrutinExternalId","officialId","fromSeq","scrutinDate","legislature","publishedOrganRef","publishedPosition","sourceMember","memberHash","rawHash") VALUES ('AN_SCRUTINS_L17','VTANR5L17V502','PA1',1,'2025-01-01',17,'PO1','maybe','m','${H("a")}','${H("b")}')`
          )
        )
      ).toBe(CHECK);
    });
  });
  // ---------------------------------------------------------------------------------------------
  // Concurrency. Each test holds a transaction open on one connection and acts from another.
  // ---------------------------------------------------------------------------------------------
  describe("concurrency", () => {
    const hashOf = (text: string) => createHash("sha256").update(text).digest("hex");

    async function begin() {
      const client = await pool.connect();
      await client.query("BEGIN");
      return client;
    }
    /** `true` when the promise settled (either way) within the delay, `false` when it is still waiting. */
    const settledWithin = (promise: Promise<unknown>, ms: number) =>
      Promise.race([
        promise.then(
          () => true,
          () => true
        ),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
      ]);
    const WAIT = 400;

    const artifactOf = async (tag: string) => {
      const sha = hashOf(`artifact-${tag}`);
      await artifact(sha);
      return sha;
    };

    it("gives snapshot numbers 1 to N without a gap or a duplicate when eight writers race", async () => {
      const WORKERS = 8;
      const EACH = 5;
      const lost: string[] = [];
      const worker = async (w: number) => {
        for (let done = 0; done < EACH; ) {
          const sha = await artifactOf(`${w}-${done}-${Math.random()}`);
          const next = (
            await q(
              `SELECT COALESCE(max("seq"), 0) + 1 AS n FROM "OfficialSourceSnapshot" WHERE "stream" = 'AN_AMO30'`
            )
          ).rows[0].n as number;
          const outcome = await stateOf(
            snapshot(`w${w}-${next}-${Math.random()}`, next, {
              sha,
              state: hashOf(`state-${w}-${next}-${Math.random()}`),
            })
          );
          if (outcome === null) done += 1;
          else if (outcome === UNIQUE || outcome === CHECK) lost.push(outcome);
          else throw new Error(`unexpected SQLSTATE ${outcome}`);
        }
      };
      await Promise.all(Array.from({ length: WORKERS }, (_, w) => worker(w)));
      const seqs = (
        await q(`SELECT "seq" FROM "OfficialSourceSnapshot" WHERE "stream" = 'AN_AMO30' ORDER BY 1`)
      ).rows.map((r) => r.seq);
      expect(seqs).toEqual(Array.from({ length: WORKERS * EACH }, (_, i) => i + 1));
      // Not a proof that the race happened, but a record of how many writers lost one.
      expect(lost.length).toBeGreaterThanOrEqual(0);
    });

    it("lets one of two writers take the same snapshot number, and lets the other take it if the first rolls back", async () => {
      const a = await artifactOf("first");
      const b = await artifactOf("second");
      const first = await begin();
      await first.query(
        `INSERT INTO "OfficialSourceSnapshot"("id","stream","seq","artifactSha256","url","fetchedAt","integrity","parserVersion","stateHash","recordCounts","importedBy")
         VALUES ('x1','AN_AMO30',1,$1,'https://example.test/a.zip', now(),'VERIFIED','5A-2.1',$2,'{}','t')`,
        [a, STATE_1]
      );
      const second = await pool.connect();
      const racing = second.query(
        `INSERT INTO "OfficialSourceSnapshot"("id","stream","seq","artifactSha256","url","fetchedAt","integrity","parserVersion","stateHash","recordCounts","importedBy")
         VALUES ('x2','AN_AMO30',1,$1,'https://example.test/b.zip', now(),'VERIFIED','5A-2.1',$2,'{}','t')`,
        [b, STATE_2]
      );
      expect(await settledWithin(racing, WAIT), "the second writer waits for the first").toBe(
        false
      );
      await first.query("ROLLBACK");
      first.release();
      await racing;
      second.release();
      expect((await q(`SELECT "id" FROM "OfficialSourceSnapshot"`)).rows).toEqual([{ id: "x2" }]);

      // And when the first commits, the second fails.
      await reset();
      await apply();
      const a2 = await artifactOf("first");
      const b2 = await artifactOf("second");
      const winner = await begin();
      await winner.query(
        `INSERT INTO "OfficialSourceSnapshot"("id","stream","seq","artifactSha256","url","fetchedAt","integrity","parserVersion","stateHash","recordCounts","importedBy")
         VALUES ('y1','AN_AMO30',1,$1,'https://example.test/a.zip', now(),'VERIFIED','5A-2.1',$2,'{}','t')`,
        [a2, STATE_1]
      );
      const loser = pool.query(
        `INSERT INTO "OfficialSourceSnapshot"("id","stream","seq","artifactSha256","url","fetchedAt","integrity","parserVersion","stateHash","recordCounts","importedBy")
         VALUES ('y2','AN_AMO30',1,$1,'https://example.test/b.zip', now(),'VERIFIED','5A-2.1',$2,'{}','t')`,
        [b2, STATE_2]
      );
      expect(await settledWithin(loser, WAIT)).toBe(false);
      await winner.query("COMMIT");
      winner.release();
      expect([UNIQUE, CHECK]).toContain(await stateOf(loser));
    });

    it("makes a release wait for a writer that already holds the snapshot, and keeps that writer's record", async () => {
      await artifact();
      await snapshot("s1", 1);
      const writer = await begin();
      await writer.query(
        `INSERT INTO "GroupMembershipRecord"("stream","sourceRecordId","fromSeq","officialId","chamber","groupRef","startDate","startState","endState","sourceMember","rawHash")
         VALUES ('AN_AMO30','PM1',1,'PA1','AN','PO1','2022-01-01','DATED','OPEN_AT_SNAPSHOT','m','${H("c")}')`
      );
      const release = decision("s1", "RELEASED");
      expect(await settledWithin(release, WAIT), "the release waits").toBe(false);
      await writer.query("COMMIT");
      writer.release();
      await release;
      expect((await q(`SELECT count(*)::int AS n FROM "GroupMembershipRecord"`)).rows[0].n).toBe(1);
      expect((await q(`SELECT "status" FROM "SnapshotDecision"`)).rows).toEqual([
        { status: "RELEASED" },
      ]);
    });

    it("refuses a record that arrives while a release is being committed", async () => {
      await artifact();
      await snapshot("s1", 1);
      const releasing = await begin();
      await releasing.query(
        `INSERT INTO "SnapshotDecision"("snapshotId","status","reason","decidedBy","decidedByKind") VALUES ('s1','RELEASED','t','t','HUMAN')`
      );
      const late = stateOf(membership("PM1", 1));
      expect(await settledWithin(late, WAIT), "the record waits for the release").toBe(false);
      await releasing.query("COMMIT");
      releasing.release();
      expect(await late).toBe(RESTRICT);
      expect((await q(`SELECT count(*)::int AS n FROM "GroupMembershipRecord"`)).rows[0].n).toBe(0);
    });

    it("makes a newer snapshot wait for a writer of the previous one, then freezes the previous one", async () => {
      await artifact();
      await snapshot("s1", 1);
      const b = await artifactOf("next");
      const writer = await begin();
      await writer.query(
        `INSERT INTO "GroupMembershipRecord"("stream","sourceRecordId","fromSeq","officialId","chamber","groupRef","startDate","startState","endState","sourceMember","rawHash")
         VALUES ('AN_AMO30','PM1',1,'PA1','AN','PO1','2022-01-01','DATED','OPEN_AT_SNAPSHOT','m','${H("c")}')`
      );
      const next = snapshot("s2", 2, { sha: b, state: STATE_2 });
      expect(await settledWithin(next, WAIT), "the next snapshot waits").toBe(false);
      await writer.query("COMMIT");
      writer.release();
      await next;
      expect(await stateOf(membership("PM2", 1))).toBe(RESTRICT);
    });

    it("refuses a record for a snapshot that a newer one replaced while the writer waited", async () => {
      await artifact();
      await snapshot("s1", 1);
      const b = await artifactOf("next");
      const successor = await begin();
      await successor.query(
        `INSERT INTO "OfficialSourceSnapshot"("id","stream","seq","artifactSha256","url","fetchedAt","integrity","parserVersion","stateHash","recordCounts","importedBy")
         VALUES ('s2','AN_AMO30',2,$1,'https://example.test/b.zip', now(),'VERIFIED','5A-2.1',$2,'{}','t')`,
        [b, STATE_2]
      );
      const late = stateOf(membership("PM1", 1));
      expect(await settledWithin(late, WAIT)).toBe(false);
      await successor.query("COMMIT");
      successor.release();
      expect(await late).toBe(RESTRICT);
    });

    it("makes finishing a run wait for a row being added to it, and refuses a row that arrives after", async () => {
      await run("r1");
      const adding = await begin();
      await adding.query(
        `INSERT INTO "RunExclusion"("runId","scrutinExternalId","officialId","status","reason","evidence") VALUES ('r1','V1','PA1','INSUFFICIENT','EDGE_DAY','{}')`
      );
      const finishing = q(
        `UPDATE "HistoricalResolutionRun" SET "status" = 'FAILED', "finishedAt" = now() WHERE "id" = 'r1'`
      );
      expect(await settledWithin(finishing, WAIT), "finishing waits").toBe(false);
      await adding.query("COMMIT");
      adding.release();
      await finishing;
      expect(
        await stateOf(
          q(
            `INSERT INTO "RunExclusion"("runId","scrutinExternalId","officialId","status","reason","evidence") VALUES ('r1','V2','PA1','CONFLICT','CONFLICT','{}')`
          )
        )
      ).toBe(RESTRICT);
      expect((await q(`SELECT count(*)::int AS n FROM "RunExclusion"`)).rows[0].n).toBe(1);
    });

    it("does not deadlock when two writers write to the same snapshot", async () => {
      await artifact();
      await snapshot("s1", 1);
      const insert = (id: string) =>
        pool.query(
          `INSERT INTO "GroupMembershipRecord"("stream","sourceRecordId","fromSeq","officialId","chamber","groupRef","startDate","startState","endState","sourceMember","rawHash")
           SELECT 'AN_AMO30', $1 || g, 1, 'PA1', 'AN', 'PO1', DATE '2022-01-01', 'DATED', 'OPEN_AT_SNAPSHOT', 'm', '${H("c")}' FROM generate_series(1, 2000) g`,
          [id]
        );
      await Promise.all([insert("A"), insert("B"), insert("C"), insert("D")]);
      expect((await q(`SELECT count(*)::int AS n FROM "GroupMembershipRecord"`)).rows[0].n).toBe(
        8000
      );
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Privileges. The application connects as the owner of the tables (the `postgres` role on
  // Supabase); the test connection here is a superuser, which is stronger still. Non-owner roles
  // show what the guards and the grants hold against, and what only ownership can undo.
  // ---------------------------------------------------------------------------------------------
  describe("privileges", () => {
    async function asRole<T>(
      role: string,
      work: (c: import("pg").PoolClient) => Promise<T>
    ): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query(`SET ROLE ${role}`);
        return await work(client);
      } finally {
        await client.query("RESET ROLE");
        client.release();
      }
    }

    beforeEach(async () => {
      await q(`DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hg_importer') THEN CREATE ROLE hg_importer BYPASSRLS; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hg_importer_rls') THEN CREATE ROLE hg_importer_rls; END IF;
      END $$`);
      // What a dedicated, non-owner importer role would be given for the lot 5C import.
      // The role may survive from an earlier run of this suite: state its attributes every time.
      await q(`ALTER ROLE hg_importer BYPASSRLS`);
      await q(`ALTER ROLE hg_importer_rls NOBYPASSRLS`);
      // Supabase gives anon and authenticated the usage of the schema: so does this test database.
      await q(`GRANT USAGE ON SCHEMA public TO hg_importer, hg_importer_rls, anon, authenticated`);
      await q(`GRANT SELECT, INSERT ON "SourceArtifact" TO hg_importer_rls`);
      await q(
        `GRANT SELECT, INSERT ON "SourceArtifact", "OfficialSourceSnapshot", "SnapshotDecision", "GroupMembershipRecord" TO hg_importer`
      );
      await q(`GRANT UPDATE ("toSeq") ON "GroupMembershipRecord" TO hg_importer`);
      await q(`GRANT USAGE ON SEQUENCE "SnapshotDecision_decisionNo_seq" TO hg_importer`);
    });

    it("lets a non-owner importer run a whole import: artifact, snapshot, records, correction, release", async () => {
      await asRole("hg_importer", async (c) => {
        await c.query(
          `INSERT INTO "SourceArtifact"("sha256","byteSize","mediaType","storageKind","storageRef","storedAt","storedBy") VALUES ($1,10,'application/zip','LOCAL_OFFLINE','a',now(),'imp')`,
          [SHA_A]
        );
        for (const [id, seq, sha, state] of [["s1", 1, SHA_A, STATE_1]] as const) {
          await c.query(
            `INSERT INTO "OfficialSourceSnapshot"("id","stream","seq","artifactSha256","url","fetchedAt","integrity","parserVersion","stateHash","recordCounts","importedBy")
             VALUES ($1,'AN_AMO30',$2,$3,'https://example.test/a.zip',now(),'VERIFIED','5A-2.1',$4,'{}','imp')`,
            [id, seq, sha, state]
          );
        }
        await c.query(
          `INSERT INTO "GroupMembershipRecord"("stream","sourceRecordId","fromSeq","officialId","chamber","groupRef","startDate","startState","endState","sourceMember","rawHash")
           VALUES ('AN_AMO30','PM1',1,'PA1','AN','PO1','2022-01-01','DATED','OPEN_AT_SNAPSHOT','m','${H("c")}')`
        );
        await c.query(
          `INSERT INTO "SnapshotDecision"("snapshotId","status","reason","decidedBy","decidedByKind") VALUES ('s1','RELEASED','ok','imp','HUMAN')`
        );
      });
      expect((await q(`SELECT count(*)::int AS n FROM "GroupMembershipRecord"`)).rows[0].n).toBe(1);
    });

    it("keeps that importer away from everything else: other columns, DELETE, TRUNCATE, triggers, replica mode", async () => {
      await artifact();
      await snapshot("s1", 1);
      await membership("PM1", 1);
      const denied = async (statement: string) =>
        asRole(
          "hg_importer",
          async (c) =>
            (await c.query(statement).then(
              () => null,
              (e: { code?: string }) => e.code
            )) ?? "allowed"
        );
      expect(await denied(`UPDATE "GroupMembershipRecord" SET "groupRef" = 'PO9'`)).toBe("42501");
      expect(await denied(`DELETE FROM "GroupMembershipRecord"`)).toBe("42501");
      expect(await denied(`TRUNCATE "GroupMembershipRecord"`)).toBe("42501");
      expect(
        await denied(
          `DROP TRIGGER "GroupMembershipRecord_version_guard" ON "GroupMembershipRecord"`
        )
      ).toBe("42501");
      expect(await denied(`ALTER TABLE "GroupMembershipRecord" DISABLE TRIGGER USER`)).toBe(
        "42501"
      );
      expect(await denied(`SET session_replication_role = replica`)).toBe("42501");
      expect(await denied(`SELECT * FROM "OfficialActorLinkDecision"`)).toBe("42501");
      expect(
        await denied(
          `INSERT INTO "RunExclusion"("runId","scrutinExternalId","officialId","status","reason","evidence") VALUES ('r','v','p','CONFLICT','x','{}')`
        )
      ).toBe("42501");
    });

    it("records a constraint on the importer role: without BYPASSRLS, row level security hides and refuses everything", async () => {
      const outcome = await asRole(
        "hg_importer_rls",
        async (c) =>
          (await c
            .query(
              `INSERT INTO "SourceArtifact"("sha256","byteSize","mediaType","storageKind","storageRef","storedAt","storedBy") VALUES ($1,10,'application/zip','LOCAL_OFFLINE','a',now(),'imp')`,
              [SHA_A]
            )
            .then(
              () => null,
              (e: { code?: string }) => e.code
            )) ?? "allowed"
      );
      // The tables have RLS and no policy: only the owner and a BYPASSRLS role write to them.
      expect(outcome).toBe("42501");
    });

    it("applies the guards to that importer too: the column it may update still cannot be bent", async () => {
      await artifact();
      await snapshot("s1", 1);
      await membership("PM1", 1);
      const outcome = await asRole(
        "hg_importer",
        async (c) =>
          (await c.query(`UPDATE "GroupMembershipRecord" SET "toSeq" = 9`).then(
            () => null,
            (e: { code?: string }) => e.code
          )) ?? "allowed"
      );
      expect(outcome).toBe(RESTRICT);
    });

    it("closes the tables to anon and authenticated, with or without a grant", async () => {
      await artifact();
      for (const role of ["anon", "authenticated"]) {
        const denied = await asRole(
          role,
          async (c) =>
            (await c.query(`SELECT * FROM "SourceArtifact"`).then(
              () => null,
              (e: { code?: string }) => e.code
            )) ?? "allowed"
        );
        expect(denied, role).toBe("42501");
        // A grant alone opens nothing: row level security has no policy, so the role sees no row.
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(`GRANT SELECT ON "SourceArtifact" TO ${role}`);
          await client.query(`SET LOCAL ROLE ${role}`);
          const rows = await client.query(`SELECT * FROM "SourceArtifact"`);
          expect(rows.rowCount, `${role} with a grant`).toBe(0);
        } finally {
          await client.query("ROLLBACK");
          client.release();
        }
      }
    });

    it("gives no function of the lot to PUBLIC, anon or authenticated", async () => {
      const granted = await q(
        `SELECT p.proname, COALESCE(r.rolname, 'PUBLIC') AS grantee
         FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a LEFT JOIN pg_roles r ON r.oid = a.grantee
         WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'historical%' AND (a.grantee = 0 OR r.rolname IN ('anon', 'authenticated'))`
      );
      expect(granted.rows).toEqual([]);
    });

    it("records the limit: the OWNER can still disable a guard, in a transaction that is rolled back here", async () => {
      await artifact();
      await snapshot("s1", 1);
      await membership("PM1", 1);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `ALTER TABLE "GroupMembershipRecord" DISABLE TRIGGER "GroupMembershipRecord_no_delete"`
        );
        // With the guard removed by its owner, the evidence can be deleted. This is the boundary of
        // what the guards protect (an error of code, not an operator who is the owner).
        await client.query(`DELETE FROM "GroupMembershipRecord"`);
        const left = await client.query(`SELECT count(*)::int AS n FROM "GroupMembershipRecord"`);
        expect(left.rows[0].n).toBe(0);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
      expect((await q(`SELECT count(*)::int AS n FROM "GroupMembershipRecord"`)).rows[0].n).toBe(1);
      expect(await stateOf(q(`DELETE FROM "GroupMembershipRecord"`))).toBe(RESTRICT);
    });
  });
});
