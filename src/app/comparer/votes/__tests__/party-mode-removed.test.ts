import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  queryRaw: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { $queryRaw: mocks.queryRaw, politician: { findFirst: vi.fn(), findUnique: vi.fn() } },
}));

import VotesComparisonPage from "../page";

describe("/comparer/votes : le mode partis est retiré", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renvoie les anciens liens vers la comparaison de la rubrique sans requête de votes", async () => {
    await expect(
      VotesComparisonPage({ searchParams: Promise.resolve({ cat: "partis", a: "rn", b: "ps" }) })
    ).rejects.toThrow("REDIRECT:/comparer?cat=partis&a=rn&b=ps");
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});
