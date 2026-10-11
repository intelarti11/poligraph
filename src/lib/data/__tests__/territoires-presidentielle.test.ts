import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  roundFindMany: vi.fn(),
  resultFindMany: vi.fn(),
  syncFindMany: vi.fn(),
  electionFindUnique: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    communeElectionRound: { findMany: mocks.roundFindMany },
    communeCandidacyResult: { findMany: mocks.resultFindMany },
    syncMetadata: { findMany: mocks.syncFindMany },
    election: { findUnique: mocks.electionFindUnique },
  },
}));

import { readCommunePresidentielles } from "../territoires-presidentielle";

const E2022 = {
  id: "e22",
  slug: "presidentielle-2022",
  title: "Élection présidentielle de 2022",
  shortTitle: "Présidentielle 2022",
  round1Date: new Date("2022-04-10T00:00:00Z"),
  round2Date: new Date("2022-04-24T00:00:00Z"),
};

function round(r: number, validVotes: number | null) {
  return {
    round: r,
    registeredVoters: 1000,
    actualVoters: 800,
    participationRate: 80,
    blankVotes: 10,
    nullVotes: 5,
    validVotes,
    election: E2022,
  };
}

function result(r: number, name: string, votes: number) {
  return { round: r, votes, candidacy: { electionId: "e22", candidateName: name } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.syncFindMany.mockResolvedValue([]);
});

describe("readCommunePresidentielles", () => {
  it("trie les candidats par voix et calcule la part des exprimés de la commune", async () => {
    mocks.roundFindMany.mockResolvedValue([round(1, 785), round(2, 700)]);
    mocks.resultFindMany.mockResolvedValue([
      result(1, "Marine Le Pen", 200),
      result(1, "Emmanuel Macron", 300),
      result(2, "Marine Le Pen", 280),
      result(2, "Emmanuel Macron", 420),
    ]);
    mocks.syncFindMany.mockResolvedValue([
      {
        sourceKey: "presidentielle-communes:presidentielle-2022",
        lastSyncAt: new Date("2026-10-12T08:00:00Z"),
      },
    ]);

    const { blocks, agregatTerritoire } = await readCommunePresidentielles("35238", "35");

    expect(agregatTerritoire).toBeNull();
    expect(blocks).toHaveLength(1);
    const [t1, t2] = blocks[0]!.tours;
    expect(t1!.candidats.map((c) => c.name)).toEqual(["Emmanuel Macron", "Marine Le Pen"]);
    expect(t1!.candidats[0]!.pct).toBe(38.22);
    expect(t2!.candidats[0]!.pct).toBe(60);
    expect(blocks[0]!.title).toBe("Présidentielle 2022");
    expect(blocks[0]!.sources.map((s) => s.round)).toEqual([1, 2]);
    expect(blocks[0]!.importedAt).toBe("2026-10-12T08:00:00.000Z");
    // Bounded reads.
    expect(mocks.roundFindMany.mock.calls[0]![0].take).toBeLessThanOrEqual(4);
    expect(mocks.resultFindMany.mock.calls[0]![0].take).toBeLessThanOrEqual(200);
  });

  it("ne donne aucune part quand les exprimés de la commune sont inconnus", async () => {
    mocks.roundFindMany.mockResolvedValue([round(1, null)]);
    mocks.resultFindMany.mockResolvedValue([result(1, "Emmanuel Macron", 300)]);
    const { blocks } = await readCommunePresidentielles("35238", "35");
    expect(blocks[0]!.tours[0]!.candidats[0]).toEqual({
      name: "Emmanuel Macron",
      votes: 300,
      pct: null,
    });
    expect(blocks[0]!.sources.map((s) => s.round)).toEqual([1]);
  });

  it("ne renvoie rien pour une commune sans résultat publié", async () => {
    mocks.roundFindMany.mockResolvedValue([]);
    const out = await readCommunePresidentielles("98411", "984");
    expect(out).toEqual({ blocks: [], agregatTerritoire: null });
    expect(mocks.resultFindMany).not.toHaveBeenCalled();
  });

  it("signale Wallis-et-Futuna, publié en un seul agrégat, une fois l'import fait", async () => {
    mocks.roundFindMany.mockResolvedValue([]);
    expect((await readCommunePresidentielles("98611", "986")).agregatTerritoire).toBeNull();

    mocks.syncFindMany.mockResolvedValue([
      { sourceKey: "presidentielle-communes:presidentielle-2022" },
    ]);
    mocks.electionFindUnique.mockResolvedValue({
      title: E2022.title,
      shortTitle: E2022.shortTitle,
    });
    expect((await readCommunePresidentielles("98611", "986")).agregatTerritoire).toEqual({
      territoire: "Wallis-et-Futuna",
      electionTitle: "Présidentielle 2022",
    });
  });
});
