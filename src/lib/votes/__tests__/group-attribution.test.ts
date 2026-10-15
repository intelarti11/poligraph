import { describe, expect, it } from "vitest";
import { filterReliableGroupPositions, isGroupAttributionReliable } from "../group-attribution";

const an = (legislature: number) => ({ chamber: "AN" as const, legislature });
const anGroup = (legislature: number | null) => ({ chamber: "AN" as const, legislature });

describe("isGroupAttributionReliable", () => {
  it("accepte un groupe AN de la législature du scrutin", () => {
    expect(isGroupAttributionReliable(an(17), anGroup(17))).toBe(true);
  });

  it("refuse un vote de la 16e attribué à un groupe de la 17e", () => {
    expect(isGroupAttributionReliable(an(16), anGroup(17))).toBe(false);
  });

  it("refuse un vote de la 17e attribué à un groupe de la 16e", () => {
    expect(isGroupAttributionReliable(an(17), anGroup(16))).toBe(false);
  });

  it("refuse un groupe AN sans législature : rien ne l'atteste", () => {
    expect(isGroupAttributionReliable(an(17), anGroup(null))).toBe(false);
  });

  it("refuse un groupe d'une autre chambre", () => {
    expect(isGroupAttributionReliable(an(17), { chamber: "SENAT", legislature: null })).toBe(false);
  });

  it("laisse le Sénat inchangé : tranches de renouvellement, pas de législature", () => {
    expect(
      isGroupAttributionReliable(
        { chamber: "SENAT", legislature: 2023 },
        { chamber: "SENAT", legislature: null }
      )
    ).toBe(true);
  });
});

describe("filterReliableGroupPositions", () => {
  it("ne garde que les lignes cohérentes et ne dépend pas du groupe actuel", () => {
    const rows = [
      { id: "a", scrutin: an(16), group: anGroup(17) },
      { id: "b", scrutin: an(17), group: anGroup(17) },
    ];
    expect(filterReliableGroupPositions(rows).map((r) => r.id)).toEqual(["b"]);
  });

  it("peut échouer : une ligne 16e/17e disparaît bien", () => {
    const rows = [{ id: "a", scrutin: an(16), group: anGroup(17) }];
    expect(filterReliableGroupPositions(rows)).toHaveLength(0);
  });
});
