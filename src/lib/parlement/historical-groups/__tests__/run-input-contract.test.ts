import { describe, expect, it } from "vitest";
import {
  defaultRunConfig,
  isIdenticalReplay,
  RESOLVER_VERSION,
  runDifferences,
} from "../run-contract";
import {
  checkRunInputs,
  computePreparedInputsHash,
  executeRun,
  RunInputContractError,
  type PreparedInputs,
  type RunVoteInput,
} from "../run-execution";
import { applySnapshot, type RecordVersion } from "../versioning";
import { d, membership, OPEN_BOUND, ref, resolved } from "../__fixtures__/builders";
import {
  MEMBERSHIPS_S2,
  membershipRecords,
  pinsFor,
  preparedFor,
  SCRUTIN_STATE_HASH,
  SCRUTIN_STREAM,
  specFor,
  STREAM,
  storeAfter,
  VOTES,
} from "../__fixtures__/scenario";
import type { GroupMembershipEvidence } from "../types";

/**
 * The input contract of `executeRun`.
 *
 * The evidence store is read through the pins and verified. The votes, identities and attestations
 * are prepared by the layer that will assemble a run, which `executeRun` cannot observe. So they
 * come with a provenance declaration and a hash, both checked against the pins. These tests make
 * sure a change that is not pinned can never pass for an identical replay.
 */

const store1 = storeAfter(1);
const store2 = storeAfter(2);
const config = defaultRunConfig([16]);
const pins2 = pinsFor(store2, 2, 1);
const spec2 = specFor(pins2);

const voteById = (id: string): RunVoteInput => VOTES.find((v) => v.voteId === id) as RunVoteInput;
const replaceVote = (id: string, change: Partial<RunVoteInput>): RunVoteInput[] =>
  VOTES.map((vote) => (vote.voteId === id ? { ...vote, ...change } : vote));

describe("honest inputs", () => {
  it("are accepted: the store, the declaration and the votes are the ones the pins designate", () => {
    expect(checkRunInputs(spec2, store2, preparedFor())).toEqual([]);
    expect(() => executeRun(spec2, store2, preparedFor())).not.toThrow();
  });

  it("are accepted for a replay of an older run on a store that has moved on", () => {
    const pins1 = pinsFor(store1, 1, 0);
    expect(checkRunInputs(specFor(pins1), store2, preparedFor())).toEqual([]);
  });

  it("are accepted when a later snapshot and a later decision exist that the run is not pinned on", () => {
    const later = applySnapshot(
      store2.memberships,
      membershipRecords([
        ...MEMBERSHIPS_S2,
        membership("m99", "PA_T20", "PO_G1", "2023-01-01", "OPEN"),
      ]),
      3
    ).versions;
    const store = {
      ...store2,
      memberships: later,
      continuityJournal: [
        ...store2.continuityJournal,
        {
          decisionNo: 2,
          key: "PO_G1|PO_G3|NOT_RELATED",
          value: {
            fromOrganRef: ref("PO_G1"),
            toOrganRef: ref("PO_G3"),
            relation: "NOT_RELATED" as const,
            status: "VALIDATED" as const,
          },
        },
      ],
    };
    expect(checkRunInputs(spec2, store, preparedFor())).toEqual([]);
  });
});

describe("a prepared input that was changed after the pins were computed is refused", () => {
  const changes: [string, RunVoteInput[]][] = [
    ["an identity resolved otherwise", replaceVote("v12", { identity: resolved("PA_T01") })],
    [
      "an attestation naming another organ",
      replaceVote("v02", {
        attestation: { publishedOrganRef: ref("PO_G3"), seatMandate: null },
      }),
    ],
    ["a position", replaceVote("v02", { position: "POUR" })],
    ["a day", replaceVote("v06", { civilDate: d("2022-12-01") })],
    ["a vote removed", VOTES.filter((v) => v.voteId !== "v18")],
    ["a vote added", [...VOTES, { ...voteById("v18"), voteId: "v99" }]],
  ];

  it.each(changes)("%s", (_label, votes) => {
    expect(checkRunInputs(spec2, store2, preparedFor(votes))).toEqual([
      "PREPARED_INPUTS_HASH_MISMATCH",
    ]);
    expect(() => executeRun(spec2, store2, preparedFor(votes))).toThrow(RunInputContractError);
  });

  it("is refused with the list of violations on the error, and no partial output", () => {
    try {
      executeRun(spec2, store2, preparedFor(replaceVote("v02", { position: "POUR" })));
      expect.unreachable("executeRun should have refused");
    } catch (error) {
      expect(error).toBeInstanceOf(RunInputContractError);
      expect((error as RunInputContractError).violations).toEqual([
        "PREPARED_INPUTS_HASH_MISMATCH",
      ]);
    }
  });

  it("is refused when the bound of open end dates is not the one the pins were computed with", () => {
    const other = { ...spec2, openBound: { ...OPEN_BOUND, date: d("2026-10-18") } };
    expect(checkRunInputs(other, store2, preparedFor())).toEqual(["PREPARED_INPUTS_HASH_MISMATCH"]);
  });

  it("does not depend on the order of the votes", () => {
    expect(computePreparedInputsHash([...VOTES].reverse(), OPEN_BOUND)).toBe(
      computePreparedInputsHash(VOTES, OPEN_BOUND)
    );
    expect(checkRunInputs(spec2, store2, preparedFor([...VOTES].reverse()))).toEqual([]);
  });
});

describe("a change made before the pins are computed is another run, never a replay", () => {
  const before = { pins: pins2, config };

  it.each([
    ["an identity resolved otherwise", replaceVote("v12", { identity: resolved("PA_T01") })],
    [
      "an attestation naming another organ",
      replaceVote("v02", {
        attestation: { publishedOrganRef: ref("PO_G3"), seatMandate: null },
      }),
    ],
    ["a position", replaceVote("v02", { position: "POUR" })],
    ["a vote removed", VOTES.filter((v) => v.voteId !== "v18")],
  ])("%s", (_label, votes) => {
    const repinned = pinsFor(store2, 2, 1, votes);
    // Honestly re-pinned inputs are valid for the new pins...
    expect(checkRunInputs(specFor(repinned), store2, preparedFor(votes))).toEqual([]);
    // ...and the run is not the previous one, whatever else stayed the same.
    expect(runDifferences(before, { pins: repinned, config })).toEqual(["preparedInputsHash"]);
    expect(isIdenticalReplay(before, { pins: repinned, config })).toBe(false);
    const previous = executeRun(spec2, store2, preparedFor());
    const next = executeRun(specFor(repinned), store2, preparedFor(votes));
    expect(next.outputHash).not.toBe(previous.outputHash);
  });

  it("is an identical replay only when nothing pinned has changed", () => {
    expect(isIdenticalReplay(before, { pins: pinsFor(store2, 2, 1), config })).toBe(true);
    expect(runDifferences(before, { pins: pinsFor(store2, 2, 1), config })).toEqual([]);
  });

  it("is told apart from a change of snapshot or of decision cutoff", () => {
    expect(runDifferences(before, { pins: pinsFor(store2, 1, 1), config })).toEqual(
      expect.arrayContaining([`snapshotPins:${STREAM}`, `snapshotStateHashes:${STREAM}`])
    );
    expect(runDifferences(before, { pins: pinsFor(store2, 2, 0), config })).toEqual(
      expect.arrayContaining(["continuityDecisionCutoff", "decisionsHash"])
    );
  });
});

describe("the declaration of the assembling layer must match the pins", () => {
  const declared = (change: Partial<PreparedInputs["provenance"]>): PreparedInputs => {
    const honest = preparedFor();
    return { ...honest, provenance: { ...honest.provenance, ...change } };
  };

  it.each<[string, Partial<PreparedInputs["provenance"]>, string]>([
    [
      "a pinned stream it does not declare",
      { snapshotPins: {}, snapshotStateHashes: {} },
      `PROVENANCE_STREAM_MISSING:${SCRUTIN_STREAM}`,
    ],
    [
      "a stream the run is not pinned on",
      {
        snapshotPins: { [SCRUTIN_STREAM]: 1, AN_SCRUTINS_L17: 1 },
        snapshotStateHashes: { [SCRUTIN_STREAM]: SCRUTIN_STATE_HASH, AN_SCRUTINS_L17: "x" },
      },
      "PROVENANCE_STREAM_NOT_PINNED:AN_SCRUTINS_L17",
    ],
    [
      "another snapshot of a pinned stream",
      { snapshotPins: { [SCRUTIN_STREAM]: 2 } },
      `PROVENANCE_SNAPSHOT_MISMATCH:${SCRUTIN_STREAM}`,
    ],
    [
      "another state hash for a pinned snapshot",
      { snapshotStateHashes: { [SCRUTIN_STREAM]: "another-hash" } },
      `PROVENANCE_STATE_HASH_MISMATCH:${SCRUTIN_STREAM}`,
    ],
    ["another identity cutoff", { linkDecisionCutoff: 3 }, "LINK_CUTOFF_MISMATCH"],
    [
      "identity decisions that are not the ones the pins hashed",
      { linkDecisionsInForce: new Map([["PA_T01", "LINKED_MANUAL"]]) },
      "DECISIONS_HASH_MISMATCH",
    ],
  ])("refuses %s", (_label, change, code) => {
    expect(checkRunInputs(spec2, store2, declared(change))).toEqual([code]);
    expect(() => executeRun(spec2, store2, declared(change))).toThrow(RunInputContractError);
  });
});

describe("the evidence store must be what the pins designate", () => {
  it("refuses a record whose content no longer matches its hash", () => {
    const tampered: RecordVersion<GroupMembershipEvidence>[] = store2.memberships.map((v) =>
      v.key === "m02" ? { ...v, value: { ...v.value, groupRef: ref("PO_G3") } } : v
    );
    expect(checkRunInputs(spec2, { ...store2, memberships: tampered }, preparedFor())).toEqual([
      "RECORD_HASH_MISMATCH:membership:m02",
    ]);
  });

  it("refuses a store that lost a record the pinned snapshot held", () => {
    const missing = store2.memberships.filter((v) => v.key !== "m02");
    expect(checkRunInputs(spec2, { ...store2, memberships: missing }, preparedFor())).toEqual([
      `PINNED_STATE_HASH_MISMATCH:${STREAM}`,
    ]);
  });

  it("refuses a store read at another snapshot than the one pinned", () => {
    expect(checkRunInputs(spec2, store1, preparedFor())).toEqual([
      `PINNED_STATE_HASH_MISMATCH:${STREAM}`,
    ]);
  });

  it("refuses a continuity decision that was revised after the pins were computed", () => {
    const revised = store2.continuityJournal.map((entry) =>
      entry.decisionNo === 1
        ? { ...entry, value: { ...entry.value, status: "REJECTED" as const } }
        : entry
    );
    expect(checkRunInputs(spec2, { ...store2, continuityJournal: revised }, preparedFor())).toEqual(
      ["DECISIONS_HASH_MISMATCH"]
    );
  });
});

describe("a run pinned on other logic is not replayed by this one", () => {
  it("refuses pins that name another resolver version", () => {
    const pins = { ...pinsFor(store2, 2, 1), resolverVersion: "1" };
    expect(checkRunInputs(specFor(pins), store2, preparedFor())).toEqual([
      `RESOLVER_VERSION_MISMATCH:1!=${RESOLVER_VERSION}`,
    ]);
  });
});

describe("violations are reported together, in a fixed order", () => {
  it("lists every violation, the same way each time", () => {
    const tampered = store2.memberships.map((v) =>
      v.key === "m02" ? { ...v, value: { ...v.value, groupRef: ref("PO_G3") } } : v
    );
    const inputs: PreparedInputs = {
      ...preparedFor(replaceVote("v02", { position: "POUR" })),
      provenance: { ...preparedFor().provenance, linkDecisionCutoff: 9 },
    };
    const expected = [
      "RECORD_HASH_MISMATCH:membership:m02",
      "LINK_CUTOFF_MISMATCH",
      "PREPARED_INPUTS_HASH_MISMATCH",
    ];
    expect(checkRunInputs(spec2, { ...store2, memberships: tampered }, inputs)).toEqual(expected);
    expect(checkRunInputs(spec2, { ...store2, memberships: tampered }, inputs)).toEqual(expected);
  });
});
