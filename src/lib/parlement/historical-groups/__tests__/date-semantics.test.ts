import { describe, expect, it } from "vitest";
import { assertConsistent, coverageAt, DATE_SEMANTICS_V1, isEdgeDay } from "../date-semantics";
import { d, membership, OPEN_BOUND } from "../__fixtures__/builders";

describe("coverageAt, interpretation v1 (closed interval)", () => {
  const record = membership("r", "PA_T01", "PO_G1", "2022-06-29", "2023-03-10");

  it("holds on the first day and on the last day, the day before and after being outside", () => {
    expect(coverageAt(record, d("2022-06-28"), OPEN_BOUND)).toEqual({ kind: "OUT" });
    expect(coverageAt(record, d("2022-06-29"), OPEN_BOUND)).toEqual({ kind: "IN" });
    expect(coverageAt(record, d("2023-03-10"), OPEN_BOUND)).toEqual({ kind: "IN" });
    expect(coverageAt(record, d("2023-03-11"), OPEN_BOUND)).toEqual({ kind: "OUT" });
  });

  it("names the interpretation it implements", () => {
    expect(DATE_SEMANTICS_V1).toBe("v1");
  });

  describe("an end that is open at the snapshot", () => {
    const open = membership("r", "PA_T01", "PO_G1", "2022-06-29", "OPEN");

    it("holds up to the bound of the snapshot, bound included", () => {
      expect(coverageAt(open, d("2026-10-16"), OPEN_BOUND)).toEqual({ kind: "IN" });
      expect(coverageAt(open, OPEN_BOUND.date, OPEN_BOUND)).toEqual({ kind: "IN" });
    });

    it("says nothing beyond the bound: neither in nor out", () => {
      expect(coverageAt(open, d("2026-10-18"), OPEN_BOUND)).toEqual({
        kind: "UNCERTAIN",
        reason: "OPEN_BEYOND_SNAPSHOT",
      });
    });

    it("is not a record that started: it is still outside before its start", () => {
      expect(coverageAt(open, d("2022-06-28"), OPEN_BOUND)).toEqual({ kind: "OUT" });
    });
  });

  it("does not read an unknown end as open, nor as closed", () => {
    const unknownEnd = membership("r", "PA_T01", "PO_G1", "2022-06-29", "UNKNOWN");
    expect(coverageAt(unknownEnd, d("2023-01-01"), OPEN_BOUND)).toEqual({
      kind: "UNCERTAIN",
      reason: "END_STATE_UNKNOWN",
    });
    expect(coverageAt(unknownEnd, d("2022-06-01"), OPEN_BOUND)).toEqual({ kind: "OUT" });
  });

  it("does not guess the start when it is unknown, but a dated end still closes the record", () => {
    const unknownStart = membership("r", "PA_T01", "PO_G1", null, "2022-12-31");
    expect(coverageAt(unknownStart, d("2022-10-10"), OPEN_BOUND)).toEqual({
      kind: "UNCERTAIN",
      reason: "START_DATE_UNKNOWN",
    });
    expect(coverageAt(unknownStart, d("2023-01-01"), OPEN_BOUND)).toEqual({ kind: "OUT" });
  });

  it("reports the start first when both ends are unknown", () => {
    const both = membership("r", "PA_T01", "PO_G1", null, "UNKNOWN");
    expect(coverageAt(both, d("2023-01-01"), OPEN_BOUND)).toEqual({
      kind: "UNCERTAIN",
      reason: "START_DATE_UNKNOWN",
    });
  });
});

describe("assertConsistent", () => {
  it("refuses a record whose states and dates disagree, rather than interpreting it", () => {
    const base = membership("bad", "PA_T01", "PO_G1", "2022-06-29", "2023-03-10");
    expect(() => assertConsistent({ ...base, startState: "UNKNOWN" })).toThrow("Inconsistent");
    expect(() => assertConsistent({ ...base, endState: "OPEN_AT_SNAPSHOT" })).toThrow(
      "Inconsistent"
    );
    expect(() => assertConsistent({ ...base, endDate: null })).toThrow("Inconsistent");
    expect(() => assertConsistent({ ...base, endDate: d("2022-01-01") })).toThrow(
      "start after end"
    );
    expect(() => assertConsistent(base)).not.toThrow();
  });
});

describe("isEdgeDay", () => {
  const records = [
    membership("a", "PA_T01", "PO_NI", "2022-06-22", "2022-06-28"),
    membership("b", "PA_T01", "PO_G1", "2022-06-29", "OPEN"),
  ];

  it("is true on the start or the end of any record of the person", () => {
    expect(isEdgeDay(records, d("2022-06-22"))).toBe(true);
    expect(isEdgeDay(records, d("2022-06-28"))).toBe(true);
    expect(isEdgeDay(records, d("2022-06-29"))).toBe(true);
  });

  it("is false inside an interval and on days with no record", () => {
    expect(isEdgeDay(records, d("2022-06-25"))).toBe(false);
    expect(isEdgeDay(records, d("2023-01-01"))).toBe(false);
  });

  it("is false when no date is known", () => {
    expect(isEdgeDay([membership("c", "PA_T01", "PO_G1", null, "UNKNOWN")], d("2022-06-28"))).toBe(
      false
    );
  });
});
