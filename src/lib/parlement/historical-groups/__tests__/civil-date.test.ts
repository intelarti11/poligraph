import { describe, expect, it } from "vitest";
import { civilDate, compareCivilDates, parseCivilDate } from "../civil-date";

describe("parseCivilDate", () => {
  it("accepts real calendar days", () => {
    expect(parseCivilDate("2022-06-22")).toBe("2022-06-22");
    expect(parseCivilDate("2024-12-31")).toBe("2024-12-31");
  });

  it("follows the leap year rule, century years included", () => {
    expect(parseCivilDate("2024-02-29")).toBe("2024-02-29");
    expect(parseCivilDate("2000-02-29")).toBe("2000-02-29");
    expect(parseCivilDate("2023-02-29")).toBeNull();
    expect(parseCivilDate("1900-02-29")).toBeNull();
  });

  it("refuses an impossible day instead of moving it to another day", () => {
    expect(parseCivilDate("2024-02-31")).toBeNull();
    expect(parseCivilDate("2024-04-31")).toBeNull();
    expect(parseCivilDate("2024-13-01")).toBeNull();
    expect(parseCivilDate("2024-00-10")).toBeNull();
    expect(parseCivilDate("2024-01-00")).toBeNull();
    expect(parseCivilDate("0000-01-01")).toBeNull();
  });

  it("refuses anything that is not exactly YYYY-MM-DD: no time, no zone, no spaces", () => {
    expect(parseCivilDate("2024-01-01T00:00:00Z")).toBeNull();
    expect(parseCivilDate("2024-01-01 ")).toBeNull();
    expect(parseCivilDate(" 2024-01-01")).toBeNull();
    expect(parseCivilDate("24-01-01")).toBeNull();
    expect(parseCivilDate("2024/01/01")).toBeNull();
    expect(parseCivilDate("")).toBeNull();
  });

  it("refuses values that are not strings", () => {
    expect(parseCivilDate(null)).toBeNull();
    expect(parseCivilDate(undefined)).toBeNull();
    expect(parseCivilDate(20240101)).toBeNull();
    expect(parseCivilDate(new Date("2024-01-01T00:00:00Z"))).toBeNull();
  });
});

describe("civilDate", () => {
  it("returns a valid day and throws on an invalid one", () => {
    expect(civilDate("2022-06-22")).toBe("2022-06-22");
    expect(() => civilDate("2022-02-30")).toThrow("Not a civil date");
  });
});

describe("compareCivilDates", () => {
  it("orders days across months and years", () => {
    expect(compareCivilDates(civilDate("2022-06-22"), civilDate("2022-06-28"))).toBe(-1);
    expect(compareCivilDates(civilDate("2023-01-01"), civilDate("2022-12-31"))).toBe(1);
    expect(compareCivilDates(civilDate("2022-06-22"), civilDate("2022-06-22"))).toBe(0);
  });
});
