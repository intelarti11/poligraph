import { describe, expect, it } from "vitest";
import { checkCompositionTotals, seatShare } from "../composition";

describe("checkCompositionTotals", () => {
  it("accepte une composition qui boucle (570 pourvus + 7 vacants = 577)", () => {
    expect(checkCompositionTotals({ seats: 577, filled: 570, vacant: 7 }, [300, 270])).toEqual([]);
  });

  it("signale des sièges pourvus et vacants qui ne font pas le total", () => {
    expect(checkCompositionTotals({ seats: 577, filled: 570, vacant: 5 }, [570])).toContain(
      "seats-mismatch"
    );
  });

  it("signale des groupes dont la somme diffère des sièges pourvus", () => {
    expect(checkCompositionTotals({ seats: 577, filled: 570, vacant: 7 }, [300, 200])).toContain(
      "groups-sum-mismatch"
    );
  });

  it("signale un effectif négatif ou non entier", () => {
    expect(checkCompositionTotals({ seats: 577, filled: 577, vacant: 0 }, [-1, 578])).toContain(
      "negative-or-fractional"
    );
    expect(checkCompositionTotals({ seats: 10, filled: 10, vacant: 0 }, [5.5, 4.5])).toContain(
      "negative-or-fractional"
    );
  });
});

describe("seatShare", () => {
  it("calcule la part sur les sièges pourvus", () => {
    expect(seatShare(285, 570)).toBe(50);
    expect(seatShare(1, 3)).toBe(33.3);
  });

  it("ne divise jamais par zéro", () => {
    expect(seatShare(0, 0)).toBeNull();
  });
});
