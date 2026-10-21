import { describe, expect, it } from "vitest";
import { parseFrenchPct, parseWideResultRow2026 } from "../parse-wide-results-2026";

describe("parseFrenchPct", () => {
  it("lit un pourcentage français", () => {
    expect(parseFrenchPct("55,08%")).toBe(55.08);
    expect(parseFrenchPct("100,00%")).toBe(100);
  });

  it("rend 0 sur une cellule vide", () => {
    expect(parseFrenchPct("")).toBe(0);
    expect(parseFrenchPct("   ")).toBe(0);
  });

  /**
   * `replace("%", "")` ne retirait que la première occurrence. Sur une cellule doublement
   * préfixée, le `%` restant ouvrait la chaîne, `parseFloat` rendait NaN et le `|| 0` le
   * transformait en zéro : un taux de participation nul, sans erreur ni trace.
   *
   * Cas non observé dans les fichiers reçus, mais le mode de défaillance est muet, donc le
   * constater coûte moins cher que le découvrir sur une page publiée.
   */
  it("retire tous les signes pourcent, pas seulement le premier", () => {
    expect(parseFrenchPct("%%55,08")).toBe(55.08);
    expect(parseFrenchPct("55,08%%")).toBe(55.08);
  });
});

describe("parseWideResultRow2026 : quart des inscrits (art. L. 262)", () => {
  function row(registered: string, votes: string, pctExpressed: string) {
    const fixed = Array(18).fill("");
    fixed[2] = "31555";
    fixed[3] = "Ville";
    fixed[4] = registered;
    // panel, name, first name, sex, nuance, short label, label, votes, %reg, %expr, elu, CM, CC
    const block = [
      "1",
      "DUPONT",
      "Jean",
      "M",
      "DVG",
      "A",
      "LISTE A",
      votes,
      "0",
      pctExpressed,
      "",
      "",
      "",
    ];
    return [...fixed, ...block];
  }

  it("n'élit pas une liste à plus de 50 % des exprimés sous le quart des inscrits", () => {
    const r = parseWideResultRow2026(row("5000", "1000", "65,79%"));
    expect(r.lists[0]?.isElected).toBe(false);
  });

  it("élit une liste qui atteint le quart des inscrits", () => {
    const r = parseWideResultRow2026(row("5000", "1250", "82,24%"));
    expect(r.lists[0]?.isElected).toBe(true);
  });
});
