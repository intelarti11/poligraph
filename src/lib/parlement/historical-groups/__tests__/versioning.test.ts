import { describe, expect, it } from "vitest";
import {
  applySnapshot,
  diffAgainstCurrent,
  effectiveDecisions,
  exceedsRemovalGuard,
  stateAt,
  validateVersions,
  type IncomingRecord,
  type RecordVersion,
} from "../versioning";

const rec = (key: string, rawHash: string, value = key): IncomingRecord<string> => ({
  key,
  rawHash,
  value,
});

describe("applySnapshot", () => {
  it("opens one version per record on the first snapshot", () => {
    const { versions, diff } = applySnapshot([], [rec("a", "1"), rec("b", "1")], 1);
    expect(diff).toEqual({ added: ["a", "b"], unchanged: [], corrected: [], removed: [] });
    expect(versions.map((v) => [v.key, v.fromSeq, v.toSeq])).toEqual([
      ["a", 1, null],
      ["b", 1, null],
    ]);
  });

  it("classifies added, unchanged, corrected and removed records", () => {
    const first = applySnapshot([], [rec("a", "1"), rec("b", "1"), rec("c", "1")], 1).versions;
    const { diff } = applySnapshot(first, [rec("a", "1"), rec("b", "2"), rec("d", "1")], 2);
    expect(diff).toEqual({
      added: ["d"],
      unchanged: ["a"],
      corrected: ["b"],
      removed: ["c"],
    });
  });

  it("closes the old version and opens the new one on a correction, without losing the old value", () => {
    const first = applySnapshot([], [rec("a", "1", "old")], 1).versions;
    const { versions } = applySnapshot(first, [rec("a", "2", "new")], 2);
    expect(versions).toEqual([
      { key: "a", fromSeq: 1, toSeq: 2, rawHash: "1", value: "old" },
      { key: "a", fromSeq: 2, toSeq: null, rawHash: "2", value: "new" },
    ]);
  });

  it("closes a removed record and replaces it with nothing", () => {
    const first = applySnapshot([], [rec("a", "1")], 1).versions;
    const { versions } = applySnapshot(first, [], 2);
    expect(versions).toEqual([{ key: "a", fromSeq: 1, toSeq: 2, rawHash: "1", value: "a" }]);
    expect(stateAt(versions, 2)).toEqual([]);
  });

  it("opens a new version when a removed record comes back", () => {
    let versions = applySnapshot([], [rec("a", "1")], 1).versions;
    versions = applySnapshot(versions, [], 2).versions;
    versions = applySnapshot(versions, [rec("a", "1")], 3).versions;
    expect(versions.map((v) => [v.fromSeq, v.toSeq])).toEqual([
      [1, 2],
      [3, null],
    ]);
    expect(stateAt(versions, 2)).toEqual([]);
    expect(stateAt(versions, 3).map((v) => v.key)).toEqual(["a"]);
  });

  it("writes nothing when the same content is applied again", () => {
    const first = applySnapshot([], [rec("a", "1"), rec("b", "2")], 1).versions;
    const again = applySnapshot(first, [rec("a", "1"), rec("b", "2")], 2);
    expect(again.versions).toEqual(first);
    expect(again.diff.unchanged).toEqual(["a", "b"]);
    expect(again.diff.added).toEqual([]);
    expect(again.diff.corrected).toEqual([]);
    expect(again.diff.removed).toEqual([]);
  });

  it("gives the same result whatever the order of the incoming records", () => {
    const first = applySnapshot([], [rec("a", "1"), rec("b", "1")], 1).versions;
    const one = applySnapshot(first, [rec("b", "2"), rec("c", "1"), rec("a", "1")], 2);
    const two = applySnapshot(first, [rec("a", "1"), rec("c", "1"), rec("b", "2")], 2);
    expect(one.diff).toEqual(two.diff);
    const order = (list: RecordVersion<string>[]) =>
      [...list].sort((x, y) => (x.key + x.fromSeq < y.key + y.fromSeq ? -1 : 1));
    expect(order(one.versions)).toEqual(order(two.versions));
  });

  it("refuses a snapshot number that is not after the ones already applied", () => {
    const first = applySnapshot([], [rec("a", "1")], 3).versions;
    expect(() => applySnapshot(first, [rec("a", "1")], 3)).toThrow("must come after");
    expect(() => applySnapshot(first, [rec("a", "1")], 2)).toThrow("must come after");
    const closed = applySnapshot(first, [], 4).versions;
    expect(() => applySnapshot(closed, [], 4)).toThrow("must come after");
  });

  it("refuses a snapshot that holds the same key twice", () => {
    expect(() => applySnapshot([], [rec("a", "1"), rec("a", "2")], 1)).toThrow("duplicate key");
  });

  it("refuses a sequence number that is not a positive integer", () => {
    expect(() => applySnapshot([], [], 0)).toThrow("seq");
    expect(() => applySnapshot([], [], 1.5)).toThrow("seq");
  });
});

describe("stateAt", () => {
  const versions = [
    { key: "a", fromSeq: 1, toSeq: 3, rawHash: "1", value: "a-old" },
    { key: "a", fromSeq: 3, toSeq: null, rawHash: "2", value: "a-new" },
    { key: "b", fromSeq: 2, toSeq: null, rawHash: "1", value: "b" },
  ];

  it("reads the span as open on the right: the closing snapshot already sees the next version", () => {
    expect(stateAt(versions, 2).map((v) => v.value)).toEqual(["a-old", "b"]);
    expect(stateAt(versions, 3).map((v) => v.value)).toEqual(["a-new", "b"]);
  });

  it("does not see a record before its first snapshot", () => {
    expect(stateAt(versions, 1).map((v) => v.key)).toEqual(["a"]);
  });

  it("throws when two versions of one key hold at the same snapshot", () => {
    const broken = [
      { key: "a", fromSeq: 1, toSeq: null, rawHash: "1", value: "x" },
      { key: "a", fromSeq: 2, toSeq: null, rawHash: "2", value: "y" },
    ];
    expect(() => stateAt(broken, 2)).toThrow("two versions");
  });
});

describe("diffAgainstCurrent", () => {
  it("describes what a snapshot would change without applying it", () => {
    const versions = applySnapshot([], [rec("a", "1")], 1).versions;
    const before = JSON.stringify(versions);
    const diff = diffAgainstCurrent(versions, [rec("a", "2"), rec("z", "1")]);
    expect(diff.corrected).toEqual(["a"]);
    expect(diff.added).toEqual(["z"]);
    expect(JSON.stringify(versions)).toBe(before);
  });
});

describe("exceedsRemovalGuard", () => {
  const diff = (removed: number) => ({
    added: [],
    unchanged: [],
    corrected: [],
    removed: Array.from({ length: removed }, (_, i) => `k${i}`),
  });

  it("stops an import that removes more than one percent of what is held", () => {
    expect(exceedsRemovalGuard(diff(2), 100)).toBe(true);
    expect(exceedsRemovalGuard(diff(1), 100)).toBe(false);
    expect(exceedsRemovalGuard(diff(0), 100)).toBe(false);
  });

  it("does not trip on an empty store", () => {
    expect(exceedsRemovalGuard(diff(0), 0)).toBe(false);
  });

  it("takes the threshold as a parameter", () => {
    expect(exceedsRemovalGuard(diff(5), 100, 0.1)).toBe(false);
    expect(exceedsRemovalGuard(diff(11), 100, 0.1)).toBe(true);
  });
});

describe("validateVersions", () => {
  it("accepts a consistent history", () => {
    const versions = applySnapshot(
      applySnapshot([], [rec("a", "1")], 1).versions,
      [rec("a", "2")],
      2
    ).versions;
    expect(validateVersions(versions)).toEqual([]);
  });

  it("reports overlapping spans and spans that close before they open", () => {
    expect(
      validateVersions([
        { key: "a", fromSeq: 1, toSeq: 4, rawHash: "1", value: "x" },
        { key: "a", fromSeq: 3, toSeq: null, rawHash: "2", value: "y" },
      ])
    ).toEqual(["a: versions overlap at 3"]);
    expect(
      validateVersions([{ key: "b", fromSeq: 5, toSeq: 5, rawHash: "1", value: "x" }])
    ).toEqual(["b: span closes at 5 <= 5"]);
  });
});

describe("effectiveDecisions", () => {
  const journal = [
    { decisionNo: 1, key: "pair", value: "PROPOSED" },
    { decisionNo: 3, key: "pair", value: "VALIDATED" },
    { decisionNo: 2, key: "other", value: "REJECTED" },
    { decisionNo: 5, key: "pair", value: "REJECTED" },
  ];

  it("keeps, for each key, the highest decision not above the cutoff", () => {
    expect([...effectiveDecisions(journal, 1)]).toEqual([["pair", "PROPOSED"]]);
    expect(Object.fromEntries(effectiveDecisions(journal, 3))).toEqual({
      pair: "VALIDATED",
      other: "REJECTED",
    });
    expect(Object.fromEntries(effectiveDecisions(journal, 5))).toEqual({
      pair: "REJECTED",
      other: "REJECTED",
    });
  });

  it("sees nothing before the first decision, so a run pinned on cutoff 0 ignores the journal", () => {
    expect(effectiveDecisions(journal, 0).size).toBe(0);
  });

  it("does not depend on the order of the journal", () => {
    const shuffled = [...journal].reverse();
    expect([...effectiveDecisions(shuffled, 3)].sort()).toEqual(
      [...effectiveDecisions(journal, 3)].sort()
    );
  });

  it("refuses a decision number used twice or a cutoff that is not an integer", () => {
    expect(() =>
      effectiveDecisions(
        [
          { decisionNo: 1, key: "a", value: 1 },
          { decisionNo: 1, key: "b", value: 2 },
        ],
        1
      )
    ).toThrow("used twice");
    expect(() => effectiveDecisions([], -1)).toThrow("cutoff");
    expect(() => effectiveDecisions([], 1.5)).toThrow("cutoff");
  });
});
