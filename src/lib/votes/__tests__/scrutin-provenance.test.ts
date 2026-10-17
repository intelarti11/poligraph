import { describe, expect, it } from "vitest";
import {
  computedPositionsNote,
  officialGroupCountsView,
  voteCoverageView,
  type AnOrganLabel,
  type OfficialGroupCountRow,
  type OfficialGroupSnapshot,
} from "../scrutin-provenance";

const TOTALS = { votesFor: 300, votesAgainst: 200, votesAbstain: 10 };

describe("voteCoverageView", () => {
  it("says nothing is imported when there is no row, never that nobody voted", () => {
    const view = voteCoverageView({ POUR: 0, CONTRE: 0, ABSTENTION: 0, NON_VOTANT: 0 }, TOTALS);
    expect(view.status).toBe("pending");
    expect(view.summary).toContain("pas une absence de votants");
  });

  it("is partial when fewer votes are recorded than the official total", () => {
    const view = voteCoverageView(
      { POUR: 290, CONTRE: 200, ABSTENTION: 10, NON_VOTANT: 3 },
      TOTALS
    );
    expect(view.status).toBe("partial");
    expect(view.summary).toContain("500 votes individuels enregistrés sur 510");
  });

  it("never reports complete, even when every counter matches", () => {
    const view = voteCoverageView(
      { POUR: 300, CONTRE: 200, ABSTENTION: 10, NON_VOTANT: 0 },
      TOTALS
    );
    expect(view.status).not.toBe("complete");
    expect(view.label).toBe("Compteurs concordants");
    expect(view.description).toContain("ne prouve pas");
  });

  it("flags more recorded votes than the official total as a discrepancy", () => {
    const view = voteCoverageView(
      { POUR: 301, CONTRE: 200, ABSTENTION: 10, NON_VOTANT: 0 },
      TOTALS
    );
    expect(view.status).toBe("unverified");
    expect(view.label).toBe("Écart avec le total officiel");
    expect(view.summary).toContain("Pour : 301 enregistrés pour 300");
  });

  it("does not count non-voters in the comparison with the official totals", () => {
    const view = voteCoverageView(
      { POUR: 300, CONTRE: 200, ABSTENTION: 10, NON_VOTANT: 40 },
      TOTALS
    );
    expect(view.label).toBe("Compteurs concordants");
  });

  it("treats only non-voter rows as partial, not as empty", () => {
    const view = voteCoverageView({ POUR: 0, CONTRE: 0, ABSTENTION: 0, NON_VOTANT: 5 }, TOTALS);
    expect(view.status).toBe("partial");
  });
});

const ORGANES: AnOrganLabel[] = [
  {
    organeRef: "PO1",
    label: "UDR",
    abbreviation: "UDR",
    startDate: new Date("2024-09-12T00:00:00Z"),
    endDate: new Date("2025-09-04T00:00:00Z"),
  },
  {
    organeRef: "PO2",
    label: "Rassemblement National",
    abbreviation: "RN",
    startDate: new Date("2024-07-18T00:00:00Z"),
    endDate: null,
  },
];

function row(overrides: Partial<OfficialGroupCountRow> = {}): OfficialGroupCountRow {
  return {
    organeRef: "PO2",
    memberCount: 120,
    forCount: 200,
    againstCount: 100,
    abstainCount: 5,
    nonVoterCount: 3,
    majorityPosition: "POUR",
    issues: [],
    ...overrides,
  };
}

function snapshot(rows: OfficialGroupCountRow[], overrides: Partial<OfficialGroupSnapshot> = {}) {
  return { imported: true, issues: [], rows, ...overrides };
}

const SCRUTIN = {
  votingDate: new Date("2025-03-01T00:00:00Z"),
  votesFor: 300,
  votesAgainst: 150,
  votesAbstain: 8,
};

/** Two rows that add up to SCRUTIN. */
function validRows() {
  return [
    row({ organeRef: "PO2", forCount: 200, againstCount: 100, abstainCount: 5 }),
    row({
      organeRef: "PO1",
      memberCount: 40,
      forCount: 100,
      againstCount: 50,
      abstainCount: 3,
      majorityPosition: "CONTRE",
    }),
  ];
}

describe("officialGroupCountsView", () => {
  it("reports a scrutin without snapshot as not imported", () => {
    const view = officialGroupCountsView({
      snapshot: { imported: false, issues: null, rows: [] },
      organes: ORGANES,
      scrutin: SCRUTIN,
    });
    expect(view).toEqual({ kind: "not-imported" });
  });

  it("shows the counts under the labels of the official referential, largest group first", () => {
    const view = officialGroupCountsView({
      snapshot: snapshot(validRows()),
      organes: ORGANES,
      scrutin: SCRUTIN,
    });
    expect(view.kind).toBe("shown");
    if (view.kind !== "shown") return;
    expect(view.rows.map((r) => r.label)).toEqual(["Rassemblement National", "UDR"]);
    expect(view.rows[1]).toMatchObject({ majorityPosition: "CONTRE", forCount: 100 });
  });

  it("withholds as a source anomaly when the parser reported an issue on a row", () => {
    const rows = validRows();
    rows[0] = row({ issues: ["organeRef: doublon à l'index 3"] });
    const view = officialGroupCountsView({
      snapshot: snapshot(rows),
      organes: ORGANES,
      scrutin: SCRUTIN,
    });
    expect(view).toMatchObject({ kind: "withheld", origin: "source" });
  });

  it("withholds as a source anomaly when the snapshot itself has issues", () => {
    const view = officialGroupCountsView({
      snapshot: snapshot([], { issues: ["ventilationVotes: objet absent"] }),
      organes: ORGANES,
      scrutin: SCRUTIN,
    });
    expect(view).toMatchObject({ kind: "withheld", origin: "source" });
  });

  it("never turns a missing count into zero", () => {
    const rows = validRows();
    rows[0] = row({ forCount: null });
    const view = officialGroupCountsView({
      snapshot: snapshot(rows),
      organes: ORGANES,
      scrutin: SCRUTIN,
    });
    expect(view).toMatchObject({ kind: "withheld", origin: "source" });
  });

  it("blames the import, not the source, while the referential is not imported", () => {
    for (const organes of [null, []]) {
      const view = officialGroupCountsView({
        snapshot: snapshot(validRows()),
        organes,
        scrutin: SCRUTIN,
      });
      expect(view).toMatchObject({ kind: "withheld", origin: "import" });
    }
  });

  it("withholds a group that the official referential does not know (PO0)", () => {
    const rows = validRows();
    rows[1] = row({
      organeRef: "PO0",
      memberCount: 40,
      forCount: 100,
      againstCount: 50,
      abstainCount: 3,
    });
    const view = officialGroupCountsView({
      snapshot: snapshot(rows),
      organes: ORGANES,
      scrutin: SCRUTIN,
    });
    expect(view).toMatchObject({ kind: "withheld", origin: "source" });
  });

  it("does not use a group label outside the period of that group", () => {
    const view = officialGroupCountsView({
      snapshot: snapshot(validRows()),
      organes: ORGANES,
      scrutin: { ...SCRUTIN, votingDate: new Date("2025-09-05T00:00:00Z") },
    });
    expect(view).toMatchObject({ kind: "withheld", origin: "source" });
  });

  it("accepts a scrutin on the first and the last day of a group", () => {
    for (const day of ["2024-09-12", "2025-09-04"]) {
      const view = officialGroupCountsView({
        snapshot: snapshot([
          row({ organeRef: "PO1", forCount: 300, againstCount: 150, abstainCount: 8 }),
        ]),
        organes: ORGANES,
        scrutin: { ...SCRUTIN, votingDate: new Date(`${day}T00:00:00Z`) },
      });
      expect(view.kind).toBe("shown");
    }
  });

  it("withholds counts that do not add up to the scrutin total, without naming a culprit", () => {
    const rows = validRows();
    rows[0] = row({ organeRef: "PO2", forCount: 199, againstCount: 100, abstainCount: 5 });
    const view = officialGroupCountsView({
      snapshot: snapshot(rows),
      organes: ORGANES,
      scrutin: SCRUTIN,
    });
    expect(view).toMatchObject({ kind: "withheld", origin: "inconsistent" });
  });
});

describe("computedPositionsNote", () => {
  it("says the positions are computed from the current group, not published", () => {
    expect(computedPositionsNote("AN")).toContain("groupe actuel de chaque député");
    expect(computedPositionsNote("AN")).toContain(
      "pas des positions publiées par l'Assemblée nationale"
    );
  });

  it("names the Senate and its members for a Senate scrutin", () => {
    expect(computedPositionsNote("SENAT")).toContain("chaque sénateur");
    expect(computedPositionsNote("SENAT")).toContain("publiées par le Sénat");
  });
});
