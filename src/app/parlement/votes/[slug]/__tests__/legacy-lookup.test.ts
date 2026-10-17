import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const findFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    scrutin: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      findFirst: (...args: unknown[]) => findFirst(...args),
    },
  },
}));

import { generateMetadata } from "@/app/parlement/votes/[slug]/page";

beforeEach(() => {
  findUnique.mockReset();
  findFirst.mockReset();
  findUnique.mockResolvedValue(null);
  findFirst.mockResolvedValue(null);
});

describe("/parlement/votes/[slug] legacy numeric lookup", () => {
  // The same scrutin number exists in the 16th and the 17th legislature: without an order,
  // `endsWith "V123"` returned either one.
  it("prefers the most recent legislature when a number exists in several", async () => {
    await generateMetadata({ params: Promise.resolve({ slug: "123" }) });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { externalId: { endsWith: "V123" } },
        orderBy: { legislature: "desc" },
      })
    );
  });

  it("does not run the numeric lookup for a slug", async () => {
    await generateMetadata({ params: Promise.resolve({ slug: "2025-01-15-un-scrutin" }) });

    expect(findFirst).not.toHaveBeenCalled();
  });
});
