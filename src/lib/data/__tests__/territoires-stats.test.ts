import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
import { buildTerritoiresStats, sharePercent } from "../territoires-stats";

const MAIRE = {
  etablis: 1000,
  from_rne: 960,
  femmes: 250,
  hommes: 749,
  civ_inconnue: 1,
  age_moins_40: 40,
  age_40_49: 110,
  age_50_59: 240,
  age_60_69: 350,
  age_70_plus: 220,
  age_inconnu: 40,
  median_age: 61,
  computed_at: new Date("2026-10-11T08:00:00Z"),
};

const COMMUNE = {
  total: 2000,
  pop_moins_500: 1000,
  pop_500_999: 400,
  pop_1000_3499: 400,
  pop_3500_9999: 150,
  pop_10000_plus: 50,
  pop_inconnue: 0,
};

describe("sharePercent", () => {
  it("arrondit au dixième", () => {
    expect(sharePercent(7956, 34796)).toBe(22.9);
    expect(sharePercent(1, 3)).toBe(33.3);
  });

  it("refuse une base vide plutôt que d'afficher zéro", () => {
    expect(sharePercent(0, 0)).toBeNull();
  });
});

describe("buildTerritoiresStats", () => {
  const stats = buildTerritoiresStats(MAIRE, COMMUNE, new Date("2026-08-10T09:00:00Z"));

  it("garde la catégorie non renseignée explicite quand elle existe", () => {
    expect(stats.maires.civility.map((r) => [r.key, r.count])).toEqual([
      ["femmes", 250],
      ["hommes", 749],
      ["inconnu", 1],
    ]);
    expect(stats.maires.age.at(-1)).toEqual({
      key: "inconnu",
      label: "Date de naissance non renseignée",
      count: 40,
    });
  });

  it("n'ajoute pas de catégorie non renseignée vide", () => {
    expect(stats.communes.population.some((r) => r.key === "inconnu")).toBe(false);
  });

  it("couvre chaque maire et chaque commune exactement une fois", () => {
    const sum = (rows: { count: number }[]) => rows.reduce((n, r) => n + r.count, 0);
    expect(sum(stats.maires.civility)).toBe(MAIRE.etablis);
    expect(sum(stats.maires.age)).toBe(MAIRE.etablis);
    expect(sum(stats.communes.population)).toBe(COMMUNE.total);
  });

  it("date le calcul et l'import, sans millésime de population", () => {
    expect(stats.computedAt).toBe("2026-10-11T08:00:00.000Z");
    expect(stats.communes.populationImportedAt).toBe("2026-08-10T09:00:00.000Z");
    expect(stats.communes).not.toHaveProperty("vintage");
  });

  it("ne porte aucune catégorie que la base n'établit pas", () => {
    const keys = JSON.stringify(stats);
    for (const absent of ["profession", "reelu", "renouvellement", "presidence", "classement"]) {
      expect(keys.toLowerCase()).not.toContain(absent);
    }
  });
});
