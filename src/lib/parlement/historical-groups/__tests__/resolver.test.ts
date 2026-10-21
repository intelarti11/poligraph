import { describe, expect, it } from "vitest";
import { resolveGroupAtDate, type ResolveInput } from "../resolver";
import { defaultRunConfig } from "../run-contract";
import {
  actor,
  CONTINUITY_DECISION,
  d,
  membership,
  OPEN_BOUND,
  ORGANS,
  organMap,
  ref,
  resolved,
} from "../__fixtures__/builders";
import { asScrutinId, IDENTITY_GAPS, type ContinuityEvidence, type Resolution } from "../types";

const CONFIG = defaultRunConfig([16]);

const base: ResolveInput = {
  chamber: "AN",
  identity: resolved("PA_T01"),
  civilDate: d("2023-01-10"),
  legislature: 16,
  memberships: [],
  organs: organMap(ORGANS),
  scrutin: null,
  continuity: [],
  openBound: OPEN_BOUND,
  legislatureGroupsFormedOn: d("2022-06-28"),
  config: {
    dateSemantics: CONFIG.dateSemantics,
    evidence: CONFIG.evidence,
    continuity: CONFIG.continuity,
  },
};

function resolve(overrides: Partial<ResolveInput> = {}): Resolution {
  return resolveGroupAtDate({ ...base, ...overrides });
}

function scrutinOf(published: string, person = "PA_T01", seat: ResolveInput["scrutin"] = null) {
  return (
    seat ?? {
      scrutinId: asScrutinId("S_TEST"),
      officialId: actor(person),
      publishedOrganRef: ref(published),
      seatMandate: null,
    }
  );
}

const inG1 = membership("g1", "PA_T01", "PO_G1", "2022-06-29", "OPEN");
const validated = (from: string, to: string, relation: ContinuityEvidence["relation"]) =>
  ({
    fromOrganRef: ref(from),
    toOrganRef: ref(to),
    relation,
    status: "VALIDATED",
  }) satisfies ContinuityEvidence;

describe("identity", () => {
  it.each(IDENTITY_GAPS)("answers UNRESOLVED_IDENTITY (%s) and reads no evidence", (reason) => {
    const result = resolve({
      identity: { status: "UNRESOLVED", reason },
      memberships: [inG1],
      scrutin: scrutinOf("PO_G1"),
    });
    expect(result).toEqual({ status: "UNRESOLVED_IDENTITY", reason });
  });

  it("refuses an attestation that belongs to another person", () => {
    expect(() => resolve({ scrutin: scrutinOf("PO_G1", "PA_T02") })).toThrow("another person");
  });
});

describe("UNKNOWN: an absence of record is never a non-registration", () => {
  it("answers NO_RECORD when the person has no record", () => {
    expect(resolve()).toEqual({ status: "UNKNOWN", reason: "NO_RECORD" });
  });

  it("does not read the records of another person", () => {
    expect(
      resolve({ memberships: [membership("x", "PA_T02", "PO_G1", "2022-06-29", "OPEN")] })
    ).toEqual({ status: "UNKNOWN", reason: "NO_RECORD" });
  });

  it("does not read the records of another chamber", () => {
    expect(resolve({ memberships: [{ ...inG1, chamber: "SENAT" }] })).toEqual({
      status: "UNKNOWN",
      reason: "NO_RECORD",
    });
  });

  it("does not read a record of another legislature", () => {
    expect(resolve({ memberships: [{ ...inG1, legislature: 17 }] })).toEqual({
      status: "UNKNOWN",
      reason: "NO_RECORD",
    });
  });

  it("answers UNKNOWN after a record has ended, never non-registered, never the old group", () => {
    const ended = membership("old", "PA_T01", "PO_G1", "2022-06-29", "2022-12-01");
    expect(resolve({ memberships: [ended] })).toEqual({ status: "UNKNOWN", reason: "NO_RECORD" });
  });

  it("answers UNKNOWN before the first record starts", () => {
    expect(resolve({ civilDate: d("2022-06-01"), memberships: [inG1] })).toEqual({
      status: "UNKNOWN",
      reason: "NO_RECORD",
    });
  });
});

describe("attested by interval only", () => {
  it("attests the group of the one record that covers the day, with the record as proof", () => {
    const result = resolve({ memberships: [inG1] });
    expect(result).toEqual({
      status: "ATTESTED_GROUP",
      groupRef: "PO_G1",
      level: "INTERVAL_ONLY",
      viaLink: null,
      diagnostics: [],
      evidence: [
        {
          kind: "MEMBERSHIP",
          sourceRecordId: "g1",
          groupRef: "PO_G1",
          startDate: "2022-06-29",
          endDate: null,
          endState: "OPEN_AT_SNAPSHOT",
        },
      ],
    });
  });

  it("keeps one candidate when two lines of one organ cover the day", () => {
    const president = membership("g1p", "PA_T01", "PO_G1", "2022-09-30", "OPEN", {
      qualityCode: "Président",
      isPrincipal: false,
    });
    const result = resolve({ memberships: [president, inG1] });
    expect(result).toMatchObject({
      status: "ATTESTED_GROUP",
      groupRef: "PO_G1",
      level: "INTERVAL_ONLY",
    });
    if (result.status !== "ATTESTED_GROUP") throw new Error("unreachable");
    expect(result.evidence.map((e) => (e.kind === "MEMBERSHIP" ? e.sourceRecordId : ""))).toEqual([
      "g1",
      "g1p",
    ]);
  });
});

describe("attested by a published vote", () => {
  it("is BOTH when the vote and the interval name the same organ", () => {
    expect(resolve({ memberships: [inG1], scrutin: scrutinOf("PO_G1") })).toMatchObject({
      status: "ATTESTED_GROUP",
      groupRef: "PO_G1",
      level: "BOTH",
      viaLink: null,
    });
  });

  it("is SCRUTIN_ONLY when the person has no interval at all", () => {
    expect(resolve({ scrutin: scrutinOf("PO_G1") })).toMatchObject({
      status: "ATTESTED_GROUP",
      groupRef: "PO_G1",
      level: "SCRUTIN_ONLY",
    });
  });

  it("is SCRUTIN_ONLY when the only record cannot be placed in time: the vote decides", () => {
    const unknownEnd = membership("u", "PA_T01", "PO_G1", "2022-06-29", "UNKNOWN");
    expect(resolve({ memberships: [unknownEnd], scrutin: scrutinOf("PO_G3") })).toMatchObject({
      status: "ATTESTED_GROUP",
      groupRef: "PO_G3",
      level: "SCRUTIN_ONLY",
    });
  });
});

describe("PO0, the filler reference", () => {
  it("is INSUFFICIENT even when an interval gives a clean answer: the interval does not settle it", () => {
    const result = resolve({ memberships: [inG1], scrutin: scrutinOf("PO0") });
    expect(result).toEqual({
      status: "INSUFFICIENT",
      reason: "PO0",
      evidence: [{ kind: "SCRUTIN_ATTESTATION", scrutinId: "S_TEST", publishedOrganRef: "PO0" }],
    });
  });

  it("is INSUFFICIENT whatever the intervals say, including when there is none", () => {
    expect(resolve({ scrutin: scrutinOf("PO0") })).toMatchObject({
      status: "INSUFFICIENT",
      reason: "PO0",
    });
  });

  it("treats every configured filler the same way", () => {
    const config = { ...base.config, evidence: { placeholderOrganRefs: ["PO0", "PO_FILL"] } };
    expect(resolve({ config, scrutin: scrutinOf("PO_FILL") })).toMatchObject({
      status: "INSUFFICIENT",
      reason: "PO0",
    });
  });

  it("is only a filler when configured: otherwise it is an unknown organ", () => {
    const config = { ...base.config, evidence: { placeholderOrganRefs: [] } };
    expect(resolve({ config, scrutin: scrutinOf("PO0") })).toMatchObject({
      status: "INSUFFICIENT",
      reason: "UNKNOWN_ORGAN",
    });
  });
});

describe("unknown organ", () => {
  it("is INSUFFICIENT when the published reference is not in the referential", () => {
    expect(resolve({ scrutin: scrutinOf("PO_NOWHERE") })).toMatchObject({
      status: "INSUFFICIENT",
      reason: "UNKNOWN_ORGAN",
    });
  });

  it("is INSUFFICIENT when a record points at an organ the referential does not have", () => {
    const ghost = membership("ghost", "PA_T01", "PO_GHOST", "2022-06-29", "OPEN");
    expect(resolve({ memberships: [ghost] })).toMatchObject({
      status: "INSUFFICIENT",
      reason: "UNKNOWN_ORGAN",
    });
  });
});

describe("CONFLICT", () => {
  it("reports the two sources and settles nothing when they name different organs", () => {
    const inG3 = membership("g3", "PA_T01", "PO_G3", "2022-06-29", "OPEN");
    const result = resolve({ memberships: [inG3], scrutin: scrutinOf("PO_G1") });
    expect(result).toMatchObject({ status: "CONFLICT", kind: "SOURCES_DISAGREE" });
    if (result.status !== "CONFLICT") throw new Error("unreachable");
    expect(result.candidates.map((c) => [c.origin, c.groupRef])).toEqual([
      ["SCRUTIN", "PO_G1"],
      ["INTERVAL", "PO_G3"],
    ]);
  });

  it("is a conflict when the vote lists a non-registered person and a group record is in force", () => {
    expect(resolve({ memberships: [inG1], scrutin: scrutinOf("PO_NI") })).toMatchObject({
      status: "CONFLICT",
      kind: "SOURCES_DISAGREE",
    });
  });

  it("does not reconcile two references on a shared label: same label, no decision, conflict", () => {
    // PO_G2 and PO_G2B carry the same label in the referential.
    const g2 = membership("g2", "PA_T01", "PO_G2", "2022-06-29", "OPEN");
    expect(resolve({ memberships: [g2], scrutin: scrutinOf("PO_G2B") })).toMatchObject({
      status: "CONFLICT",
      kind: "SOURCES_DISAGREE",
    });
  });

  it("is a conflict when two different organs hold on the same day, with or without a vote", () => {
    const g1 = membership("a", "PA_T01", "PO_G1", "2022-06-29", "OPEN");
    const g3 = membership("b", "PA_T01", "PO_G3", "2022-09-01", "OPEN");
    expect(resolve({ memberships: [g1, g3] })).toMatchObject({
      status: "CONFLICT",
      kind: "MULTIPLE_ORGANS",
    });
    expect(resolve({ memberships: [g1, g3], scrutin: scrutinOf("PO_G1") })).toMatchObject({
      status: "CONFLICT",
      kind: "MULTIPLE_ORGANS",
    });
  });

  it("is a conflict when the seat mandate of the vote does not cover the day", () => {
    const seat = { startDate: d("2022-06-22"), endDate: d("2022-12-31") };
    const result = resolve({
      memberships: [inG1],
      scrutin: { ...scrutinOf("PO_G1"), seatMandate: seat },
    });
    expect(result).toMatchObject({ status: "CONFLICT", kind: "SEAT_MISMATCH" });
  });

  it("does not take an open seat mandate for a contradiction", () => {
    const seat = { startDate: d("2022-06-22"), endDate: null };
    expect(
      resolve({ memberships: [inG1], scrutin: { ...scrutinOf("PO_G1"), seatMandate: seat } })
    ).toMatchObject({ status: "ATTESTED_GROUP", level: "BOTH" });
  });
});

describe("continuity: a validated decision, and nothing else, reconciles two references", () => {
  const g2 = membership("g2", "PA_T01", "PO_G2", "2022-06-29", "OPEN");
  const vote = () => scrutinOf("PO_G2B");

  it("reads two references as one group through a validated RENAMED_SAME_GROUP, and says so", () => {
    const result = resolve({
      memberships: [g2],
      scrutin: vote(),
      continuity: [CONTINUITY_DECISION],
    });
    expect(result).toMatchObject({
      status: "ATTESTED_GROUP",
      groupRef: "PO_G2B",
      level: "BOTH",
      viaLink: { fromOrganRef: "PO_G2", toOrganRef: "PO_G2B", relation: "RENAMED_SAME_GROUP" },
    });
  });

  it("works in both directions of the decision", () => {
    const reversed = validated("PO_G2B", "PO_G2", "RENAMED_SAME_GROUP");
    expect(resolve({ memberships: [g2], scrutin: vote(), continuity: [reversed] })).toMatchObject({
      status: "ATTESTED_GROUP",
      level: "BOTH",
      viaLink: { fromOrganRef: "PO_G2B", toOrganRef: "PO_G2" },
    });
  });

  it.each(["PROPOSED", "REJECTED"] as const)("ignores a decision that is only %s", (status) => {
    expect(
      resolve({
        memberships: [g2],
        scrutin: vote(),
        continuity: [{ ...CONTINUITY_DECISION, status }],
      })
    ).toMatchObject({ status: "CONFLICT" });
  });

  it.each(["SUCCESSOR", "SPLIT", "MERGED", "EDITORIAL_CONTINUITY"] as const)(
    "ignores a validated %s: only a renaming reconciles references",
    (relation) => {
      expect(
        resolve({
          memberships: [g2],
          scrutin: vote(),
          continuity: [validated("PO_G2", "PO_G2B", relation)],
        })
      ).toMatchObject({ status: "CONFLICT" });
    }
  );

  it("lets a validated NOT_RELATED on the same pair win over a renaming", () => {
    expect(
      resolve({
        memberships: [g2],
        scrutin: vote(),
        continuity: [CONTINUITY_DECISION, validated("PO_G2B", "PO_G2", "NOT_RELATED")],
      })
    ).toMatchObject({ status: "CONFLICT" });
  });

  it("refuses to reconcile organs of two legislatures, whatever the decision says", () => {
    const g1 = membership("g1", "PA_T01", "PO_G1", "2022-06-29", "OPEN");
    const result = resolve({
      memberships: [g1],
      scrutin: scrutinOf("PO_X1"),
      continuity: [validated("PO_G1", "PO_X1", "RENAMED_SAME_GROUP")],
    });
    expect(result).toMatchObject({ status: "CONFLICT" });
  });

  it("refuses to reconcile a non-registration organ with a group organ", () => {
    const g1 = membership("g1", "PA_T01", "PO_G1", "2022-06-29", "OPEN");
    expect(
      resolve({
        memberships: [g1],
        scrutin: scrutinOf("PO_NI"),
        continuity: [validated("PO_G1", "PO_NI", "RENAMED_SAME_GROUP")],
      })
    ).toMatchObject({ status: "CONFLICT" });
  });

  it("is switched off by configuration: no relation allowed, no reconciliation", () => {
    const config = { ...base.config, continuity: { ...base.config.continuity, relations: [] } };
    expect(
      resolve({ memberships: [g2], scrutin: vote(), continuity: [CONTINUITY_DECISION], config })
    ).toMatchObject({ status: "CONFLICT" });
  });
});

describe("edge days", () => {
  const ni = membership("ni", "PA_T01", "PO_NI", "2022-06-22", "2022-06-28");
  const g1 = membership("g1", "PA_T01", "PO_G1", "2022-06-29", "OPEN");

  it("without a vote, an edge day is INSUFFICIENT on the last day of a record", () => {
    expect(resolve({ civilDate: d("2022-06-28"), memberships: [ni, g1] })).toMatchObject({
      status: "INSUFFICIENT",
      reason: "EDGE_DAY",
    });
  });

  it("without a vote, an edge day is INSUFFICIENT on the first day of a record", () => {
    expect(resolve({ civilDate: d("2022-06-29"), memberships: [ni, g1] })).toMatchObject({
      status: "INSUFFICIENT",
      reason: "EDGE_DAY",
    });
    expect(resolve({ civilDate: d("2022-06-22"), memberships: [ni, g1] })).toMatchObject({
      status: "INSUFFICIENT",
      reason: "EDGE_DAY",
    });
  });

  it("a day inside an interval is not an edge day", () => {
    expect(resolve({ civilDate: d("2022-06-25"), memberships: [ni, g1] })).toMatchObject({
      status: "ATTESTED_NON_INSCRIT",
      level: "INTERVAL_ONLY",
    });
    expect(resolve({ civilDate: d("2022-07-11"), memberships: [ni, g1] })).toMatchObject({
      status: "ATTESTED_GROUP",
      level: "INTERVAL_ONLY",
    });
  });

  it("with a vote that agrees, the edge day has no effect of its own", () => {
    expect(
      resolve({ civilDate: d("2022-06-29"), memberships: [ni, g1], scrutin: scrutinOf("PO_G1") })
    ).toMatchObject({ status: "ATTESTED_GROUP", groupRef: "PO_G1", level: "BOTH" });
  });

  it("with a vote that disagrees on an edge day, it is a conflict, never settled by the interval", () => {
    // The vote still lists the person as non-registered on the day the group record starts.
    const lateStart = membership("late", "PA_T01", "PO_G1", "2022-07-23", "OPEN");
    expect(
      resolve({ civilDate: d("2022-07-23"), memberships: [lateStart], scrutin: scrutinOf("PO_NI") })
    ).toMatchObject({ status: "CONFLICT", kind: "SOURCES_DISAGREE" });
  });
});

describe("non-registered", () => {
  const ni = membership("ni", "PA_T01", "PO_NI", "2022-06-22", "2022-06-28");

  it("attests a non-registration only when a record says so, with the transitional flag", () => {
    expect(resolve({ civilDate: d("2022-06-25"), memberships: [ni] })).toMatchObject({
      status: "ATTESTED_NON_INSCRIT",
      groupRef: "PO_NI",
      level: "INTERVAL_ONLY",
      transitional: true,
    });
  });

  it("is not transitional when the registration is still open", () => {
    const open = membership("ni2", "PA_T01", "PO_NI", "2022-06-22", "OPEN");
    expect(resolve({ civilDate: d("2023-05-05"), memberships: [open] })).toMatchObject({
      status: "ATTESTED_NON_INSCRIT",
      transitional: false,
    });
  });

  it("is not transitional when it ended after the groups were formed", () => {
    const later = membership("ni3", "PA_T01", "PO_NI", "2023-01-01", "2023-02-01");
    expect(resolve({ civilDate: d("2023-01-15"), memberships: [later] })).toMatchObject({
      status: "ATTESTED_NON_INSCRIT",
      transitional: false,
    });
  });

  it("cannot say when the formation date of the groups is not known", () => {
    expect(
      resolve({ civilDate: d("2022-06-25"), memberships: [ni], legislatureGroupsFormedOn: null })
    ).toMatchObject({ status: "ATTESTED_NON_INSCRIT", transitional: null });
  });

  it("attests a non-registration from the vote alone when no interval exists, and cannot qualify it", () => {
    expect(resolve({ scrutin: scrutinOf("PO_NI") })).toMatchObject({
      status: "ATTESTED_NON_INSCRIT",
      groupRef: "PO_NI",
      level: "SCRUTIN_ONLY",
      transitional: null,
    });
  });

  it("is BOTH when the vote and the registration record agree", () => {
    expect(
      resolve({ civilDate: d("2022-06-25"), memberships: [ni], scrutin: scrutinOf("PO_NI") })
    ).toMatchObject({ status: "ATTESTED_NON_INSCRIT", level: "BOTH", transitional: true });
  });

  it("is a conflict when the vote says non-registered and a group record is in force", () => {
    const g1 = membership("g1", "PA_T01", "PO_G1", "2022-06-29", "OPEN");
    expect(
      resolve({ civilDate: d("2022-07-11"), memberships: [g1], scrutin: scrutinOf("PO_NI") })
    ).toMatchObject({ status: "CONFLICT" });
  });
});

describe("dates that cannot be placed", () => {
  it("is INSUFFICIENT (END_STATE_UNKNOWN) when the end of the record is unknown", () => {
    const unknownEnd = membership("u", "PA_T01", "PO_G1", "2022-06-29", "UNKNOWN");
    expect(resolve({ memberships: [unknownEnd] })).toMatchObject({
      status: "INSUFFICIENT",
      reason: "END_STATE_UNKNOWN",
    });
  });

  it("is INSUFFICIENT (START_DATE_UNKNOWN) when the start is unknown", () => {
    const unknownStart = membership("u", "PA_T01", "PO_G1", null, "2023-06-01");
    expect(resolve({ memberships: [unknownStart] })).toMatchObject({
      status: "INSUFFICIENT",
      reason: "START_DATE_UNKNOWN",
    });
  });

  it("is INSUFFICIENT (OPEN_BEYOND_SNAPSHOT) after the bound of an open record", () => {
    expect(resolve({ civilDate: d("2027-01-01"), memberships: [inG1] })).toMatchObject({
      status: "INSUFFICIENT",
      reason: "OPEN_BEYOND_SNAPSHOT",
    });
  });

  it("attests an open record up to the bound, bound included", () => {
    expect(resolve({ civilDate: OPEN_BOUND.date, memberships: [inG1] })).toMatchObject({
      status: "ATTESTED_GROUP",
      level: "INTERVAL_ONLY",
    });
  });

  it("is not attested when an undecidable record sits next to a clean one: the clean one is not enough", () => {
    const unknownEnd = membership("u", "PA_T01", "PO_G3", "2022-06-29", "UNKNOWN");
    expect(resolve({ memberships: [inG1, unknownEnd] })).toMatchObject({
      status: "INSUFFICIENT",
      reason: "END_STATE_UNKNOWN",
    });
  });

  it("reports the reasons in a fixed order, whatever the order of the records", () => {
    const unknownEnd = membership("a", "PA_T01", "PO_G1", "2022-06-29", "UNKNOWN");
    const unknownStart = membership("b", "PA_T01", "PO_G1", null, "2023-06-01");
    const one = resolve({ memberships: [unknownEnd, unknownStart] });
    const two = resolve({ memberships: [unknownStart, unknownEnd] });
    expect(one).toMatchObject({ reason: "START_DATE_UNKNOWN" });
    expect(two).toMatchObject({ reason: "START_DATE_UNKNOWN" });
  });
});

describe("no fallback of any kind", () => {
  it("never answers a group when the person has no record and no vote, whatever the day", () => {
    const start = Date.UTC(2022, 5, 1);
    for (let offset = 0; offset < 1200; offset += 7) {
      const day = new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
      expect(resolve({ civilDate: d(day), memberships: [] })).toEqual({
        status: "UNKNOWN",
        reason: "NO_RECORD",
      });
    }
  });

  it("only attests an organ that a record covers or that the vote published", () => {
    const records = [
      membership("a", "PA_T01", "PO_NI", "2022-06-22", "2022-06-28"),
      membership("b", "PA_T01", "PO_G1", "2022-06-29", "2023-03-10"),
      membership("c", "PA_T01", "PO_G3", "2023-03-11", "OPEN"),
    ];
    const start = Date.UTC(2022, 5, 20);
    for (let offset = 0; offset < 700; offset += 1) {
      const day = new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
      const result = resolve({ civilDate: d(day), memberships: records });
      if (result.status !== "ATTESTED_GROUP" && result.status !== "ATTESTED_NON_INSCRIT") continue;
      const covering = records.filter(
        (r) =>
          r.startDate !== null && r.startDate <= day && (r.endDate === null || day <= r.endDate)
      );
      expect(covering.map((r) => r.groupRef)).toContain(result.groupRef);
      // An edge day is never attested from intervals alone.
      expect(records.some((r) => r.startDate === day || r.endDate === day)).toBe(false);
    }
  });

  it("never answers the group of a later or an earlier period when the day is in a gap", () => {
    const records = [
      membership("a", "PA_T01", "PO_G1", "2022-06-29", "2022-12-01"),
      membership("b", "PA_T01", "PO_G3", "2023-06-01", "OPEN"),
    ];
    expect(resolve({ civilDate: d("2023-02-01"), memberships: records })).toEqual({
      status: "UNKNOWN",
      reason: "NO_RECORD",
    });
  });

  it("refuses an interpretation of the dates it does not implement", () => {
    const config = {
      ...base.config,
      dateSemantics: { ...base.config.dateSemantics, version: "v2" as unknown as "v1" },
    };
    expect(() => resolve({ config })).toThrow("Unknown date semantics");
  });
});

describe("a valid vote and interval evidence that cannot be placed (E2 indeterminate)", () => {
  // The vote lists the person under PO_G1.
  const vote = () => scrutinOf("PO_G1");
  const validG1 = membership("valid", "PA_T01", "PO_G1", "2022-06-29", "OPEN");
  const validG3 = membership("valid-g3", "PA_T01", "PO_G3", "2022-06-29", "OPEN");
  // Cannot be placed, and names another group: if it applied, it would contradict the vote.
  const unknownEndG3 = membership("unk-end", "PA_T01", "PO_G3", "2022-06-29", "UNKNOWN");
  // Cannot be placed, and names the group of the vote: it could only agree with it.
  const unknownEndG1 = membership("unk-end-g1", "PA_T01", "PO_G1", "2022-06-29", "UNKNOWN");
  const unknownStartG3 = membership("unk-start", "PA_T01", "PO_G3", null, "2023-06-01");
  const ghost = membership("ghost", "PA_T01", "PO_GHOST", "2022-06-29", "OPEN");

  const diagnosticsOf = (result: Resolution) =>
    "diagnostics" in result ? result.diagnostics : undefined;

  it("1. no relevant interval: the vote stands alone, with no uncertainty to report", () => {
    const ended = membership("old", "PA_T01", "PO_G3", "2022-06-29", "2022-12-01");
    const result = resolve({ memberships: [ended], scrutin: vote() });
    expect(result).toMatchObject({
      status: "ATTESTED_GROUP",
      groupRef: "PO_G1",
      level: "SCRUTIN_ONLY",
      diagnostics: [],
    });
  });

  it("2. indeterminate intervals and no valid one: SCRUTIN_ONLY, with the records and reasons reported", () => {
    const result = resolve({
      memberships: [unknownStartG3, unknownEndG3, ghost],
      scrutin: vote(),
    });
    expect(result).toMatchObject({
      status: "ATTESTED_GROUP",
      groupRef: "PO_G1",
      level: "SCRUTIN_ONLY",
    });
    expect(diagnosticsOf(result)).toEqual([
      {
        kind: "E2_INDETERMINATE",
        uncertain: [
          {
            sourceRecordId: "ghost",
            groupRef: "PO_GHOST",
            reason: "UNKNOWN_ORGAN",
            couldContradict: true,
          },
          {
            sourceRecordId: "unk-end",
            groupRef: "PO_G3",
            reason: "END_STATE_UNKNOWN",
            couldContradict: true,
          },
          {
            sourceRecordId: "unk-start",
            groupRef: "PO_G3",
            reason: "START_DATE_UNKNOWN",
            couldContradict: true,
          },
        ],
        withheldCorroboration: [],
      },
    ]);
  });

  it("2. an open record read after the bound of its snapshot is reported with its reason", () => {
    const result = resolve({
      civilDate: d("2027-01-01"),
      memberships: [membership("open", "PA_T01", "PO_G1", "2022-06-29", "OPEN")],
      scrutin: vote(),
    });
    expect(result).toMatchObject({ status: "ATTESTED_GROUP", level: "SCRUTIN_ONLY" });
    expect(diagnosticsOf(result)).toEqual([
      {
        kind: "E2_INDETERMINATE",
        uncertain: [
          {
            sourceRecordId: "open",
            groupRef: "PO_G1",
            reason: "OPEN_BEYOND_SNAPSHOT",
            couldContradict: false,
          },
        ],
        withheldCorroboration: [],
      },
    ]);
  });

  it("2. an indeterminate record of the same group as the vote is reported, and is no threat", () => {
    const result = resolve({ memberships: [unknownEndG1], scrutin: vote() });
    expect(result).toMatchObject({ status: "ATTESTED_GROUP", level: "SCRUTIN_ONLY" });
    expect(diagnosticsOf(result)).toMatchObject([
      { uncertain: [{ sourceRecordId: "unk-end-g1", couldContradict: false }] },
    ]);
  });

  it("3. a valid, identical interval and nothing indeterminate: BOTH, no diagnostic", () => {
    expect(resolve({ memberships: [validG1], scrutin: vote() })).toMatchObject({
      status: "ATTESTED_GROUP",
      level: "BOTH",
      diagnostics: [],
    });
  });

  it("3. a valid interval of the same group under another reference, through a validated decision: BOTH", () => {
    const g2 = membership("g2", "PA_T01", "PO_G2", "2022-06-29", "OPEN");
    expect(
      resolve({
        memberships: [g2],
        scrutin: scrutinOf("PO_G2B"),
        continuity: [CONTINUITY_DECISION],
      })
    ).toMatchObject({
      status: "ATTESTED_GROUP",
      groupRef: "PO_G2B",
      level: "BOTH",
      diagnostics: [],
    });
  });

  it("3. an indeterminate record that could only agree does not withhold the corroboration", () => {
    const result = resolve({ memberships: [validG1, unknownEndG1], scrutin: vote() });
    expect(result).toMatchObject({ status: "ATTESTED_GROUP", level: "BOTH" });
    expect(diagnosticsOf(result)).toMatchObject([
      {
        uncertain: [{ sourceRecordId: "unk-end-g1", couldContradict: false }],
        withheldCorroboration: [],
      },
    ]);
  });

  it("3. an indeterminate record of a group made the same by a validated decision is no threat", () => {
    const g2 = membership("g2", "PA_T01", "PO_G2", "2022-06-29", "OPEN");
    const g2b = membership("g2b-unknown", "PA_T01", "PO_G2B", "2022-06-29", "UNKNOWN");
    const result = resolve({
      memberships: [g2, g2b],
      scrutin: scrutinOf("PO_G2"),
      continuity: [CONTINUITY_DECISION],
    });
    expect(result).toMatchObject({ status: "ATTESTED_GROUP", groupRef: "PO_G2", level: "BOTH" });
  });

  it("4. valid and identical, but an indeterminate record could name another group: SCRUTIN_ONLY, never BOTH", () => {
    const result = resolve({ memberships: [validG1, unknownEndG3], scrutin: vote() });
    expect(result).toMatchObject({
      status: "ATTESTED_GROUP",
      groupRef: "PO_G1",
      level: "SCRUTIN_ONLY",
      viaLink: null,
    });
    expect(diagnosticsOf(result)).toEqual([
      {
        kind: "E2_INDETERMINATE",
        uncertain: [
          {
            sourceRecordId: "unk-end",
            groupRef: "PO_G3",
            reason: "END_STATE_UNKNOWN",
            couldContradict: true,
          },
        ],
        // The agreeing record is not lost: it is named, and withheld.
        withheldCorroboration: ["valid"],
      },
    ]);
    if (result.status !== "ATTESTED_GROUP") throw new Error("unreachable");
    expect(result.evidence).toEqual([
      { kind: "SCRUTIN_ATTESTATION", scrutinId: "S_TEST", publishedOrganRef: "PO_G1" },
    ]);
  });

  it("4. an indeterminate record that points at an organ nobody knows is a threat", () => {
    const result = resolve({ memberships: [validG1, ghost], scrutin: vote() });
    expect(result).toMatchObject({ status: "ATTESTED_GROUP", level: "SCRUTIN_ONLY" });
    expect(diagnosticsOf(result)).toMatchObject([
      {
        uncertain: [{ groupRef: "PO_GHOST", couldContradict: true }],
        withheldCorroboration: ["valid"],
      },
    ]);
  });

  it("4. withholds the corroboration of a reconciled group too, and says which records", () => {
    const g2 = membership("g2", "PA_T01", "PO_G2", "2022-06-29", "OPEN");
    const result = resolve({
      memberships: [g2, unknownEndG3],
      scrutin: scrutinOf("PO_G2B"),
      continuity: [CONTINUITY_DECISION],
    });
    expect(result).toMatchObject({
      status: "ATTESTED_GROUP",
      groupRef: "PO_G2B",
      level: "SCRUTIN_ONLY",
      viaLink: null,
    });
    expect(diagnosticsOf(result)).toMatchObject([{ withheldCorroboration: ["g2"] }]);
  });

  it("5. a valid interval that names another group is a conflict, indeterminate records or not", () => {
    const without = resolve({ memberships: [validG3], scrutin: vote() });
    const withUncertain = resolve({
      memberships: [validG3, unknownEndG3, unknownStartG3],
      scrutin: vote(),
    });
    expect(without).toMatchObject({
      status: "CONFLICT",
      kind: "SOURCES_DISAGREE",
      diagnostics: [],
    });
    expect(withUncertain).toMatchObject({ status: "CONFLICT", kind: "SOURCES_DISAGREE" });
    expect(diagnosticsOf(withUncertain)).toMatchObject([
      { uncertain: [{ sourceRecordId: "unk-end" }, { sourceRecordId: "unk-start" }] },
    ]);
  });

  it("6. several valid intervals that name different groups are a conflict", () => {
    const result = resolve({ memberships: [validG1, validG3, unknownEndG1], scrutin: vote() });
    expect(result).toMatchObject({ status: "CONFLICT", kind: "MULTIPLE_ORGANS" });
    expect(diagnosticsOf(result)).toMatchObject([
      { uncertain: [{ sourceRecordId: "unk-end-g1" }] },
    ]);
  });

  it("7. an invalid vote stays INSUFFICIENT, whatever the intervals say: no fallback", () => {
    for (const published of ["PO0", "PO_NOWHERE"]) {
      for (const memberships of [[validG1], [validG1, unknownEndG3], [unknownEndG3], []]) {
        const result = resolve({ memberships, scrutin: scrutinOf(published) });
        expect(result.status).toBe("INSUFFICIENT");
        expect(result).toMatchObject({ reason: published === "PO0" ? "PO0" : "UNKNOWN_ORGAN" });
      }
    }
  });

  it("8. without a vote, an indeterminate record forbids a certain attribution, valid interval or not", () => {
    for (const memberships of [
      [unknownEndG3],
      [validG1, unknownEndG3],
      [validG1, unknownEndG1],
      [validG1, ghost],
    ]) {
      expect(resolve({ memberships })).toMatchObject({ status: "INSUFFICIENT" });
    }
    expect(resolve({ memberships: [validG1, unknownEndG3] })).toMatchObject({
      reason: "END_STATE_UNKNOWN",
    });
  });

  it("tells apart no corroboration, indeterminate corroboration and an effective contradiction", () => {
    const none = resolve({ memberships: [], scrutin: vote() });
    const indeterminate = resolve({ memberships: [unknownEndG3], scrutin: vote() });
    const contradiction = resolve({ memberships: [validG3], scrutin: vote() });
    // Same level for the first two, and the vote is kept: but only the second says why.
    expect(none).toMatchObject({
      status: "ATTESTED_GROUP",
      level: "SCRUTIN_ONLY",
      diagnostics: [],
    });
    expect(indeterminate).toMatchObject({ status: "ATTESTED_GROUP", level: "SCRUTIN_ONLY" });
    expect(diagnosticsOf(indeterminate)).toHaveLength(1);
    expect(diagnosticsOf(none)).toHaveLength(0);
    // A real contradiction is not attested at all.
    expect(contradiction.status).toBe("CONFLICT");
  });

  it("reports the same diagnostic whatever the order of the records", () => {
    const records = [unknownStartG3, ghost, validG1, unknownEndG3, unknownEndG1];
    const one = resolve({ memberships: records, scrutin: vote() });
    const two = resolve({ memberships: [...records].reverse(), scrutin: vote() });
    expect(two).toEqual(one);
  });

  it("keeps an attested non-registration, with its diagnostic, when intervals cannot be placed", () => {
    const result = resolve({ memberships: [unknownEndG3], scrutin: scrutinOf("PO_NI") });
    expect(result).toMatchObject({
      status: "ATTESTED_NON_INSCRIT",
      level: "SCRUTIN_ONLY",
      transitional: null,
    });
    expect(diagnosticsOf(result)).toHaveLength(1);
  });
});
