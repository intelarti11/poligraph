import { describe, expect, it } from "vitest";
import { parisMidnight } from "@/lib/governments/dates";
import {
  adoptionWindow,
  coveringMandate,
  groupDecisionsByPeriod,
  type MayorMandate,
  type PeriodDecision,
} from "../decision-periods";

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
// Mandate dates come from the RNE at Paris midnight (22:00 or 23:00 UTC the day before).

const predecessor: MayorMandate = {
  mandateId: "m-old",
  politicianId: "p-old",
  person: { fullName: "Lou Précédent", slug: "lou-precedent" },
  startDate: parisMidnight("2020-05-23"),
  endDate: parisMidnight("2026-03-21"),
  isCurrent: false,
};
const successor: MayorMandate = {
  mandateId: "m-new",
  politicianId: "p-new",
  person: { fullName: "Camille Exemple", slug: "camille-exemple" },
  startDate: parisMidnight("2026-03-22"),
  endDate: null,
  isCurrent: true,
};

const decision = (
  id: string,
  date: string,
  precision: PeriodDecision["adoptionDatePrecision"] = "DAY"
) => ({
  id,
  adoptionDate: day(date),
  adoptionDatePrecision: precision,
});

describe("adoptionWindow", () => {
  it("covers the whole month or year of an imprecise date", () => {
    expect(adoptionWindow(day("2026-02-01"), "MONTH")).toEqual(["2026-02-01", "2026-02-28"]);
    expect(adoptionWindow(day("2024-02-01"), "MONTH")).toEqual(["2024-02-01", "2024-02-29"]);
    expect(adoptionWindow(day("2026-06-04"), "YEAR")).toEqual(["2026-01-01", "2026-12-31"]);
    expect(adoptionWindow(day("2026-06-04"), "DAY")).toEqual(["2026-06-04", "2026-06-04"]);
  });
});

describe("coveringMandate", () => {
  const mandates = [predecessor, successor];

  it("finds the mayor in office on the adoption day, read in Paris time", () => {
    expect(coveringMandate(["2026-03-21", "2026-03-21"], mandates)?.mandateId).toBe("m-old");
    expect(coveringMandate(["2026-03-22", "2026-03-22"], mandates)?.mandateId).toBe("m-new");
  });

  it("leaves a month spanning a change of mayor unestablished", () => {
    expect(coveringMandate(["2026-03-01", "2026-03-31"], mandates)).toBeNull();
  });

  it("leaves a date before any documented mandate unestablished", () => {
    expect(coveringMandate(["2019-01-10", "2019-01-10"], mandates)).toBeNull();
  });

  it("does not guess the end of a past mandate recorded without one", () => {
    const openPast = { ...predecessor, endDate: null };
    expect(coveringMandate(["2021-06-01", "2021-06-01"], [openPast])).toBeNull();
  });

  it("never names a mayor whose profile is not public, nor moves the decision to a neighbour", () => {
    const hidden = { ...predecessor, person: null };
    expect(coveringMandate(["2021-06-01", "2021-06-01"], [hidden, successor])).toBeNull();
  });

  it("leaves overlapping mandates unestablished", () => {
    const overlap: MayorMandate = { ...successor, mandateId: "m-x", politicianId: "p-x" };
    expect(coveringMandate(["2026-06-04", "2026-06-04"], [successor, overlap])).toBeNull();
  });
});

describe("groupDecisionsByPeriod", () => {
  it("files a decision adopted under the predecessor there, whatever its publication date", () => {
    const { mayors, unestablished } = groupDecisionsByPeriod(
      [decision("budget", "2026-03-12"), decision("ressourcerie", "2026-06-04")],
      [predecessor, successor]
    );
    expect(unestablished).toEqual([]);
    expect(mayors.map((m) => [m.person.slug, m.decisionCount])).toEqual([
      ["camille-exemple", 1],
      ["lou-precedent", 1],
    ]);
    expect(mayors[1]!.mandates[0]!.decisions.map((d) => d.id)).toEqual(["budget"]);
  });

  it("keeps a re-elected mayor on one period, split by mandate", () => {
    const first = { ...predecessor, politicianId: "p-new", person: successor.person };
    const { mayors } = groupDecisionsByPeriod(
      [decision("a", "2021-03-12"), decision("b", "2026-06-04")],
      [first, successor]
    );
    expect(mayors).toHaveLength(1);
    expect(mayors[0]!.mandates.map((m) => [m.start, m.end, m.decisions.length])).toEqual([
      ["2020-05-23", "2026-03-21", 1],
      ["2026-03-22", null, 1],
    ]);
  });

  it("puts an imprecise date across the change of mayor in the unestablished group", () => {
    const { mayors, unestablished } = groupDecisionsByPeriod(
      [decision("flou", "2026-03-01", "MONTH")],
      [predecessor, successor]
    );
    expect(unestablished.map((d) => d.id)).toEqual(["flou"]);
    expect(mayors.map((m) => m.person.slug)).toEqual(["camille-exemple"]);
  });

  it("lists decisions most recent first", () => {
    const { mayors } = groupDecisionsByPeriod(
      [decision("old", "2026-04-01"), decision("new", "2026-09-01")],
      [successor]
    );
    expect(mayors[0]!.mandates[0]!.decisions.map((d) => d.id)).toEqual(["new", "old"]);
  });
});
