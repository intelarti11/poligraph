import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ scrutinFindMany: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { scrutin: { findMany: mocks.scrutinFindMany } } }));

import { GENERATORS } from "../generators";

const recent = { entityIds: new Set<string>() };

function scrutinWithVotes(legislature: number) {
  const votes = Array.from({ length: 60 }, (_, i) => ({
    position: i % 2 === 0 ? "POUR" : "CONTRE",
    politician: { mandates: [] },
  }));
  return {
    id: "s",
    slug: "s",
    title: "Texte",
    chamber: "AN",
    legislature,
    votingDate: new Date(),
    votesFor: 30,
    votesAgainst: 30,
    votesAbstain: 0,
    result: "REJECTED",
    votes,
  };
}

describe("générateur « votes clivants » : groupe actuel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ignore un scrutin AN qui n'est pas de la législature courante", async () => {
    mocks.scrutinFindMany.mockResolvedValue([scrutinWithVotes(16)]);

    expect(await GENERATORS.votes!(recent)).toEqual([]);
  });
});
