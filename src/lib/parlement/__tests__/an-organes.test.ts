import { describe, expect, it } from "vitest";
import { parseAnOrgan } from "../an-organes";

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
    expect(parseAnOrgan(organ({ legislature: null }), SCOPE)).toEqual({
      skipped: "legislature-out-of-scope",
    });
  });

  it("skips a group without a label instead of falling back on its abbreviation", () => {
    expect(parseAnOrgan(organ({ libelle: "  " }), SCOPE)).toEqual({ skipped: "missing-label" });
  });

  it("treats a malformed date as unknown", () => {
    const result = parseAnOrgan(organ({ viMoDe: { dateDebut: "12/09/2024", dateFin: "" } }), SCOPE);
    expect(result).toMatchObject({ row: { startDate: null, endDate: null } });
  });

  it("rejects payloads that are not an organ", () => {
    expect(parseAnOrgan(null, SCOPE)).toEqual({ skipped: "not-an-organ" });
    expect(parseAnOrgan({ organe: { codeType: "GP" } }, SCOPE)).toEqual({
      skipped: "not-an-organ",
    });
    expect(parseAnOrgan([], SCOPE)).toEqual({ skipped: "not-an-organ" });
  });
});
