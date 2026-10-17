import { describe, expect, it } from "vitest";
import { excludedBy, exclusionReasonOf, validateExclusionRules } from "../exclusion";
import { identityForPolitician, type ActorLinkDecision } from "../identity";
import { decidePositionPublication } from "../publication";
import { defaultRunConfig } from "../run-contract";
import { actor, ref } from "../__fixtures__/builders";
import {
  asScrutinId,
  EXCLUSION_REASONS,
  type ExclusionRule,
  type OrganTally,
  type Resolution,
} from "../types";

const RULES = defaultRunConfig([16]).exclusion.rules;

const attestedGroup: Resolution = {
  status: "ATTESTED_GROUP",
  groupRef: ref("PO_G1"),
  level: "BOTH",
  evidence: [],
  viaLink: null,
  diagnostics: [],
};

describe("exclusion", () => {
  it("leaves out nothing that is attested", () => {
    expect(exclusionReasonOf(attestedGroup)).toBeNull();
    expect(
      exclusionReasonOf({
        status: "ATTESTED_NON_INSCRIT",
        groupRef: ref("PO_NI"),
        level: "INTERVAL_ONLY",
        evidence: [],
        viaLink: null,
        diagnostics: [],
        transitional: true,
      })
    ).toBeNull();
    expect(excludedBy(attestedGroup, RULES)).toBeNull();
  });

  it.each<[string, Resolution, string, string]>([
    ["UNKNOWN", { status: "UNKNOWN", reason: "NO_RECORD" }, "NO_RECORD", "NO_RECORD"],
    [
      "CONFLICT",
      { status: "CONFLICT", kind: "MULTIPLE_ORGANS", candidates: [], diagnostics: [] },
      "CONFLICT",
      "SOURCES_DISAGREE",
    ],
    [
      "INSUFFICIENT PO0",
      { status: "INSUFFICIENT", reason: "PO0", evidence: [] },
      "PO0",
      "PUBLISHED_ORGAN_UNKNOWN",
    ],
    [
      "INSUFFICIENT EDGE_DAY",
      { status: "INSUFFICIENT", reason: "EDGE_DAY", evidence: [] },
      "EDGE_DAY",
      "EDGE_DAY_NO_SCRUTIN",
    ],
    [
      "INSUFFICIENT END_STATE_UNKNOWN",
      { status: "INSUFFICIENT", reason: "END_STATE_UNKNOWN", evidence: [] },
      "END_STATE_UNKNOWN",
      "DATE_UNDETERMINED",
    ],
    [
      "UNRESOLVED_IDENTITY",
      { status: "UNRESOLVED_IDENTITY", reason: "AMBIGUOUS_LINK" },
      "AMBIGUOUS_LINK",
      "IDENTITY_UNRESOLVED",
    ],
  ])(
    "leaves out a %s vote, under the rule that covers its reason",
    (_l, resolution, reason, rule) => {
      expect(exclusionReasonOf(resolution)).toBe(reason);
      expect(excludedBy(resolution, RULES)).toEqual({ ruleId: rule, reason });
    }
  );

  it("throws when a reason has no rule, instead of counting the vote somewhere", () => {
    const withoutConflict = RULES.filter((rule) => rule.id !== "SOURCES_DISAGREE");
    expect(() =>
      excludedBy(
        { status: "CONFLICT", kind: "SOURCES_DISAGREE", candidates: [], diagnostics: [] },
        withoutConflict
      )
    ).toThrow("No exclusion rule covers the reason CONFLICT");
  });

  describe("validateExclusionRules", () => {
    it("accepts the default rules: every reason is covered exactly once", () => {
      expect(validateExclusionRules(RULES)).toEqual([]);
      expect(RULES.flatMap((rule) => rule.reasons).sort()).toEqual([...EXCLUSION_REASONS].sort());
    });

    it("reports a reason that no rule covers", () => {
      const issues = validateExclusionRules(RULES.filter((rule) => rule.id !== "NO_RECORD"));
      expect(issues).toEqual(["reason NO_RECORD is covered by no rule"]);
    });

    it("reports a reason covered twice, an id used twice and an unknown reason", () => {
      const extra: ExclusionRule = { id: "NO_RECORD", reasons: ["CONFLICT"], action: "EXCLUDE" };
      const issues = validateExclusionRules([...RULES, extra]);
      expect(issues).toContain("rule id used twice: NO_RECORD");
      expect(issues).toContain("reason CONFLICT is covered by SOURCES_DISAGREE and NO_RECORD");
      const unknown = {
        id: "X",
        reasons: ["MADE_UP"],
        action: "EXCLUDE",
      } as unknown as ExclusionRule;
      expect(validateExclusionRules([...RULES, unknown])).toContain(
        "rule X: unknown reason MADE_UP"
      );
    });

    it("refuses any action other than EXCLUDE: no substitute group exists", () => {
      const fallback = { ...RULES[0], action: "USE_CURRENT_GROUP" } as unknown as ExclusionRule;
      expect(validateExclusionRules([fallback, ...RULES.slice(1)])).toContain(
        `rule ${RULES[0]?.id}: the only action is EXCLUDE`
      );
    });
  });
});

function tally(overrides: Partial<OrganTally> = {}): OrganTally {
  return {
    scrutinId: asScrutinId("S1"),
    groupRef: ref("PO_G1"),
    organKind: "GROUP",
    forCount: 10,
    againstCount: 5,
    abstainCount: 1,
    nonVoterCount: 2,
    excludedCount: 0,
    excludedByReason: {},
    ...overrides,
  };
}

describe("publication: editorial decisions, apart from the resolution", () => {
  const strict = { maxExcludedPerGroup: 0 };

  it("publishes a position when every vote of the group is attested", () => {
    expect(decidePositionPublication(tally(), strict)).toEqual({ publishable: true });
  });

  it("withholds a position as soon as one vote is left out, under the strict threshold", () => {
    expect(
      decidePositionPublication(
        tally({ excludedCount: 1, excludedByReason: { CONFLICT: 1 } }),
        strict
      )
    ).toEqual({ publishable: false, reason: "EXCLUDED_VOTES_PRESENT" });
  });

  it("takes the threshold from the configuration, and only the threshold changes the decision", () => {
    const withOneExcluded = tally({ excludedCount: 1 });
    const before = JSON.stringify(withOneExcluded);
    expect(decidePositionPublication(withOneExcluded, { maxExcludedPerGroup: 1 })).toEqual({
      publishable: true,
    });
    expect(decidePositionPublication(withOneExcluded, { maxExcludedPerGroup: 0 })).toEqual({
      publishable: false,
      reason: "EXCLUDED_VOTES_PRESENT",
    });
    // The counts of the run are untouched by the decision.
    expect(JSON.stringify(withOneExcluded)).toBe(before);
  });

  it("withholds a position that rests on no attested vote", () => {
    expect(
      decidePositionPublication(
        tally({ forCount: 0, againstCount: 0, abstainCount: 0, nonVoterCount: 3 }),
        strict
      )
    ).toEqual({ publishable: false, reason: "NO_ATTESTED_VOTE" });
  });

  it("does not present non-registered members as a group", () => {
    expect(decidePositionPublication(tally({ organKind: "NON_INSCRIT" }), strict)).toEqual({
      publishable: false,
      reason: "NON_INSCRIT_IS_NOT_A_GROUP",
    });
  });
});

describe("identityForPolitician", () => {
  const link = (
    officialId: string,
    politicianId: string | null,
    status: ActorLinkDecision["status"]
  ): ActorLinkDecision => ({ officialId: actor(officialId), politicianId, status });
  const profile = { politicianId: "pol-1", officialIdOnProfile: "PA_T01" };

  it.each(["LINKED_OFFICIAL_ID", "LINKED_EXTERNAL_ID", "LINKED_MANUAL"] as const)(
    "resolves a profile through a %s decision",
    (status) => {
      expect(identityForPolitician(profile, [link("PA_T01", "pol-1", status)])).toEqual({
        status: "RESOLVED",
        officialId: "PA_T01",
      });
    }
  );

  it("ignores decisions about other profiles", () => {
    expect(identityForPolitician(profile, [link("PA_T02", "pol-2", "LINKED_OFFICIAL_ID")])).toEqual(
      { status: "UNRESOLVED", reason: "NO_LINK" }
    );
  });

  it("is ambiguous when two actors are linked to the profile, or when a decision says so", () => {
    expect(
      identityForPolitician(profile, [
        link("PA_T01", "pol-1", "LINKED_OFFICIAL_ID"),
        link("PA_T09", "pol-1", "LINKED_MANUAL"),
      ])
    ).toEqual({ status: "UNRESOLVED", reason: "AMBIGUOUS_LINK" });
    expect(identityForPolitician(profile, [link("PA_T01", "pol-1", "AMBIGUOUS")])).toEqual({
      status: "UNRESOLVED",
      reason: "AMBIGUOUS_LINK",
    });
  });

  it("does not link a profile on a name or on an identifier it carries: it needs a decision", () => {
    expect(identityForPolitician(profile, [])).toEqual({ status: "UNRESOLVED", reason: "NO_LINK" });
    expect(identityForPolitician(profile, [link("PA_T01", null, "NONE")])).toEqual({
      status: "UNRESOLVED",
      reason: "NO_LINK",
    });
  });

  it("says NO_OFFICIAL_ID when the profile carries no official identifier and nothing links it", () => {
    expect(identityForPolitician({ politicianId: "pol-1", officialIdOnProfile: null }, [])).toEqual(
      { status: "UNRESOLVED", reason: "NO_OFFICIAL_ID" }
    );
  });
});
