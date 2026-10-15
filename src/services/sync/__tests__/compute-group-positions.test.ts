import { describe, it, expect, vi } from "vitest";

const queries = vi.hoisted(() => ({ raw: [] as string[] }));

vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      queries.raw.push(strings.join("?"));
      return [];
    }),
    scrutinGroupPosition: { upsert: vi.fn() },
  },
}));

import {
  aggregateGroupVotes,
  computeGroupPositions,
  computeGroupPositionsForScrutin,
} from "../compute-group-positions";

describe("calcul des positions : pas d'attribution anachronique", () => {
  it("n'associe un vote qu'au groupe de la législature du scrutin (tous les scrutins)", async () => {
    queries.raw.length = 0;
    await computeGroupPositions();
    expect(queries.raw[0]).toContain("g.legislature = s.legislature");
    expect(queries.raw[0]).toContain("g.chamber = s.chamber");
  });

  it("applique la même règle au calcul d'un seul scrutin", async () => {
    queries.raw.length = 0;
    await computeGroupPositionsForScrutin("s1");
    expect(queries.raw[0]).toContain("g.legislature = s.legislature");
  });
});

describe("aggregateGroupVotes", () => {
  it("determines majority position and cohesion", () => {
    const result = aggregateGroupVotes([
      { position: "POUR" },
      { position: "POUR" },
      { position: "POUR" },
      { position: "CONTRE" },
      { position: "ABSTENTION" },
    ]);

    expect(result!.position).toBe("POUR");
    expect(result!.forCount).toBe(3);
    expect(result!.againstCount).toBe(1);
    expect(result!.abstainCount).toBe(1);
    expect(result!.cohesionPct).toBeCloseTo(60, 0);
  });

  it("excludes NON_VOTANT and ABSENT from counts", () => {
    const result = aggregateGroupVotes([
      { position: "POUR" },
      { position: "POUR" },
      { position: "ABSENT" },
      { position: "NON_VOTANT" },
    ]);

    expect(result!.forCount).toBe(2);
    expect(result!.againstCount).toBe(0);
    expect(result!.abstainCount).toBe(0);
    expect(result!.cohesionPct).toBe(100);
  });

  it("returns null when all members are absent", () => {
    const result = aggregateGroupVotes([{ position: "ABSENT" }, { position: "NON_VOTANT" }]);
    expect(result).toBeNull();
  });

  it("handles tie by choosing the first in POUR > CONTRE > ABSTENTION order", () => {
    const result = aggregateGroupVotes([{ position: "POUR" }, { position: "CONTRE" }]);
    expect(result!.position).toBe("POUR");
    expect(result!.cohesionPct).toBeCloseTo(50, 0);
  });
});
