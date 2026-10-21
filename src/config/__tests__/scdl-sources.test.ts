import { describe, expect, it } from "vitest";
import { isCouncilActType, SCDL_SOURCES, type ScdlSource } from "@/config/scdl-sources";

const brest = SCDL_SOURCES.find((s) => s.key === "brest") as ScdlSource;

describe("sources SCDL", () => {
  it("ne garde que les délibérations d'un fichier qui mêle arrêtés et décisions", () => {
    expect(isCouncilActType(brest, "Délibération")).toBe(true);
    expect(isCouncilActType(brest, "délibération")).toBe(true);
    expect(isCouncilActType(brest, "Arrêté")).toBe(false);
    expect(isCouncilActType(brest, "décision")).toBe(false);
  });

  it("écarte une ligne sans type d'acte quand un filtre est défini", () => {
    expect(isCouncilActType(brest, null)).toBe(false);
  });

  it("garde toutes les lignes d'une source sans filtre", () => {
    const pure = SCDL_SOURCES.find((s) => s.key === "taugon") as ScdlSource;
    expect(isCouncilActType(pure, null)).toBe(true);
    expect(isCouncilActType(pure, "Arrêté")).toBe(true);
  });

  it("rattache Brest à son conseil municipal et à son conseil métropolitain", () => {
    expect(brest.authorities.map((a) => a.institution)).toEqual([
      { kind: "CONSEIL_MUNICIPAL", communeId: "29019" },
      { kind: "CONSEIL_COMMUNAUTAIRE", sirenEpci: "242900314" },
    ]);
  });
});
