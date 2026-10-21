import { describe, expect, it } from "vitest";
import {
  COUNT_POSITIONS,
  deriveCountCheck,
  diffOf,
  groupCoherence,
  scrutinCoherence,
  type GroupCountInput,
  type PositionCounts,
} from "../count-check";
import { parseScrutin, type ParsedAnScrutin } from "../parse-scrutin";
import { scrutinFile, type GroupSpec } from "../__fixtures__/official-files";

const counts = (pour = 0, contre = 0, abstention = 0, nonVotant = 0): PositionCounts => ({
  pour,
  contre,
  abstention,
  nonVotant,
});

describe("scrutinCoherence: the rule, on every combination", () => {
  const cases: [string, Parameters<typeof scrutinCoherence>[0], string][] = [
    [
      "a summary, nothing differs, nothing unverified",
      { mismatchedGroups: 0, unverifiableGroups: 0, summaryPresent: true, summaryDiffers: false },
      "COHERENT",
    ],
    [
      "a group differs",
      { mismatchedGroups: 1, unverifiableGroups: 0, summaryPresent: true, summaryDiffers: false },
      "COUNT_MISMATCH",
    ],
    [
      "the summary differs",
      { mismatchedGroups: 0, unverifiableGroups: 0, summaryPresent: true, summaryDiffers: true },
      "COUNT_MISMATCH",
    ],
    [
      "no summary",
      { mismatchedGroups: 0, unverifiableGroups: 0, summaryPresent: false, summaryDiffers: false },
      "UNVERIFIABLE",
    ],
    [
      "a group has no official count",
      { mismatchedGroups: 0, unverifiableGroups: 2, summaryPresent: true, summaryDiffers: false },
      "UNVERIFIABLE",
    ],
    [
      "a mismatch outranks a missing summary",
      { mismatchedGroups: 1, unverifiableGroups: 0, summaryPresent: false, summaryDiffers: false },
      "COUNT_MISMATCH",
    ],
    [
      "a mismatch outranks an unverified group",
      { mismatchedGroups: 1, unverifiableGroups: 3, summaryPresent: true, summaryDiffers: false },
      "COUNT_MISMATCH",
    ],
    [
      "a summary that differs is a mismatch even with an unverified group",
      { mismatchedGroups: 0, unverifiableGroups: 1, summaryPresent: true, summaryDiffers: true },
      "COUNT_MISMATCH",
    ],
    [
      "an absent summary has no difference to speak of",
      { mismatchedGroups: 0, unverifiableGroups: 0, summaryPresent: false, summaryDiffers: true },
      "UNVERIFIABLE",
    ],
  ];
  it.each(cases)("%s", (_label, parts, expected) => {
    expect(scrutinCoherence(parts)).toBe(expected);
  });
});

describe("deriveCountCheck", () => {
  const group = (
    organRef: string,
    nominal: PositionCounts,
    official: PositionCounts | null
  ): GroupCountInput => ({
    organRef,
    nominal,
    official,
  });

  it("keeps the nominal counts, the official counts, the differences and the status, per group and in total", () => {
    const check = deriveCountCheck({
      groups: [
        group("PO1", counts(4, 1), counts(5, 1)),
        group("PO2", counts(0, 2, 1), counts(0, 2, 1)),
      ],
      synthese: counts(5, 3, 1),
    });
    expect(check.nominal).toEqual(counts(4, 3, 1));
    expect(check.official).toEqual(counts(5, 3, 1));
    expect(check.diff).toEqual(counts(-1, 0, 0, 0));
    expect(check.groups.map((g) => [g.organRef, g.coherence, g.diff])).toEqual([
      ["PO1", "COUNT_MISMATCH", counts(-1, 0, 0, 0)],
      ["PO2", "COHERENT", counts(0, 0, 0, 0)],
    ]);
    expect(check).toMatchObject({
      groupCount: 2,
      mismatchedGroups: 1,
      unverifiableGroups: 0,
      coherence: "COUNT_MISMATCH",
    });
  });

  it("is COHERENT only with a summary, no difference and no group left unverified", () => {
    expect(
      deriveCountCheck({ groups: [group("PO1", counts(3), counts(3))], synthese: counts(3) })
        .coherence
    ).toBe("COHERENT");
    expect(
      deriveCountCheck({ groups: [group("PO1", counts(3), counts(3))], synthese: null }).coherence
    ).toBe("UNVERIFIABLE");
    expect(
      deriveCountCheck({ groups: [group("PO1", counts(3), null)], synthese: counts(3) }).coherence
    ).toBe("UNVERIFIABLE");
  });

  it("treats a difference on the non-voters alone as a mismatch", () => {
    const check = deriveCountCheck({
      groups: [group("PO1", counts(3, 0, 0, 0), counts(3, 0, 0, 0))],
      synthese: counts(3, 0, 0, 2),
    });
    expect(check.coherence).toBe("COUNT_MISMATCH");
    expect(check.diff).toEqual(counts(0, 0, 0, -2));
  });

  it("reports no difference when there is no official count to compare with", () => {
    expect(diffOf(counts(1, 2, 3, 4), null)).toBeNull();
    expect(groupCoherence(null, null)).toBe("UNVERIFIABLE");
  });

  it("refuses what the table could not hold: no group, a negative or a fractional count", () => {
    expect(() => deriveCountCheck({ groups: [], synthese: counts() })).toThrow();
    expect(() =>
      deriveCountCheck({ groups: [group("PO1", counts(-1), null)], synthese: null })
    ).toThrow();
    expect(() =>
      deriveCountCheck({ groups: [group("PO1", counts(1.5), null)], synthese: null })
    ).toThrow();
    expect(() =>
      deriveCountCheck({ groups: [group("PO1", counts(1), counts(-2))], synthese: null })
    ).toThrow();
  });

  it("does not modify its input", () => {
    const input = { groups: [group("PO1", counts(1), counts(2))], synthese: counts(2) };
    const before = JSON.stringify(input);
    deriveCountCheck(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------
// The parser and this file are two implementations of one rule.
// ---------------------------------------------------------------------------------------------

const an = (raw: unknown): ParsedAnScrutin => {
  const parsed = parseScrutin(raw);
  if (parsed.status !== "AN") throw new Error(`expected an AN scrutin, got ${parsed.status}`);
  return parsed.scrutin;
};

const fromParsed = (s: ParsedAnScrutin) =>
  deriveCountCheck({
    groups: s.groups.map((g) => ({
      organRef: g.organRef,
      nominal: g.nominal,
      official: g.official,
    })),
    synthese: s.synthese,
  });

describe("agreement with the parser", () => {
  const voter = (n: number) => ({ actor: `PA${n}` });

  it("agrees on the five situations the files show", () => {
    const base: GroupSpec[] = [
      { organ: "PO1", pour: [voter(1), voter(2)], contre: [voter(3)] },
      { organ: "PO2", abstention: [voter(4)] },
    ];
    const situations: [string, unknown][] = [
      ["coherent", scrutinFile("VTANR5L16V1", base)],
      [
        "a group differs",
        scrutinFile("VTANR5L16V2", [
          {
            ...(base[0] as GroupSpec),
            official: { pour: 3, contre: 1, abstention: 0, nonVotant: 0 },
          },
          base[1] as GroupSpec,
        ]),
      ],
      [
        "the summary differs",
        scrutinFile("VTANR5L16V3", base, {
          synthese: { pour: 9, contre: 1, abstention: 1, nonVotant: 0 },
        }),
      ],
      ["no summary", scrutinFile("VTANR5L16V4", base, { synthese: null })],
      [
        "a group without an official count",
        scrutinFile("VTANR5L16V5", [
          { ...(base[0] as GroupSpec), official: null },
          base[1] as GroupSpec,
        ]),
      ],
    ];
    const seen = new Set<string>();
    for (const [label, raw] of situations) {
      const parsed = an(raw);
      const derived = fromParsed(parsed);
      expect(derived.coherence, label).toBe(parsed.countCoherence);
      expect(derived.mismatchedGroups, label).toBe(parsed.mismatchedGroups);
      seen.add(derived.coherence);
    }
    expect([...seen].sort()).toEqual(["COHERENT", "COUNT_MISMATCH", "UNVERIFIABLE"]);
  });

  it("agrees on 600 scrutins drawn from a fixed pseudo-random sequence", () => {
    // A small linear congruential generator: the same 600 scrutins on every run.
    let seed = 20261018;
    const next = (max: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % max;
    };
    const tally: Record<string, number> = {};
    for (let i = 0; i < 600; i += 1) {
      let actor = 0;
      const groups: GroupSpec[] = Array.from({ length: 1 + next(4) }, (_, g) => {
        const list = (n: number) => Array.from({ length: n }, () => ({ actor: `PA${actor++}` }));
        const spec: GroupSpec = {
          organ: `PO${g + 1}`,
          pour: list(next(3)),
          contre: list(next(3)),
          abstention: list(next(2)),
          nonVotant: list(next(2)),
        };
        const nominal = {
          pour: spec.pour?.length ?? 0,
          contre: spec.contre?.length ?? 0,
          abstention: spec.abstention?.length ?? 0,
          nonVotant: spec.nonVotant?.length ?? 0,
        };
        const mode = next(6);
        spec.official =
          mode === 0
            ? null
            : mode === 1
              ? { ...nominal, pour: nominal.pour + 1 }
              : mode === 2
                ? { ...nominal, nonVotant: nominal.nonVotant + next(2) }
                : nominal;
        return spec;
      });
      const summed = (key: "pour" | "contre" | "abstention" | "nonVotant") =>
        groups.reduce((n, g) => n + (g[key]?.length ?? 0), 0);
      const total = {
        pour: summed("pour"),
        contre: summed("contre"),
        abstention: summed("abstention"),
        nonVotant: summed("nonVotant"),
      };
      const mode = next(5);
      const synthese =
        mode === 0 ? null : mode === 1 ? { ...total, contre: total.contre + 1 } : total;
      const parsed = an(scrutinFile(`VTANR5L16V${i}`, groups, { synthese }));
      const derived = fromParsed(parsed);
      expect(derived.coherence, `scrutin ${i}`).toBe(parsed.countCoherence);
      expect(derived.mismatchedGroups, `scrutin ${i}`).toBe(parsed.mismatchedGroups);
      expect(derived.nominal, `scrutin ${i}`).toEqual({
        pour: parsed.attestations.filter((a) => a.position === "pour").length,
        contre: parsed.attestations.filter((a) => a.position === "contre").length,
        abstention: parsed.attestations.filter((a) => a.position === "abstention").length,
        nonVotant: parsed.attestations.filter((a) => a.position === "nonVotant").length,
      });
      tally[derived.coherence] = (tally[derived.coherence] ?? 0) + 1;
    }
    // The draw reaches all three statuses, or the comparison above would prove little.
    expect(Object.keys(tally).sort()).toEqual(["COHERENT", "COUNT_MISMATCH", "UNVERIFIABLE"]);
    expect(COUNT_POSITIONS).toHaveLength(4);
  });
});
