import { describe, expect, it } from "vitest";
import {
  createInstitutionSchema,
  decisionSchema,
  decisionTransitionSchema,
  territorialSourceSchema,
} from "../decision-territoriale";

const SOURCE = {
  kind: "PROCES_VERBAL",
  title: "Procès-verbal de la séance",
  producer: "Commune",
  url: "https://example.test/pv.pdf",
  lastVerifiedAt: "2026-10-02",
};

const DECISION = {
  institutionId: "inst-1",
  communeId: "35238",
  title: "Objet de la délibération",
  adoptionDate: "2026-06-04",
  adoptionDatePrecision: "DAY",
  outcome: "ADOPTEE",
  sourceId: "src-1",
  sourceLocator: "page 4, point 12",
};

describe("territorialSourceSchema", () => {
  it("accepts an https document and stores the verification day at UTC midnight", () => {
    const parsed = territorialSourceSchema.parse(SOURCE);
    expect(parsed.lastVerifiedAt.toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(parsed.archiveUrl).toBeNull();
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,x",
    "ftp://example.test/a",
    "file:///etc/passwd",
  ])("refuses the non-http URL %s", (url) => {
    expect(territorialSourceSchema.safeParse({ ...SOURCE, url }).success).toBe(false);
    expect(territorialSourceSchema.safeParse({ ...SOURCE, archiveUrl: url }).success).toBe(false);
  });

  it("refuses a URL carrying credentials", () => {
    expect(
      territorialSourceSchema.safeParse({ ...SOURCE, url: "https://user:pw@example.test/" }).success
    ).toBe(false);
  });

  it("refuses an impossible calendar day instead of rolling it over", () => {
    expect(
      territorialSourceSchema.safeParse({ ...SOURCE, lastVerifiedAt: "2026-02-30" }).success
    ).toBe(false);
  });

  it("refuses unknown keys", () => {
    expect(territorialSourceSchema.safeParse({ ...SOURCE, status: "PUBLISHED" }).success).toBe(
      false
    );
  });
});

describe("decisionSchema", () => {
  it("turns empty optional fields into null", () => {
    const parsed = decisionSchema.parse({ ...DECISION, reference: "", publicationDate: "" });
    expect(parsed.reference).toBeNull();
    expect(parsed.publicationDate).toBeNull();
  });

  it("cannot set the curation status or the reviewer through the notice", () => {
    expect(decisionSchema.safeParse({ ...DECISION, status: "PUBLISHED" }).success).toBe(false);
    expect(decisionSchema.safeParse({ ...DECISION, reviewedBy: "x" }).success).toBe(false);
  });

  it("refuses a malformed INSEE code", () => {
    expect(decisionSchema.safeParse({ ...DECISION, communeId: "../x" }).success).toBe(false);
    expect(decisionSchema.safeParse({ ...DECISION, communeId: "2A004" }).success).toBe(true);
    expect(decisionSchema.safeParse({ ...DECISION, communeId: "97611" }).success).toBe(true);
  });

  it("requires a locator in the source", () => {
    expect(decisionSchema.safeParse({ ...DECISION, sourceLocator: "  " }).success).toBe(false);
  });
});

describe("createInstitutionSchema", () => {
  it("ties a municipal council to a commune and an intercommunal one to a SIREN", () => {
    expect(
      createInstitutionSchema.safeParse({
        kind: "CONSEIL_MUNICIPAL",
        name: "Conseil",
        communeId: "35238",
      }).success
    ).toBe(true);
    expect(
      createInstitutionSchema.safeParse({
        kind: "CONSEIL_MUNICIPAL",
        name: "Conseil",
        sirenEpci: "243500139",
      }).success
    ).toBe(false);
    expect(
      createInstitutionSchema.safeParse({
        kind: "CONSEIL_COMMUNAUTAIRE",
        name: "Conseil",
        sirenEpci: "243500139",
      }).success
    ).toBe(true);
  });
});

describe("decisionTransitionSchema", () => {
  it("refuses an unknown action", () => {
    expect(decisionTransitionSchema.safeParse({ action: "FORCE_PUBLISH" }).success).toBe(false);
  });
});
