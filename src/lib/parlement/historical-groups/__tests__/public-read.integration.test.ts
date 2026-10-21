// @vitest-environment node
/**
 * What PostgreSQL really does with the public read views of the lot 6
 * (`2026-10-21-historical-groups-public-read.sql`). Runs the committed SQL, as written, on a
 * disposable database after the three scripts of the lot 5, with invented rows only.
 *
 * Not run by default and not wired into CI: same container and same setup as
 * `schema.integration.test.ts` (read its header). The suite drops and recreates the public schema
 * of that database before every test, and refuses any other target.
 *
 * What it proves, each with a case that can fail: only released and verified runs are readable, a
 * revocation hides a run, only publishable named groups come through, nothing but the owner can
 * read a view or a raw table, the exposed columns are exactly the allowlist, and the script stops
 * by itself when a raw table has lost its row level security.
 */
import { createHash } from "node:crypto";
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
const read = (name: string) => readFileSync(`${MANUAL}${name}`, "utf8");
const SQL_5B = read("2026-10-18-historical-groups-schema.sql");
const SQL_5C0 = read("2026-10-19-historical-groups-count-check.sql");
const SQL_5D = read("2026-10-20-historical-groups-roles-positions.sql");
const SQL_6 = read("2026-10-21-historical-groups-public-read.sql");
const SQL_6_ROLLBACK = read("2026-10-21-historical-groups-public-read-rollback.sql");

const H = (c: string) => c.repeat(64);
const SCRUTINS = "AN_SCRUTINS_L16";
const AMO30 = "AN_AMO30";
const DENIED = "42501";

const POSITION_COLUMNS = [
  "legislature",
  "scrutinExternalId",
  "organRef",
  "organLabel",
  "organAbbreviation",
  "forCount",
  "againstCount",
  "abstainCount",
  "nonVoterCount",
  "sameAbbreviationElsewhere",
];
const STATUS_COLUMNS = [
  "legislature",
  "scrutinExternalId",
  "countCoherence",
  "groupsShown",
  "groupsWithheld",
  "withheldGroups",
  "nonInscritVotes",
  "excludedConflictVotes",
  "excludedUnknownGroupVotes",
  "affiliationsUrl",
  "affiliationsFetchedAt",
  "affiliationsAsOf",
  "scrutinsUrl",
  "scrutinsFetchedAt",
];

type Cols = Record<string, unknown>;

describeDb("lot 6 public read views on a disposable PostgreSQL", () => {
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
  async function as<T>(role: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query(`SET ROLE ${role}`);
      return await fn(client);
    } finally {
      await client.query("RESET ROLE");
      client.release();
    }
  }

  async function reset() {
    const r = await q(
      `SELECT current_database() AS db, current_user AS usr, current_setting('hg.disposable', true) AS marker`
    );
    if (r.rows[0].db !== "hg_schema_test" || r.rows[0].marker !== "yes") {
      throw new Error("Refusing to run: not the disposable container");
    }
    await q("DROP SCHEMA IF EXISTS hg_reference CASCADE");
    await q("DROP SCHEMA public CASCADE");
    await q("CREATE SCHEMA public");
    await q(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hg_importer') THEN CREATE ROLE hg_importer LOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hg_runner') THEN CREATE ROLE hg_runner LOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hg_reader') THEN CREATE ROLE hg_reader LOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'readonly') THEN CREATE ROLE readonly; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'poligraph_bot') THEN CREATE ROLE poligraph_bot LOGIN; END IF;
    END $$`);
    // The shared database, as found on 2026-10-19: service_role bypasses RLS, readonly has no login,
    // and poligraph_bot (the Wikibot login role) bypasses RLS and inherits readonly.
    await q("ALTER ROLE service_role BYPASSRLS");
    await q("ALTER ROLE readonly NOLOGIN NOBYPASSRLS");
    await q("ALTER ROLE poligraph_bot LOGIN BYPASSRLS INHERIT");
    await q("GRANT readonly TO poligraph_bot");
    await q("ALTER ROLE hg_importer NOBYPASSRLS");
    await q("CREATE EXTENSION IF NOT EXISTS btree_gist");
    // What Supabase does on the public schema: anon and authenticated may use it, and every new
    // object is granted to them, and to service_role, by default. The project's own readonly role
    // gets SELECT the same way. The REVOKE statements of the scripts are what closes the lot 5
    // tables and the views; without this, the test would pass on a schema that is closed by accident
    // (no USAGE at all, or a role the fixture forgot) instead of by the REVOKE. The first version of
    // the views passed here while readonly, and through it poligraph_bot, could read them in
    // production, because the fixture knew only anon and authenticated.
    await q("GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, readonly");
    await q(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role"
    );
    await q("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly");
    // Managed by Prisma on the real database, not by the lot 5 scripts: the minimal shape the views read.
    await q(`CREATE TABLE "AnOrgan" (
      "organeRef" TEXT PRIMARY KEY, "legislature" INTEGER NOT NULL, "label" TEXT NOT NULL,
      "abbreviation" TEXT, "startDate" TIMESTAMPTZ, "endDate" TIMESTAMPTZ,
      "sourceUrl" TEXT NOT NULL DEFAULT 'https://data.assemblee-nationale.fr/x', "fetchedAt" TIMESTAMPTZ NOT NULL DEFAULT now())`);
  }

  async function insert(table: string, cols: Cols) {
    const names = Object.keys(cols);
    return q(
      `INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})`,
      names.map((n) => cols[n])
    );
  }
  const organ = (ref: string, label: string, abbreviation: string | null, legislature = 16) =>
    insert("AnOrgan", { organeRef: ref, legislature, label, abbreviation });

  const artifact = (sha: string) =>
    q(
      `INSERT INTO "SourceArtifact"("sha256","byteSize","mediaType","storageKind","storageRef","storedAt","storedBy")
       VALUES ($1, 100, 'application/zip', 'LOCAL_OFFLINE', 'artifacts/x', now(), 'test')`,
      [sha]
    );
  const snapshot = (
    id: string,
    stream: string,
    seq: number,
    sha: string,
    state: string,
    url: string
  ) =>
    q(
      `INSERT INTO "OfficialSourceSnapshot"("id","stream","seq","artifactSha256","url","fetchedAt","integrity","parserVersion","stateHash","recordCounts","importedBy")
       VALUES ($1, $2, $3, $4, $5, '2026-10-18T22:00:00Z', 'VERIFIED', '5C-0.1', $6, '{}', 'test')`,
      [id, stream, seq, sha, url, state]
    );
  const decide = (snapshotId: string, status: string) =>
    q(
      `INSERT INTO "SnapshotDecision"("snapshotId","status","reason","decidedBy","decidedByKind") VALUES ($1, $2, 't', 't', 'HUMAN')`,
      [snapshotId, status]
    );

  const countCheck = (id: string, over: Cols = {}): Cols => ({
    stream: SCRUTINS,
    scrutinExternalId: id,
    fromSeq: 1,
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
    sourceMember: "json/x.json",
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

  const CONFIG = (legislatures: number[]) =>
    JSON.stringify({
      scope: { legislatures },
      evidence: { placeholderOrganRefs: ["PO0"] },
      publication: { maxExcludedPerGroup: 0 },
    });

  /** A run on the two streams, still RUNNING: positions go in, then `finish`. */
  async function newRun(id: string, legislatures = [16]) {
    await as("hg_runner", async (c) => {
      await c.query(
        `INSERT INTO "HistoricalResolutionRun"("id","inputHash","status","linkDecisionCutoff","continuityDecisionCutoff","decisionsHash","preparedInputsHash","parserVersion","resolverVersion","dateSemanticsVersion","exclusionRulesVersion","configHash","config","codeVersion","startedBy","startedAt")
         VALUES ($1, $2, 'RUNNING', 0, 0, $3, $3, '5C-0.1', '2', 'v1', '1', $3, $4::jsonb, 'test', 'runner', now())`,
        [id, createHash("sha256").update(id).digest("hex"), H("d"), CONFIG(legislatures)]
      );
      await c.query(
        `INSERT INTO "HistoricalRunSnapshotPin"("runId","stream","seq","stateHash") SELECT $1, "stream", "seq", "stateHash" FROM "OfficialSourceSnapshot" WHERE ("stream","seq") IN (('${AMO30}', 1), ('${SCRUTINS}', 1))`,
        [id]
      );
    });
  }
  const position = (runId: string, scrutin: string, organRef: string, over: Cols = {}): Cols => ({
    runId,
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
    as("hg_runner", async (c) => {
      const names = Object.keys(row);
      await c.query(
        `INSERT INTO "ScrutinOrganPosition" (${names.map((n) => `"${n}"`).join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})`,
        names.map((n) => row[n])
      );
    });
  const finish = (runId: string, outputHash: string, at = "now()") =>
    as("hg_runner", (c) =>
      c.query(
        `UPDATE "HistoricalResolutionRun" SET "status" = 'COMPLETED', "outputHash" = $1, "statusCounts" = '{}', "finishedAt" = ${at} WHERE "id" = $2`,
        [outputHash, runId]
      )
    );

  /** Streams released, a coherent scrutin OK, a discordant BAD, an unverifiable UNV, and a run over them. */
  async function fixture() {
    await artifact(H("1"));
    await artifact(H("2"));
    await snapshot("amo1", AMO30, 1, H("1"), H("3"), "https://data.assemblee-nationale.fr/amo.zip");
    await snapshot(
      "sc1",
      SCRUTINS,
      1,
      H("2"),
      H("4"),
      "https://data.assemblee-nationale.fr/scrutins.zip"
    );
    await insert("ScrutinCountCheck", countCheck("OK"));
    await insert("ScrutinCountCheck", countCheck("BAD", MISMATCH));
    await insert("ScrutinCountCheck", countCheck("UNV", UNVERIFIABLE));
    await organ("PO1", "Groupe Un", "UN");
    await organ("PO2", "Groupe Deux", "DEUX");
    await organ("PO3", "Socialistes", "SOC");
    await organ("PO4", "Socialistes (nouvelle référence)", "SOC");
    await organ("PO5", "Groupe Cinq", "CINQ");
    await organ("PO6", "Groupe Six", "SIX");
    await organ("NI", "Non inscrit", "NI");
    // The pin guard of the lot 5 refuses a snapshot that is not RELEASED: a run cannot exist over a
    // quarantined one. The states "released then revoked" are what the views have to follow.
    await decide("amo1", "RELEASED");
    await decide("sc1", "RELEASED");
    await newRun("run1");
    await put(position("run1", "OK", "PO1", { forCount: 21 }));
    await put(position("run1", "OK", "PO2", { againstCount: 7, forCount: 0 }));
    await put(position("run1", "OK", "PO3"));
    await put(position("run1", "OK", "PO4"));
    await put(
      position("run1", "OK", "PO5", {
        publishable: false,
        reason: "NO_ATTESTED_VOTE",
        forCount: 0,
        againstCount: 0,
        nonVoterCount: 1,
      })
    );
    await put(
      position("run1", "OK", "PO6", {
        publishable: false,
        reason: "EXCLUDED_VOTES_PRESENT",
        excludedCount: 2,
        excludedByReason: '{"CONFLICT":2}',
      })
    );
    await put(
      position("run1", "OK", "NI", {
        organKind: "NON_INSCRIT",
        publishable: false,
        reason: "NON_INSCRIT_IS_NOT_A_GROUP",
        forCount: 2,
        againstCount: 1,
      })
    );
    await put(
      position("run1", "OK", "PO0", {
        organKind: null,
        publishable: false,
        reason: "EXCLUDED_VOTES_PRESENT",
        forCount: 0,
        againstCount: 0,
        excludedCount: 3,
        excludedByReason: '{"PO0":3}',
      })
    );
    await put(position("run1", "BAD", "PO1", { publishable: false, reason: "COUNT_MISMATCH" }));
    await put(position("run1", "UNV", "PO1", { publishable: false, reason: "COUNT_UNVERIFIABLE" }));
    await finish("run1", H("7"));
  }
  const positions = (scrutin: string) =>
    q(
      `SELECT * FROM "HistoricalGroupPositionPublic" WHERE "scrutinExternalId" = $1 ORDER BY "organRef"`,
      [scrutin]
    );
  const status = (scrutin: string) =>
    q(`SELECT * FROM "HistoricalScrutinPublicStatus" WHERE "scrutinExternalId" = $1`, [scrutin]);

  let lockClient: PoolClient | undefined;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    lockClient = await pool.connect();
    await lockClient.query("SELECT pg_advisory_lock(5330001)");
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
    await q(SQL_5D);
    await fixture();
    await q(SQL_6);
  });

  describe("what is readable", () => {
    it("un run terminé et libéré est lu", async () => {
      expect((await q(`SELECT "legislature", "runId" FROM "HistoricalPublishedRun"`)).rows).toEqual(
        [{ legislature: 16, runId: "run1" }]
      );
    });

    it("révoquer un seul des deux snapshots épinglés suffit à retirer le run", async () => {
      await decide("amo1", "REVOKED");
      expect((await q(`SELECT count(*)::int AS n FROM "HistoricalPublishedRun"`)).rows[0].n).toBe(
        0
      );
      expect((await positions("OK")).rowCount).toBe(0);
    });

    it("un run qui n'est pas terminé n'est pas lu, même sur une autre législature", async () => {
      await newRun("run-open", [15]);
      await put(position("run-open", "OK", "PO1", { forCount: 77 }));
      expect((await q(`SELECT "runId" FROM "HistoricalPublishedRun"`)).rows).toEqual([
        { runId: "run1" },
      ]);
      expect((await positions("OK")).rows.some((r) => r.forCount === 77)).toBe(false);
    });

    it("libérés et terminés : seuls les groupes nommés, publishable et sans vote exclu", async () => {
      const rows = (await positions("OK")).rows;
      expect(rows.map((r) => r.organRef)).toEqual(["PO1", "PO2", "PO3", "PO4"]);
      expect(rows[0]).toMatchObject({
        legislature: 16,
        organLabel: "Groupe Un",
        organAbbreviation: "UN",
        forCount: 21,
        sameAbbreviationElsewhere: false,
      });
      // Two organs share the abbreviation SOC in this legislature: flagged, never merged.
      expect(rows.filter((r) => r.sameAbbreviationElsewhere).map((r) => r.organRef)).toEqual([
        "PO3",
        "PO4",
      ]);
    });

    it("scrutin discordant ou non vérifiable : aucune ligne de groupe, un état qui explique", async () => {
      expect((await positions("BAD")).rowCount).toBe(0);
      expect((await positions("UNV")).rowCount).toBe(0);
      expect((await status("BAD")).rows[0]).toMatchObject({
        countCoherence: "COUNT_MISMATCH",
        groupsShown: 0,
      });
      expect((await status("UNV")).rows[0]).toMatchObject({
        countCoherence: "UNVERIFIABLE",
        groupsShown: 0,
      });
    });

    it("withheldGroups ne porte que des raisons que la page sait expliquer, cohérent ou non", async () => {
      // Regression: on the real data the 35 discordant scrutins carried COUNT_MISMATCH here, which
      // the reader refuses, so the page showed "unavailable" instead of the discordance notice.
      const explained = ["EXCLUDED_VOTES_PRESENT", "NO_ATTESTED_VOTE", "UNLABELLED_GROUP"];
      for (const scrutin of ["OK", "BAD", "UNV"]) {
        const groups = (await status(scrutin)).rows[0].withheldGroups as { reason: string }[];
        for (const group of groups) expect(explained, `${scrutin}`).toContain(group.reason);
      }
      expect((await status("OK")).rows[0].withheldGroups).toHaveLength(2);
    });

    it("l'état d'un scrutin compte, nomme et ne montre aucun vote", async () => {
      const s = (await status("OK")).rows[0];
      expect(s).toMatchObject({
        legislature: 16,
        countCoherence: "COHERENT",
        groupsShown: 4,
        groupsWithheld: 2,
        nonInscritVotes: 3,
        excludedConflictVotes: 2,
        excludedUnknownGroupVotes: 3,
        affiliationsUrl: "https://data.assemblee-nationale.fr/amo.zip",
        scrutinsUrl: "https://data.assemblee-nationale.fr/scrutins.zip",
      });
      expect(s.withheldGroups).toEqual([
        { label: "Groupe Cinq", abbreviation: "CINQ", reason: "NO_ATTESTED_VOTE" },
        { label: "Groupe Six", abbreviation: "SIX", reason: "EXCLUDED_VOTES_PRESENT" },
      ]);
    });

    it("une position publishable dont le groupe n'a pas de nom n'est pas montrée et reste comptée", async () => {
      await q(`DELETE FROM "AnOrgan" WHERE "organeRef" = 'PO2'`);
      expect((await positions("OK")).rows.map((r) => r.organRef)).toEqual(["PO1", "PO3", "PO4"]);
      expect((await status("OK")).rows[0]).toMatchObject({ groupsShown: 3, groupsWithheld: 3 });
    });

    it("une décision REVOKED retire le run de la lecture, sans autre geste", async () => {
      expect((await positions("OK")).rowCount).toBe(4);
      await decide("sc1", "REVOKED");
      expect((await positions("OK")).rowCount).toBe(0);
      expect((await status("OK")).rowCount).toBe(0);
    });

    it("le run le plus récent d'une législature est le seul lu", async () => {
      await newRun("run2");
      await put(position("run2", "OK", "PO1", { forCount: 99 }));
      await finish("run2", H("8"), "now() + interval '1 hour'");
      const rows = (await positions("OK")).rows;
      expect(rows.map((r) => [r.organRef, r.forCount])).toEqual([["PO1", 99]]);
    });
  });

  describe("who can read", () => {
    const VIEWS = [
      "HistoricalPublishedRun",
      "HistoricalGroupPositionPublic",
      "HistoricalScrutinPublicStatus",
    ];
    const RAW = [
      "ScrutinOrganPosition",
      "HistoricalResolutionRun",
      "RunExclusion",
      "SnapshotDecision",
      "OfficialSourceSnapshot",
    ];

    it.each([
      "anon",
      "authenticated",
      "hg_reader",
      "hg_runner",
      "hg_importer",
      "readonly",
      "poligraph_bot",
    ])("%s ne lit pas les vues", async (role) => {
      await as(role, async (c) => {
        for (const view of VIEWS) {
          const e = await stateOf(c.query(`SELECT * FROM "${view}"`));
          expect(e?.code, `${role} on ${view}`).toBe(DENIED);
        }
        if (role === "anon" || role === "authenticated") {
          for (const table of RAW) {
            const e = await stateOf(c.query(`SELECT * FROM "${table}"`));
            expect(e?.code, `${role} on ${table}`).toBe(DENIED);
          }
        }
      });
    });

    it("aucun droit n'est accordé par le script : seuls le propriétaire et service_role en ont sur les vues", async () => {
      const r = await q(
        `SELECT DISTINCT CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) x
         WHERE n.nspname = 'public' AND c.relname = ANY($1)
         ORDER BY 1`,
        [VIEWS]
      );
      // service_role keeps the Supabase default grant (it bypasses RLS on every table anyway). The
      // owner is the test user here and `postgres` on the shared database. Nobody else, readonly
      // included: that one came from the default privileges and the first version left it in place.
      const owner = (await q("SELECT current_user AS u")).rows[0].u;
      expect(r.rows.map((x) => x.grantee).sort()).toEqual([owner, "service_role"].sort());
    });

    it("le schéma de test reproduit les droits par défaut de Supabase et leur héritage", async () => {
      // A control that can fail: without the fixture defaults, every case below would be closed
      // by accident. A fresh table is granted to readonly and service_role, and poligraph_bot
      // reaches it through readonly.
      await q(`CREATE TABLE "DefaultsProbe" (id int)`);
      const priv = async (role: string) =>
        (
          await q(`SELECT has_table_privilege($1, 'public."DefaultsProbe"', 'SELECT') AS ok`, [
            role,
          ])
        ).rows[0].ok;
      expect(await priv("readonly")).toBe(true);
      expect(await priv("service_role")).toBe(true);
      expect(await priv("poligraph_bot")).toBe(true);
      const bot = (
        await q(`SELECT rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'poligraph_bot'`)
      ).rows[0];
      expect(bot).toEqual({ rolbypassrls: true, rolcanlogin: true });
      expect(
        (await q(`SELECT pg_has_role('poligraph_bot', 'readonly', 'USAGE') AS inherits`)).rows[0]
          .inherits
      ).toBe(true);
    });

    it("readonly ne voit aucune ligne des tables brutes : la RLS la retient, les vues ne sont pas son chemin", async () => {
      const raw = (await q(`SELECT count(*)::int AS n FROM "ScrutinOrganPosition"`)).rows[0].n;
      expect(raw).toBeGreaterThan(0);
      await as("readonly", async (c) => {
        expect(
          (await c.query(`SELECT count(*)::int AS n FROM "ScrutinOrganPosition"`)).rows[0].n
        ).toBe(0);
      });
    });

    it("les colonnes exposées sont exactement la liste attendue", async () => {
      const cols = async (view: string) =>
        (
          await q(
            `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
            [view]
          )
        ).rows.map((r) => r.column_name);
      expect(await cols("HistoricalGroupPositionPublic")).toEqual(POSITION_COLUMNS);
      expect(await cols("HistoricalScrutinPublicStatus")).toEqual(STATUS_COLUMNS);
    });

    it("aucune valeur lue ne contient d'identifiant d'élu, d'empreinte ni de preuve", async () => {
      const all = JSON.stringify([...(await positions("OK")).rows, ...(await status("OK")).rows]);
      for (const secret of [
        H("3"),
        H("4"),
        H("7"),
        H("a"),
        H("b"),
        "run1",
        "evidence",
        "officialId",
      ]) {
        expect(all).not.toContain(secret);
      }
    });
  });

  describe("le script", () => {
    it("s'arrête de lui-même si la RLS d'une table brute a été coupée", async () => {
      await q(SQL_6_ROLLBACK);
      await q(`ALTER TABLE "ScrutinOrganPosition" DISABLE ROW LEVEL SECURITY`);
      const e = await stateOf(q(SQL_6));
      expect(e?.message).toContain("row level security is off");
      // The transaction was rolled back: no view was left behind.
      expect(
        (await q(`SELECT to_regclass('"HistoricalGroupPositionPublic"') AS t`)).rows[0].t
      ).toBeNull();
    });

    it("s'arrête de lui-même si readonly garde un droit sur une vue", async () => {
      // The exact regression of the first version: the REVOKE named PUBLIC, anon and authenticated
      // only, so readonly (and poligraph_bot through it) kept SELECT on the three views.
      const withoutReadonly = SQL_6.replace(
        "FROM PUBLIC, anon, authenticated, readonly;",
        "FROM PUBLIC, anon, authenticated;"
      );
      expect(withoutReadonly).not.toBe(SQL_6);
      await q(SQL_6_ROLLBACK);
      const e = await stateOf(q(withoutReadonly));
      expect(e?.message).toContain(
        "privilege(s) left to a role other than the owner and service_role"
      );
      expect(
        (await q(`SELECT to_regclass('"HistoricalGroupPositionPublic"') AS t`)).rows[0].t
      ).toBeNull();
      await q(SQL_6);
    });

    it("s'arrête aussi pour un rôle que le REVOKE ne nomme pas, venu des droits par défaut", async () => {
      await q(
        `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'late_reader') THEN CREATE ROLE late_reader; END IF; END $$`
      );
      await q("GRANT USAGE ON SCHEMA public TO late_reader");
      await q(SQL_6_ROLLBACK);
      await q("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO late_reader");
      const e = await stateOf(q(SQL_6));
      expect(e?.message).toContain(
        "privilege(s) left to a role other than the owner and service_role"
      );
      await q("ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM late_reader");
      await q(SQL_6);
    });

    it("ne touche à aucune table existante et se retire proprement", async () => {
      const before = (
        await q(
          `SELECT count(*)::int AS n FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace`
        )
      ).rows[0].n;
      await q(SQL_6_ROLLBACK);
      for (const view of [
        "HistoricalGroupPositionPublic",
        "HistoricalScrutinPublicStatus",
        "HistoricalPublishedRun",
      ]) {
        expect((await q(`SELECT to_regclass('"${view}"') AS t`)).rows[0].t).toBeNull();
      }
      const after = (
        await q(
          `SELECT count(*)::int AS n FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace`
        )
      ).rows[0].n;
      expect(after).toBe(before);
      await q(SQL_6);
    });
  });
});
