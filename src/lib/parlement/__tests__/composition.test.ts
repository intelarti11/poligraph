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
    expect(
      checkCompositionTotals({ seats: 577, filled: 570, vacant: 7 }, [300, 200], {
        unaffiliated: 0,
      })
    ).toContain("groups-sum-mismatch");
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

describe("checkCompositionTotals : députés non inscrits", () => {
  const totals = { seats: 577, filled: 570, vacant: 7 };

  it("boucle quand groupes + non-inscrits = sièges pourvus", () => {
    expect(checkCompositionTotals(totals, [300, 250], { unaffiliated: 20 })).toEqual([]);
  });

  it("n'assimile pas les non-inscrits à un groupe : écart signalé s'ils sont renseignés", () => {
    expect(checkCompositionTotals(totals, [300, 250], { unaffiliated: 5 })).toEqual([
      "groups-sum-mismatch",
    ]);
  });

  it("effectif inconnu et groupes en dessous des pourvus : donnée incomplète, pas somme fausse", () => {
    expect(checkCompositionTotals(totals, [300, 250])).toEqual(["unaffiliated-unknown"]);
    expect(checkCompositionTotals(totals, [300, 250], { unaffiliated: null })).toEqual([
      "unaffiliated-unknown",
    ]);
  });

  it("effectif inconnu mais groupes au-dessus des pourvus : somme fausse", () => {
    expect(checkCompositionTotals(totals, [400, 200])).toEqual(["groups-sum-mismatch"]);
  });

  it("zéro non-inscrit renseigné est un fait distinct de non renseigné", () => {
    expect(checkCompositionTotals(totals, [570], { unaffiliated: 0 })).toEqual([]);
    expect(checkCompositionTotals(totals, [550], { unaffiliated: 0 })).toEqual([
      "groups-sum-mismatch",
    ]);
  });

  it("refuse un effectif de non-inscrits négatif ou fractionnaire", () => {
    expect(checkCompositionTotals(totals, [570], { unaffiliated: -1 })).toContain(
      "negative-or-fractional"
    );
    expect(checkCompositionTotals(totals, [570], { unaffiliated: 0.5 })).toContain(
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
