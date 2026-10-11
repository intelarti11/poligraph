import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { normalizeDeputeRecord } from "../deputes";
import type { DeputeCSV } from "../types";

const record = (departementCode: string) => ({ departementCode }) as DeputeCSV;

describe("normalizeDeputeRecord", () => {
  it("upper-cases the Corsican department codes written in lower case by the AN CSV", () => {
    expect(normalizeDeputeRecord(record("2a")).departementCode).toBe("2A");
    expect(normalizeDeputeRecord(record("2b")).departementCode).toBe("2B");
  });

  it("leaves numeric codes unchanged", () => {
    expect(normalizeDeputeRecord(record("35")).departementCode).toBe("35");
    expect(normalizeDeputeRecord(record("974")).departementCode).toBe("974");
  });
});
