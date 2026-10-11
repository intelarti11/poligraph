import { describe, expect, it } from "vitest";
import { formatEffectiveDate, populationVintageLabel } from "../population-label";

describe("populationVintageLabel", () => {
  it("annonce le millésime, la date d'entrée en vigueur et le producteur", () => {
    expect(
      populationVintageLabel({ millesime: 2023, effectiveFrom: "2026-01-01", producer: "INSEE" })
    ).toBe("Population municipale 2023, en vigueur au 1er janvier 2026 (INSEE)");
    expect(
      populationVintageLabel({ millesime: 2025, effectiveFrom: "2026-01-01", producer: "ISEE" })
    ).toBe("Population municipale 2025, en vigueur au 1er janvier 2026 (ISEE)");
  });

  it("n'écrit l'ordinal que pour le premier du mois", () => {
    expect(formatEffectiveDate("2018-01-01")).toBe("1er janvier 2018");
    expect(formatEffectiveDate("2025-09-19")).toBe("19 septembre 2025");
    expect(formatEffectiveDate("2025-01-11")).toBe("11 janvier 2025");
  });
});
