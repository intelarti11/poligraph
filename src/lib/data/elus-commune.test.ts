import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  communeFindUnique: vi.fn(),
  mandateFindMany: vi.fn(),
}));

vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    commune: { findUnique: mocks.communeFindUnique },
    mandate: { findMany: mocks.mandateFindMany },
  },
}));

import { getCommuneWithElus } from "./elus";

const COMMUNE = {
  id: "35238",
  name: "Rennes",
  departmentCode: "35",
  regionCode: "53",
  regionName: null,
  postalCodes: ["35000"],
  population: 230890,
  latitude: 48.1,
  longitude: -1.6,
  totalSeats: 61,
  website: null,
};

type Status = "PUBLISHED" | "DRAFT" | "EXCLUDED";

function mandate(
  id: string,
  type: string,
  status: Status,
  extra: { lastConfirmedAt?: Date | null; functionStart?: Date | null } = {}
) {
  return {
    id,
    type,
    startDate: new Date("2026-03-22T00:00:00Z"),
    endDate: null,
    isCurrent: true,
    departmentCode: "35",
    source: "RNE",
    lastConfirmedAt: extra.lastConfirmedAt ?? null,
    politician: {
      id: `pol-${id}`,
      slug: `slug-${id}`,
      firstName: "Prénom",
      lastName: `Nom-${id}`,
      fullName: `Prénom Nom-${id}`,
      civility: "Mme",
      birthDate: null,
      photoUrl: null,
      publicationStatus: status,
      currentParty: null,
    },
    localData: {
      communeId: "35238",
      functionStart: extra.functionStart ?? null,
      rneExternalId: null,
      partyLabel: null,
      commune: { id: "35238", name: "Rennes", departmentCode: "35", population: 230890 },
    },
  };
}

/**
 * The fake honours the two predicates the reader relies on: the public boundary on the
 * politician relation, and the mandate type. A reader that forgot the public filter would get
 * every row back and the assertions below would see the non-public profile.
 */
function serve(rows: ReturnType<typeof mandate>[]) {
  mocks.mandateFindMany.mockImplementation(
    async (args: {
      where: {
        type?: string | { in: string[] };
        politician?: { publicationStatus?: string };
      };
    }) => {
      const { type, politician } = args.where;
      return rows.filter((row) => {
        if (typeof type === "string" && row.type !== type) return false;
        if (type && typeof type === "object" && !type.in.includes(row.type)) return false;
        if (politician?.publicationStatus) {
          return row.politician.publicationStatus === politician.publicationStatus;
        }
        return true;
      });
    }
  );
}

describe("getCommuneWithElus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.communeFindUnique.mockResolvedValue(COMMUNE);
  });

  it("n'expose aucun profil non public parmi les élus", async () => {
    serve([
      mandate("a", "MAIRE", "PUBLISHED"),
      mandate("b", "MAIRE_ARRONDISSEMENT", "DRAFT"),
      mandate("c", "CONSEILLER_MUNICIPAL", "EXCLUDED"),
    ]);

    const result = await getCommuneWithElus("35238");

    expect(result?.officials.map((o) => o.politician.slug)).toEqual(["slug-a"]);
    expect(JSON.stringify(result)).not.toContain("slug-b");
    expect(JSON.stringify(result)).not.toContain("slug-c");
  });

  it("déclare le maire non établi quand deux maires sont courants, même si un seul est public", async () => {
    serve([mandate("a", "MAIRE", "PUBLISHED"), mandate("b", "MAIRE", "DRAFT")]);

    const result = await getCommuneWithElus("35238");

    expect(result?.maireStatus).toBe("NON_ETABLI");
    expect(result?.maire).toBeNull();
    // Aucun nom de maire par la liste des élus non plus, public ou non.
    expect(result?.officials.filter((o) => o.role === "MAIRE")).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("slug-b");
  });

  it("déclare le maire non établi quand le seul maire courant n'est pas public", async () => {
    serve([mandate("b", "MAIRE", "DRAFT")]);

    const result = await getCommuneWithElus("35238");

    expect(result?.maireStatus).toBe("NON_ETABLI");
    expect(result?.maire).toBeNull();
    expect(JSON.stringify(result)).not.toContain("slug-b");
  });

  it("établit le maire unique public et restitue sa fraîcheur", async () => {
    serve([
      mandate("a", "MAIRE", "PUBLISHED", {
        lastConfirmedAt: new Date("2026-10-01T00:00:00Z"),
        functionStart: new Date("2026-03-22T00:00:00Z"),
      }),
    ]);

    const result = await getCommuneWithElus("35238");

    expect(result?.maireStatus).toBe("ETABLI");
    expect(result?.maire?.politician.slug).toBe("slug-a");
    expect(result?.maire?.lastConfirmedAt).toBe("2026-10-01T00:00:00.000Z");
    expect(result?.maire?.functionStart).toBe("2026-03-22T00:00:00.000Z");
  });

  it("restitue une fraîcheur inconnue comme null, jamais comme une date inventée", async () => {
    serve([mandate("a", "MAIRE", "PUBLISHED")]);

    const result = await getCommuneWithElus("35238");

    expect(result?.maire?.lastConfirmedAt).toBeNull();
  });

  it("déclare le maire absent quand aucun maire courant n'est enregistré", async () => {
    serve([]);

    const result = await getCommuneWithElus("35238");

    expect(result?.maireStatus).toBe("ABSENT");
    expect(result?.maire).toBeNull();
  });

  it("renvoie null pour une commune inconnue", async () => {
    mocks.communeFindUnique.mockResolvedValue(null);
    expect(await getCommuneWithElus("00000")).toBeNull();
  });
});
