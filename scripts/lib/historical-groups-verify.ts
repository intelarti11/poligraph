/**
 * Verification of a snapshot, and its release (lot 5D, PR B).
 *
 * `verifySnapshot` is read-only and never trusts what the import declared: it recomputes the raw
 * hash of every stored row from its columns, the state hash of the snapshot from the rows, compares
 * the row counts with `recordCounts`, and looks for orphans inside the stream. With the archive at
 * hand it also rebuilds the state hash from the archive itself: the database and the original agree
 * or the snapshot is not releasable.
 *
 * `releaseSnapshot` is the human gesture. It refuses to run as a role of the lot, requires the hash
 * of a verification that passed, and records a RELEASED decision made by a HUMAN.
 */
import { hashOf } from "@/lib/parlement/historical-groups/canonical";
import type pg from "pg";
import type { OpenedArchive } from "./historical-groups-archive";
import { snapshotAt, snapshotStatus } from "./historical-groups-db";
import { recomputeState } from "./historical-groups-import";
import { indexArchive } from "./historical-groups-snapshot";

export interface SnapshotVerification {
  stream: string;
  seq: number;
  ok: boolean;
  problems: string[];
  recordedStateHash: string | null;
  recomputedStateHash: string | null;
  archiveStateHash: string | null;
  rows: Record<string, number>;
  status: string | null;
}

const cover = (alias: string, seq: number) =>
  `${alias}."fromSeq" <= ${seq} AND (${alias}."toSeq" IS NULL OR ${alias}."toSeq" > ${seq})`;

async function count(client: pg.Client, sql: string, values: unknown[]): Promise<number> {
  const r = await client.query(sql, values);
  return Number((r.rows[0] as { n: string }).n);
}

/** Orphans inside a stream, at one snapshot. Every query counts rows that must not exist. */
async function orphanProblems(client: pg.Client, stream: string, seq: number): Promise<string[]> {
  const checks: [string, string][] =
    stream === "AN_AMO30"
      ? [
          [
            "group memberships naming an organ absent from the organs of the snapshot",
            `SELECT count(*) AS n FROM "GroupMembershipRecord" m WHERE m."stream" = $1 AND ${cover("m", seq)}
             AND NOT EXISTS (SELECT 1 FROM "OfficialOrganRecord" o WHERE o."stream" = m."stream" AND o."organeRef" = m."groupRef" AND ${cover("o", seq)})`,
          ],
          [
            "group memberships without an actor in the snapshot",
            `SELECT count(*) AS n FROM "GroupMembershipRecord" m WHERE m."stream" = $1 AND ${cover("m", seq)}
             AND NOT EXISTS (SELECT 1 FROM "OfficialActor" a WHERE a."stream" = m."stream" AND a."officialId" = m."officialId" AND ${cover("a", seq)})`,
          ],
          [
            "seat mandates without an actor in the snapshot",
            `SELECT count(*) AS n FROM "SeatMandateRecord" s WHERE s."stream" = $1 AND ${cover("s", seq)}
             AND NOT EXISTS (SELECT 1 FROM "OfficialActor" a WHERE a."stream" = s."stream" AND a."officialId" = s."officialId" AND ${cover("a", seq)})`,
          ],
        ]
      : [
          [
            "scrutins with attestations and no count check",
            `SELECT count(DISTINCT v."scrutinExternalId") AS n FROM "ScrutinVoterAttestation" v WHERE v."stream" = $1 AND ${cover("v", seq)}
             AND NOT EXISTS (SELECT 1 FROM "ScrutinCountCheck" c WHERE c."stream" = v."stream" AND c."scrutinExternalId" = v."scrutinExternalId" AND ${cover("c", seq)})`,
          ],
          [
            "group count checks of a scrutin without a count check",
            `SELECT count(*) AS n FROM "ScrutinGroupCountCheck" g WHERE g."stream" = $1 AND ${cover("g", seq)}
             AND NOT EXISTS (SELECT 1 FROM "ScrutinCountCheck" c WHERE c."stream" = g."stream" AND c."scrutinExternalId" = g."scrutinExternalId" AND ${cover("c", seq)})`,
          ],
          [
            "scrutins whose group count checks do not number the groupCount of the scrutin",
            `SELECT count(*) AS n FROM "ScrutinCountCheck" c WHERE c."stream" = $1 AND ${cover("c", seq)}
             AND c."groupCount" <> (SELECT count(*) FROM "ScrutinGroupCountCheck" g WHERE g."stream" = c."stream" AND g."scrutinExternalId" = c."scrutinExternalId" AND ${cover("g", seq)})`,
          ],
        ];
  const problems: string[] = [];
  for (const [label, sql] of checks) {
    const n = await count(client, sql, [stream]);
    if (n > 0) problems.push(`${n} ${label}`);
  }
  return problems;
}

export async function verifySnapshot(
  client: pg.Client,
  stream: string,
  seq: number,
  archive: OpenedArchive | null = null
): Promise<SnapshotVerification> {
  const snapshot = await snapshotAt(client, stream, seq);
  const problems: string[] = [];
  if (!snapshot) {
    return {
      stream,
      seq,
      ok: false,
      problems: ["no such snapshot"],
      recordedStateHash: null,
      recomputedStateHash: null,
      archiveStateHash: null,
      rows: {},
      status: null,
    };
  }
  if (snapshot.integrity !== "VERIFIED") problems.push(`integrity is ${snapshot.integrity}`);
  const back = await recomputeState(
    client,
    stream,
    seq,
    (p) => problems.length < 20 && problems.push(p)
  );
  if (back.stateHash !== snapshot.stateHash) {
    problems.push("the state hash recomputed from the rows is not the recorded one");
  }
  const declared = (snapshot.recordCounts as { rows?: Record<string, number> }).rows ?? {};
  for (const [kind, n] of Object.entries(back.rows)) {
    if (declared[kind] !== n)
      problems.push(`${kind}: ${n} rows stored, ${declared[kind]} declared`);
  }
  problems.push(...(await orphanProblems(client, stream, seq)));
  let archiveStateHash: string | null = null;
  if (archive) {
    archiveStateHash = indexArchive(stream, archive).stateHash;
    if (archive.sha256 !== snapshot.artifactSha256)
      problems.push("the archive is not the snapshot's artifact");
    if (archiveStateHash !== snapshot.stateHash) {
      problems.push("the state hash rebuilt from the archive is not the recorded one");
    }
  }
  return {
    stream,
    seq,
    ok: problems.length === 0,
    problems,
    recordedStateHash: snapshot.stateHash,
    recomputedStateHash: back.stateHash,
    archiveStateHash,
    rows: back.rows,
    status: await snapshotStatus(client, snapshot.id),
  };
}

export const verificationHash = (v: SnapshotVerification): string =>
  hashOf({
    stream: v.stream,
    seq: v.seq,
    ok: v.ok,
    problems: v.problems,
    stateHash: v.recordedStateHash,
    rows: v.rows,
  });

export async function releaseSnapshot(
  client: pg.Client,
  stream: string,
  seq: number,
  archive: OpenedArchive,
  confirm: string,
  reason: string,
  decidedBy: string
): Promise<void> {
  const who = await client.query(`SELECT current_user AS u`);
  if (["hg_importer", "hg_runner", "hg_reader"].includes((who.rows[0] as { u: string }).u)) {
    throw new Error("a release is a human gesture: it cannot be made with a role of the lot");
  }
  const verification = await verifySnapshot(client, stream, seq, archive);
  if (!verification.ok)
    throw new Error(`${stream}/${seq} does not verify: ${verification.problems.join("; ")}`);
  if (verification.status !== "QUARANTINED")
    throw new Error(`${stream}/${seq} is ${verification.status}, not QUARANTINED`);
  if (verificationHash(verification) !== confirm)
    throw new Error("the verification is not the confirmed one");
  const snapshot = await snapshotAt(client, stream, seq);
  await client.query(
    `INSERT INTO "SnapshotDecision"("snapshotId","status","reason","decidedBy","decidedByKind") VALUES ($1, 'RELEASED', $2, $3, 'HUMAN')`,
    [snapshot?.id, reason, decidedBy]
  );
}
