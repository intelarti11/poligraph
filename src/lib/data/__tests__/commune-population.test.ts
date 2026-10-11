import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn(), syncFindUnique: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { $queryRaw: mocks.queryRaw, syncMetadata: { findUnique: mocks.syncFindUnique } },
}));

import {
  isMissingTableError,
  readDepartementPopulationVintages,
  readPopulationEnVigueur,
} from "../commune-population";

const MISSING_TABLE = Object.assign(new Error("relation does not exist"), {
  code: "P2010",
  meta: { driverAdapterError: { cause: { kind: "TableDoesNotExist" } } },
});

const ROW = {
  populationMunicipale: 230890,
  millesime: 2023,
  effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  producer: "INSEE",
  sourceLabel: "INSEE, populations de référence 2023",
  sourceUrl: "https://www.insee.fr/fr/statistiques/8680726",
  importedAt: new Date("2026-10-11T08:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.syncFindUnique.mockResolvedValue({ lastSyncAt: new Date("2026-12-01T06:00:00Z") });
});

describe("readPopulationEnVigueur", () => {
  it("renvoie la population et son millésime, dates en ISO", async () => {
    mocks.queryRaw.mockResolvedValue([ROW]);
    await expect(readPopulationEnVigueur("35238")).resolves.toEqual({
      value: 230890,
      vintage: {
        millesime: 2023,
        effectiveFrom: "2026-01-01",
        producer: "INSEE",
        sourceLabel: ROW.sourceLabel,
        sourceUrl: ROW.sourceUrl,
        importedAt: "2026-10-11T08:00:00.000Z",
      },
      verifiedAt: "2026-12-01T06:00:00.000Z",
    });
  });

  it("retombe sur la date d'import de la ligne sans date de vérification", async () => {
    mocks.queryRaw.mockResolvedValue([ROW]);
    mocks.syncFindUnique.mockResolvedValue(null);
    const result = await readPopulationEnVigueur("35238");
    expect(result?.verifiedAt).toBe("2026-10-11T08:00:00.000Z");
  });

  it("filtre sur la date du jour côté base, jamais un millésime pas encore en vigueur", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await readPopulationEnVigueur("35238");
    const sql = mocks.queryRaw.mock.calls[0]![0] as { strings: string[] };
    expect(sql.strings.join("?")).toMatch(/"effectiveFrom" <= CURRENT_DATE/);
  });

  it("renvoie null sans série", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await expect(readPopulationEnVigueur("98901")).resolves.toBeNull();
  });

  it("tolère une table pas encore créée, mais laisse passer toute autre erreur", async () => {
    mocks.queryRaw.mockRejectedValueOnce(MISSING_TABLE);
    await expect(readPopulationEnVigueur("35238")).resolves.toBeNull();
    mocks.queryRaw.mockRejectedValueOnce(new Error("timeout"));
    await expect(readPopulationEnVigueur("35238")).rejects.toThrow("timeout");
  });
});

describe("readDepartementPopulationVintages", () => {
  it("liste les millésimes en vigueur avec le nombre de communes couvertes", async () => {
    const { populationMunicipale: _unused, ...vintage } = ROW;
    mocks.queryRaw.mockResolvedValue([{ ...vintage, communes: 17 }]);
    const result = await readDepartementPopulationVintages("976");
    expect(result).toEqual([expect.objectContaining({ millesime: 2023, communes: 17 })]);
  });

  it("tolère une table pas encore créée", async () => {
    mocks.queryRaw.mockRejectedValueOnce(MISSING_TABLE);
    await expect(readDepartementPopulationVintages("35")).resolves.toEqual([]);
    expect(isMissingTableError(new Error("x"))).toBe(false);
  });
});
