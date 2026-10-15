import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));

import * as compare from "@/lib/data/compare";

describe("comparaison de partis", () => {
  it("n'expose plus de concordance de votes fondée sur le parti actuel", () => {
    expect("getPartyVoteComparison" in compare).toBe(false);
  });
});
