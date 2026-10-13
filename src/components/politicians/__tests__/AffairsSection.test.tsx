import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AffairsSection } from "@/components/politicians/AffairsSection";

function makeAffair(overrides: Record<string, unknown> = {}) {
  return {
    id: "v1",
    slug: "affaire-victime",
    title: "Affaire de test",
    description: "Faits factuels.",
    status: "CONDAMNATION_DEFINITIVE",
    category: "VIOLENCE",
    involvement: "VICTIM",
    factsDate: null,
    startDate: null,
    verdictDate: new Date("2024-01-15"),
    createdAt: new Date("2024-01-01"),
    appeal: false,
    court: null,
    chamber: null,
    caseNumber: null,
    partyAtTime: null,
    events: [],
    sources: [],
    linkedAffair: null,
    linkedBy: [],
    prisonMonths: null,
    prisonFirmMonths: null,
    ineligibilityFirmMonths: null,
    fineAmount: null,
    ineligibilityMonths: null,
    communityService: null,
    otherSentence: null,
    sentence: null,
    ...overrides,
  };
}

describe("AffairsSection — liens vers les fiches d'affaires", () => {
  it("une affaire en cause directe renvoie vers sa fiche", () => {
    const { container } = render(
      <AffairsSection
        affairs={[makeAffair({ id: "d1", slug: "affaire-directe", involvement: "DIRECT" })]}
        civility="M"
      />
    );
    expect(container.querySelector('a[href="/affaires/affaire-directe"]')).toBeTruthy();
  });

  it("une affaire où le politicien est victime renvoie vers sa fiche", () => {
    const { container } = render(<AffairsSection affairs={[makeAffair()]} civility="M" />);
    expect(container.querySelector('a[href="/affaires/affaire-victime"]')).toBeTruthy();
  });
});

describe("AffairsSection — décisions non pénales", () => {
  it("ne range jamais une décision civile sous « Condamnation définitive »", () => {
    const { container } = render(
      <AffairsSection
        affairs={[
          makeAffair({
            id: "c1",
            slug: "affaire-civile",
            involvement: "DIRECT",
            jurisdictionOrder: "CIVIL",
          }),
        ]}
        civility="M"
      />
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Décisions non pénales");
    expect(text).not.toContain("Condamnation définitive");
    expect(text).toContain("Décision définitive");
    expect(container.querySelector('a[href="/affaires/affaire-civile"]')).toBeTruthy();
  });

  it("garde le groupe « Condamnation définitive » pour une affaire pénale", () => {
    const { container } = render(
      <AffairsSection
        affairs={[makeAffair({ id: "p1", involvement: "DIRECT", jurisdictionOrder: "PENAL" })]}
        civility="M"
      />
    );
    expect(container.textContent).toContain("Condamnation définitive");
    expect(container.textContent).not.toContain("Décisions non pénales");
  });
});
