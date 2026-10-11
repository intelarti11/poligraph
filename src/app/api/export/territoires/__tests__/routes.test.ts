import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * withCache is NOT stubbed here: the CDN policy and the purge tag are part of what these routes
 * promise (see ../../__tests__/cdn-cache.test.ts for the older exports).
 */
const mocks = vi.hoisted(() => ({
  getCommuneExportRows: vi.fn(),
  getDepartementExportRows: vi.fn(),
  getRegionExportRows: vi.fn(),
}));

vi.mock("@/lib/data/territoires-exports", () => ({
  getCommuneExportRows: (code: string) => mocks.getCommuneExportRows(code),
  getDepartementExportRows: () => mocks.getDepartementExportRows(),
  getRegionExportRows: () => mocks.getRegionExportRows(),
}));

import { GET as communes } from "../communes/[departement]/route";
import { GET as departements } from "../departements/route";
import { GET as regions } from "../regions/route";

function call(
  handler: typeof communes,
  path: string,
  params: Record<string, string> = {}
): Promise<Response> {
  return handler(new NextRequest(`https://poligraph.fr${path}`), {
    params: Promise.resolve(params),
  });
}

describe("exports CSV Territoires", () => {
  beforeEach(() => {
    mocks.getCommuneExportRows.mockReset().mockResolvedValue([]);
    mocks.getDepartementExportRows.mockResolvedValue([]);
    mocks.getRegionExportRows.mockResolvedValue([]);
  });

  it.each(["984", "../35", "35%2F..", "ZZ", "2C"])(
    "answers 404 for %s without reading the base",
    async (code) => {
      const res = await call(communes, `/api/export/territoires/communes/${code}`, {
        departement: code,
      });
      expect(res.status).toBe(404);
      expect(mocks.getCommuneExportRows).not.toHaveBeenCalled();
    }
  );

  it("normalises the code before reading and naming the file", async () => {
    const res = await call(communes, "/api/export/territoires/communes/2a", { departement: "2a" });
    expect(res.status).toBe(200);
    expect(mocks.getCommuneExportRows).toHaveBeenCalledWith("2A");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="communes-2A-\d{4}-\d{2}-\d{2}\.csv"$/
    );
  });

  it("neutralises formula-leading cells in the served file", async () => {
    mocks.getCommuneExportRows.mockResolvedValue([{ code_insee: "97411", nom: "=1+1" }]);
    const res = await call(communes, "/x", { departement: "974" });
    expect(await res.text()).toContain("'=1+1");
  });

  it.each([
    ["communes", () => call(communes, "/x", { departement: "974" })],
    ["departements", () => call(departements, "/x")],
    ["regions", () => call(regions, "/x")],
  ] as const)("%s: UTF-8 BOM, CDN cache, purge tag and licence link", async (_name, run) => {
    const res = await run();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(res.headers.get("Vercel-CDN-Cache-Control")).toBe(
      "public, s-maxage=86400, stale-while-revalidate=604800"
    );
    const tags = res.headers.get("Vercel-Cache-Tag")?.split(",") ?? [];
    expect(tags).toEqual(expect.arrayContaining(["export:territories", "exports"]));
    expect(res.headers.get("Link")).toContain(
      'opendatacommons.org/licenses/odbl/1-0/>; rel="license"'
    );
  });
});
