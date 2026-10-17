import { describe, expect, it } from "vitest";
import { isBlockingSkip, parseAnOrgan, validateAnOrganRows, type AnOrganRow } from "../an-organes";

const SCOPE = [15, 16, 17] as const;

// Shape of the real AMO30 files (namespace attributes trimmed).
function organ(overrides: Record<string, unknown> = {}) {
  return {
    organe: {
      uid: "PO847173",
      codeType: "GP",
      libelle: "UDR",
      libelleAbrege: "UDR",
      viMoDe: { dateDebut: "2024-09-12", dateAgrement: null, dateFin: "2025-09-04" },
      legislature: "17",
      ...overrides,
    },
  };
}

describe("parseAnOrgan", () => {
  it("keeps the label and the period the source gives for a group", () => {
    expect(parseAnOrgan(organ(), SCOPE)).toEqual({
      row: {
        organeRef: "PO847173",
        legislature: 17,
        label: "UDR",
        abbreviation: "UDR",
        startDate: new Date("2024-09-12T00:00:00Z"),
        endDate: new Date("2025-09-04T00:00:00Z"),
      },
    });
  });

  it("keeps a group whose end date is absent as ongoing, never inventing one", () => {
    const result = parseAnOrgan(
      organ({
        uid: "PO872880",
        libelle: "Union des droites pour la République",
        viMoDe: { dateDebut: "2025-09-05", dateFin: null },
      }),
      SCOPE
    );
    expect(result).toMatchObject({ row: { organeRef: "PO872880", endDate: null } });
  });

  it("does not merge two references of the same abbreviation", () => {
    const a = parseAnOrgan(organ(), SCOPE);
    const b = parseAnOrgan(
      organ({ uid: "PO872880", libelle: "Union des droites pour la République" }),
      SCOPE
    );
    expect(a).toMatchObject({ row: { label: "UDR" } });
    expect(b).toMatchObject({ row: { label: "Union des droites pour la République" } });
  });

  it("skips an organ that is not a parliamentary group", () => {
    expect(parseAnOrgan(organ({ codeType: "COMPER" }), SCOPE)).toEqual({
      skipped: "not-parliamentary-group",
    });
  });

  it("skips a group outside the wanted legislatures", () => {
    expect(parseAnOrgan(organ({ legislature: "14" }), SCOPE)).toEqual({
      skipped: "legislature-out-of-scope",
    });
  });

  it("does not hide a group with no legislature behind the out-of-scope skip", () => {
    for (const legislature of [null, "", undefined, "abc"]) {
      expect(parseAnOrgan(organ({ legislature }), SCOPE)).toEqual({
        skipped: "missing-legislature",
      });
    }
  });

  it("skips a group without a label instead of falling back on its abbreviation", () => {
    expect(parseAnOrgan(organ({ libelle: "  " }), SCOPE)).toEqual({ skipped: "missing-label" });
  });

  it("treats an absent or empty date as unknown", () => {
    for (const viMoDe of [{ dateDebut: null, dateFin: "" }, {}, null]) {
      const result = parseAnOrgan(organ({ viMoDe }), SCOPE);
      expect(result).toMatchObject({ row: { startDate: null, endDate: null } });
    }
  });

  it("rejects a malformed or impossible date instead of guessing one", () => {
    for (const dateDebut of ["12/09/2024", "2024-02-31", "2023-02-29", "2024-13-01", 20240912]) {
      expect(parseAnOrgan(organ({ viMoDe: { dateDebut, dateFin: null } }), SCOPE)).toEqual({
        skipped: "invalid-date",
      });
    }
    expect(
      parseAnOrgan(organ({ viMoDe: { dateDebut: "2024-02-29", dateFin: null } }), SCOPE)
    ).toMatchObject({ row: { startDate: new Date("2024-02-29T00:00:00Z") } });
  });

  it("rejects payloads that are not an organ", () => {
    expect(parseAnOrgan(null, SCOPE)).toEqual({ skipped: "not-an-organ" });
    expect(parseAnOrgan({ organe: { codeType: "GP" } }, SCOPE)).toEqual({
      skipped: "not-an-organ",
    });
    expect(parseAnOrgan([], SCOPE)).toEqual({ skipped: "not-an-organ" });
  });
});

describe("isBlockingSkip", () => {
  it("only lets through organs that are not groups of the wanted legislatures", () => {
    expect(isBlockingSkip("not-parliamentary-group")).toBe(false);
    expect(isBlockingSkip("legislature-out-of-scope")).toBe(false);
    for (const reason of [
      "not-an-organ",
      "missing-label",
      "missing-legislature",
      "invalid-date",
    ] as const) {
      expect(isBlockingSkip(reason)).toBe(true);
    }
  });
});

function row(overrides: Partial<AnOrganRow> = {}): AnOrganRow {
  return {
    organeRef: "PO1",
    legislature: 17,
    label: "Groupe",
    abbreviation: null,
    startDate: null,
    endDate: null,
    ...overrides,
  };
}

describe("validateAnOrganRows", () => {
  const full = [
    row({ organeRef: "PO15", legislature: 15 }),
    row({ organeRef: "PO16", legislature: 16 }),
    row({ organeRef: "PO17", legislature: 17 }),
  ];

  it("accepts a consistent set", () => {
    expect(validateAnOrganRows(full, SCOPE)).toEqual([]);
  });

  it("reports a duplicated organeRef", () => {
    expect(validateAnOrganRows([...full, row({ organeRef: "PO17" })], SCOPE)).toEqual([
      "duplicate organeRef: PO17",
    ]);
  });

  it("reports an end date before the start date", () => {
    const inverted = row({
      organeRef: "PO18",
      startDate: new Date("2025-01-02T00:00:00Z"),
      endDate: new Date("2025-01-01T00:00:00Z"),
    });
    expect(validateAnOrganRows([...full, inverted], SCOPE)).toEqual([
      "end date before start date for PO18",
    ]);
  });

  it("reports a wanted legislature that has no group at all", () => {
    expect(validateAnOrganRows(full.slice(0, 2), SCOPE)).toEqual(["no group for legislature 17"]);
    expect(validateAnOrganRows([], SCOPE)).toHaveLength(3);
  });
});
