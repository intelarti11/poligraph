import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ syncFindUnique: vi.fn(), queryRaw: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    syncMetadata: { findUnique: mocks.syncFindUnique },
    $queryRaw: mocks.queryRaw,
  },
}));

import { readIntercommunalites } from "../territoires-intercommunalites";

const SITUATION = new Date("2026-01-01T00:00:00.000Z");
const EPCI_SOURCE = "INSEE, EPCI à fiscalité propre au 1er janvier 2026";
const EPT_SOURCE = "INSEE, établissements publics territoriaux au 1er janvier 2026";
const URL = "https://www.insee.fr/fr/information/2510634";

/** A row of the joined query: body columns are null for "Sans objet". */
function row(
  body: { siren: string; name: string; nature: string } | null,
  sourceLabel = EPCI_SOURCE
) {
  return {
    situationDate: SITUATION,
    sourceLabel,
    sourceUrl: URL,
    siren: body?.siren ?? null,
    name: body?.name ?? null,
    nature: body?.nature ?? null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.syncFindUnique.mockResolvedValue({ lastSyncAt: new Date("2026-10-12T08:00:00Z") });
});

describe("readIntercommunalites", () => {
  it("ne lit pas les tables avant le premier import", async () => {
    mocks.syncFindUnique.mockResolvedValue(null);
    expect(await readIntercommunalites("35238")).toBeNull();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("lit en une requête les appartenances en cours de la commune, bornées", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await readIntercommunalites("93066");
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    const query = mocks.queryRaw.mock.calls[0]![0] as { sql: string; values: unknown[] };
    expect(query.values).toEqual(["93066"]);
    expect(query.sql).toMatch(/LEFT JOIN "Intercommunalite"/);
    expect(query.sql).toMatch(/"validTo" IS NULL/);
    expect(query.sql).toMatch(/LIMIT 5/);
  });

  it("dit « non établie » pour une commune absente de la source, jamais « aucune »", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    const block = await readIntercommunalites("98735");
    expect(block).toMatchObject({
      state: "NON_ETABLI",
      intercommunalites: [],
      situationDate: null,
      lastCheckedAt: "2026-10-12T08:00:00.000Z",
    });
  });

  it("dit « aucune » quand la source l'établit (île mono-communale)", async () => {
    mocks.queryRaw.mockResolvedValue([row(null)]);
    const block = await readIntercommunalites("29155");
    expect(block).toMatchObject({
      state: "AUCUNE",
      intercommunalites: [],
      situationDate: "2026-01-01T00:00:00.000Z",
      source: { label: EPCI_SOURCE, url: URL },
    });
  });

  it("présente la MGP puis l'EPT, chacun avec sa source et sa nature en toutes lettres", async () => {
    mocks.queryRaw.mockResolvedValue([
      row({ siren: "200057867", name: "Plaine Commune", nature: "EPT" }, EPT_SOURCE),
      row({ siren: "200054781", name: "Métropole du Grand Paris", nature: "METRO" }),
    ]);
    const block = await readIntercommunalites("93066");
    expect(block?.state).toBe("DISPONIBLE");
    expect(block?.intercommunalites).toEqual([
      {
        siren: "200054781",
        name: "Métropole du Grand Paris",
        nature: "METRO",
        natureLabel: "métropole",
        source: { label: EPCI_SOURCE, url: URL },
      },
      {
        siren: "200057867",
        name: "Plaine Commune",
        nature: "EPT",
        natureLabel: "établissement public territorial",
        source: { label: EPT_SOURCE, url: URL },
      },
    ]);
    expect(block?.source.label).toBe(EPCI_SOURCE);
  });

  it("qualifie la Métropole de Lyon de collectivité à statut particulier", async () => {
    mocks.queryRaw.mockResolvedValue([
      row({ siren: "200046977", name: "Métropole de Lyon", nature: "MET69" }),
    ]);
    const block = await readIntercommunalites("69123");
    expect(block?.intercommunalites[0]?.natureLabel).toBe(
      "collectivité territoriale à statut particulier"
    );
  });
});
