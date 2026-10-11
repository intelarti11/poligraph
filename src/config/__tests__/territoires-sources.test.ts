import { describe, expect, it } from "vitest";
import { POLIGRAPH_DATA_LICENCE, TERRITOIRES_SOURCES } from "@/config/territoires-sources";

describe("registre des licences Territoires", () => {
  it("has unique ids", () => {
    const ids = TERRITOIRES_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("states a verified licence for every source already in use", () => {
    for (const s of TERRITOIRES_SOURCES.filter((x) => x.status === "EN_SERVICE")) {
      expect(s.licence.name, s.id).toBeTruthy();
      expect(s.licence.url, s.id).toMatch(/^https:\/\//);
    }
  });

  it("records where and when each licence was read", () => {
    for (const s of TERRITOIRES_SOURCES) {
      expect(s.licence.verifiedOn, s.id).toMatch(/^https:\/\//);
      expect(s.licence.verifiedAt, s.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.url, s.id).toMatch(/^https:\/\//);
    }
  });

  it("explains every missing licence instead of leaving it blank", () => {
    for (const s of TERRITOIRES_SOURCES.filter((x) => x.licence.name === null)) {
      expect(s.licence.note, s.id).toBeTruthy();
      expect(s.status, s.id).toBe("PREVU");
    }
  });

  it("uses no em or en dash in public text", () => {
    const text = JSON.stringify([TERRITOIRES_SOURCES, POLIGRAPH_DATA_LICENCE]);
    expect(text).not.toMatch(/[–—]/);
  });
});
