// @vitest-environment node
/**
 * The whole path on a disposable PostgreSQL, with small synthetic archives: import as the importer
 * role, verification, release by the owner, run as the runner role, replay as the reader role.
 * Same container and setup as `schema.integration.test.ts` (see its header). Not run by default.
 *
 * The hash contracts are checked by code written here, not by the code under test: the expected
 * canonical text and state hash are rebuilt from the stored rows with a second implementation.
 */
import AdmZip from "adm-zip";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acteurFile,
  groupMandate,
  organeFile,
  scrutinFile,
  seatMandate,
  type VotantSpec,
} from "@/lib/parlement/historical-groups/__fixtures__/official-files";
import { openArchiveBytes, type OpenedArchive } from "../historical-groups-archive";
import {
  connectDisposable,
  KIND_TABLE,
  CONTENT_COLUMNS,
  readRecordsAt,
} from "../historical-groups-db";
import {
  applyImport,
  planHashOf,
  planImport,
  type ManifestEntry,
} from "../historical-groups-import";
import { assembleRun, execute, replayRun, writeRun } from "../historical-groups-run";
import { releaseSnapshot, verificationHash, verifySnapshot } from "../historical-groups-verify";

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
if (url && (url === process.env.DATABASE_URL || url === process.env.DIRECT_URL)) {
  throw new Error("The test URL must not be a connection string of the application");
}
const describeDb = url ? describe : describe.skip;

const MANUAL = "prisma/migrations/manual/";
const MIGRATIONS = [
  "2026-10-18-historical-groups-schema.sql",
  "2026-10-19-historical-groups-count-check.sql",
  "2026-10-20-historical-groups-roles-positions.sql",
].map((f) => readFileSync(`${MANUAL}${f}`, "utf8"));

const FIXED_TIME = new Date(Date.UTC(2020, 0, 1));
function zipOf(files: Record<string, unknown>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(JSON.stringify(content)));
    (zip.getEntry(name) as AdmZip.IZipEntry).header.time = FIXED_TIME;
  }
  return zip.toBuffer();
}

const AMO30 = "AN_AMO30";
const L16 = "AN_SCRUTINS_L16";
const voter = (actor: string, mandate: string): VotantSpec => ({ actor, mandate });

/** Three deputies: two in a group, one non-registered. Organ PO_G1 is a group, PO_NI is not. */
function amo30Archive(extra: Record<string, unknown> = {}): OpenedArchive {
  return openArchiveBytes(
    zipOf({
      "json/organe/PO_G1.json": organeFile("PO_G1", { label: "Groupe un", abbreviation: "G1" }),
      "json/organe/PO_NI.json": organeFile("PO_NI", {
        label: "Députés non inscrits",
        abbreviation: "NI",
      }),
      "json/acteur/PA1.json": acteurFile("PA1", [
        groupMandate("MG1", "PA1", "PO_G1"),
        seatMandate("PM1", "PA1"),
      ]),
      "json/acteur/PA2.json": acteurFile("PA2", [
        groupMandate("MG2", "PA2", "PO_NI", { quality: "Député non-inscrit" }),
        seatMandate("PM2", "PA2"),
      ]),
      "json/acteur/PA3.json": acteurFile("PA3", [
        groupMandate("MG3", "PA3", "PO_G1"),
        seatMandate("PM3", "PA3"),
      ]),
      ...extra,
    })
  );
}

/** Scrutin `id` where PA1 and PA3 vote under the group and PA2 under the non-registered. */
function scrutinsArchive(
  files: {
    id: string;
    official?: { pour: number; contre: number; abstention: number; nonVotant: number };
    contreAs?: string;
  }[]
): OpenedArchive {
  const entries: Record<string, unknown> = {};
  for (const f of files) {
    entries[`json/${f.id}.json`] = scrutinFile(f.id, [
      {
        organ: "PO_G1",
        pour: [voter("PA1", "PM1"), voter("PA3", "PM3")],
        ...(f.official ? { official: f.official } : {}),
      },
      { organ: f.contreAs ?? "PO_NI", contre: [voter("PA2", "PM2")] },
    ]);
  }
  return openArchiveBytes(zipOf(entries));
}

const entryOf = (stream: string, archive: OpenedArchive): ManifestEntry => ({
  stream,
  sha256: archive.sha256,
  sizeBytes: archive.sizeBytes,
  file: `archives/${archive.sha256}.zip`,
  url: "https://example.test/archive.zip",
  serverLastModified: null,
  sourceAsOf: stream === AMO30 ? "2026-10-17T00:34:00Z" : null,
});

// A second canonical form, written from the specification (sorted keys, no spaces, integers).
function independentJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(independentJson).join(",")}]`;
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${independentJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describeDb("historical groups: import, release, run and replay on a disposable PostgreSQL", () => {
  let owner: pg.Pool;
  let lock: pg.PoolClient | undefined;
  const roleUrl = (role: string, password: string) =>
    `postgresql://${role}:${password}@127.0.0.1:55486/hg_schema_test`;
  const as = async <T>(
    role: "importer" | "runner" | "reader" | "owner",
    fn: (c: pg.Client) => Promise<T>
  ): Promise<T> => {
    const creds = {
      importer: ["hg_importer", "imp"],
      runner: ["hg_runner", "run"],
      reader: ["hg_reader", "rea"],
      owner: ["hg_schema_test", "hg_schema_test"],
    }[role] as [string, string];
    const client = await connectDisposable(roleUrl(...creds), role, {});
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  };

  async function importAs(stream: string, archive: OpenedArchive) {
    return as("importer", async (c) => {
      const { plan } = await planImport(c, stream, archive);
      return applyImport(c, stream, archive, entryOf(stream, archive), planHashOf(plan));
    });
  }
  async function release(stream: string, seq: number, archive: OpenedArchive) {
    await as("owner", async (c) => {
      const v = await verifySnapshot(c, stream, seq, archive);
      await releaseSnapshot(c, stream, seq, archive, verificationHash(v), "test", "tester");
    });
  }

  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: url });
    lock = await owner.connect();
    await lock.query("SELECT pg_advisory_lock(5330001)");
  });
  afterAll(async () => {
    if (lock) {
      await lock.query("SELECT pg_advisory_unlock(5330001)");
      lock.release();
    }
    await owner?.end();
  });
  beforeEach(async () => {
    const marker = await owner.query(
      `SELECT current_setting('hg.disposable', true) AS m, current_database() AS d`
    );
    if (marker.rows[0].m !== "yes" || marker.rows[0].d !== "hg_schema_test")
      throw new Error("not the disposable container");
    await owner.query("DROP SCHEMA IF EXISTS hg_reference CASCADE");
    await owner.query("DROP SCHEMA public CASCADE");
    await owner.query("CREATE SCHEMA public");
    await owner.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hg_importer') THEN CREATE ROLE hg_importer LOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hg_runner') THEN CREATE ROLE hg_runner LOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hg_reader') THEN CREATE ROLE hg_reader LOGIN; END IF;
    END $$`);
    await owner.query(
      `ALTER ROLE hg_importer PASSWORD 'imp' NOBYPASSRLS; ALTER ROLE hg_runner PASSWORD 'run'; ALTER ROLE hg_reader PASSWORD 'rea'; ALTER ROLE hg_schema_test PASSWORD 'hg_schema_test'`
    );
    await owner.query("CREATE EXTENSION IF NOT EXISTS btree_gist");
    for (const sql of MIGRATIONS) await owner.query(sql);
  });

  // ------------------------------------------------------------------------------------------
  describe("the import", () => {
    it("writes the snapshot as the importer role, QUARANTINED, and reads it back to the same hashes", async () => {
      const archive = amo30Archive();
      const result = await importAs(AMO30, archive);
      expect(result).toMatchObject({
        outcome: "IMPORTED",
        seq: 1,
        rowsWritten: 3 + 2 + 3 + 3,
        rowsClosed: 0,
      });
      const decisions = await owner.query(
        `SELECT "status","decidedByKind" FROM "SnapshotDecision"`
      );
      expect(decisions.rows).toEqual([{ status: "QUARANTINED", decidedByKind: "SCRIPT" }]);
      const verdict = await as("reader", (c) => verifySnapshot(c, AMO30, 1, archive));
      expect(verdict).toMatchObject({ ok: true, problems: [], status: "QUARANTINED" });
      expect(verdict.archiveStateHash).toBe(verdict.recordedStateHash);
    });

    it("gives rows whose rawHash and whose snapshot stateHash match a second implementation", async () => {
      const archive = amo30Archive();
      await importAs(AMO30, archive);
      const stored = await as("owner", async (c) => {
        const out: { kind: string; key: string; rawHash: string; recomputed: string }[] = [];
        for (const kind of Object.keys(KIND_TABLE).filter((k) =>
          ["OFFICIAL_ACTOR", "OFFICIAL_ORGAN", "GROUP_MEMBERSHIP", "SEAT_MANDATE"].includes(k)
        )) {
          for await (const r of readRecordsAt(c, AMO30, 1, kind as keyof typeof KIND_TABLE)) {
            const row: Record<string, unknown> = {};
            for (const column of CONTENT_COLUMNS[kind as keyof typeof KIND_TABLE])
              row[column] = r.row[column];
            out.push({
              kind,
              key: r.key,
              rawHash: r.rawHash,
              recomputed: sha(independentJson({ kind, row })),
            });
          }
        }
        return out;
      });
      expect(stored).toHaveLength(11);
      for (const s of stored) expect(s.rawHash, `${s.kind} ${s.key}`).toBe(s.recomputed);
      const lines = stored.map((s) => JSON.stringify([s.kind, s.key, s.rawHash])).sort();
      const expected = sha(lines.map((l) => `${l}\n`).join(""));
      const recorded = await owner.query(
        `SELECT "stateHash" FROM "OfficialSourceSnapshot" WHERE "stream" = $1`,
        [AMO30]
      );
      expect(recorded.rows[0].stateHash).toBe(expected);
    });

    it("records the member each row came from and the hash of its bytes", async () => {
      await importAs(AMO30, amo30Archive());
      const rows = await owner.query(
        `SELECT "sourceMember","memberHash" FROM "OfficialActor" WHERE "officialId" = 'PA1'`
      );
      expect(rows.rows[0].sourceMember).toBe("json/acteur/PA1.json");
      const expected = sha(
        JSON.stringify(
          acteurFile("PA1", [groupMandate("MG1", "PA1", "PO_G1"), seatMandate("PM1", "PA1")])
        )
      );
      expect(rows.rows[0].memberHash).toBe(expected);
    });

    it("writes nothing the second time, and refuses a stale confirmation", async () => {
      const archive = amo30Archive();
      await importAs(AMO30, archive);
      const before = await owner.query(`SELECT count(*)::int AS n FROM "OfficialActor"`);
      const plan = await as("importer", async (c) => (await planImport(c, AMO30, archive)).plan);
      expect(plan.status).toBe("ALREADY_IMPORTED");
      await expect(
        as("importer", (c) =>
          applyImport(c, AMO30, archive, entryOf(AMO30, archive), planHashOf(plan))
        )
      ).resolves.toMatchObject({ outcome: "ALREADY_IMPORTED", rowsWritten: 0, rowsClosed: 0 });
      await expect(
        as("importer", (c) =>
          applyImport(c, AMO30, archive, entryOf(AMO30, archive), "0".repeat(64))
        )
      ).rejects.toThrow(/not the confirmed one/);
      expect((await owner.query(`SELECT count(*)::int AS n FROM "OfficialActor"`)).rows[0].n).toBe(
        before.rows[0].n
      );
      expect(
        (await owner.query(`SELECT count(*)::int AS n FROM "OfficialSourceSnapshot"`)).rows[0].n
      ).toBe(1);
    });

    it("refuses to apply without the hash of the plan it is shown", async () => {
      const archive = amo30Archive();
      await expect(
        as("importer", (c) =>
          applyImport(c, AMO30, archive, entryOf(AMO30, archive), "f".repeat(64))
        )
      ).rejects.toThrow(/not the confirmed one/);
      expect((await owner.query(`SELECT count(*)::int AS n FROM "SourceArtifact"`)).rows[0].n).toBe(
        0
      );
    });

    it("is atomic: a failure in the middle leaves nothing, and the import can then be redone", async () => {
      const archive = amo30Archive();
      const entry = entryOf(AMO30, archive);
      await as("importer", async (real) => {
        const { plan } = await planImport(real, AMO30, archive);
        let inserts = 0;
        const flaky = new Proxy(real, {
          get(target, property, receiver) {
            if (property === "query") {
              return (text: unknown, values?: unknown) => {
                if (
                  typeof text === "string" &&
                  text.startsWith('INSERT INTO "GroupMembershipRecord"') &&
                  ++inserts === 1
                ) {
                  return Promise.reject(new Error("simulated crash"));
                }
                return (target.query as (...a: unknown[]) => unknown).call(target, text, values);
              };
            }
            return Reflect.get(target, property, receiver);
          },
        }) as pg.Client;
        await expect(applyImport(flaky, AMO30, archive, entry, planHashOf(plan))).rejects.toThrow(
          "simulated crash"
        );
      });
      for (const table of [
        "SourceArtifact",
        "OfficialSourceSnapshot",
        "SnapshotDecision",
        "OfficialActor",
        "GroupMembershipRecord",
      ]) {
        expect(
          (await owner.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n,
          table
        ).toBe(0);
      }
      await expect(importAs(AMO30, archive)).resolves.toMatchObject({
        outcome: "IMPORTED",
        seq: 1,
      });
    });

    it("lets one of two concurrent imports win, and the other write nothing", async () => {
      const archive = amo30Archive();
      const entry = entryOf(AMO30, archive);
      const results = await Promise.allSettled([
        as("importer", async (c) =>
          applyImport(
            c,
            AMO30,
            archive,
            entry,
            planHashOf((await planImport(c, AMO30, archive)).plan)
          )
        ),
        as("importer", async (c) =>
          applyImport(
            c,
            AMO30,
            archive,
            entry,
            planHashOf((await planImport(c, AMO30, archive)).plan)
          )
        ),
      ]);
      const imported = results.filter(
        (r) => r.status === "fulfilled" && r.value.outcome === "IMPORTED"
      );
      expect(imported).toHaveLength(1);
      expect(
        (await owner.query(`SELECT count(*)::int AS n FROM "OfficialSourceSnapshot"`)).rows[0].n
      ).toBe(1);
      expect((await owner.query(`SELECT count(*)::int AS n FROM "OfficialActor"`)).rows[0].n).toBe(
        3
      );
    });

    it("applies a retroactive correction as a new snapshot, and keeps what the first one said", async () => {
      const first = amo30Archive();
      await importAs(AMO30, first);
      // The source rewrites PA3's group mandate in place: it now ends on 2023-01-01.
      const second = amo30Archive({
        "json/acteur/PA3.json": acteurFile("PA3", [
          groupMandate("MG3", "PA3", "PO_G1", { end: "2023-01-01" }),
          seatMandate("PM3", "PA3"),
        ]),
      });
      const plan = await as("importer", async (c) => (await planImport(c, AMO30, second)).plan);
      expect(plan.diff.GROUP_MEMBERSHIP).toEqual({
        added: 0,
        corrected: 1,
        removed: 0,
        unchanged: 2,
      });
      expect(plan.diff.OFFICIAL_ACTOR).toEqual({
        added: 0,
        corrected: 0,
        removed: 0,
        unchanged: 3,
      });
      await expect(importAs(AMO30, second)).resolves.toMatchObject({
        seq: 2,
        rowsWritten: 1,
        rowsClosed: 1,
      });
      const versions = await owner.query(
        `SELECT "fromSeq","toSeq","endState" FROM "GroupMembershipRecord" WHERE "sourceRecordId" = 'MG3' ORDER BY "fromSeq"`
      );
      expect(versions.rows).toEqual([
        { fromSeq: 1, toSeq: 2, endState: "OPEN_AT_SNAPSHOT" },
        { fromSeq: 2, toSeq: null, endState: "DATED" },
      ]);
      for (const [seq, archive] of [
        [1, first],
        [2, second],
      ] as const) {
        expect(await as("reader", (c) => verifySnapshot(c, AMO30, seq, archive))).toMatchObject({
          ok: true,
        });
      }
    });

    it("stops on a mass removal, and writes nothing", async () => {
      await importAs(AMO30, amo30Archive());
      const smaller = openArchiveBytes(
        zipOf({
          "json/organe/PO_G1.json": organeFile("PO_G1", { label: "Groupe un", abbreviation: "G1" }),
        })
      );
      const plan = await as("importer", async (c) => (await planImport(c, AMO30, smaller)).plan);
      expect(plan.status).toBe("BLOCKED_BY_REMOVAL_GUARD");
      await expect(importAs(AMO30, smaller)).rejects.toThrow(/BLOCKED_BY_REMOVAL_GUARD/);
      expect(
        (await owner.query(`SELECT count(*)::int AS n FROM "OfficialSourceSnapshot"`)).rows[0].n
      ).toBe(1);
    });

    it("sees a row changed behind its back: the verification names it", async () => {
      const archive = amo30Archive();
      await importAs(AMO30, archive);
      await owner.query(`ALTER TABLE "OfficialOrganRecord" DISABLE TRIGGER USER`);
      await owner.query(
        `UPDATE "OfficialOrganRecord" SET "label" = 'Altered' WHERE "organeRef" = 'PO_G1'`
      );
      const verdict = await as("reader", (c) => verifySnapshot(c, AMO30, 1, archive));
      expect(verdict.ok).toBe(false);
      expect(verdict.problems.join(" ")).toContain("rawHash");
      // The state hash is built from the stored raw hashes, which did not move: only the columns check sees it.
      expect(verdict.problems.join(" ")).not.toContain("state hash");
    });
  });

  // ------------------------------------------------------------------------------------------
  describe("the release", () => {
    it("is a human gesture: the importer cannot, and the owner needs the hash of a passing verification", async () => {
      const archive = amo30Archive();
      await importAs(AMO30, archive);
      await expect(
        as("importer", (c) =>
          c.query(
            `INSERT INTO "SnapshotDecision"("snapshotId","status","reason","decidedBy","decidedByKind") VALUES ('hg-AN_AMO30-1','RELEASED','x','x','HUMAN')`
          )
        )
      ).rejects.toThrow(/row-level security/);
      await expect(
        as("importer", (c) => releaseSnapshot(c, AMO30, 1, archive, "0".repeat(64), "x", "x"))
      ).rejects.toThrow(/human gesture/);
      await expect(
        as("owner", (c) => releaseSnapshot(c, AMO30, 1, archive, "0".repeat(64), "x", "x"))
      ).rejects.toThrow(/not the confirmed one/);
      await release(AMO30, 1, archive);
      const statuses = await owner.query(
        `SELECT "status","decidedByKind" FROM "SnapshotDecision" ORDER BY "decisionNo"`
      );
      expect(statuses.rows).toEqual([
        { status: "QUARANTINED", decidedByKind: "SCRIPT" },
        { status: "RELEASED", decidedByKind: "HUMAN" },
      ]);
    });
  });

  // ------------------------------------------------------------------------------------------
  describe("the run", () => {
    const amo = () => amo30Archive();
    async function prepare(scrutins: OpenedArchive) {
      const a = amo();
      await importAs(AMO30, a);
      await importAs(L16, scrutins);
      await release(AMO30, 1, a);
      await release(L16, 1, scrutins);
    }

    it("refuses a snapshot that is still QUARANTINED", async () => {
      const s = scrutinsArchive([{ id: "VTANR5L16V1" }]);
      await importAs(AMO30, amo());
      await importAs(L16, s);
      await expect(
        as("runner", (c) => assembleRun(c, 16, { amo30: 1, scrutins: 1 }))
      ).rejects.toThrow(/not RELEASED/);
    });

    it("resolves every vote from the evidence, writes the run, and replays to the same output hash", async () => {
      const s = scrutinsArchive([{ id: "VTANR5L16V1" }, { id: "VTANR5L16V2" }]);
      await prepare(s);
      const summary = await as("runner", async (c) => {
        const run = await assembleRun(c, 16, { amo30: 1, scrutins: 1 });
        return writeRun(c, run, execute(run), "test");
      });
      expect(summary.votes).toBe(6);
      expect(summary.statusCounts).toEqual({ ATTESTED_GROUP: 4, ATTESTED_NON_INSCRIT: 2 });
      expect(summary.levels).toEqual({ BOTH: 6 });
      // PO_G1 is a group of a coherent scrutin: shown. PO_NI is not a group: never shown.
      expect(summary.positions).toBe(4);
      expect(summary.publishablePositions).toBe(2);
      expect(summary.positionsByReason).toEqual({ NON_INSCRIT_IS_NOT_A_GROUP: 2 });
      const verdict = await as("reader", (c) => replayRun(c, summary.runId));
      expect(verdict).toMatchObject({
        ok: true,
        problems: [],
        recordedOutputHash: summary.outputHash,
        replayedOutputHash: summary.outputHash,
      });
    });

    it("never shows a position of a scrutin whose official counts disagree with its nominal lists", async () => {
      const s = scrutinsArchive([
        { id: "VTANR5L16V1" },
        { id: "VTANR5L16V2", official: { pour: 5, contre: 0, abstention: 0, nonVotant: 0 } },
      ]);
      await prepare(s);
      const summary = await as("runner", async (c) => {
        const run = await assembleRun(c, 16, { amo30: 1, scrutins: 1 });
        return writeRun(c, run, execute(run), "test");
      });
      expect(summary.positionsByReason["COUNT_MISMATCH"]).toBe(2);
      const shown = await owner.query(
        `SELECT "scrutinExternalId" FROM "ScrutinOrganPosition" WHERE "publishable"`
      );
      expect(shown.rows).toEqual([{ scrutinExternalId: "VTANR5L16V1" }]);
      // Even forced, the database refuses.
      await expect(
        as("runner", (c) =>
          c.query(
            `INSERT INTO "ScrutinOrganPosition"("runId","scrutinExternalId","organRef","organKind","forCount","againstCount","abstainCount","nonVoterCount","excludedCount","excludedByReason","publishable","reason") VALUES ($1,'VTANR5L16V2','PO_X','GROUP',1,0,0,0,0,'{}',true,NULL)`,
            [summary.runId]
          )
        )
      ).rejects.toThrow();
    });

    it("excludes a vote whose published organ disagrees with the interval record, and counts it", async () => {
      const s = scrutinsArchive([{ id: "VTANR5L16V1", contreAs: "PO_G1" }]);
      await prepare(s);
      const summary = await as("runner", async (c) => {
        const run = await assembleRun(c, 16, { amo30: 1, scrutins: 1 });
        return writeRun(c, run, execute(run), "test");
      });
      // PA2 is a registered NI member in the interval records but published under PO_G1.
      expect(summary.statusCounts["CONFLICT"]).toBe(1);
      expect(summary.exclusions).toBe(1);
      const stored = await owner.query(`SELECT "status","reason","officialId" FROM "RunExclusion"`);
      expect(stored.rows).toEqual([{ status: "CONFLICT", reason: "CONFLICT", officialId: "PA2" }]);
    });

    it("detects a recorded run that is not the one the evidence gives: wrong output hash, wrong input hash", async () => {
      const s = scrutinsArchive([{ id: "VTANR5L16V1" }]);
      await prepare(s);
      const summary = await as("runner", async (c) => {
        const run = await assembleRun(c, 16, { amo30: 1, scrutins: 1 });
        return writeRun(c, run, execute(run), "test");
      });
      await owner.query(`ALTER TABLE "HistoricalResolutionRun" DISABLE TRIGGER USER`);
      await owner.query(`UPDATE "HistoricalResolutionRun" SET "outputHash" = $1`, ["a".repeat(64)]);
      const wrongOutput = await as("reader", (c) => replayRun(c, summary.runId));
      expect(wrongOutput.ok).toBe(false);
      expect(wrongOutput.problems.join(" ")).toContain("output hash");
      await owner.query(`UPDATE "HistoricalResolutionRun" SET "inputHash" = $1`, ["b".repeat(64)]);
      const wrongInput = await as("reader", (c) => replayRun(c, summary.runId));
      expect(wrongInput.problems.join(" ")).toContain("input hash");
    });

    it("refuses to record the same run twice, and a run cannot be replayed by a wrong identifier", async () => {
      const s = scrutinsArchive([{ id: "VTANR5L16V1" }]);
      await prepare(s);
      await as("runner", async (c) => {
        const run = await assembleRun(c, 16, { amo30: 1, scrutins: 1 });
        await writeRun(c, run, execute(run), "test");
        await expect(writeRun(c, run, execute(run), "test")).rejects.toThrow(/already exists/);
      });
      expect(await as("reader", (c) => replayRun(c, "run-unknown"))).toMatchObject({ ok: false });
    });

    it("cannot write evidence, release, or delete as the runner", async () => {
      const s = scrutinsArchive([{ id: "VTANR5L16V1" }]);
      await prepare(s);
      await as("runner", async (c) => {
        await expect(c.query(`DELETE FROM "ScrutinOrganPosition"`)).rejects.toThrow(
          /permission denied/
        );
        await expect(
          c.query(
            `INSERT INTO "SnapshotDecision"("snapshotId","status","reason","decidedBy","decidedByKind") VALUES ('hg-AN_AMO30-1','REVOKED','x','x','HUMAN')`
          )
        ).rejects.toThrow();
        await expect(c.query(`UPDATE "OfficialActor" SET "toSeq" = 2`)).rejects.toThrow(
          /permission denied/
        );
      });
    });
  });
});
