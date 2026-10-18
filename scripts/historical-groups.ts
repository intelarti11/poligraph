/**
 * Historical group tools (lot 5D, PR B). Local disposable database only.
 *
 *   import          --stream S [--apply --confirm <plan hash>]      (role hg_importer)
 *   verify          --stream S --seq N [--with-archive]             (role hg_reader)
 *   release         --stream S --seq N --confirm <hash> --reason T --by NAME   (owner, human gesture)
 *   run             --legislature N [--apply]                       (role hg_runner)
 *   verify-run      --run ID                                        (role hg_reader)
 *
 * Connection URLs come from HG_URL_IMPORTER, HG_URL_READER, HG_URL_OWNER (and HG_URL_RUNNER for runs),
 * the archives from HG_ARCHIVE_DIR (the folder holding manifest.json). Nothing is read from
 * DATABASE_URL or DIRECT_URL, and a URL that is not the disposable local database is refused.
 * `import` without --apply writes nothing: it prints the plan and its hash.
 */
import {
  applyImport,
  openVerified,
  planHashOf,
  planImport,
  readManifest,
  type ManifestEntry,
} from "./lib/historical-groups-import";
import {
  BASELINE_FILE,
  crossCheck,
  readBaselineLegislature,
} from "./lib/historical-groups-crosscheck";
import { connectDisposable, type ToolRole } from "./lib/historical-groups-db";
import { releaseSnapshot, verificationHash, verifySnapshot } from "./lib/historical-groups-verify";
import {
  assembleRun,
  execute,
  positionsOf,
  replayRun,
  summarize,
  writeRun,
} from "./lib/historical-groups-run";
import { execFileSync } from "node:child_process";
import type pg from "pg";

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}
const flag = (args: string[], name: string) => args.includes(`--${name}`);

function urlFor(role: ToolRole): string {
  const name = `HG_URL_${role.toUpperCase()}`;
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function archiveDir(): string {
  const dir = process.env["HG_ARCHIVE_DIR"];
  if (!dir) throw new Error("HG_ARCHIVE_DIR is not set");
  return dir;
}

function entryFor(stream: string): ManifestEntry {
  const entry = readManifest(archiveDir()).find((e) => e.stream === stream);
  if (!entry) throw new Error(`no archive for ${stream} in the manifest`);
  return entry;
}

async function latestReleasedSeq(client: pg.Client, stream: string): Promise<number> {
  const r = await client.query(
    `SELECT s."seq" FROM "OfficialSourceSnapshot" s
     WHERE s."stream" = $1 AND EXISTS (SELECT 1 FROM "SnapshotDecision" d WHERE d."snapshotId" = s."id" AND d."status" = 'RELEASED')
     ORDER BY s."seq" DESC LIMIT 1`,
    [stream]
  );
  if (r.rowCount === 0) throw new Error(`${stream}: no released snapshot`);
  return (r.rows[0] as { seq: number }).seq;
}

const log = (line: string) => process.stderr.write(`${line}\n`);

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const stream = option(args, "stream");
  if (command === "import") {
    if (!stream) throw new Error("--stream is required");
    const entry = entryFor(stream);
    const archive = openVerified(archiveDir(), entry);
    const client = await connectDisposable(urlFor("importer"), "importer");
    try {
      if (!flag(args, "apply")) {
        await client.query("BEGIN READ ONLY");
        const { plan } = await planImport(client, stream, archive);
        await client.query("ROLLBACK");
        console.log(JSON.stringify({ plan, planHash: planHashOf(plan) }, null, 2));
        return;
      }
      const confirm = option(args, "confirm");
      if (!confirm) throw new Error("--apply needs --confirm <plan hash>");
      console.log(
        JSON.stringify(await applyImport(client, stream, archive, entry, confirm, log), null, 2)
      );
    } finally {
      await client.end();
    }
    return;
  }
  if (command === "verify" || command === "release") {
    const seq = Number(option(args, "seq"));
    if (!stream || !Number.isInteger(seq)) throw new Error("--stream and --seq are required");
    const archive =
      flag(args, "with-archive") || command === "release"
        ? openVerified(archiveDir(), entryFor(stream))
        : null;
    const client = await connectDisposable(
      urlFor(command === "verify" ? "reader" : "owner"),
      command === "verify" ? "reader" : "owner"
    );
    try {
      if (command === "verify") {
        const v = await verifySnapshot(client, stream, seq, archive);
        console.log(JSON.stringify({ ...v, verificationHash: verificationHash(v) }, null, 2));
        process.exitCode = v.ok ? 0 : 1;
        return;
      }
      const confirm = option(args, "confirm");
      const reason = option(args, "reason");
      const by = option(args, "by");
      if (!archive || !confirm || !reason || !by)
        throw new Error("release needs --confirm, --reason and --by");
      await releaseSnapshot(client, stream, seq, archive, confirm, reason, by);
      console.log(JSON.stringify({ released: { stream, seq } }));
    } finally {
      await client.end();
    }
    return;
  }
  if (command === "run") {
    const legislature = Number(option(args, "legislature"));
    if (!Number.isInteger(legislature)) throw new Error("--legislature is required");
    const client = await connectDisposable(urlFor("runner"), "runner");
    try {
      const amo30 = await latestReleasedSeq(client, "AN_AMO30");
      const scrutins = await latestReleasedSeq(client, `AN_SCRUTINS_L${legislature}`);
      const started = Date.now();
      const run = await assembleRun(client, legislature, { amo30, scrutins });
      log(`assembled in ${Date.now() - started} ms (${run.inputs.votes.length} votes)`);
      const output = execute(run);
      log(`executed in ${Date.now() - started} ms`);
      const cross = (summary: ReturnType<typeof summarize>) =>
        crossCheck(summary, readBaselineLegislature(BASELINE_FILE, legislature));
      if (!flag(args, "apply")) {
        const summary = summarize(run, output, positionsOf(run, output));
        const reconciliation = cross(summary);
        console.log(JSON.stringify({ ...summary, crossCheck: reconciliation }, null, 2));
        process.exitCode = reconciliation.every((i) => i.equal) ? 0 : 1;
        return;
      }
      const codeVersion = execFileSync("git", ["rev-parse", "HEAD"]).toString().trim();
      const summary = await writeRun(client, run, output, codeVersion);
      const reconciliation = cross(summary);
      console.log(
        JSON.stringify(
          { ...summary, crossCheck: reconciliation, millis: Date.now() - started },
          null,
          2
        )
      );
      process.exitCode = reconciliation.every((i) => i.equal) ? 0 : 1;
    } finally {
      await client.end();
    }
    return;
  }
  if (command === "verify-run") {
    const runId = option(args, "run");
    if (!runId) throw new Error("--run is required");
    const client = await connectDisposable(urlFor("reader"), "reader");
    try {
      const verdict = await replayRun(client, runId);
      console.log(JSON.stringify(verdict, null, 2));
      process.exitCode = verdict.ok ? 0 : 1;
    } finally {
      await client.end();
    }
    return;
  }
  throw new Error(`unknown command: ${command ?? "(none)"}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
