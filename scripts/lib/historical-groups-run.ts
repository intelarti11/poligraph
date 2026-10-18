/**
 * A historical run over released snapshots: assembly, execution, writing, replay (lot 5D, PR B).
 *
 * `assembleRun` reads the pinned snapshots from the database, recomputes the raw hash of every row
 * and the state hash of each snapshot (a run starts on content that still hashes to what was
 * recorded, `checkRunnable`), and turns the rows into the inputs of `executeRun`. `writeRun` records
 * the run, its pins, its exclusions and its positions in one transaction. `replayRun` rebuilds the
 * inputs from the database and executes again: the output hash must be the recorded one.
 *
 * Two state hashes are in play and both are kept. The database pin of a snapshot is its recorded
 * state hash (the foreign key of the pin table). The pin the run is identified by, for the evidence
 * stream, is the hash of the evidence the resolver reads (`evidenceStateHash`): it moves if any row
 * of that evidence moves. The votes are pinned by `preparedInputsHash`.
 *
 * Nothing here writes a position as publishable without the database agreeing: the guard of the
 * positions table checks the count coherence, the threshold and the organ again.
 */
import { hashOf } from "@/lib/parlement/historical-groups/canonical";
import { decidePositionPublication } from "@/lib/parlement/historical-groups/publication";
import {
  rawHashOf,
  stateHashOfRecords,
  type GroupMembershipRow,
  type HashedRecord,
  type OfficialOrganRow,
  type RecordKind,
  type RowOf,
  type ScrutinAttestationRow,
  type SeatMandateRow,
} from "@/lib/parlement/historical-groups/rows";
import { buildEvidenceStore, buildVote } from "@/lib/parlement/historical-groups/run-assembly";
import {
  computeInputHash,
  defaultRunConfig,
  hashDecisionsInForce,
  RESOLVER_VERSION,
  type RunPins,
} from "@/lib/parlement/historical-groups/run-contract";
import {
  evidenceStateHash,
  executeRun,
  withPreparedInputsHash,
  type EvidenceStore,
  type PreparedInputs,
  type RunOutput,
  type RunSpec,
  type RunVoteInput,
} from "@/lib/parlement/historical-groups/run-execution";
import type { CountCoherence, OpenBound, RunConfig } from "@/lib/parlement/historical-groups/types";
import { civilDate } from "@/lib/parlement/historical-groups/civil-date";
import type pg from "pg";
import {
  insertRows,
  kindsOfStream,
  readRecordsAt,
  snapshotAt,
  snapshotStatus,
  type SnapshotRow,
} from "./historical-groups-db";
import { AMO30_STREAM } from "./historical-groups-snapshot";

export interface LoadedSnapshot {
  snapshot: SnapshotRow;
  status: string;
  organs: OfficialOrganRow[];
  memberships: GroupMembershipRow[];
  seats: Map<string, SeatMandateRow>;
  votes: RunVoteInput[];
  coherence: Map<string, CountCoherence>;
}

export class RunRefusedError extends Error {
  constructor(detail: string) {
    super(`Run refused: ${detail}`);
    this.name = "RunRefusedError";
  }
}

/**
 * Reads one snapshot completely, checking as it goes. Every row's raw hash is recomputed from its
 * columns and the state hash of the whole snapshot is recomputed from the rows: a difference refuses
 * the run. Only what a run needs is kept: the evidence rows of the AMO30 stream, the votes (turned
 * into run inputs one by one) and the coherence of each scrutin.
 */
export async function loadSnapshot(
  client: pg.Client,
  stream: string,
  seq: number,
  seatsForVotes: ReadonlyMap<string, SeatMandateRow> | null
): Promise<LoadedSnapshot> {
  const snapshot = await snapshotAt(client, stream, seq);
  if (!snapshot) throw new RunRefusedError(`${stream}/${seq} does not exist`);
  const status = await snapshotStatus(client, snapshot.id);
  if (status !== "RELEASED")
    throw new RunRefusedError(`${stream}/${seq} is ${status}, not RELEASED`);
  if (snapshot.integrity !== "VERIFIED")
    throw new RunRefusedError(`${stream}/${seq} is not VERIFIED`);
  const loaded: LoadedSnapshot = {
    snapshot,
    status,
    organs: [],
    memberships: [],
    seats: new Map(),
    votes: [],
    coherence: new Map(),
  };
  const records: HashedRecord[] = [];
  for (const kind of kindsOfStream(stream)) {
    for await (const stored of readRecordsAt(client, stream, seq, kind)) {
      const row = stored.row as unknown as RowOf[typeof kind];
      if (rawHashOf(kind, row) !== stored.rawHash) {
        throw new RunRefusedError(
          `${stream}/${seq}: ${kind} ${stored.key} does not hash to its rawHash`
        );
      }
      records.push({ kind, key: stored.key, row: null as never, rawHash: stored.rawHash });
      switch (kind) {
        case "OFFICIAL_ORGAN":
          loaded.organs.push(row as OfficialOrganRow);
          break;
        case "GROUP_MEMBERSHIP":
          loaded.memberships.push(row as GroupMembershipRow);
          break;
        case "SEAT_MANDATE":
          loaded.seats.set((row as SeatMandateRow).sourceRecordId, row as SeatMandateRow);
          break;
        case "SCRUTIN_ATTESTATION":
          if (!seatsForVotes)
            throw new RunRefusedError("votes are read after the evidence snapshot");
          loaded.votes.push(buildVote(row as ScrutinAttestationRow, seatsForVotes));
          break;
        case "SCRUTIN_COUNT_CHECK": {
          const check = row as RowOf["SCRUTIN_COUNT_CHECK"];
          loaded.coherence.set(check.scrutinExternalId, check.countCoherence);
          break;
        }
        default:
          break;
      }
    }
  }
  if (stateHashOfRecords(records) !== snapshot.stateHash) {
    throw new RunRefusedError(
      `${stream}/${seq}: the rows no longer hash to the recorded state hash`
    );
  }
  return loaded;
}

/** The civil date, in France, of an instant: the bound of the open end dates of a file. */
export function parisCivilDate(instant: Date): ReturnType<typeof civilDate> {
  const text = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  return civilDate(text);
}

export interface AssembledRun {
  legislature: number;
  spec: RunSpec;
  store: EvidenceStore;
  inputs: PreparedInputs;
  config: RunConfig;
  inputHash: string;
  evidence: LoadedSnapshot;
  scrutins: LoadedSnapshot;
  unclassifiedOrgans: string[];
}

export async function assembleRun(
  client: pg.Client,
  legislature: number,
  seqs: { amo30: number; scrutins: number }
): Promise<AssembledRun> {
  const scrutinStream = `AN_SCRUTINS_L${legislature}`;
  const evidence = await loadSnapshot(client, AMO30_STREAM, seqs.amo30, null);
  const { store, unclassifiedOrgans } = buildEvidenceStore({
    seq: seqs.amo30,
    organs: evidence.organs,
    memberships: evidence.memberships,
  });
  const scrutins = await loadSnapshot(client, scrutinStream, seqs.scrutins, evidence.seats);
  if (evidence.snapshot.parserVersion !== scrutins.snapshot.parserVersion) {
    throw new RunRefusedError("the two snapshots were read by different parser versions");
  }
  if (evidence.snapshot.sourceAsOf === null) {
    throw new RunRefusedError(
      "the evidence snapshot has no sourceAsOf: the bound of open ends is unknown"
    );
  }
  const openBound: OpenBound = {
    date: parisCivilDate(new Date(evidence.snapshot.sourceAsOf)),
    source: "SOURCE_AS_OF",
  };
  const config = defaultRunConfig([legislature]);
  const pins: RunPins = withPreparedInputsHash(
    {
      snapshotPins: { [AMO30_STREAM]: seqs.amo30, [scrutinStream]: seqs.scrutins },
      snapshotStateHashes: {
        [AMO30_STREAM]: evidenceStateHash(store, seqs.amo30),
        [scrutinStream]: scrutins.snapshot.stateHash,
      },
      linkDecisionCutoff: 0,
      continuityDecisionCutoff: 0,
      decisionsHash: hashDecisionsInForce(new Map(), new Map()),
      parserVersion: evidence.snapshot.parserVersion,
      resolverVersion: RESOLVER_VERSION,
    },
    scrutins.votes,
    openBound
  );
  const spec: RunSpec = { config, pins, evidenceStream: AMO30_STREAM, openBound };
  const inputs: PreparedInputs = {
    votes: scrutins.votes,
    provenance: {
      snapshotPins: { [scrutinStream]: seqs.scrutins },
      snapshotStateHashes: { [scrutinStream]: scrutins.snapshot.stateHash },
      linkDecisionCutoff: 0,
      linkDecisionsInForce: new Map(),
    },
  };
  return {
    legislature,
    spec,
    store,
    inputs,
    config,
    inputHash: computeInputHash(pins, config),
    evidence,
    scrutins,
    unclassifiedOrgans,
  };
}

export const runIdOf = (inputHash: string): string => `run-${inputHash.slice(0, 16)}`;

// ---------------------------------------------------------------------------
// Positions and exclusions
// ---------------------------------------------------------------------------

export interface PositionRow {
  scrutinExternalId: string;
  organRef: string;
  organKind: string | null;
  forCount: number;
  againstCount: number;
  abstainCount: number;
  nonVoterCount: number;
  excludedCount: number;
  excludedByReason: Record<string, number>;
  publishable: boolean;
  reason: string | null;
}

export function positionsOf(run: AssembledRun, output: RunOutput): PositionRow[] {
  const rows: PositionRow[] = [];
  for (const tally of output.tallies) {
    if (tally.groupRef === null)
      throw new RunRefusedError(`${tally.scrutinId}: a tally with no organ`);
    const coherence = run.scrutins.coherence.get(tally.scrutinId) ?? null;
    const decision = decidePositionPublication(tally, run.config.publication, coherence);
    rows.push({
      scrutinExternalId: tally.scrutinId,
      organRef: tally.groupRef,
      organKind: tally.organKind,
      forCount: tally.forCount,
      againstCount: tally.againstCount,
      abstainCount: tally.abstainCount,
      nonVoterCount: tally.nonVoterCount,
      excludedCount: tally.excludedCount,
      excludedByReason: tally.excludedByReason as Record<string, number>,
      publishable: decision.publishable,
      reason: decision.publishable ? null : decision.reason,
    });
  }
  return rows;
}

export interface RunSummary {
  legislature: number;
  runId: string;
  inputHash: string;
  outputHash: string;
  votes: number;
  statusCounts: Record<string, number>;
  levels: Record<string, number>;
  reasons: Record<string, number>;
  exclusions: number;
  positions: number;
  publishablePositions: number;
  positionsByReason: Record<string, number>;
  unclassifiedOrgans: string[];
}

export function summarize(
  run: AssembledRun,
  output: RunOutput,
  positions: PositionRow[]
): RunSummary {
  const levels: Record<string, number> = {};
  const reasons: Record<string, number> = {};
  for (const r of output.results) {
    if (r.level) levels[r.level] = (levels[r.level] ?? 0) + 1;
    if (r.reason)
      reasons[`${r.status}:${r.reason}`] = (reasons[`${r.status}:${r.reason}`] ?? 0) + 1;
  }
  const positionsByReason: Record<string, number> = {};
  for (const p of positions)
    if (p.reason) positionsByReason[p.reason] = (positionsByReason[p.reason] ?? 0) + 1;
  return {
    legislature: run.legislature,
    runId: runIdOf(run.inputHash),
    inputHash: run.inputHash,
    outputHash: output.outputHash,
    votes: run.inputs.votes.length,
    statusCounts: output.statusCounts as Record<string, number>,
    levels,
    reasons,
    exclusions: output.exclusions.length,
    positions: positions.length,
    publishablePositions: positions.filter((p) => p.publishable).length,
    positionsByReason,
    unclassifiedOrgans: run.unclassifiedOrgans,
  };
}

export async function writeRun(
  client: pg.Client,
  run: AssembledRun,
  output: RunOutput,
  codeVersion: string
): Promise<RunSummary> {
  const positions = positionsOf(run, output);
  const runId = runIdOf(run.inputHash);
  const { pins, config } = run.spec;
  await client.query("BEGIN");
  try {
    const existing = await client.query(
      `SELECT 1 FROM "HistoricalResolutionRun" WHERE "inputHash" = $1`,
      [run.inputHash]
    );
    if (existing.rowCount)
      throw new RunRefusedError(`a run with this input hash already exists (${runId})`);
    await client.query(
      `INSERT INTO "HistoricalResolutionRun"("id","inputHash","status","linkDecisionCutoff","continuityDecisionCutoff","decisionsHash","preparedInputsHash","parserVersion","resolverVersion","dateSemanticsVersion","exclusionRulesVersion","configHash","config","codeVersion","startedBy","startedAt")
       VALUES ($1,$2,'RUNNING',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,'run-historical',now())`,
      [
        runId,
        run.inputHash,
        pins.linkDecisionCutoff,
        pins.continuityDecisionCutoff,
        pins.decisionsHash,
        pins.preparedInputsHash,
        pins.parserVersion,
        pins.resolverVersion,
        config.dateSemantics.version,
        config.exclusion.version,
        hashOf(config),
        JSON.stringify(config),
        codeVersion,
      ]
    );
    for (const loaded of [run.evidence, run.scrutins]) {
      await client.query(
        `INSERT INTO "HistoricalRunSnapshotPin"("runId","stream","seq","stateHash") VALUES ($1,$2,$3,$4)`,
        [runId, loaded.snapshot.stream, loaded.snapshot.seq, loaded.snapshot.stateHash]
      );
    }
    const byVote = new Map(output.results.map((r) => [r.voteId, r]));
    const exclusionRows = output.exclusions.map((e) => {
      const result = byVote.get(e.voteId);
      if (!result) throw new RunRefusedError(`exclusion of an unknown vote ${e.voteId}`);
      const [scrutin, official] = e.voteId.split("|") as [string, string];
      return [
        runId,
        scrutin,
        official,
        result.status,
        e.reason,
        JSON.stringify({
          ruleId: e.ruleId,
          candidateRefs: result.candidateRefs,
          evidenceKeys: result.evidenceKeys,
          diagnostics: result.diagnostics,
        }),
      ];
    });
    await insertRows(
      client,
      "RunExclusion",
      ["runId", "scrutinExternalId", "officialId", "status", "reason", "evidence"],
      exclusionRows
    );
    await insertRows(
      client,
      "ScrutinOrganPosition",
      [
        "runId",
        "scrutinExternalId",
        "organRef",
        "organKind",
        "forCount",
        "againstCount",
        "abstainCount",
        "nonVoterCount",
        "excludedCount",
        "excludedByReason",
        "publishable",
        "reason",
      ],
      positions.map((p) => [
        runId,
        p.scrutinExternalId,
        p.organRef,
        p.organKind,
        p.forCount,
        p.againstCount,
        p.abstainCount,
        p.nonVoterCount,
        p.excludedCount,
        JSON.stringify(p.excludedByReason),
        p.publishable,
        p.reason,
      ])
    );
    await client.query(
      `UPDATE "HistoricalResolutionRun" SET "status" = 'COMPLETED', "outputHash" = $2, "statusCounts" = $3::jsonb, "finishedAt" = now() WHERE "id" = $1`,
      [runId, output.outputHash, JSON.stringify(output.statusCounts)]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return summarize(run, output, positions);
}

export function execute(run: AssembledRun): RunOutput {
  return executeRun(run.spec, run.store, run.inputs);
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export interface ReplayVerdict {
  runId: string;
  ok: boolean;
  problems: string[];
  recordedOutputHash: string | null;
  replayedOutputHash: string | null;
}

/**
 * Rebuilds the inputs of a recorded run from the database and executes it again. The run is the same
 * only if the input hash, the output hash, the status counts and the stored exclusions and positions
 * all agree with what the replay produces.
 */
export async function replayRun(client: pg.Client, runId: string): Promise<ReplayVerdict> {
  const problems: string[] = [];
  const row = await client.query(
    `SELECT "inputHash","outputHash","statusCounts","status","linkDecisionCutoff","continuityDecisionCutoff","config" FROM "HistoricalResolutionRun" WHERE "id" = $1`,
    [runId]
  );
  const recorded = row.rows[0] as
    | {
        inputHash: string;
        outputHash: string | null;
        statusCounts: unknown;
        status: string;
        linkDecisionCutoff: string;
        continuityDecisionCutoff: string;
        config: RunConfig;
      }
    | undefined;
  if (!recorded)
    return {
      runId,
      ok: false,
      problems: ["no such run"],
      recordedOutputHash: null,
      replayedOutputHash: null,
    };
  if (recorded.status !== "COMPLETED") problems.push(`status is ${recorded.status}`);
  if (
    Number(recorded.linkDecisionCutoff) !== 0 ||
    Number(recorded.continuityDecisionCutoff) !== 0
  ) {
    problems.push("decision cutoffs other than 0 are not replayable by this tool");
  }
  const pins = await client.query(
    `SELECT "stream","seq" FROM "HistoricalRunSnapshotPin" WHERE "runId" = $1`,
    [runId]
  );
  const seqOf = new Map(
    (pins.rows as { stream: string; seq: number }[]).map((p) => [p.stream, p.seq])
  );
  const scrutinStream = [...seqOf.keys()].find((s) => s.startsWith("AN_SCRUTINS_"));
  const amo = seqOf.get(AMO30_STREAM);
  if (!scrutinStream || amo === undefined) {
    return {
      runId,
      ok: false,
      problems: [...problems, "the run does not pin the expected streams"],
      recordedOutputHash: recorded.outputHash,
      replayedOutputHash: null,
    };
  }
  const legislature = Number(scrutinStream.slice("AN_SCRUTINS_L".length));
  let replayed: string | null = null;
  try {
    const assembled = await assembleRun(client, legislature, {
      amo30: amo,
      scrutins: seqOf.get(scrutinStream) as number,
    });
    if (assembled.inputHash !== recorded.inputHash)
      problems.push("the input hash rebuilt from the database is not the recorded one");
    const output = execute(assembled);
    replayed = output.outputHash;
    if (output.outputHash !== recorded.outputHash)
      problems.push("the output hash of the replay is not the recorded one");
    if (hashOf(output.statusCounts) !== hashOf(recorded.statusCounts))
      problems.push("the status counts differ");
    const stored = await client.query(
      `SELECT (SELECT count(*) FROM "RunExclusion" WHERE "runId" = $1) AS exclusions,
              (SELECT count(*) FROM "ScrutinOrganPosition" WHERE "runId" = $1) AS positions,
              (SELECT count(*) FROM "ScrutinOrganPosition" WHERE "runId" = $1 AND "publishable") AS publishable`,
      [runId]
    );
    const s = stored.rows[0] as { exclusions: string; positions: string; publishable: string };
    const positions = positionsOf(assembled, output);
    if (Number(s.exclusions) !== output.exclusions.length)
      problems.push("the stored exclusions are not the replayed ones");
    if (Number(s.positions) !== positions.length)
      problems.push("the stored positions are not the replayed ones");
    if (Number(s.publishable) !== positions.filter((p) => p.publishable).length) {
      problems.push("the stored publishable positions are not the replayed ones");
    }
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  return {
    runId,
    ok: problems.length === 0,
    problems,
    recordedOutputHash: recorded.outputHash,
    replayedOutputHash: replayed,
  };
}
