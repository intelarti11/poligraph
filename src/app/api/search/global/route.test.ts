import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma";

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/db", () => ({ db: { $queryRaw: queryRaw } }));

import { GET } from "./route";

const context = { params: Promise.resolve({}) };

describe("GET recherche globale", () => {
  it("ne met pas en cache une réponse de recherche nominative", async () => {
    const response = await GET(
      new NextRequest("https://poligraph.fr/api/search/global?q=Juan%20Branco"),
      context
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("GET recherche globale, affaires", () => {
  it("renvoie l'implication de chaque affaire pour que l'interface n'attribue pas le statut à un témoin", async () => {
    queryRaw.mockImplementation((first: unknown) => {
      const text = Array.isArray(first)
        ? first.join("")
        : ((first as { strings?: string[] }).strings ?? []).join("");
      if (!text.includes('FROM "Affair" a')) return Promise.resolve([]);
      return Promise.resolve([
        {
          slug: "affaire-temoin",
          title: "Affaire",
          status: "CONDAMNATION_DEFINITIVE",
          involvement: "INDIRECT",
          politicianName: "Témoin",
          politicianSlug: "temoin",
        },
      ]);
    });

    const response = await GET(
      new NextRequest("https://poligraph.fr/api/search/global?q=Affaire"),
      context
    );
    const body = (await response.json()) as { affairs: Array<{ involvement: string }> };

    expect(body.affairs.map((a) => a.involvement)).toEqual(["INDIRECT"]);
  });
});

/** A `$queryRaw` call, tagged template or `Prisma.sql` object, flattened with nested fragments. */
function sqlText(call: unknown[]): { text: string; values: unknown[] } {
  const [first, ...rest] = call;
  const sql = Array.isArray(first)
    ? Prisma.sql(first as unknown as TemplateStringsArray, ...rest)
    : (first as Prisma.Sql);
  return { text: sql.sql, values: sql.values };
}

describe("GET recherche globale, territoires", () => {
  it("cherche aussi les communes par code postal", async () => {
    queryRaw.mockReset().mockResolvedValue([]);

    await GET(new NextRequest("https://poligraph.fr/api/search/global?q=86100"), context);

    const communeQuery = queryRaw.mock.calls
      .map((call) => sqlText(call))
      .find((q) => q.text.includes('FROM "Commune" c'));
    expect(communeQuery?.text).toContain('= ANY(c."postalCodes")');
    expect(communeQuery?.values).toContain("86100");
  });

  it("ne cherche pas par code postal un texte qui n'en est pas un", async () => {
    queryRaw.mockReset().mockResolvedValue([]);

    await GET(new NextRequest("https://poligraph.fr/api/search/global?q=Poitiers"), context);

    const communeQuery = queryRaw.mock.calls
      .map((call) => sqlText(call))
      .find((q) => q.text.includes('FROM "Commune" c'));
    expect(communeQuery?.text).not.toContain("postalCodes");
  });

  it("renvoie les départements par nom ou par code, avec leur slug", async () => {
    queryRaw.mockReset().mockResolvedValue([]);

    const byName = await GET(
      new NextRequest("https://poligraph.fr/api/search/global?q=vienne"),
      context
    );
    const byCode = await GET(
      new NextRequest("https://poligraph.fr/api/search/global?q=2a"),
      context
    );

    const named = (await byName.json()) as { departements: Array<{ code: string; slug: string }> };
    const coded = (await byCode.json()) as { departements: Array<{ code: string; name: string }> };
    expect(named.departements).toEqual([{ code: "86", name: "Vienne", slug: "vienne" }]);
    expect(coded.departements.map((d) => d.code)).toEqual(["2A"]);
  });
});
