import { describe, expect, it } from "vitest";
import { isDataStatusKind, worstDataStatus } from "../data-status";

describe("worstDataStatus", () => {
  it("retient le statut le moins fiable", () => {
    expect(worstDataStatus(["complete", "partial"])).toBe("partial");
    expect(worstDataStatus(["complete", "unverified", "partial"])).toBe("unverified");
    expect(worstDataStatus(["partial", "pending"])).toBe("pending");
  });

  it("un ensemble vide est en attente, pas complet", () => {
    expect(worstDataStatus([])).toBe("pending");
  });
});

describe("isDataStatusKind", () => {
  it("rejette toute valeur hors liste", () => {
    expect(isDataStatusKind("complete")).toBe(true);
    expect(isDataStatusKind("done")).toBe(false);
    expect(isDataStatusKind(undefined)).toBe(false);
  });
});
