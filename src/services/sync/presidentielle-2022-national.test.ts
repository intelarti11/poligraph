import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import {
  CANDIDATES_2022,
  ROUND_TOTALS_2022,
  decideLink,
  findExisting,
  participationPct,
  targetFields,
} from "./presidentielle-2022-national";

const byName = (name: string) => CANDIDATES_2022.find((c) => c.candidateName === name)!;

describe("résultats nationaux 2022 (Conseil constitutionnel)", () => {
  it("les voix des candidats font exactement les suffrages exprimés de chaque tour", () => {
    const t1 = CANDIDATES_2022.reduce((s, c) => s + c.round1Votes, 0);
    const t2 = CANDIDATES_2022.reduce((s, c) => s + (c.round2Votes ?? 0), 0);
    expect(t1).toBe(ROUND_TOTALS_2022[1].validVotes);
    expect(t2).toBe(ROUND_TOTALS_2022[2].validVotes);
  });

  it("votants = blancs + nuls + exprimés", () => {
    for (const t of Object.values(ROUND_TOTALS_2022)) {
      expect(t.blankVotes + t.nullVotes + t.validVotes).toBe(t.actualVoters);
    }
  });

  it("donne les parts publiées, qualification et élection", () => {
    expect(targetFields(byName("Emmanuel Macron"))).toEqual({
      round1Votes: 9_783_058,
      round1Pct: 27.85,
      round1Qualified: true,
      round2Votes: 18_768_639,
      round2Pct: 58.55,
      isElected: true,
    });
    expect(targetFields(byName("Anne Hidalgo")).round1Pct).toBe(1.75);
    expect(targetFields(byName("Jean-Luc Mélenchon")).round1Qualified).toBe(false);
    expect(CANDIDATES_2022.filter((c) => c.isElected)).toHaveLength(1);
    expect(participationPct(ROUND_TOTALS_2022[1])).toBe(73.69);
    expect(participationPct(ROUND_TOTALS_2022[2])).toBe(71.99);
  });
});

describe("decideLink", () => {
  const lassalle = byName("Jean Lassalle");

  it("retire le lien vers une fiche homonyme", () => {
    const d = decideLink(
      lassalle,
      {
        id: "c",
        candidateName: "Jean Lassalle",
        politicianId: "p",
        politicianWikidataIds: ["Q65587881"],
      },
      []
    );
    expect(d.action).toBe("unlink");
  });

  it("garde le lien vers la bonne fiche", () => {
    const d = decideLink(
      lassalle,
      {
        id: "c",
        candidateName: "Jean Lassalle",
        politicianId: "p",
        politicianWikidataIds: ["Q3173022"],
      },
      []
    );
    expect(d).toEqual({ action: "keep" });
  });

  it("ne rattache une nouvelle candidature qu'à une fiche portant l'élément Wikidata", () => {
    const arthaud = byName("Nathalie Arthaud");
    expect(decideLink(arthaud, null, [{ id: "p1", wikidataIds: ["Q439490"] }])).toEqual({
      action: "link",
      politicianId: "p1",
    });
    expect(decideLink(arthaud, null, [{ id: "p1", wikidataIds: [] }]).action).toBe("none");
    expect(decideLink(arthaud, null, []).action).toBe("none");
  });
});

describe("findExisting", () => {
  it("rapproche par nom normalisé et refuse les doublons", () => {
    const rows = [{ candidateName: "Eric Zemmour" }];
    expect(findExisting(byName("Éric Zemmour"), rows)).toBe(rows[0]);
    expect(findExisting(byName("Philippe Poutou"), rows)).toBeNull();
    expect(() =>
      findExisting(byName("Éric Zemmour"), [...rows, { candidateName: "ÉRIC ZEMMOUR" }])
    ).toThrow(/Plusieurs/);
  });
});
