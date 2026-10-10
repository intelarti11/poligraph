import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parisDay } from "@/lib/governments/dates";

// Birth and death dates are mostly stored at midnight Paris time (22:00 or 23:00 UTC the day
// before): reading their UTC day shows the previous day. Public surfaces must use the Paris day.
const FILES = [
  "src/app/politiques/[slug]/page-data.ts",
  "src/app/admin/politiques/[id]/edit/page.tsx",
];

describe("birth and death dates read in Paris time", () => {
  it("parisDay keeps the calendar day of a Paris-midnight timestamp", () => {
    expect(parisDay(new Date("1953-11-21T23:00:00.000Z"))).toBe("1953-11-22");
    expect(parisDay(new Date("1946-07-20T12:00:00.000Z"))).toBe("1946-07-20");
  });

  it.each(FILES)("%s does not read a birth or death date in UTC", (file) => {
    const code = readFileSync(file, "utf8");
    expect(code).not.toMatch(/(birthDate|deathDate)\??\.toISOString\(\)/);
  });
});
