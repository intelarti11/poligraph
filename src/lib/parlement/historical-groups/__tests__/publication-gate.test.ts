import { describe, expect, it } from "vitest";
import { decidePositionPublication } from "../publication";
import { civilDate } from "../civil-date";
import { asGroupRef, asScrutinId, type CountCoherence, type OrganTally } from "../types";

const tally = (overrides: Partial<OrganTally> = {}): OrganTally => ({
  scrutinId: asScrutinId("VTANR5L16V1"),
  groupRef: asGroupRef("PO1"),
  organKind: "GROUP",
  forCount: 10,
  againstCount: 4,
  abstainCount: 1,
  nonVoterCount: 0,
  excludedCount: 0,
  excludedByReason: {},
  ...overrides,
});
const strict = { maxExcludedPerGroup: 0 };

/** What the resolution made of the votes of a group. Every outcome the resolver can leave. */
const OUTCOMES: [string, OrganTally][] = [
  ["every vote attested, nothing left out", tally()],
  ["a unanimous group", tally({ forCount: 40, againstCount: 0, abstainCount: 0 })],
  [
    "a vote left out as a conflict between E1 and E2",
    tally({ excludedCount: 1, excludedByReason: { CONFLICT: 1 } }),
  ],
  [
    "votes left out on a placeholder organ",
    tally({ excludedCount: 3, excludedByReason: { PO0: 3 } }),
  ],
  [
    "votes left out on an uncertain date",
    tally({ excludedCount: 2, excludedByReason: { EDGE_DAY: 2 } }),
  ],
  ["non-registered members", tally({ organKind: "NON_INSCRIT" })],
  ["no attested vote", tally({ forCount: 0, againstCount: 0, abstainCount: 0, nonVoterCount: 5 })],
];

describe("the count gate of the publication", () => {
  it.each(OUTCOMES)("COUNT_MISMATCH refuses, whatever the resolution made: %s", (_label, t) => {
    expect(decidePositionPublication(t, strict, "COUNT_MISMATCH")).toEqual({
      publishable: false,
      reason: "COUNT_MISMATCH",
    });
  });

  it.each(OUTCOMES)("UNVERIFIABLE refuses, whatever the resolution made: %s", (_label, t) => {
    expect(decidePositionPublication(t, strict, "UNVERIFIABLE")).toEqual({
      publishable: false,
      reason: "COUNT_UNVERIFIABLE",
    });
  });

  it.each(OUTCOMES)(
    "an unknown coherence refuses, whatever the resolution made: %s",
    (_label, t) => {
      expect(decidePositionPublication(t, strict, null)).toEqual({
        publishable: false,
        reason: "COUNT_COHERENCE_UNKNOWN",
      });
    }
  );

  it("refuses a value it does not know, and a lax threshold does not reopen the gate", () => {
    const bogus = "COHERENT_ENOUGH" as unknown as CountCoherence;
    expect(decidePositionPublication(tally(), strict, bogus)).toEqual({
      publishable: false,
      reason: "COUNT_COHERENCE_UNKNOWN",
    });
    const lax = { maxExcludedPerGroup: 1_000_000 };
    expect(
      decidePositionPublication(tally({ excludedCount: 5 }), lax, "COUNT_MISMATCH").publishable
    ).toBe(false);
    expect(
      decidePositionPublication(tally({ excludedCount: 5 }), lax, "UNVERIFIABLE").publishable
    ).toBe(false);
  });

  it("only COHERENT hands the decision to the thresholds, which then behave as before", () => {
    expect(decidePositionPublication(tally(), strict, "COHERENT")).toEqual({ publishable: true });
    expect(decidePositionPublication(tally({ excludedCount: 1 }), strict, "COHERENT")).toEqual({
      publishable: false,
      reason: "EXCLUDED_VOTES_PRESENT",
    });
    expect(
      decidePositionPublication(tally({ organKind: "NON_INSCRIT" }), strict, "COHERENT")
    ).toEqual({ publishable: false, reason: "NON_INSCRIT_IS_NOT_A_GROUP" });
  });

  it("is never published by anything but the full agreement: the whole grid", () => {
    const published: string[] = [];
    for (const [label, t] of OUTCOMES) {
      for (const coherence of ["COHERENT", "COUNT_MISMATCH", "UNVERIFIABLE", null] as const) {
        if (decidePositionPublication(t, strict, coherence).publishable)
          published.push(`${label} / ${coherence}`);
      }
    }
    expect(published).toEqual([
      "every vote attested, nothing left out / COHERENT",
      "a unanimous group / COHERENT",
    ]);
  });

  it("reads the counts of the run and changes none of them", () => {
    const t = tally({ excludedCount: 2, excludedByReason: { CONFLICT: 2 } });
    const before = JSON.stringify(t);
    for (const coherence of ["COHERENT", "COUNT_MISMATCH", "UNVERIFIABLE", null] as const)
      decidePositionPublication(t, strict, coherence);
    expect(JSON.stringify(t)).toBe(before);
  });

  it("cannot be called without saying what is known of the counts", () => {
    // @ts-expect-error the third argument is required: forgetting to look the coherence up does not compile
    expect(decidePositionPublication(tally(), strict).publishable).toBe(false);
    // @ts-expect-error `undefined` is not `null`: it is a caller that did not look
    expect(decidePositionPublication(tally(), strict, undefined).publishable).toBe(false);
  });

  it("does not know the date or the resolver: its decision is the same for any day", () => {
    void civilDate("2023-03-14");
    expect(decidePositionPublication(tally(), strict, "COUNT_MISMATCH")).toEqual(
      decidePositionPublication(
        tally({ forCount: 1 }),
        { maxExcludedPerGroup: 7 },
        "COUNT_MISMATCH"
      )
    );
  });
});
