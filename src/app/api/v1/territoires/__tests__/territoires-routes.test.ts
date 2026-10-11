import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCommuneDossier: vi.fn(),
  getDepartementTerritoire: vi.fn(),
  getRegionTerritoire: vi.fn(),
  getCommuneWithElus: vi.fn(),
}));

// The routes are thin: the contract under test is validation, status codes, cache headers and
// the fact that the body is exactly what the reader returned (same facts as the page).
vi.mock("@/lib/data/territoires", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/data/territoires");
  return {
    normalizeInseeCode: actual.normalizeInseeCode,
    normalizeDepartmentCode: actual.normalizeDepartmentCode,
    getCommuneDossier: mocks.getCommuneDossier,
    getDepartementTerritoire: mocks.getDepartementTerritoire,
    getRegionTerritoire: mocks.getRegionTerritoire,
  };
});
vi.mock("@/lib/data/elus", () => ({ getCommuneWithElus: mocks.getCommuneWithElus }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { NextRequest } from "next/server";
import { GET as getCommune } from "@/app/api/v1/territoires/communes/[code]/route";
import { GET as getDepartement } from "@/app/api/v1/territoires/departements/[code]/route";
import { GET as getRegion } from "@/app/api/v1/territoires/regions/[slug]/route";
import { GET as getLegacyCommune } from "@/app/api/v1/communes/[codeInsee]/route";
import { getRateLimitTier } from "@/proxy";

const BASE = "https://poligraph.fr/api/v1/territoires";

function call(
  handler: typeof getCommune,
  url: string,
  params: Record<string, string>
): Promise<Response> {
  return handler(new NextRequest(url), { params: Promise.resolve(params) });
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/v1/territoires/communes/[code]", () => {
  it("refuse un code mal formé sans lire la base", async () => {
    const res = await call(getCommune, `${BASE}/communes/abc`, { code: "abc" });
    expect(res.status).toBe(400);
    expect(mocks.getCommuneDossier).not.toHaveBeenCalled();
  });

  it("renvoie 404 pour une commune inconnue", async () => {
    mocks.getCommuneDossier.mockResolvedValue(null);
    const res = await call(getCommune, `${BASE}/communes/99999`, { code: "99999" });
    expect(res.status).toBe(404);
  });

  it("sert le dossier du lecteur tel quel, en cache public quotidien", async () => {
    const dossier = { identity: { inseeCode: "2A004" }, maire: { state: "NON_ETABLI" } };
    mocks.getCommuneDossier.mockResolvedValue(dossier);

    const res = await call(getCommune, `${BASE}/communes/2a004`, { code: "2a004" });

    expect(res.status).toBe(200);
    expect(mocks.getCommuneDossier).toHaveBeenCalledWith("2A004");
    expect(await res.json()).toEqual(dossier);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=120"
    );
  });

  it("répond 500 sans détail quand le lecteur échoue", async () => {
    mocks.getCommuneDossier.mockRejectedValue(new Error("secret interne"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call(getCommune, `${BASE}/communes/35238`, { code: "35238" });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});

describe("GET /api/v1/territoires/departements/[code]", () => {
  it.each([
    ["code", "/departements/1x?page=1", "1x"],
    ["page nulle", "/departements/13?page=0", "13"],
    ["page au-delà de 40", "/departements/13?page=41", "13"],
    ["page non entière", "/departements/13?page=1.5", "13"],
    ["lettre multiple", "/departements/13?lettre=AB", "13"],
    ["lettre non latine", "/departements/13?lettre=%C3%89", "13"],
  ])("refuse un paramètre invalide (%s)", async (_label, path, code) => {
    const res = await call(getDepartement, `${BASE}${path}`, { code });
    expect(res.status).toBe(400);
    expect(mocks.getDepartementTerritoire).not.toHaveBeenCalled();
  });

  it("transmet la page et la lettre au lecteur", async () => {
    mocks.getDepartementTerritoire.mockResolvedValue({ communes: { rows: [] } });
    const res = await call(getDepartement, `${BASE}/departements/2b?page=2&lettre=c`, {
      code: "2b",
    });
    expect(res.status).toBe(200);
    expect(mocks.getDepartementTerritoire).toHaveBeenCalledWith("2B", { page: 2, letter: "c" });
  });

  it("renvoie 404 quand le lecteur ne connaît pas le département", async () => {
    mocks.getDepartementTerritoire.mockResolvedValue(null);
    const res = await call(getDepartement, `${BASE}/departements/96`, { code: "96" });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/territoires/regions/[slug]", () => {
  it("refuse un slug invalide", async () => {
    const res = await call(getRegion, `${BASE}/regions/Bretagne!`, { slug: "Bretagne!" });
    expect(res.status).toBe(400);
  });

  it("renvoie 404 pour une région inconnue et 200 sinon", async () => {
    mocks.getRegionTerritoire.mockResolvedValueOnce(null);
    expect((await call(getRegion, `${BASE}/regions/atlantide`, { slug: "atlantide" })).status).toBe(
      404
    );

    mocks.getRegionTerritoire.mockResolvedValueOnce({ region: { code: "53" } });
    const res = await call(getRegion, `${BASE}/regions/bretagne`, { slug: "bretagne" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ region: { code: "53" } });
  });
});

describe("contrat commun de l'API v1", () => {
  it("place les routes Territoires dans le palier de débit général, comme le reste de v1", () => {
    expect(getRateLimitTier("/api/v1/territoires/communes/35238")).toBe("general");
    expect(getRateLimitTier("/api/v1/territoires/regions/bretagne")).toBe("general");
  });

  it("garde /api/v1/communes cohérent : état du maire transmis tel quel", async () => {
    const payload = { commune: { inseeCode: "35238" }, maireStatus: "NON_ETABLI", maire: null };
    mocks.getCommuneWithElus.mockResolvedValue(payload);
    const res = await getLegacyCommune(
      new NextRequest("https://poligraph.fr/api/v1/communes/35238"),
      { params: Promise.resolve({ codeInsee: "35238" }) }
    );
    expect(await res.json()).toEqual(payload);
  });
});
