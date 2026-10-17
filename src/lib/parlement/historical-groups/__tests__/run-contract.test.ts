import { describe, expect, it } from "vitest";
import {
  assertValidRunConfig,
  checkRunnable,
  computeInputHash,
  configHash,
  defaultRunConfig,
  derivedRunStatus,
  hashDecisionsInForce,
  RESOLVER_VERSION,
  snapshotStatusOf,
  validateRunConfig,
  type PinnedSnapshotState,
  type RunPins,
} from "../run-contract";
import type { RunConfig } from "../types";

const pins: RunPins = {
  snapshotPins: { AN_AMO30: 2, AN_SCRUTINS_L16: 1 },
  snapshotStateHashes: { AN_AMO30: "hash-amo-2", AN_SCRUTINS_L16: "hash-scr-1" },
  linkDecisionCutoff: 0,
  continuityDecisionCutoff: 1,
  decisionsHash: "decisions-1",
  preparedInputsHash: "prepared-1",
  parserVersion: "parser-1",
  resolverVersion: RESOLVER_VERSION,
};

describe("validateRunConfig", () => {
  it("accepts the default configuration", () => {
    expect(validateRunConfig(defaultRunConfig([16, 17]))).toEqual([]);
    expect(() => assertValidRunConfig(defaultRunConfig([16]))).not.toThrow();
  });

  const mutate = (change: (config: RunConfig) => void): string[] => {
    const config = structuredClone(defaultRunConfig([16])) as RunConfig;
    change(config);
    return validateRunConfig(config);
  };

  it("refuses an interpretation of the dates that is not implemented", () => {
    expect(mutate((c) => ((c.dateSemantics as { version: string }).version = "v2"))).toContain(
      "dateSemantics.version must be v1"
    );
    expect(mutate((c) => ((c.dateSemantics as { interval: string }).interval = "open"))).toContain(
      "dateSemantics.interval must be closed"
    );
  });

  it("refuses to let an edge day be settled without a vote", () => {
    expect(
      mutate(
        (c) =>
          ((c.dateSemantics as { edgeDayWithoutScrutin: string }).edgeDayWithoutScrutin = "ALLOW")
      )
    ).toContain("dateSemantics.edgeDayWithoutScrutin must be INSUFFICIENT");
  });

  it("refuses to reconcile organs of different legislatures", () => {
    expect(
      mutate(
        (c) => ((c.continuity as { sameLegislatureOnly: boolean }).sameLegislatureOnly = false)
      )
    ).toContain("continuity.sameLegislatureOnly must be true");
  });

  it("allows only the renaming relation, once", () => {
    expect(
      mutate(
        (c) => ((c.continuity as unknown as { relations: string[] }).relations = ["SUCCESSOR"])
      )
    ).toContain("continuity.relations may only contain RENAMED_SAME_GROUP, once");
    expect(
      mutate(
        (c) =>
          ((c.continuity as unknown as { relations: string[] }).relations = [
            "RENAMED_SAME_GROUP",
            "RENAMED_SAME_GROUP",
          ])
      )
    ).toContain("continuity.relations may only contain RENAMED_SAME_GROUP, once");
  });

  it("requires every exclusion reason to be covered", () => {
    const issues = mutate(
      (c) => ((c.exclusion as unknown as { rules: unknown[] }).rules = c.exclusion.rules.slice(1))
    );
    expect(issues.some((issue) => issue.includes("is covered by no rule"))).toBe(true);
  });

  it("requires canonical lists and valid numbers", () => {
    expect(
      mutate(
        (c) =>
          ((c.evidence as { placeholderOrganRefs: string[] }).placeholderOrganRefs = [
            "PO_B",
            "PO_A",
          ])
      )
    ).toContain("evidence.placeholderOrganRefs must be non-empty strings, sorted, unique");
    expect(
      mutate((c) => ((c.scope as { legislatures: number[] }).legislatures = [17, 16]))
    ).toContain("scope.legislatures must be positive integers, sorted, unique, not empty");
    expect(mutate((c) => ((c.scope as { legislatures: number[] }).legislatures = []))).toContain(
      "scope.legislatures must be positive integers, sorted, unique, not empty"
    );
    expect(
      mutate((c) => ((c.publication as { maxExcludedPerGroup: number }).maxExcludedPerGroup = -1))
    ).toContain("publication.maxExcludedPerGroup must be an integer >= 0");
  });
});

describe("configHash and computeInputHash", () => {
  const config = defaultRunConfig([16]);

  it("is stable for the same configuration and changes when any setting changes", () => {
    expect(configHash(config)).toBe(configHash(structuredClone(config) as RunConfig));
    const other = structuredClone(config) as RunConfig;
    (other.publication as { maxExcludedPerGroup: number }).maxExcludedPerGroup = 1;
    expect(configHash(other)).not.toBe(configHash(config));
  });

  it("refuses to hash an invalid configuration", () => {
    const broken = structuredClone(config) as RunConfig;
    (broken.scope as { legislatures: number[] }).legislatures = [];
    expect(() => configHash(broken)).toThrow("Invalid run configuration");
  });

  it("gives one identity to one set of pins, whatever the order the pins were written in", () => {
    const reordered: RunPins = {
      ...pins,
      snapshotPins: { AN_SCRUTINS_L16: 1, AN_AMO30: 2 },
      snapshotStateHashes: { AN_SCRUTINS_L16: "hash-scr-1", AN_AMO30: "hash-amo-2" },
    };
    expect(computeInputHash(reordered, config)).toBe(computeInputHash(pins, config));
  });

  it.each<[string, Partial<RunPins>]>([
    ["a snapshot number", { snapshotPins: { AN_AMO30: 3, AN_SCRUTINS_L16: 1 } }],
    ["a state hash", { snapshotStateHashes: { AN_AMO30: "other", AN_SCRUTINS_L16: "hash-scr-1" } }],
    ["the identity cutoff", { linkDecisionCutoff: 1 }],
    ["the continuity cutoff", { continuityDecisionCutoff: 2 }],
    ["the decisions hash", { decisionsHash: "decisions-2" }],
    ["the parser version", { parserVersion: "parser-2" }],
    ["the resolver version", { resolverVersion: "other-version" }],
    ["the prepared inputs", { preparedInputsHash: "prepared-2" }],
  ])("changes the identity of the run when %s changes", (_label, change) => {
    expect(computeInputHash({ ...pins, ...change }, config)).not.toBe(
      computeInputHash(pins, config)
    );
  });

  it("changes the identity of the run when the configuration changes", () => {
    const other = structuredClone(config) as RunConfig;
    (other.continuity as unknown as { relations: string[] }).relations = [];
    expect(computeInputHash(pins, other)).not.toBe(computeInputHash(pins, config));
  });

  it("refuses pins and hashes that do not cover the same streams", () => {
    expect(() =>
      computeInputHash({ ...pins, snapshotStateHashes: { AN_AMO30: "x" } }, config)
    ).toThrow("same streams");
  });
});

describe("hashDecisionsInForce", () => {
  it("does not depend on the order of the entries, and changes with the decisions", () => {
    const a = new Map<string, unknown>([
      ["k1", "VALIDATED"],
      ["k2", "REJECTED"],
    ]);
    const b = new Map<string, unknown>([
      ["k2", "REJECTED"],
      ["k1", "VALIDATED"],
    ]);
    expect(hashDecisionsInForce(new Map(), a)).toBe(hashDecisionsInForce(new Map(), b));
    expect(hashDecisionsInForce(new Map(), a)).not.toBe(hashDecisionsInForce(a, new Map()));
    expect(hashDecisionsInForce(new Map(), new Map())).not.toBe(hashDecisionsInForce(new Map(), a));
  });
});

describe("snapshotStatusOf", () => {
  it("holds a snapshot that has no decision: nothing is usable by default", () => {
    expect(snapshotStatusOf([])).toBe("QUARANTINED");
  });

  it("follows the last decision", () => {
    expect(
      snapshotStatusOf([
        { decisionNo: 1, status: "RELEASED" },
        { decisionNo: 2, status: "QUARANTINED" },
      ])
    ).toBe("QUARANTINED");
    expect(
      snapshotStatusOf([
        { decisionNo: 2, status: "QUARANTINED" },
        { decisionNo: 3, status: "RELEASED" },
      ])
    ).toBe("RELEASED");
  });

  it("treats a revocation as final, whatever is decided after it", () => {
    expect(
      snapshotStatusOf([
        { decisionNo: 1, status: "REVOKED" },
        { decisionNo: 2, status: "RELEASED" },
      ])
    ).toBe("REVOKED");
  });
});

describe("checkRunnable", () => {
  const state = (overrides: Partial<PinnedSnapshotState> & { stream: string; seq: number }) =>
    ({
      status: "RELEASED",
      recordedStateHash: pins.snapshotStateHashes[overrides.stream] as string,
      recomputedStateHash: pins.snapshotStateHashes[overrides.stream] as string,
      ...overrides,
    }) satisfies PinnedSnapshotState;
  const good = [
    state({ stream: "AN_AMO30", seq: 2 }),
    state({ stream: "AN_SCRUTINS_L16", seq: 1 }),
  ];

  it("lets a run start when every pinned snapshot is released and intact", () => {
    expect(checkRunnable(pins, good)).toEqual({ ok: true });
  });

  it.each(["QUARANTINED", "REVOKED"] as const)("refuses a pinned snapshot that is %s", (status) => {
    const states = [{ ...good[0], status } as PinnedSnapshotState, good[1] as PinnedSnapshotState];
    expect(checkRunnable(pins, states)).toEqual({
      ok: false,
      refusals: [{ stream: "AN_AMO30", reason: "NOT_RELEASED", status }],
    });
  });

  it("refuses a snapshot that has no decision (held by default)", () => {
    const states = [
      { ...good[0], status: snapshotStatusOf([]) } as PinnedSnapshotState,
      good[1] as PinnedSnapshotState,
    ];
    expect(checkRunnable(pins, states)).toMatchObject({ ok: false });
  });

  it("refuses a snapshot whose stored records no longer hash to what was recorded", () => {
    const states = [
      { ...good[0], recomputedStateHash: "altered" } as PinnedSnapshotState,
      good[1] as PinnedSnapshotState,
    ];
    expect(checkRunnable(pins, states)).toEqual({
      ok: false,
      refusals: [{ stream: "AN_AMO30", reason: "STATE_HASH_MISMATCH" }],
    });
  });

  it("refuses pins that disagree with the recorded hash, and pins with no snapshot", () => {
    const wrongPin = {
      ...pins,
      snapshotStateHashes: { ...pins.snapshotStateHashes, AN_AMO30: "other" },
    };
    expect(checkRunnable(wrongPin, good)).toEqual({
      ok: false,
      refusals: [{ stream: "AN_AMO30", reason: "PINNED_HASH_MISMATCH" }],
    });
    expect(checkRunnable(pins, [good[0] as PinnedSnapshotState])).toEqual({
      ok: false,
      refusals: [{ stream: "AN_SCRUTINS_L16", reason: "PIN_WITHOUT_SNAPSHOT" }],
    });
  });
});

describe("derivedRunStatus", () => {
  it("is read from the pinned snapshots, and a revocation outweighs a quarantine", () => {
    expect(derivedRunStatus(["RELEASED", "RELEASED"])).toBe("OK");
    expect(derivedRunStatus(["RELEASED", "QUARANTINED"])).toBe("TO_REVIEW");
    expect(derivedRunStatus(["QUARANTINED", "REVOKED"])).toBe("INVALIDATED_BY_REVOCATION");
  });
});
