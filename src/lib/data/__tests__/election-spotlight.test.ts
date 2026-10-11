import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  flagFindUnique: vi.fn(),
  flagFindMany: vi.fn(),
  electionFindUnique: vi.fn(),
}));

vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    featureFlag: { findUnique: mocks.flagFindUnique, findMany: mocks.flagFindMany },
    election: { findUnique: mocks.electionFindUnique },
  },
}));

import { getElectionSpotlight } from "../election-spotlight";

const NOW = new Date("2026-10-11T12:00:00Z");

function spotlight(
  row: Partial<{ enabled: boolean; value: unknown; startDate: Date | null; endDate: Date | null }>
) {
  mocks.flagFindUnique.mockResolvedValue({
    enabled: true,
    value: { slug: "presidentielle-2027" },
    startDate: null,
    endDate: null,
    ...row,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.flagFindMany.mockResolvedValue([]);
  mocks.electionFindUnique.mockResolvedValue({ id: "e-2027" });
});

describe("getElectionSpotlight", () => {
  it("ne met rien en avant quand le drapeau n'existe pas", async () => {
    mocks.flagFindUnique.mockResolvedValue(null);
    expect(await getElectionSpotlight(NOW)).toBeNull();
  });

  it("met en avant l'élection désignée quand le drapeau est allumé", async () => {
    spotlight({});
    const item = await getElectionSpotlight(NOW);
    expect(item?.slug).toBe("presidentielle-2027");
    expect(item?.href).toBe("/elections/presidentielle-2027");
  });

  it("ignore une valeur présente quand le drapeau est éteint", async () => {
    spotlight({ enabled: false });
    expect(await getElectionSpotlight(NOW)).toBeNull();
  });

  it("ignore un slug absent de NAV_ELECTIONS", async () => {
    spotlight({ value: { slug: "legislatives-2099" } });
    expect(await getElectionSpotlight(NOW)).toBeNull();
  });

  it("ignore une valeur sans slug exploitable", async () => {
    spotlight({ value: "presidentielle-2027" });
    expect(await getElectionSpotlight(NOW)).toBeNull();
  });

  it("ne met rien en avant avant le début de la fenêtre", async () => {
    spotlight({ startDate: new Date("2026-10-12T00:00:00Z") });
    expect(await getElectionSpotlight(NOW)).toBeNull();
  });

  it("ne met rien en avant après la fin de la fenêtre", async () => {
    spotlight({ endDate: new Date("2026-10-10T00:00:00Z") });
    expect(await getElectionSpotlight(NOW)).toBeNull();
  });

  it("met en avant à l'intérieur de la fenêtre", async () => {
    spotlight({
      startDate: new Date("2026-10-01T00:00:00Z"),
      endDate: new Date("2026-10-31T00:00:00Z"),
    });
    expect((await getElectionSpotlight(NOW))?.slug).toBe("presidentielle-2027");
  });

  it("ne met rien en avant quand l'élection n'existe pas en base", async () => {
    spotlight({});
    mocks.electionFindUnique.mockResolvedValue(null);
    expect(await getElectionSpotlight(NOW)).toBeNull();
  });

  it("respecte le drapeau propre de l'entrée", async () => {
    spotlight({ value: { slug: "municipales-2026" } });
    expect(await getElectionSpotlight(NOW)).toBeNull();

    mocks.flagFindMany.mockResolvedValue([
      { name: "MUNICIPALES_2026", enabled: true, value: null, startDate: null, endDate: null },
    ]);
    expect((await getElectionSpotlight(NOW))?.slug).toBe("municipales-2026");
  });
});
