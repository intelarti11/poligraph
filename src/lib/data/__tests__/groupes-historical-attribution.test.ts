import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  parliamentaryGroup: { findUnique: vi.fn() },
  scrutinGroupPosition: { findMany: vi.fn() },
}));

vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: dbMock }));

import {
  getGroupKeyVotes,
  getScrutinGroupPositions,
  getScrutinGroupPositionsBatch,
} from "@/lib/data/groupes";

function row(
  id: string,
  scrutinId: string,
  scrutin: { chamber: "AN" | "SENAT"; legislature: number },
  group: { chamber: "AN" | "SENAT"; legislature: number | null }
) {
  return {
    id,
    scrutinId,
    position: "POUR",
    forCount: 10,
    againstCount: 0,
    abstainCount: 0,
    cohesionPct: 100,
    scrutin,
    group: {
      id: `g-${id}`,
      code: "SOC",
      name: "Socialistes",
      shortName: null,
      color: null,
      slug: "soc-an-17",
      ...group,
    },
  };
}

describe("positions de groupe : pas d'attribution anachronique", () => {
  beforeEach(() => vi.clearAllMocks());

  it("n'expose pas un vote de la 16e sous un groupe de la 17e", async () => {
    dbMock.scrutinGroupPosition.findMany.mockResolvedValue([
      row("old", "s16", { chamber: "AN", legislature: 16 }, { chamber: "AN", legislature: 17 }),
    ]);

    expect(await getScrutinGroupPositions("s16")).toEqual([]);
  });

  it("garde la position d'un scrutin de la 17e et retire les champs de contrôle", async () => {
    dbMock.scrutinGroupPosition.findMany.mockResolvedValue([
      row("ok", "s17", { chamber: "AN", legislature: 17 }, { chamber: "AN", legislature: 17 }),
    ]);

    const [position] = await getScrutinGroupPositions("s17");

    expect(position?.id).toBe("ok");
    expect(position).not.toHaveProperty("scrutin");
    expect(position?.group).not.toHaveProperty("legislature");
    expect(position?.group).not.toHaveProperty("chamber");
  });

  it("filtre aussi le listing par lot", async () => {
    dbMock.scrutinGroupPosition.findMany.mockResolvedValue([
      row("old", "s16", { chamber: "AN", legislature: 16 }, { chamber: "AN", legislature: 17 }),
      row("ok", "s17", { chamber: "AN", legislature: 17 }, { chamber: "AN", legislature: 17 }),
    ]);

    const map = await getScrutinGroupPositionsBatch(["s16", "s17"]);

    expect(map.has("s16")).toBe(false);
    expect(map.get("s17")?.map((p) => p.id)).toEqual(["ok"]);
  });

  it("limite les votes clés d'un groupe AN à sa propre législature", async () => {
    dbMock.parliamentaryGroup.findUnique.mockResolvedValue({ chamber: "AN", legislature: 17 });
    dbMock.scrutinGroupPosition.findMany.mockResolvedValue([]);

    await getGroupKeyVotes("g1");

    expect(dbMock.scrutinGroupPosition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { groupId: "g1", scrutin: { legislature: 17 } },
      })
    );
  });

  it("ne publie aucun vote clé pour un groupe AN sans législature", async () => {
    dbMock.parliamentaryGroup.findUnique.mockResolvedValue({ chamber: "AN", legislature: null });

    expect(await getGroupKeyVotes("g1")).toEqual([]);
    expect(dbMock.scrutinGroupPosition.findMany).not.toHaveBeenCalled();
  });
});
