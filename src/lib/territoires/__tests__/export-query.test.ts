import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: (...args: unknown[]) => mocks.queryRaw(...args),
    syncMetadata: {
      findUnique: (...args: unknown[]) => mocks.findUnique(...args),
      findMany: (...args: unknown[]) => mocks.findMany(...args),
    },
  },
}));

import {
  MAX_EXPORT_ROWS,
  queryCommuneExportRows,
  queryTerritoireReleases,
} from "@/lib/territoires/export-query";

const COMMUNE = {
  id: "97411",
  name: "Saint-Denis",
  departmentCode: "974",
  regionCode: "04",
  regionName: "La Réunion",
  population: 150000,
  constituencyNumber: 1,
};

function mayor(communeId: string, slug: string, publicationStatus = "PUBLISHED") {
  return {
    communeId,
    slug,
    fullName: slug,
    publicId: null,
    publicationStatus,
    lastConfirmedAt: null,
    source: "RNE",
  };
}

describe("queryCommuneExportRows", () => {
  beforeEach(() => {
    mocks.queryRaw.mockReset();
    mocks.findUnique.mockResolvedValue({ lastSyncAt: new Date("2026-08-10T00:00:00Z") });
  });

  it("counts mayors before the public filter: one public plus one private names nobody", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([COMMUNE])
      .mockResolvedValueOnce([mayor("97411", "public"), mayor("97411", "prive", "DRAFT")]);
    const [row] = await queryCommuneExportRows("974");
    expect(row!.maire_etat).toBe("NON_ETABLI");
    expect(row!.maire_nom).toBe("");
  });

  it("does not filter mayors on publication status in SQL", async () => {
    mocks.queryRaw.mockResolvedValueOnce([COMMUNE]).mockResolvedValueOnce([]);
    await queryCommuneExportRows("974");
    const mayorSql = (mocks.queryRaw.mock.calls[1]![0] as { strings: string[] }).strings.join("?");
    expect(mayorSql).not.toMatch(/"publicationStatus"\s*=/);
    expect(mayorSql).toContain(`"sectorLabel" IS NULL`);
  });

  it("binds the department code as a parameter, never in the SQL text", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await queryCommuneExportRows("974");
    const sql = mocks.queryRaw.mock.calls[0]![0] as { strings: string[]; values: unknown[] };
    expect(sql.strings.join("")).not.toContain("974");
    expect(sql.values).toContain("974");
  });

  it("refuses a file above the row cap", async () => {
    mocks.queryRaw.mockResolvedValueOnce(
      Array.from({ length: MAX_EXPORT_ROWS + 1 }, (_, i) => ({ ...COMMUNE, id: String(i) }))
    );
    await expect(queryCommuneExportRows(null)).rejects.toThrow(/50000/);
  });
});

describe("queryTerritoireReleases", () => {
  it("reads one release per row and skips a malformed one", async () => {
    mocks.findMany.mockResolvedValue([
      {
        sourceKey: "territoires-release:communes:2026-10-11",
        itemCount: 34963,
        contentHash: "abc",
        extra: { url: "https://blob.example/communes-france-2026-10-11.csv", byteSize: 10327467 },
      },
      { sourceKey: "territoires-release:communes:2026-09-01", itemCount: 1, extra: null },
    ]);
    expect(await queryTerritoireReleases()).toEqual([
      {
        day: "2026-10-11",
        url: "https://blob.example/communes-france-2026-10-11.csv",
        byteSize: 10327467,
        rowCount: 34963,
        sha256: "abc",
      },
    ]);
  });
});
