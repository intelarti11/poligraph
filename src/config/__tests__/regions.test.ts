import { describe, expect, it } from "vitest";
import { DEPARTMENTS } from "@/config/departments";
import {
  REGIONS,
  TERRITOIRES_HORS_REGION,
  getRegionByCode,
  getRegionBySlug,
  getRegionForDepartment,
  getTerritoireHorsRegion,
} from "@/config/regions";

const COM_CODES = ["975", "977", "978", "984", "986", "987", "988", "989"];

describe("référentiel des régions", () => {
  it("compte 18 régions, 13 en métropole et 5 en outre-mer", () => {
    expect(REGIONS).toHaveLength(18);
    expect(REGIONS.filter((r) => !r.outreMer)).toHaveLength(13);
    expect(REGIONS.filter((r) => r.outreMer)).toHaveLength(5);
  });

  it("couvre 101 départements, chacun une seule fois", () => {
    const all = REGIONS.flatMap((r) => r.departmentCodes);
    expect(all).toHaveLength(101);
    expect(new Set(all).size).toBe(101);
  });

  it("ne référence que des départements connus de DEPARTMENTS", () => {
    for (const code of REGIONS.flatMap((r) => r.departmentCodes)) {
      expect(DEPARTMENTS[code], `département ${code} absent de DEPARTMENTS`).toBeDefined();
    }
  });

  it("couvre tout département de DEPARTMENTS qui n'est pas une collectivité hors région", () => {
    for (const code of Object.keys(DEPARTMENTS)) {
      if (COM_CODES.includes(code)) continue;
      expect(getRegionForDepartment(code), `département ${code} sans région`).not.toBeNull();
    }
  });

  it("concorde avec la région métropolitaine déclarée dans DEPARTMENTS", () => {
    for (const region of REGIONS.filter((r) => !r.outreMer)) {
      for (const code of region.departmentCodes) {
        expect(DEPARTMENTS[code]!.region, `département ${code}`).toBe(region.name);
      }
    }
  });

  it("fait de chaque DROM une région mono-départementale du même nom", () => {
    for (const region of REGIONS.filter((r) => r.outreMer)) {
      expect(region.departmentCodes).toHaveLength(1);
      expect(DEPARTMENTS[region.departmentCodes[0]!]!.name).toBe(region.name);
    }
  });

  it("n'attache aucune collectivité d'outre-mer à une région", () => {
    for (const code of COM_CODES) {
      expect(getRegionForDepartment(code), code).toBeNull();
      expect(getTerritoireHorsRegion(code)?.statut, code).toBeTruthy();
    }
    expect(Object.keys(TERRITOIRES_HORS_REGION).sort()).toEqual([...COM_CODES].sort());
  });

  it("a des codes, slugs et chefs-lieux uniques", () => {
    expect(new Set(REGIONS.map((r) => r.code)).size).toBe(18);
    expect(new Set(REGIONS.map((r) => r.slug)).size).toBe(18);
    for (const r of REGIONS) {
      expect(r.slug).toMatch(/^[a-z0-9-]+$/);
      expect(r.chefLieu.inseeCode).toMatch(/^[0-9][0-9AB][0-9]{3}$/);
    }
  });

  it("résout par slug, par code et par département", () => {
    expect(getRegionBySlug("ile-de-france")?.code).toBe("11");
    expect(getRegionBySlug("provence-alpes-cote-d-azur")?.code).toBe("93");
    expect(getRegionBySlug("inconnue")).toBeNull();
    expect(getRegionByCode("53")?.name).toBe("Bretagne");
    expect(getRegionByCode("975")).toBeNull();
    expect(getRegionByCode(null)).toBeNull();
    expect(getRegionForDepartment("2a")?.code).toBe("94");
    expect(getRegionForDepartment("976")?.name).toBe("Mayotte");
    expect(getRegionForDepartment("69")?.chefLieu.name).toBe("Lyon");
    expect(getRegionForDepartment("99")).toBeNull();
  });
});
