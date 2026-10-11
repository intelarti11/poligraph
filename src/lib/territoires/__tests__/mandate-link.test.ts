import { describe, expect, it } from "vitest";
import { mandateTerritoireHref } from "../mandate-link";

const LINKED = { commune: { population: 46_000 } };

describe("mandateTerritoireHref", () => {
  it("relie un mandat local en cours à la page commune", () => {
    expect(
      mandateTerritoireHref({
        isCurrent: true,
        constituency: "Carcassonne (11069)",
        localData: LINKED,
      })
    ).toBe("/territoires/communes/11069");
  });

  it("accepte les codes corses", () => {
    expect(
      mandateTerritoireHref({ isCurrent: true, constituency: "Ajaccio (2A004)", localData: LINKED })
    ).toBe("/territoires/communes/2A004");
  });

  it("ne relie pas un mandat terminé", () => {
    expect(
      mandateTerritoireHref({
        isCurrent: false,
        constituency: "Carcassonne (11069)",
        localData: LINKED,
      })
    ).toBeNull();
  });

  it("ne relie pas un mandat sans commune en base", () => {
    expect(
      mandateTerritoireHref({
        isCurrent: true,
        constituency: "Carcassonne (11069)",
        localData: { commune: null },
      })
    ).toBeNull();
    expect(
      mandateTerritoireHref({ isCurrent: true, constituency: "Carcassonne (11069)" })
    ).toBeNull();
  });

  it("ne devine pas un code absent du libellé", () => {
    expect(
      mandateTerritoireHref({ isCurrent: true, constituency: "Agen", localData: LINKED })
    ).toBeNull();
    expect(
      mandateTerritoireHref({ isCurrent: true, constituency: "Rhône (3)", localData: LINKED })
    ).toBeNull();
  });
});
