// @vitest-environment node
/**
 * What PostgreSQL really enforces for the lot 5D (PR A): the three dedicated roles and their row
 * level security policies, the `memberHash` columns, and the internal positions table with its
 * publication guard. Same container and same setup as `schema.integration.test.ts`: read its header.
 *
 * Nothing official is loaded: every row is invented. Roles are exercised with SET ROLE from the
 * owner connection: a non-owner role without BYPASSRLS goes through the same privilege and policy
 * checks as a connection opened with its own login. Not run by default, not wired into CI.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EXPECTED, ROLES, type Role } from "../__fixtures__/role-matrix";

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
// Only this variable is read: never DATABASE_URL or DIRECT_URL, which point at production.
if (url && (url === process.env.DATABASE_URL || url === process.env.DIRECT_URL)) {
  throw new Error("The test URL must not be a connection string of the application");
}
const describeDb = url ? describe : describe.skip;

const MANUAL = "prisma/migrations/manual/";
const SQL_5B = readFileSync(`${MANUAL}2026-10-18-historical-groups-schema.sql`, "utf8");
const SQL_5C0 = readFileSync(`${MANUAL}2026-10-19-historical-groups-count-check.sql`, "utf8");
const SQL_5D = readFileSync(`${MANUAL}2026-10-20-historical-groups-roles-positions.sql`, "utf8");
const SQL_5D_ROLLBACK = readFileSync(
  `${MANUAL}2026-10-20-historical-groups-roles-positions-rollback.sql`,
  "utf8"
);

const H = (c: string) => c.repeat(64);
const SCRUTINS = "AN_SCRUTINS_L16";
const AMO30 = "AN_AMO30";

const RESTRICT = "23001";
const CHECK = "23514";
const DENIED = "42501";

type Cols = Record<string, unknown>;

describeDb("lot 5D roles, policies and positions on a disposable PostgreSQL", () => {
  let pool: Pool;
  const q = (text: string, values?: unknown[]) => pool.query(text, values);

  async function stateOf(run: Promise<unknown>): Promise<{ code: string; message: string } | null> {
    try {
      await run;
      return null;
    } catch (error) {
      const e = error as { code?: string; message: string };
      return { code: e.code ?? "no-code", message: e.message };
    }
  }

  /** Runs `fn` on a client switched to `role`, then switches back. */
  async function as<T>(role: Role, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query(`SET ROLE ${role}`);
      return await fn(client);
    } finally {
      await client.query("RESET ROLE");
      client.release();
    }
  }
  const denied = (client: PoolClient, text: string, values?: unknown[]) =>
    stateOf(client.query(text, values));

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
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hg_importer') THEN CREATE ROLE hg_importer LOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hg_runner') THEN CREATE ROLE hg_runner LOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hg_reader') THEN CREATE ROLE hg_reader LOGIN; END IF;
    END $$`);
    await q("ALTER ROLE hg_importer NOBYPASSRLS");
    await q("CREATE EXTENSION IF NOT EXISTS btree_gist");
  }
  const apply5d = () => q(SQL_5D);

  async function insert(table: string, cols: Cols) {
    const names = Object.keys(cols);
    return q(
      `INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})`,
      names.map((n) => cols[n])
    );
  }
  const artifact = (sha: string) =>
    q(
      `INSERT INTO "SourceArtifact"("sha256","byteSize","mediaType","storageKind","storageRef","storedAt","storedBy")
       VALUES ($1, 100, 'application/zip', 'LOCAL_OFFLINE', 'artifacts/x', now(), 'test')`,
      [sha]
    );
  const snapshot = (id: string, stream: string, seq: number, sha: string, state: string) =>
    q(
      `INSERT INTO "OfficialSourceSnapshot"("id","stream","seq","artifactSha256","url","fetchedAt","integrity","parserVersion","stateHash","recordCounts","importedBy")
       VALUES ($1, $2, $3, $4, 'https://example.test/a.zip', now(), 'VERIFIED', '5C-0.1', $5, '{}', 'test')`,
      [id, stream, seq, sha, state]
    );
  const decide = (snapshotId: string, status: string, kind = "HUMAN") =>
    q(
      `INSERT INTO "SnapshotDecision"("snapshotId","status","reason","decidedBy","decidedByKind") VALUES ($1, $2, 't', 't', $3)`,
      [snapshotId, status, kind]
    );

  const checkRow = (id: string, over: Cols = {}, fromSeq = 1): Cols => ({
    stream: SCRUTINS,
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
  const MISMATCH: Cols = {
    countCoherence: "COUNT_MISMATCH",
    mismatchedGroups: 1,
    nominalPour: 11,
    diffPour: 1,
  };
  const UNVERIFIABLE: Cols = {
    countCoherence: "UNVERIFIABLE",
    officialPour: null,
    officialContre: null,
    officialAbstention: null,
    officialNonVotant: null,
    diffPour: null,
    diffContre: null,
    diffAbstention: null,
    diffNonVotant: null,
  };
  const groupRow = (id: string, organRef: string): Cols => ({
    stream: SCRUTINS,
    scrutinExternalId: id,
    organRef,
    organOrdinal: 0,
    fromSeq: 1,
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
  });
  const base = { sourceMember: "x.json", memberHash: H("a"), rawHash: H("b"), fromSeq: 1 };
  /** One minimal valid row for each of the seven record tables, with its stream. */
  const recordRows: Record<string, Cols> = {
    OfficialActor: { stream: AMO30, officialId: "PA1", ...base },
    OfficialOrganRecord: {
      stream: AMO30,
      organeRef: "PO1",
      codeType: "GP",
      label: "Groupe",
      ...base,
    },
    GroupMembershipRecord: {
      stream: AMO30,
      sourceRecordId: "M1",
      officialId: "PA1",
      chamber: "AN",
      groupRef: "PO1",
      startState: "UNKNOWN",
      endState: "UNKNOWN",
      ...base,
    },
    SeatMandateRecord: {
      stream: AMO30,
      sourceRecordId: "S1",
      officialId: "PA1",
      startState: "UNKNOWN",
      endState: "UNKNOWN",
      ...base,
    },
    ScrutinVoterAttestation: {
      stream: SCRUTINS,
      scrutinExternalId: "VT1",
      officialId: "PA1",
      scrutinDate: "2023-03-14",
      legislature: 16,
      publishedOrganRef: "PO1",
      publishedPosition: "pour",
      ...base,
    },
    ScrutinCountCheck: checkRow("VT1"),
    ScrutinGroupCountCheck: groupRow("VT1", "PO1"),
  };

  /** Snapshots on both streams, the AMO30 one released, nothing else. */
  async function streams() {
    await artifact(H("1"));
    await artifact(H("2"));
    await snapshot("amo1", AMO30, 1, H("1"), H("3"));
    await snapshot("sc1", SCRUTINS, 1, H("2"), H("4"));
  }

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
    await q(SQL_5B);
    await q(SQL_5C0);
  });

  // ------------------------------------------------------------------------------------------
  describe("the script", () => {
    it("refuses, naming what is missing, when a role does not exist", async () => {
      await q("DROP ROLE hg_runner");
      const e = await stateOf(apply5d());
      expect(e?.message).toContain(
        "The prerequisites of the roles and positions schema are missing"
      );
      expect(e?.message).toContain("the role hg_runner does not exist");
      expect((await q(`SELECT 1 FROM pg_namespace WHERE nspname = 'hg_reference'`)).rowCount).toBe(
        0
      );
      await q("CREATE ROLE hg_runner LOGIN");
    });

    it.each(["BYPASSRLS", "SUPERUSER", "CREATEROLE", "CREATEDB"])(
      "refuses a role with %s",
      async (attribute) => {
        await q(`ALTER ROLE hg_importer ${attribute}`);
        const e = await stateOf(apply5d());
        expect(e?.message).toContain("the role hg_importer must not be SUPERUSER, BYPASSRLS");
        await q("ALTER ROLE hg_importer NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB");
      }
    );

    it("refuses a role that owns a table of the lot", async () => {
      await q(`ALTER TABLE "RunExclusion" OWNER TO hg_reader`);
      const e = await stateOf(apply5d());
      expect(e?.message).toContain("the role hg_reader owns RunExclusion");
      await q(`ALTER TABLE "RunExclusion" OWNER TO hg_schema_test`);
    });

    it("refuses over a partial lot 5B, naming the count", async () => {
      await q(`DROP TABLE "ScrutinGroupCountCheck"`);
      const e = await stateOf(apply5d());
      expect(e?.message).toContain(
        "the lot 5B and 5C-0 schema is missing or partial: 14 of 15 tables"
      );
    });

    it("refuses to add memberHash to a table that holds rows, and changes nothing", async () => {
      await streams();
      await q(
        `INSERT INTO "OfficialActor"("stream","officialId","fromSeq","sourceMember","rawHash") VALUES ('${AMO30}', 'PA1', 1, 'x.json', '${H("b")}')`
      );
      const e = await stateOf(apply5d());
      expect(e?.message).toContain("memberHash cannot be added to a table that already holds rows");
      expect(e?.message).toContain("OfficialActor holds rows and has no memberHash column");
      expect((await q(`SELECT to_regclass('"ScrutinOrganPosition"') AS t`)).rows[0].t).toBeNull();
      expect(
        (
          await q(
            `SELECT 1 FROM pg_attribute WHERE attname = 'memberHash' AND attrelid = '"OfficialActor"'::regclass`
          )
        ).rowCount
      ).toBe(0);
    });

    it("applies twice with the same result", async () => {
      expect(await stateOf(apply5d())).toBeNull();
      const dump = () =>
        q(
          `SELECT count(*)::int AS policies, (SELECT count(*)::int FROM information_schema.role_table_grants WHERE grantee IN ('hg_importer', 'hg_runner', 'hg_reader')) AS grants FROM pg_policy`
        );
      const first = (await dump()).rows[0];
      expect(await stateOf(apply5d())).toBeNull();
      expect((await dump()).rows[0]).toEqual(first);
      expect((await q(`SELECT 1 FROM pg_namespace WHERE nspname = 'hg_reference'`)).rowCount).toBe(
        0
      );
    });

    it("holds the privileges of the matrix, no more and no less", async () => {
      await apply5d();
      for (const role of ROLES) {
        const wanted = EXPECTED[role];
        const tablePrivs = (
          await q(
            `SELECT table_name, privilege_type FROM information_schema.role_table_grants
             WHERE grantee = $1 AND table_schema = 'public' ORDER BY 1, 2`,
            [role]
          )
        ).rows.map((r) => `${r.table_name}:${r.privilege_type}`);
        const expected = [
          ...wanted.select.map((t) => `${t}:SELECT`),
          ...wanted.insert.map((t) => `${t}:INSERT`),
        ].sort();
        expect(tablePrivs.sort()).toEqual(expected);

        const columnPrivs = (
          await q(
            `SELECT table_name, column_name FROM information_schema.column_privileges
             WHERE grantee = $1 AND table_schema = 'public' AND privilege_type = 'UPDATE'
               AND (table_name, column_name) NOT IN (SELECT table_name, column_name FROM information_schema.role_table_grants g
                                                    JOIN information_schema.columns c USING (table_name) WHERE g.grantee = $1 AND g.privilege_type = 'UPDATE')
             ORDER BY 1, 2`,
            [role]
          )
        ).rows.map((r) => `${r.table_name}.${r.column_name}`);
        const expectedColumns = Object.entries(wanted.update)
          .flatMap(([t, cols]) => cols.map((c) => `${t}.${c}`))
          .sort();
        expect(columnPrivs.sort()).toEqual(expectedColumns);
      }
    });

    it("gives no role DELETE, TRUNCATE, REFERENCES, TRIGGER or any right to anon, authenticated or public", async () => {
      await apply5d();
      const extra = await q(
        `SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
         WHERE table_schema = 'public' AND (privilege_type IN ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
            OR grantee IN ('anon', 'authenticated', 'PUBLIC')) AND grantee <> 'hg_schema_test'`
      );
      expect(extra.rows).toEqual([]);
      const fn = await q(
        `SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x WHERE p.proname = 'historical_position_guard' AND x.grantee = 0`
      );
      expect(fn.rowCount).toBe(0);
    });

    it("keeps the three roles non-owners with no BYPASSRLS, and RLS on in every table", async () => {
      await apply5d();
      const roles = await q(
        `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('hg_importer', 'hg_runner', 'hg_reader')`
      );
      expect(roles.rows).toHaveLength(3);
      for (const r of roles.rows) {
        expect(r.rolsuper).toBe(false);
        expect(r.rolbypassrls).toBe(false);
      }
      const owned = await q(
        `SELECT c.relname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
         WHERE c.relnamespace = 'public'::regnamespace AND r.rolname IN ('hg_importer', 'hg_runner', 'hg_reader')`
      );
      expect(owned.rows).toEqual([]);
      const noRls = await q(
        `SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND NOT relrowsecurity`
      );
      expect(noRls.rows).toEqual([]);
    });

    it("detects a policy, a grant or a column privilege that drifted, and a missing memberHash constraint", async () => {
      await apply5d();
      const damages: [string, string, string][] = [
        [
          `DROP POLICY "hg_importer_select" ON "OfficialActor"`,
          `CREATE POLICY "hg_importer_select" ON "OfficialActor" FOR SELECT TO hg_importer USING (true)`,
          "policy",
        ],
        [
          `GRANT DELETE ON "OfficialActor" TO hg_importer`,
          `REVOKE DELETE ON "OfficialActor" FROM hg_importer`,
          "DELETE",
        ],
        [
          `GRANT UPDATE ("rawHash") ON "OfficialActor" TO hg_importer`,
          `REVOKE UPDATE ("rawHash") ON "OfficialActor" FROM hg_importer`,
          "rawHash",
        ],
        [
          `GRANT SELECT ON "OfficialActorLinkDecision" TO hg_reader`,
          `REVOKE SELECT ON "OfficialActorLinkDecision" FROM hg_reader`,
          "OfficialActorLinkDecision",
        ],
        [
          `ALTER TABLE "OfficialActor" DROP CONSTRAINT "OfficialActor_memberHash_format"`,
          `ALTER TABLE "OfficialActor" ADD CONSTRAINT "OfficialActor_memberHash_format" CHECK ("memberHash" ~ '^[0-9a-f]{64}$')`,
          "memberHash_format",
        ],
        [
          `ALTER TABLE "ScrutinOrganPosition" DISABLE TRIGGER "ScrutinOrganPosition_insert_guard"`,
          `ALTER TABLE "ScrutinOrganPosition" ENABLE ALWAYS TRIGGER "ScrutinOrganPosition_insert_guard"`,
          "trigger",
        ],
      ];
      for (const [damage, repair, word] of damages) {
        await q(damage);
        const e = await stateOf(apply5d());
        expect(e?.message, damage).toContain("differs from the expected definition");
        expect(e?.message, damage).toContain(word);
        await q(repair);
      }
      expect(await stateOf(apply5d())).toBeNull();
    });

    it("rolls back when the tables are empty, and refuses once a position exists", async () => {
      await apply5d();
      expect(await stateOf(q(SQL_5D_ROLLBACK))).toBeNull();
      expect((await q(`SELECT to_regclass('"ScrutinOrganPosition"') AS t`)).rows[0].t).toBeNull();
      expect(
        (
          await q(
            `SELECT 1 FROM information_schema.role_table_grants WHERE grantee IN ('hg_importer', 'hg_runner', 'hg_reader')`
          )
        ).rowCount
      ).toBe(0);
      expect(await stateOf(apply5d())).toBeNull();
    });
  });

  // ------------------------------------------------------------------------------------------
  describe("the importer role", () => {
    beforeEach(async () => {
      await apply5d();
      await streams();
    });

    it("writes artifacts, snapshots, quarantine decisions and the seven record tables", async () => {
      await as("hg_importer", async (c) => {
        await c.query(
          `INSERT INTO "SourceArtifact"("sha256","byteSize","mediaType","storageKind","storageRef","storedAt","storedBy")
           VALUES ($1, 100, 'application/zip', 'LOCAL_OFFLINE', 'artifacts/y', now(), 'import')`,
          [H("9")]
        );
        await c.query(`UPDATE "SourceArtifact" SET "lastVerifiedAt" = now() WHERE "sha256" = $1`, [
          H("9"),
        ]);
        await c.query(
          `INSERT INTO "SnapshotDecision"("snapshotId","status","reason","decidedBy","decidedByKind") VALUES ('amo1', 'QUARANTINED', 'imported', 'import', 'SCRIPT')`
        );
        for (const [table, row] of Object.entries(recordRows)) {
          const names = Object.keys(row);
          const result = await stateOf(
            c.query(
              `INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})`,
              names.map((n) => row[n])
            )
          );
          expect(result, table).toBeNull();
        }
      });
    });

    it("cannot release, revoke, or record a decision as a human", async () => {
      await as("hg_importer", async (c) => {
        for (const params of [
          ["RELEASED", "SCRIPT"],
          ["REVOKED", "SCRIPT"],
          ["QUARANTINED", "HUMAN"],
        ]) {
          const e = await denied(
            c,
            `INSERT INTO "SnapshotDecision"("snapshotId","status","reason","decidedBy","decidedByKind") VALUES ('amo1', $1, 'x', 'import', $2)`,
            params
          );
          expect(e?.code, params.join("/")).toBe(DENIED);
        }
        // Even as a human, RELEASED is out of reach: the policy looks at the status, not the claim.
        const forged = await denied(
          c,
          `INSERT INTO "SnapshotDecision"("snapshotId","status","reason","decidedBy","decidedByKind") VALUES ('amo1', 'RELEASED', 'x', 'import', 'HUMAN')`
        );
        expect(forged?.code).toBe(DENIED);
        expect(forged?.message).toContain("row-level security");
      });
      expect(
        (await q(`SELECT 1 FROM "SnapshotDecision" WHERE "snapshotId" = 'amo1'`)).rowCount
      ).toBe(0);
    });

    it("cannot delete, truncate, update decisions or alter anything", async () => {
      await decide("amo1", "QUARANTINED", "SCRIPT");
      await insert("OfficialActor", recordRows.OfficialActor as Cols);
      await as("hg_importer", async (c) => {
        expect((await denied(c, `DELETE FROM "OfficialActor"`))?.code).toBe(DENIED);
        expect((await denied(c, `TRUNCATE "OfficialActor"`))?.code).toBe(DENIED);
        expect((await denied(c, `UPDATE "SnapshotDecision" SET "status" = 'RELEASED'`))?.code).toBe(
          DENIED
        );
        expect((await denied(c, `UPDATE "OfficialActor" SET "rawHash" = '${H("f")}'`))?.code).toBe(
          DENIED
        );
        expect((await denied(c, `ALTER TABLE "OfficialActor" DISABLE TRIGGER ALL`))?.code).toBe(
          DENIED
        );
        expect((await denied(c, `DROP TABLE "OfficialActor"`))?.code).toBe(DENIED);
        expect((await denied(c, `CREATE TABLE "Rogue"(x int)`))?.code).toBe(DENIED);
        expect(
          (await denied(c, `ALTER TABLE "OfficialActor" DISABLE ROW LEVEL SECURITY`))?.code
        ).toBe(DENIED);
        expect((await denied(c, `SET session_replication_role = replica`))?.code).toBe(DENIED);
        expect((await denied(c, `CREATE POLICY p ON "OfficialActor" USING (true)`))?.code).toBe(
          DENIED
        );
      });
      expect((await q(`SELECT count(*)::int AS n FROM "OfficialActor"`)).rows[0].n).toBe(1);
    });

    it("closes an open version (and only that), through the version guard", async () => {
      await artifact(H("5"));
      await insert("OfficialActor", recordRows.OfficialActor as Cols);
      await snapshot("amo2", AMO30, 2, H("5"), H("6"));
      await as("hg_importer", async (c) => {
        const closed = await c.query(
          `UPDATE "OfficialActor" SET "toSeq" = 2 WHERE "officialId" = 'PA1' AND "toSeq" IS NULL`
        );
        expect(closed.rowCount).toBe(1);
        // A closed version is invisible to the update policy: nothing matches, nothing changes.
        const again = await c.query(
          `UPDATE "OfficialActor" SET "toSeq" = 2 WHERE "officialId" = 'PA1'`
        );
        expect(again.rowCount).toBe(0);
      });
    });

    it("cannot touch run tables, positions, or read the identity and continuity journals", async () => {
      await q(
        `INSERT INTO "OfficialActorLinkDecision"("chamber","officialId","status","evidence","decidedBy","decidedByKind") VALUES ('AN', 'PA1', 'NONE', 'e', 'h', 'HUMAN')`
      );
      await as("hg_importer", async (c) => {
        for (const table of [
          "OfficialActorLinkDecision",
          "OrganContinuityDecision",
          "HistoricalResolutionRun",
          "HistoricalRunSnapshotPin",
          "RunExclusion",
          "ScrutinOrganPosition",
        ]) {
          expect((await denied(c, `SELECT * FROM "${table}"`))?.code, `select ${table}`).toBe(
            DENIED
          );
          expect((await denied(c, `DELETE FROM "${table}"`))?.code, `delete ${table}`).toBe(DENIED);
        }
        expect(
          (await denied(c, `INSERT INTO "HistoricalResolutionRun"("id") VALUES ('r')`))?.code
        ).toBe(DENIED);
        expect(
          (await denied(c, `INSERT INTO "ScrutinOrganPosition"("runId") VALUES ('r')`))?.code
        ).toBe(DENIED);
      });
    });
  });

  // ------------------------------------------------------------------------------------------
  describe("the reader role", () => {
    it("reads what verification needs and writes nothing", async () => {
      await apply5d();
      await streams();
      await as("hg_reader", async (c) => {
        expect(
          (await c.query(`SELECT count(*)::int AS n FROM "OfficialSourceSnapshot"`)).rows[0].n
        ).toBe(2);
        expect((await denied(c, `INSERT INTO "SourceArtifact"("sha256") VALUES ('x')`))?.code).toBe(
          DENIED
        );
        expect((await denied(c, `SELECT * FROM "OfficialActorLinkDecision"`))?.code).toBe(DENIED);
        expect(
          (await denied(c, `UPDATE "OfficialSourceSnapshot" SET "importedBy" = 'x'`))?.code
        ).toBe(DENIED);
        expect((await denied(c, `DELETE FROM "OfficialSourceSnapshot"`))?.code).toBe(DENIED);
      });
    });
  });

  // ------------------------------------------------------------------------------------------
  describe("the runner role and the publication guard", () => {
    const CONFIG = (max: number) =>
      JSON.stringify({
        evidence: { placeholderOrganRefs: ["PO0"] },
        publication: { maxExcludedPerGroup: max },
      });
    async function newRun(id: string, max = 0, pinSeq = 1) {
      await as("hg_runner", async (c) => {
        await c.query(
          `INSERT INTO "HistoricalResolutionRun"("id","inputHash","status","linkDecisionCutoff","continuityDecisionCutoff","decisionsHash","preparedInputsHash","parserVersion","resolverVersion","dateSemanticsVersion","exclusionRulesVersion","configHash","config","codeVersion","startedBy","startedAt")
           VALUES ($1, $2, 'RUNNING', 0, 0, $3, $3, '5C-0.1', '2', 'v1', '1', $3, $4::jsonb, 'test', 'runner', now())`,
          [id, createHash("sha256").update(id).digest("hex"), H("d"), CONFIG(max)]
        );
        await c.query(
          `INSERT INTO "HistoricalRunSnapshotPin"("runId","stream","seq","stateHash") SELECT $1, "stream", "seq", "stateHash" FROM "OfficialSourceSnapshot" WHERE "stream" = $2 AND "seq" = $3`,
          [id, SCRUTINS, pinSeq]
        );
      });
    }
    const position = (scrutin: string, organRef: string, over: Cols = {}): Cols => ({
      runId: "run1",
      scrutinExternalId: scrutin,
      organRef,
      organKind: "GROUP",
      forCount: 3,
      againstCount: 1,
      abstainCount: 0,
      nonVoterCount: 0,
      excludedCount: 0,
      excludedByReason: "{}",
      publishable: true,
      reason: null,
      ...over,
    });
    const put = (row: Cols) =>
      as("hg_runner", (c) => {
        const names = Object.keys(row);
        return denied(
          c,
          `INSERT INTO "ScrutinOrganPosition" (${names.map((n) => `"${n}"`).join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})`,
          names.map((n) => row[n])
        );
      });

    beforeEach(async () => {
      await apply5d();
      await streams();
      await insert("ScrutinCountCheck", checkRow("OK"));
      await insert("ScrutinCountCheck", checkRow("BAD", MISMATCH));
      await insert("ScrutinCountCheck", checkRow("UNV", UNVERIFIABLE));
      await decide("sc1", "RELEASED");
      await newRun("run1");
    });

    it("pins only a RELEASED snapshot, writes exclusions, and finishes a run", async () => {
      await as("hg_runner", async (c) => {
        await c.query(
          `INSERT INTO "RunExclusion"("runId","scrutinExternalId","officialId","status","reason","evidence") VALUES ('run1', 'OK', 'PA1', 'UNKNOWN', 'PO0', '{}')`
        );
        const e = await denied(
          c,
          `UPDATE "HistoricalResolutionRun" SET "inputHash" = '${H("e")}' WHERE "id" = 'run1'`
        );
        expect(e?.code).toBe(DENIED);
        await c.query(
          `UPDATE "HistoricalResolutionRun" SET "status" = 'COMPLETED', "outputHash" = $1, "statusCounts" = '{}', "finishedAt" = now() WHERE "id" = 'run1'`,
          [H("7")]
        );
      });
      await artifact(H("8"));
      await snapshot("sc2", SCRUTINS, 2, H("8"), H("9"));
      await as("hg_runner", async (c) => {
        const unreleased = await denied(
          c,
          `INSERT INTO "HistoricalRunSnapshotPin"("runId","stream","seq","stateHash") VALUES ('run1', 'AN_SCRUTINS_L15', 2, '${H("9")}')`
        );
        expect(unreleased).not.toBeNull();
      });
    });

    it("cannot write snapshots, decisions or records", async () => {
      await as("hg_runner", async (c) => {
        expect(
          (
            await denied(
              c,
              `INSERT INTO "SnapshotDecision"("snapshotId","status","reason","decidedBy","decidedByKind") VALUES ('sc1', 'RELEASED', 'x', 'x', 'HUMAN')`
            )
          )?.code
        ).toBe(DENIED);
        expect((await denied(c, `INSERT INTO "OfficialActor"("stream") VALUES ('x')`))?.code).toBe(
          DENIED
        );
        expect((await denied(c, `DELETE FROM "ScrutinOrganPosition"`))?.code).toBe(DENIED);
        expect((await denied(c, `TRUNCATE "ScrutinOrganPosition"`))?.code).toBe(DENIED);
      });
    });

    it("publishes a group of a COHERENT scrutin", async () => {
      expect(await put(position("OK", "PO1"))).toBeNull();
    });

    it("refuses to publish a COUNT_MISMATCH, an UNVERIFIABLE or an unknown scrutin", async () => {
      for (const scrutin of ["BAD", "UNV", "NEVER_IMPORTED"]) {
        const e = await put(position(scrutin, "PO1"));
        expect(e?.code, scrutin).toBe(RESTRICT);
        expect(e?.message, scrutin).toContain("is not COHERENT in the pinned snapshots");
      }
    });

    it("keeps a row that is not publishable, with its reason, whatever the scrutin", async () => {
      for (const [scrutin, reason] of [
        ["BAD", "COUNT_MISMATCH"],
        ["UNV", "COUNT_UNVERIFIABLE"],
        ["OK", "EXCLUDED_VOTES_PRESENT"],
      ] as const) {
        const e = await put(
          position(scrutin, "PO1", { publishable: false, reason, excludedCount: 2 })
        );
        expect(e, scrutin).toBeNull();
      }
    });

    it("refuses a placeholder organ, whatever its counts", async () => {
      const e = await put(position("OK", "PO0"));
      expect(e?.code).toBe(RESTRICT);
      expect(e?.message).toContain("is a placeholder");
    });

    it("refuses excluded votes beyond the threshold of the run, and accepts them within it", async () => {
      const over = await put(
        position("OK", "PO1", { excludedCount: 1, excludedByReason: '{"PO0":1}' })
      );
      expect(over?.code).toBe(RESTRICT);
      expect(over?.message).toContain("exceed the threshold");
      await newRun("run2", 1);
      const within = await put(
        position("OK", "PO1", { runId: "run2", excludedCount: 1, excludedByReason: '{"PO0":1}' })
      );
      expect(within).toBeNull();
    });

    it("refuses what the row itself contradicts: not a group, no attested vote, reason mismatch", async () => {
      const cases: Cols[] = [
        position("OK", "PO1", { organKind: "NON_INSCRIT" }),
        position("OK", "PO1", { organKind: null }),
        position("OK", "PO1", { forCount: 0, againstCount: 0, abstainCount: 0, nonVoterCount: 4 }),
        position("OK", "PO1", { reason: "COUNT_MISMATCH" }),
        position("OK", "PO1", { publishable: false, reason: null }),
        position("OK", "PO1", { publishable: false, reason: "SOMETHING_ELSE" }),
        position("OK", "PO1", { forCount: -1 }),
      ];
      for (const row of cases) {
        expect((await put(row))?.code, JSON.stringify(row)).toBe(CHECK);
      }
    });

    it("refuses a publishable row even from the owner, with triggers bypass attempted", async () => {
      await q(`SET session_replication_role = replica`);
      try {
        const e = await stateOf(insert("ScrutinOrganPosition", position("BAD", "PO1") as Cols));
        expect(e?.code).toBe(RESTRICT);
      } finally {
        await q(`SET session_replication_role = DEFAULT`);
      }
      expect((await q(`SELECT count(*)::int AS n FROM "ScrutinOrganPosition"`)).rows[0].n).toBe(0);
    });

    it("refuses a position once the run is finished, and on an unknown run", async () => {
      await put(position("OK", "PO1"));
      await as("hg_runner", (c) =>
        c.query(
          `UPDATE "HistoricalResolutionRun" SET "status" = 'COMPLETED', "outputHash" = $1, "statusCounts" = '{}', "finishedAt" = now() WHERE "id" = 'run1'`,
          [H("7")]
        )
      );
      const late = await put(
        position("OK", "PO2", { publishable: false, reason: "NO_ATTESTED_VOTE" })
      );
      expect(late?.code).toBe(RESTRICT);
      expect(late?.message).toContain("only while it is RUNNING");
      const ghost = await put(position("OK", "PO1", { runId: "ghost" }));
      expect(ghost).not.toBeNull();
    });

    it("never updates, deletes or truncates a position, for any role", async () => {
      await put(position("OK", "PO1"));
      for (const sql of [
        `UPDATE "ScrutinOrganPosition" SET "publishable" = false, "reason" = 'COUNT_MISMATCH'`,
        `DELETE FROM "ScrutinOrganPosition"`,
        `TRUNCATE "ScrutinOrganPosition"`,
      ]) {
        const e = await stateOf(q(sql));
        expect(e?.code, sql).toBe(RESTRICT);
      }
      expect((await q(`SELECT count(*)::int AS n FROM "ScrutinOrganPosition"`)).rows[0].n).toBe(1);
    });

    it("judges coherence in the snapshot the run pinned, not in the latest one", async () => {
      // Snapshot 2 supersedes the count check of scrutin OK with a mismatch.
      await artifact(H("8"));
      await snapshot("sc2", SCRUTINS, 2, H("8"), H("9"));
      await as("hg_importer", async (c) => {
        await c.query(
          `UPDATE "ScrutinCountCheck" SET "toSeq" = 2 WHERE "scrutinExternalId" = 'OK'`
        );
        const names = Object.keys(checkRow("OK", MISMATCH, 2));
        const row = checkRow("OK", MISMATCH, 2);
        await c.query(
          `INSERT INTO "ScrutinCountCheck" (${names.map((n) => `"${n}"`).join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})`,
          names.map((n) => row[n])
        );
      });
      await decide("sc2", "RELEASED");
      await newRun("run2", 0, 2);
      // run1 pinned snapshot 1, where the counts were coherent.
      expect(await put(position("OK", "PO1"))).toBeNull();
      // run2 pinned snapshot 2, where they are not.
      const e = await put(position("OK", "PO1", { runId: "run2" }));
      expect(e?.code).toBe(RESTRICT);
    });
  });
});
