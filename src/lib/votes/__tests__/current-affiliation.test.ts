import { describe, expect, it } from "vitest";
import { currentAffiliationLabel } from "../current-affiliation";

describe("currentAffiliationLabel", () => {
  it("présente le groupe comme actuel, jamais comme celui du jour du vote", () => {
    const label = currentAffiliationLabel({ group: { code: "SOC", name: "Socialistes" } });

    expect(label?.text).toBe("Groupe actuel : SOC");
    expect(label?.title).toContain("pas nécessairement celui du jour du vote");
  });

  it("préfère le groupe au parti", () => {
    const label = currentAffiliationLabel({
      group: { code: "SOC", name: "Socialistes" },
      party: { shortName: "PS", name: "Parti socialiste" },
    });

    expect(label?.text).toContain("SOC");
  });

  it("retombe sur le parti actuel, étiqueté comme tel", () => {
    const label = currentAffiliationLabel({
      party: { shortName: null, name: "Parti socialiste" },
    });

    expect(label?.text).toBe("Parti actuel : Parti socialiste");
  });

  it("ne renvoie rien sans affiliation", () => {
    expect(currentAffiliationLabel({})).toBeNull();
  });
});
