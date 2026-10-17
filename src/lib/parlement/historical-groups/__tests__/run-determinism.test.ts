import { describe, expect, it } from "vitest";
import { GOLDEN_OUTPUT_HASHES } from "../__fixtures__/golden";
import {
  pinsFor,
  preparedFor,
  specFor,
  SCRUTIN_STATE_HASH,
  SCRUTIN_STREAM,
  stateHashAt,
  storeAfter,
  VOTES,
  CONTINUITY_JOURNAL,
} from "../__fixtures__/scenario";
import {
  checkRunnable,
  computeInputHash,
  defaultRunConfig,
  derivedRunStatus,
  RESOLVER_VERSION,
  snapshotStatusOf,
  type PinnedSnapshotState,
} from "../run-contract";
import { executeRun, type RunOutput } from "../run-execution";
import type { RunConfig, VotePosition } from "../types";

/**
 * A run on the synthetic scenario, before and after a retroactive correction of the evidence.
 *
 * Run 1 is computed on snapshot 1. Snapshot 2 then corrects two records, adds one and removes one,
 * and a continuity decision is validated. Run 2 is computed on snapshot 2 and the decision.
 *
 * Every test checks the business result (which vote resolved to what), not only a hash: a hash
 * proves two runs are the same, never that either of them is right.
 */

const store1 = storeAfter(1);
const store2 = storeAfter(2);

const pins1 = pinsFor(store1, 1, 0);
const pins2 = pinsFor(store2, 2, 1);

// Run 1 as it was computed, before snapshot 2 existed.
const run1 = executeRun(specFor(pins1), store1, preparedFor());
const run2 = executeRun(specFor(pins2), store2, preparedFor());

/** `STATUS:group:level:reason` for each vote, so that a whole run reads as one table. */
function summary(output: RunOutput): Record<string, string> {
  return Object.fromEntries(
    output.results.map((r) => [
      r.voteId,
      `${r.status}:${r.groupRef ?? "-"}:${r.level ?? "-"}:${r.reason ?? "-"}`,
    ])
  );
}

const EXPECTED_RUN1: Record<string, string> = {
  v01: "ATTESTED_NON_INSCRIT:PO_NI:INTERVAL_ONLY:-",
  v02: "ATTESTED_GROUP:PO_G1:BOTH:-",
  v03: "INSUFFICIENT:-:-:EDGE_DAY",
  v04: "CONFLICT:-:-:SOURCES_DISAGREE",
  v05: "ATTESTED_GROUP:PO_G1:BOTH:-",
  v06: "ATTESTED_GROUP:PO_G3:INTERVAL_ONLY:-",
  v07: "UNKNOWN:-:-:NO_RECORD",
  v08: "ATTESTED_GROUP:PO_G1:BOTH:-",
  v09: "INSUFFICIENT:-:-:END_STATE_UNKNOWN",
  v10: "ATTESTED_GROUP:PO_G1:SCRUTIN_ONLY:-",
  v11: "INSUFFICIENT:-:-:START_DATE_UNKNOWN",
  v12: "UNRESOLVED_IDENTITY:-:-:NO_OFFICIAL_ID",
  v13: "CONFLICT:-:-:SOURCES_DISAGREE",
  v14: "INSUFFICIENT:-:-:UNKNOWN_ORGAN",
  v15: "CONFLICT:-:-:MULTIPLE_ORGANS",
  v16: "INSUFFICIENT:-:-:PO0",
  v17: "ATTESTED_NON_INSCRIT:PO_NI:INTERVAL_ONLY:-",
  v18: "ATTESTED_GROUP:PO_G1:BOTH:-",
  v19: "ATTESTED_GROUP:PO_G2:INTERVAL_ONLY:-",
  v20: "INSUFFICIENT:-:-:OPEN_BEYOND_SNAPSHOT",
  // A valid interval agrees, an indeterminate one could not: the vote stands alone.
  v21: "ATTESTED_GROUP:PO_G1:SCRUTIN_ONLY:-",
};

// Run 2 differs from run 1 on four votes, and only those.
const EXPECTED_RUN2: Record<string, string> = {
  ...EXPECTED_RUN1,
  // The continuity decision: two references of one group, now read as one, said so.
  v04: "ATTESTED_GROUP:PO_G2B:BOTH:-",
  // c1: the corrected interval now disagrees with the vote.
  v05: "CONFLICT:-:-:SOURCES_DISAGREE",
  // c3: the record is gone. Unknown, not carried over from run 1.
  v06: "UNKNOWN:-:-:NO_RECORD",
  // c2: a record that did not exist now attests the group.
  v07: "ATTESTED_GROUP:PO_G1:INTERVAL_ONLY:-",
};

describe("business results of the scenario", () => {
  it("run 1 resolves each vote as expected", () => {
    expect(summary(run1)).toEqual(EXPECTED_RUN1);
  });

  it("run 2 resolves each vote as expected", () => {
    expect(summary(run2)).toEqual(EXPECTED_RUN2);
  });

  it("explains each answer: the proof of a vote names the records and the vote it rests on", () => {
    const v08 = run1.results.find((r) => r.voteId === "v08");
    expect(v08?.evidenceKeys).toEqual(["MEMBERSHIP:m06", "MEMBERSHIP:m07", "SCRUTIN:S8"]);
    const v04Run2 = run2.results.find((r) => r.voteId === "v04");
    expect(v04Run2?.viaLink).toBe("PO_G2>PO_G2B");
    expect(v04Run2?.evidenceKeys).toEqual(["MEMBERSHIP:m03", "SCRUTIN:S4"]);
    const v04Run1 = run1.results.find((r) => r.voteId === "v04");
    expect(v04Run1?.candidateRefs).toEqual(["INTERVAL:PO_G2", "SCRUTIN:PO_G2B"]);
    expect(v04Run1?.viaLink).toBeNull();
  });

  it("qualifies the non-registrations: transitional before the groups exist, not after", () => {
    const transitional = (output: RunOutput, id: string) =>
      output.results.find((r) => r.voteId === id)?.transitional;
    expect(transitional(run1, "v01")).toBe(true);
    expect(transitional(run1, "v17")).toBe(false);
  });

  it("leaves out exactly the votes that are not attested, under the rule that covers each reason", () => {
    expect(run1.exclusions).toEqual([
      { voteId: "v03", ruleId: "EDGE_DAY_NO_SCRUTIN", reason: "EDGE_DAY" },
      { voteId: "v04", ruleId: "SOURCES_DISAGREE", reason: "CONFLICT" },
      { voteId: "v07", ruleId: "NO_RECORD", reason: "NO_RECORD" },
      { voteId: "v09", ruleId: "DATE_UNDETERMINED", reason: "END_STATE_UNKNOWN" },
      { voteId: "v11", ruleId: "DATE_UNDETERMINED", reason: "START_DATE_UNKNOWN" },
      { voteId: "v12", ruleId: "IDENTITY_UNRESOLVED", reason: "NO_OFFICIAL_ID" },
      { voteId: "v13", ruleId: "SOURCES_DISAGREE", reason: "CONFLICT" },
      { voteId: "v14", ruleId: "PUBLISHED_ORGAN_UNKNOWN", reason: "UNKNOWN_ORGAN" },
      { voteId: "v15", ruleId: "SOURCES_DISAGREE", reason: "CONFLICT" },
      { voteId: "v16", ruleId: "PUBLISHED_ORGAN_UNKNOWN", reason: "PO0" },
      { voteId: "v20", ruleId: "OPEN_BEYOND_SNAPSHOT", reason: "OPEN_BEYOND_SNAPSHOT" },
    ]);
    expect(run2.exclusions.map((e) => e.voteId)).toEqual([
      "v03",
      "v05",
      "v06",
      "v09",
      "v11",
      "v12",
      "v13",
      "v14",
      "v15",
      "v16",
      "v20",
    ]);
  });

  it("counts attested votes under their group and left-out votes under the group the scrutin listed", () => {
    const tally = (output: RunOutput, scrutin: string, group: string | null) =>
      output.tallies.find((t) => t.scrutinId === scrutin && t.groupRef === group);
    // S2 has two attested votes and one left out (no official identifier), all listed under PO_G1.
    expect(tally(run1, "S2", "PO_G1")).toMatchObject({
      forCount: 1,
      againstCount: 1,
      abstainCount: 0,
      excludedCount: 1,
      excludedByReason: { NO_OFFICIAL_ID: 1 },
      organKind: "GROUP",
    });
    // A filler reference: counted nowhere as a group, kept as what the scrutin published.
    expect(tally(run1, "S16", "PO0")).toMatchObject({
      excludedCount: 1,
      excludedByReason: { PO0: 1 },
      forCount: 0,
      organKind: null,
    });
    // A non-voter is counted as a non-voter, under the non-registered organ, never as a group.
    expect(tally(run1, "S17", "PO_NI")).toMatchObject({
      nonVoterCount: 1,
      organKind: "NON_INSCRIT",
    });
    // No scrutin attestation and no attested group: nowhere to put the vote but the empty bucket.
    expect(tally(run1, "S3", null)).toMatchObject({ excludedCount: 1 });
    // Run 1 left v04 out under the organ it was listed under; run 2 attests it there.
    expect(tally(run1, "S4", "PO_G2B")).toMatchObject({ forCount: 0, excludedCount: 1 });
    expect(tally(run2, "S4", "PO_G2B")).toMatchObject({ forCount: 1, excludedCount: 0 });
  });

  it("loses no vote: every vote is attested or left out, in exactly one bucket", () => {
    for (const output of [run1, run2]) {
      const total = output.tallies.reduce(
        (sum, t) =>
          sum + t.forCount + t.againstCount + t.abstainCount + t.nonVoterCount + t.excludedCount,
        0
      );
      expect(total).toBe(VOTES.length);
      expect(output.results).toHaveLength(VOTES.length);
      const left = output.results.filter((r) => r.excludedBy !== null).length;
      expect(output.exclusions).toHaveLength(left);
      expect(output.tallies.reduce((sum, t) => sum + t.excludedCount, 0)).toBe(left);
    }
  });
});

describe("interval evidence that cannot be placed stays visible in the run", () => {
  const diagnostics = (output: RunOutput, id: string) =>
    output.results.find((r) => r.voteId === id)?.diagnostics;

  it("reports it on a vote that rests on the published vote alone", () => {
    // v10: the only record names the group of the vote, but its end is unknown: no threat.
    expect(diagnostics(run1, "v10")).toEqual([
      "E2_INDETERMINATE:m09:PO_G1:END_STATE_UNKNOWN:no-threat",
    ]);
    expect(diagnostics(run2, "v10")).toEqual(diagnostics(run1, "v10"));
  });

  it("withholds the corroboration and names both records when one could contradict the vote", () => {
    // v21: m18 agrees with the vote, m19 (another group, unknown end) could contradict it.
    expect(summary(run1).v21).toBe("ATTESTED_GROUP:PO_G1:SCRUTIN_ONLY:-");
    expect(diagnostics(run1, "v21")).toEqual([
      "E2_CORROBORATION_WITHHELD:m18",
      "E2_INDETERMINATE:m19:PO_G3:END_STATE_UNKNOWN:threat",
    ]);
  });

  it("reports nothing when nothing could not be placed", () => {
    for (const id of ["v02", "v08", "v18"]) expect(diagnostics(run1, id)).toEqual([]);
  });

  it("is part of the output: changing a diagnostic changes the hash of the run", () => {
    // v21 attested BOTH would not be the same run as v21 withheld: the level and the diagnostic
    // both differ, and the hash follows.
    const without = executeRun(
      specFor(
        pinsFor(
          store1,
          1,
          0,
          VOTES.filter((v) => v.voteId !== "v21")
        )
      ),
      store1,
      preparedFor(VOTES.filter((v) => v.voteId !== "v21"))
    );
    expect(without.outputHash).not.toBe(run1.outputHash);
  });
});

describe("T1: a retroactive correction does not change a run already computed", () => {
  it("snapshot 1 is still read as it was after snapshot 2 has been imported", () => {
    expect(stateHashAt(store2, 1)).toBe(stateHashAt(store1, 1));
    expect(stateHashAt(store2, 2)).not.toBe(stateHashAt(store1, 1));
  });

  it("replaying the inputs of run 1 on the corrected store gives the same results and the same hash", () => {
    const replay = executeRun(specFor(pins1), store2, preparedFor());
    expect(summary(replay)).toEqual(EXPECTED_RUN1);
    expect(replay.results).toEqual(run1.results);
    expect(replay.tallies).toEqual(run1.tallies);
    expect(replay.outputHash).toBe(run1.outputHash);
  });

  it("the replay ignores the decision that was added after run 1 (identical, v04 still a conflict)", () => {
    expect(CONTINUITY_JOURNAL).toHaveLength(1);
    const replay = executeRun(specFor(pins1), store2, preparedFor());
    expect(summary(replay).v04).toBe("CONFLICT:-:-:SOURCES_DISAGREE");
  });
});

describe("T2 to T5: what a new run changes, and nothing more", () => {
  it("T2: run 2 differs from run 1 on exactly the votes touched by the corrections", () => {
    const one = summary(run1);
    const two = summary(run2);
    const changed = Object.keys(one).filter((id) => one[id] !== two[id]);
    expect(changed).toEqual(["v04", "v05", "v06", "v07"]);
    // The full results agree on every other vote, evidence included.
    for (const result of run1.results.filter((r) => !changed.includes(r.voteId))) {
      expect(run2.results.find((r) => r.voteId === result.voteId)).toEqual(result);
    }
  });

  it("T3: a vote attested from a record that was removed becomes unknown, never carried over", () => {
    expect(summary(run1).v06).toBe("ATTESTED_GROUP:PO_G3:INTERVAL_ONLY:-");
    expect(summary(run2).v06).toBe("UNKNOWN:-:-:NO_RECORD");
    expect(run2.results.find((r) => r.voteId === "v06")?.groupRef).toBeNull();
  });

  it("T4: a correction that breaks an agreement makes it a conflict, never an attested group", () => {
    expect(summary(run1).v05).toBe("ATTESTED_GROUP:PO_G1:BOTH:-");
    const after = run2.results.find((r) => r.voteId === "v05");
    expect(after?.status).toBe("CONFLICT");
    expect(after?.groupRef).toBeNull();
    expect(after?.candidateRefs).toEqual(["INTERVAL:PO_G3", "SCRUTIN:PO_G1"]);
  });

  it("T5: the continuity decision acts on a run only through its cutoff, and only on the votes it concerns", () => {
    const withoutDecision = executeRun(specFor(pinsFor(store2, 1, 0)), store2, preparedFor());
    const withDecision = executeRun(specFor(pinsFor(store2, 1, 1)), store2, preparedFor());
    const a = summary(withoutDecision);
    const b = summary(withDecision);
    const changed = Object.keys(a).filter((id) => a[id] !== b[id]);
    expect(changed).toEqual(["v04"]);
    expect(b.v04).toBe("ATTESTED_GROUP:PO_G2B:BOTH:-");
    expect(withDecision.results.find((r) => r.voteId === "v04")?.viaLink).toBe("PO_G2>PO_G2B");
  });
});

describe("T7: the order of the inputs changes nothing", () => {
  it("gives the same results and the same hash with votes and records in another order", () => {
    const shuffled = {
      memberships: [...store2.memberships].reverse(),
      organs: [...store2.organs].reverse(),
      continuityJournal: [...store2.continuityJournal].reverse(),
    };
    const out = executeRun(specFor(pins2), shuffled, preparedFor([...VOTES].reverse()));
    expect(out.results).toEqual(run2.results);
    expect(out.tallies).toEqual(run2.tallies);
    expect(out.outputHash).toBe(run2.outputHash);
  });
});

describe("T8: another configuration is another run, and the first is untouched", () => {
  const noReconciliation = (): RunConfig => {
    const config = structuredClone(defaultRunConfig([16])) as RunConfig;
    (config.continuity as unknown as { relations: string[] }).relations = [];
    return config;
  };

  it("changes the identity of the run and the result of the votes it concerns", () => {
    const config = noReconciliation();
    expect(computeInputHash(pins2, config)).not.toBe(
      computeInputHash(pins2, defaultRunConfig([16]))
    );
    const other = executeRun(specFor(pins2, config), store2, preparedFor());
    expect(summary(other).v04).toBe("CONFLICT:-:-:SOURCES_DISAGREE");
    expect(other.outputHash).not.toBe(run2.outputHash);
    // Same pins, same evidence: the run that used the default configuration has not moved.
    expect(executeRun(specFor(pins2), store2, preparedFor()).outputHash).toBe(run2.outputHash);
    expect(summary(run2).v04).toBe("ATTESTED_GROUP:PO_G2B:BOTH:-");
  });

  it("gives run 1 and run 2 distinct identities", () => {
    expect(computeInputHash(pins1, defaultRunConfig([16]))).not.toBe(
      computeInputHash(pins2, defaultRunConfig([16]))
    );
  });
});

describe("T9: a run starts only on released, intact snapshots", () => {
  const stateOf = (seq: number, status: PinnedSnapshotState["status"]): PinnedSnapshotState => ({
    stream: "AN_AMO30",
    seq,
    status,
    recordedStateHash: stateHashAt(store2, seq),
    recomputedStateHash: stateHashAt(store2, seq),
  });
  // The second pinned stream, the one the attestations come from. Every pinned stream must pass.
  const scrutinStateOf = (status: PinnedSnapshotState["status"]): PinnedSnapshotState => ({
    stream: SCRUTIN_STREAM,
    seq: 1,
    status,
    recordedStateHash: SCRUTIN_STATE_HASH,
    recomputedStateHash: SCRUTIN_STATE_HASH,
  });

  it("refuses a snapshot that has no decision, then accepts it once released", () => {
    const held = snapshotStatusOf([]);
    expect(checkRunnable(pins2, [stateOf(2, held), scrutinStateOf("RELEASED")])).toEqual({
      ok: false,
      refusals: [{ stream: "AN_AMO30", reason: "NOT_RELEASED", status: "QUARANTINED" }],
    });
    const released = snapshotStatusOf([{ decisionNo: 1, status: "RELEASED" }]);
    expect(checkRunnable(pins2, [stateOf(2, released), scrutinStateOf("RELEASED")])).toEqual({
      ok: true,
    });
  });

  it("refuses a run whose attestation stream is not released, even when the evidence is", () => {
    expect(checkRunnable(pins2, [stateOf(2, "RELEASED"), scrutinStateOf("QUARANTINED")])).toEqual({
      ok: false,
      refusals: [{ stream: SCRUTIN_STREAM, reason: "NOT_RELEASED", status: "QUARANTINED" }],
    });
  });

  it("refuses a revoked snapshot, and a revocation invalidates run 2 but not run 1", () => {
    const revoked = snapshotStatusOf([
      { decisionNo: 1, status: "RELEASED" },
      { decisionNo: 2, status: "REVOKED" },
    ]);
    expect(checkRunnable(pins2, [stateOf(2, revoked), scrutinStateOf("RELEASED")])).toMatchObject({
      ok: false,
    });
    expect(derivedRunStatus([revoked, "RELEASED"])).toBe("INVALIDATED_BY_REVOCATION");
    expect(derivedRunStatus(["RELEASED", "RELEASED"])).toBe("OK");
    expect(checkRunnable(pins1, [stateOf(1, "RELEASED"), scrutinStateOf("RELEASED")])).toEqual({
      ok: true,
    });
  });
});

describe("a run does not start from nothing", () => {
  it("refuses a run that pins no snapshot of the evidence stream", () => {
    const pins = { ...pins2, snapshotPins: { OTHER: 1 }, snapshotStateHashes: { OTHER: "x" } };
    expect(() => executeRun(specFor(pins), store2, preparedFor())).toThrow("pins no snapshot");
  });

  it("refuses two votes with the same identifier", () => {
    expect(() => executeRun(specFor(pins2), store2, preparedFor([VOTES[0]!, VOTES[0]!]))).toThrow(
      "Duplicate voteId"
    );
  });

  it("refuses an invalid configuration", () => {
    const broken = structuredClone(defaultRunConfig([16])) as RunConfig;
    (broken.continuity as { sameLegislatureOnly: boolean }).sameLegislatureOnly = false;
    expect(() => executeRun(specFor(pins2, broken), store2, preparedFor())).toThrow(
      "Invalid run configuration"
    );
  });
});

describe("T14: the reference results fail when the logic changes without a new version", () => {
  it("has a reference entry for the current resolver version", () => {
    expect(GOLDEN_OUTPUT_HASHES[RESOLVER_VERSION]).toBeDefined();
  });

  it("reproduces the reference hash of both runs", () => {
    expect(run1.outputHash).toBe(GOLDEN_OUTPUT_HASHES[RESOLVER_VERSION]?.run1);
    expect(run2.outputHash).toBe(GOLDEN_OUTPUT_HASHES[RESOLVER_VERSION]?.run2);
  });

  it("would notice a single changed answer: the hash is sensitive to one vote", () => {
    const original = VOTES.find((vote) => vote.voteId === "v02")!;
    const flipped: VotePosition = original.position === "CONTRE" ? "POUR" : "CONTRE";
    expect(flipped).not.toBe(original.position);
    const moved = VOTES.map((vote) =>
      vote.voteId === "v02" ? { ...vote, position: flipped } : vote
    );
    const out = executeRun(specFor(pinsFor(store1, 1, 0, moved)), store1, preparedFor(moved));
    expect(out.outputHash).not.toBe(GOLDEN_OUTPUT_HASHES[RESOLVER_VERSION]?.run1);
  });
});
