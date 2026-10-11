import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  createMany: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  communeUpdate: vi.fn(),
  executeRaw: vi.fn(),
  syncUpsert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    communePopulation: {
      findMany: mocks.findMany,
      createMany: mocks.createMany,
      update: mocks.update,
      updateMany: mocks.updateMany,
    },
    commune: { update: mocks.communeUpdate },
    syncMetadata: { upsert: mocks.syncUpsert },
    $executeRaw: mocks.executeRaw,
  },
}));

import { POPULATION_SYNC_KEY } from "@/config/populations-reference";
import type { PopulationPlan, PopulationRecord } from "../populations-plan";
import { WRITE_BATCH_SIZE, writePopulationPlan } from "../populations";

function record(communeId: string, pmun: number): PopulationRecord {
  return {
    communeId,
    departmentCode: "35",
    millesime: 2023,
    populationMunicipale: pmun,
    populationCompteeAPart: 10,
    populationTotale: pmun + 10,
    effectiveFrom: "2026-01-01",
    producer: "INSEE",
    sourceLabel: "INSEE 2023",
    sourceUrl: "https://www.insee.fr/fr/statistiques/8680726",
  };
}

function existing(r: PopulationRecord, id: string) {
  return {
    id,
    communeId: r.communeId,
    millesime: r.millesime,
    populationMunicipale: r.populationMunicipale,
    populationCompteeAPart: r.populationCompteeAPart,
    populationTotale: r.populationTotale,
    effectiveFrom: new Date(`${r.effectiveFrom}T00:00:00Z`),
    producer: r.producer,
    sourceLabel: r.sourceLabel,
    sourceUrl: r.sourceUrl,
  };
}

function plan(matched: PopulationRecord[], differing: PopulationPlan["differing"]): PopulationPlan {
  return {
    matchedRecords: matched,
    byDepartment: [],
    inForce: new Map(),
    differing,
    crossesIndexFloor: [],
    crossesDeputeThreshold: [],
    indexationGained: [],
    indexationLost: [],
  };
}

const sqlText = (call: unknown[]) => (call[0] as { strings: string[] }).strings.join("?");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.executeRaw.mockImplementation(async (sql: { values: unknown[] }) => {
    const ids = sql.values.find(Array.isArray) as unknown[];
    return ids.length;
  });
});

describe("writePopulationPlan", () => {
  it("ne réécrit aucune ligne inchangée et date la vérification dans SyncMetadata", async () => {
    const r = record("35238", 230890);
    mocks.findMany.mockResolvedValue([existing(r, "p1")]);

    const result = await writePopulationPlan(plan([r], []));

    expect(result).toEqual({ created: 0, updated: 0, communePopulationAligned: 0 });
    expect(mocks.executeRaw).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.createMany).not.toHaveBeenCalled();
    expect(mocks.syncUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sourceKey: POPULATION_SYNC_KEY } })
    );
  });

  it("met à jour les lignes changées et aligne Commune.population en UPDATE ensemblistes par lots", async () => {
    const n = WRITE_BATCH_SIZE + 1;
    const fresh = Array.from({ length: n }, (_, i) => record(`c${i}`, 1000 + i));
    mocks.findMany.mockResolvedValue(
      fresh.map((r, i) => existing({ ...r, populationMunicipale: 1 }, `p${i}`))
    );
    const differing = fresh.map((r) => ({
      communeId: r.communeId,
      before: 1,
      after: r.populationMunicipale,
    }));

    const result = await writePopulationPlan(plan(fresh, differing));

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.communeUpdate).not.toHaveBeenCalled();
    const calls = mocks.executeRaw.mock.calls;
    const popUpdates = calls.filter((c) => sqlText(c).includes('UPDATE "CommunePopulation"'));
    const communeUpdates = calls.filter((c) => sqlText(c).includes('UPDATE "Commune" c'));
    expect(popUpdates).toHaveLength(2);
    expect(communeUpdates).toHaveLength(2);
    expect(sqlText(communeUpdates[0]!)).toMatch(/unnest\(/);
    expect(sqlText(communeUpdates[0]!)).toMatch(/IS DISTINCT FROM v\.pop/);
    expect(result).toEqual({ created: 0, updated: n, communePopulationAligned: n });
  });

  it("crée les lignes nouvelles par lots", async () => {
    mocks.findMany.mockResolvedValue([]);
    const result = await writePopulationPlan(plan([record("35238", 230890)], []));
    expect(mocks.createMany).toHaveBeenCalledTimes(1);
    expect(result.created).toBe(1);
  });
});
