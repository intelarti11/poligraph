import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  syncFindMany: vi.fn(),
  electionFindUnique: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: mocks.queryRaw,
    syncMetadata: { findMany: mocks.syncFindMany },
    election: { findUnique: mocks.electionFindUnique },
  },
}));

import { readCommunePresidentielles } from "../territoires-presidentielle";

function row(
  round: number,
  validVotes: number | null,
  candidats: Array<{ name: string; votes: number }> | null
) {
  return {
    electionId: "e22",
    slug: "presidentielle-2022",
    title: "Élection présidentielle de 2022",
    shortTitle: "Présidentielle 2022",
    round1Date: new Date("2022-04-10T00:00:00Z"),
    round2Date: new Date("2022-04-24T00:00:00Z"),
    round,
    registeredVoters: 1000,
    actualVoters: 800,
    participationRate: "80.00",
    blankVotes: 10,
    nullVotes: 5,
    validVotes,
    lastSyncAt: new Date("2026-10-12T08:00:00Z"),
    candidats,
  };
}

/** Text of the tagged template passed to $queryRaw. */
function sqlOf(call: unknown[]): string {
  const sql = call[0] as { strings?: string[]; sql?: string };
  return sql.sql ?? sql.strings?.join("?") ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.syncFindMany.mockResolvedValue([]);
});

describe("readCommunePresidentielles", () => {
  it("lit tout en une requête, trie par voix et calcule la part des exprimés", async () => {
    mocks.queryRaw.mockResolvedValue([
      row(1, 785, [
        { name: "Marine Le Pen", votes: 200 },
        { name: "Emmanuel Macron", votes: 300 },
      ]),
      row(2, 700, [
        { name: "Marine Le Pen", votes: 280 },
        { name: "Emmanuel Macron", votes: 420 },
      ]),
    ]);

    const { blocks, agregatTerritoire } = await readCommunePresidentielles("35238", "35");

    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.syncFindMany).not.toHaveBeenCalled();
    const sql = sqlOf(mocks.queryRaw.mock.calls[0]!);
    expect(sql).toContain("LIMIT");
    expect(sql).toContain("'PRESIDENTIELLE'");
    expect(agregatTerritoire).toBeNull();
    expect(blocks).toHaveLength(1);
    const [t1, t2] = blocks[0]!.tours;
    expect(t1!.candidats.map((c) => c.name)).toEqual(["Emmanuel Macron", "Marine Le Pen"]);
    expect(t1!.candidats[0]!.pct).toBe(38.22);
    expect(t1!.participationRate).toBe(80);
    expect(t2!.candidats[0]!.pct).toBe(60);
    expect(blocks[0]!.title).toBe("Présidentielle 2022");
    expect(blocks[0]!.sources.map((s) => s.round)).toEqual([1, 2]);
    expect(blocks[0]!.importedAt).toBe("2026-10-12T08:00:00.000Z");
  });

  it("ne donne aucune part quand les exprimés de la commune sont inconnus", async () => {
    mocks.queryRaw.mockResolvedValue([row(1, null, [{ name: "Emmanuel Macron", votes: 300 }])]);
    const { blocks } = await readCommunePresidentielles("35238", "35");
    expect(blocks[0]!.tours[0]!.candidats[0]).toEqual({
      name: "Emmanuel Macron",
      votes: 300,
      pct: null,
    });
    expect(blocks[0]!.sources.map((s) => s.round)).toEqual([1]);
  });

  it("garde une participation sans voix enregistrées", async () => {
    mocks.queryRaw.mockResolvedValue([row(1, 785, null)]);
    const { blocks } = await readCommunePresidentielles("35238", "35");
    expect(blocks[0]!.tours[0]!.candidats).toEqual([]);
  });

  it("ne renvoie rien pour une commune sans résultat publié", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    const out = await readCommunePresidentielles("98411", "984");
    expect(out).toEqual({ blocks: [], agregatTerritoire: null });
  });

  it("ne plante pas tant que la table des voix n'existe pas", async () => {
    mocks.queryRaw.mockRejectedValue(
      new Error('Raw query failed. Code: `42P01`. relation "CommuneCandidacyResult" does not exist')
    );
    expect(await readCommunePresidentielles("35238", "35")).toEqual({
      blocks: [],
      agregatTerritoire: null,
    });
  });

  it("propage toute autre erreur", async () => {
    mocks.queryRaw.mockRejectedValue(new Error("connection reset"));
    await expect(readCommunePresidentielles("35238", "35")).rejects.toThrow("connection reset");
  });

  it("signale Wallis-et-Futuna, publié en un seul agrégat, une fois l'import fait", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    expect((await readCommunePresidentielles("98611", "986")).agregatTerritoire).toBeNull();

    mocks.syncFindMany.mockResolvedValue([
      { sourceKey: "presidentielle-communes:presidentielle-2022" },
    ]);
    mocks.electionFindUnique.mockResolvedValue({
      title: "Élection présidentielle de 2022",
      shortTitle: "Présidentielle 2022",
    });
    expect((await readCommunePresidentielles("98611", "986")).agregatTerritoire).toEqual({
      territoire: "Wallis-et-Futuna",
      electionTitle: "Présidentielle 2022",
    });
  });
});
