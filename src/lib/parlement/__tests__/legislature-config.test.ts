import { describe, expect, it } from "vitest";
import { AN_LEGISLATURE_COVERAGE, AN_LEGISLATURE_FACTS, AN_SOURCES } from "@/config/legislatures";
import {
  isIsoDate,
  validateLegislatureCoverage,
  validateLegislatureFacts,
} from "../legislature-config";
import type { LegislatureCoverage, LegislatureFacts } from "../legislature-types";

const clone = <T>(value: T): T => structuredClone(value);
const numbers = AN_LEGISLATURE_FACTS.map((l) => l.number);

describe("configuration institutionnelle des législatures de l'AN", () => {
  it("couvre exactement les 15e, 16e et 17e", () => {
    expect(numbers).toEqual([15, 16, 17]);
  });

  it("est cohérente", () => {
    expect(validateLegislatureFacts(AN_LEGISLATURE_FACTS, AN_SOURCES)).toEqual([]);
    expect(validateLegislatureCoverage(AN_LEGISLATURE_COVERAGE, numbers)).toEqual([]);
  });

  it("donne 577 sièges légaux avec LO 119 pour chaque législature", () => {
    for (const leg of AN_LEGISLATURE_FACTS) {
      expect(leg.seats.legalCount).toBe(577);
      expect(leg.seats.legalBasisSourceIds).toEqual(["lo-119"]);
    }
  });

  it("distingue les natures de dates de la 15e législature", () => {
    const l15 = AN_LEGISLATURE_FACTS[0]!;
    const byKind = Object.fromEntries(l15.dates.map((d) => [d.kind, d.date]));
    expect(byKind["election-second-round"]).toBe("2017-06-18");
    expect(byKind["archive-start"]).toBe("2017-06-23");
    expect(byKind["opening-sitting"]).toBe("2017-06-27");
    expect(byKind["archive-start"]).not.toBe(byKind["opening-sitting"]);
  });

  it("sépare décret et publication de la dissolution de 2024", () => {
    const l16 = AN_LEGISLATURE_FACTS[1]!;
    const d = (k: string) => l16.dates.find((x) => x.kind === k)?.date;
    expect(d("dissolution-decree")).toBe("2024-06-09");
    expect(d("dissolution-publication")).toBe("2024-06-10");
    expect(l16.endCause).toBe("dissolution");
  });

  it("la 17e est en cours, sans dissolution ni fin", () => {
    const l17 = AN_LEGISLATURE_FACTS[2]!;
    expect(l17.status).toBe("ongoing");
    expect(l17.endCause).toBeNull();
    expect(l17.dates.some((d) => d.kind === "dissolution-decree")).toBe(false);
  });

  it("ouvre la 17e le deuxième jeudi suivant le second tour (article 12)", () => {
    const l17 = AN_LEGISLATURE_FACTS[2]!;
    const second = new Date(
      `${l17.dates.find((d) => d.kind === "election-second-round")!.date}T00:00:00Z`
    );
    const day = second.getUTCDay();
    const firstThursday = new Date(second);
    firstThursday.setUTCDate(second.getUTCDate() + ((4 - day + 7) % 7 || 7));
    const secondThursday = new Date(firstThursday);
    secondThursday.setUTCDate(firstThursday.getUTCDate() + 7);
    expect(secondThursday.toISOString().slice(0, 10)).toBe(
      l17.dates.find((d) => d.kind === "opening-sitting")!.date
    );
  });

  it("l'expiration des pouvoirs est un troisième mardi de juin (LO 121)", () => {
    for (const leg of AN_LEGISLATURE_FACTS) {
      for (const d of leg.dates.filter(
        (x) => x.kind === "powers-expiry" || x.kind === "previous-powers-expiry"
      )) {
        const date = new Date(`${d.date}T00:00:00Z`);
        expect(date.getUTCMonth()).toBe(5);
        expect(date.getUTCDay()).toBe(2);
        expect(Math.ceil(date.getUTCDate() / 7)).toBe(3);
      }
    }
  });

  it("signale les contradictions de dates sans les arbitrer", () => {
    const contradictions = AN_LEGISLATURE_FACTS.flatMap((l) => l.contradictions);
    expect(contradictions.length).toBeGreaterThanOrEqual(3);
    expect(contradictions.every((c) => c.arbitrated === false)).toBe(true);
  });

  it("garde faits et couverture dans des structures distinctes", () => {
    for (const leg of AN_LEGISLATURE_FACTS) {
      expect(leg).not.toHaveProperty("datasets");
      expect(leg).not.toHaveProperty("coverage");
    }
    for (const cov of AN_LEGISLATURE_COVERAGE) {
      expect(cov).not.toHaveProperty("dates");
      expect(cov).not.toHaveProperty("seats");
    }
  });

  it("n'affirme encore aucun jeu de données « complet »", () => {
    const levels = AN_LEGISLATURE_COVERAGE.flatMap((c) => c.datasets.map((d) => d.level));
    expect(levels).not.toContain("complete");
  });

  it("ne déduit aucun effectif historique de la composition actuelle", () => {
    const l16 = AN_LEGISLATURE_COVERAGE.find((c) => c.number === 16)!;
    expect(l16.datasets.find((d) => d.dataset === "referenced-groups")!.level).toBe("absent");
    expect(l16.datasets.find((d) => d.dataset === "dated-group-membership")!.level).toBe("absent");
    expect(l16.datasets.find((d) => d.dataset === "computed-group-positions")!.level).toBe(
      "withheld"
    );
  });

  it("ne cite que des URL https officielles ou de l'Assemblée", () => {
    for (const s of AN_SOURCES) {
      expect(s.url.startsWith("https://")).toBe(true);
    }
    const hosts = new Set(AN_SOURCES.map((s) => new URL(s.url).host));
    expect([...hosts].sort()).toEqual([
      "data.assemblee-nationale.fr",
      "www.assemblee-nationale.fr",
      "www.legifrance.gouv.fr",
    ]);
  });
});

describe("validateLegislatureFacts : cas d'échec", () => {
  const base = () => clone(AN_LEGISLATURE_FACTS) as LegislatureFacts[];

  it("refuse une date invalide", () => {
    const facts = base();
    facts[0]!.dates[0]!.date = "2017-02-31" as never;
    expect(validateLegislatureFacts(facts, AN_SOURCES).join()).toContain("date invalide");
  });

  it("refuse une date sans source ou avec une source inconnue", () => {
    const a = base();
    a[0]!.dates[0]!.sourceIds = [];
    expect(validateLegislatureFacts(a, AN_SOURCES).join()).toContain("date sans source");
    const b = base();
    b[0]!.dates[0]!.sourceIds = ["inconnue"];
    expect(validateLegislatureFacts(b, AN_SOURCES).join()).toContain("source inconnue");
  });

  it("refuse une date déduite sans explication", () => {
    const facts = base();
    const derived = facts[0]!.dates.find((d) => d.basis === "derived")!;
    delete derived.explanation;
    expect(validateLegislatureFacts(facts, AN_SOURCES).join()).toContain("sans explication");
  });

  it("refuse une ouverture antérieure au second tour", () => {
    const facts = base();
    facts[0]!.dates.find((d) => d.kind === "opening-sitting")!.date = "2017-06-01";
    expect(validateLegislatureFacts(facts, AN_SOURCES).join()).toContain("ouverture");
  });

  it("refuse une législature en cours avec une dissolution", () => {
    const facts = base();
    facts[2]!.dates.push({
      kind: "dissolution-decree",
      date: "2025-01-01",
      basis: "sourced",
      sourceIds: ["decret-dissolution-2024"],
    });
    expect(validateLegislatureFacts(facts, AN_SOURCES).join()).toContain("en cours mais");
  });

  it("refuse une contradiction qui cite une date absente", () => {
    const facts = base();
    facts[0]!.contradictions[0]!.claims[0]!.date = "2017-06-22";
    expect(validateLegislatureFacts(facts, AN_SOURCES).join()).toContain("date absente");
  });

  it("refuse des sièges sans source juridique", () => {
    const facts = base();
    facts[0]!.seats.legalBasisSourceIds = [];
    expect(validateLegislatureFacts(facts, AN_SOURCES).join()).toContain("sans source juridique");
  });
});

describe("validateLegislatureCoverage : cas d'échec", () => {
  const base = () => clone(AN_LEGISLATURE_COVERAGE) as LegislatureCoverage[];

  it("refuse « complet » sans justification de périmètre", () => {
    const cov = base();
    const ds = cov[2]!.datasets[0]!;
    ds.level = "complete";
    ds.measured = { count: 10, outOf: 10 };
    expect(validateLegislatureCoverage(cov, numbers).join()).toContain(
      "complet sans justification"
    );
  });

  it("refuse « complet » sans référence de comparaison", () => {
    const cov = base();
    const ds = cov[2]!.datasets[0]!;
    ds.level = "complete";
    ds.completeJustification = "Tout est là.";
    ds.measured = { count: 10 };
    expect(validateLegislatureCoverage(cov, numbers).join()).toContain("sans référence");
  });

  it("refuse « complet » quand la mesure ne boucle pas", () => {
    const cov = base();
    const ds = cov[2]!.datasets[0]!;
    ds.level = "complete";
    ds.completeJustification = "Tout est là.";
    ds.measured = { count: 8730, outOf: 8772 };
    expect(validateLegislatureCoverage(cov, numbers).join()).toContain("ne boucle pas");
  });

  it("accepte « complet » seulement avec justification, référence et mesure qui boucle", () => {
    const cov = base();
    const ds = cov[2]!.datasets[0]!;
    ds.level = "complete";
    ds.completeJustification = "Comparé au total publié par la source.";
    ds.measured = { count: 100, expected: 100 };
    expect(validateLegislatureCoverage(cov, numbers)).toEqual([]);
  });

  it("refuse « absent » avec un effectif non nul", () => {
    const cov = base();
    const ds = cov[0]!.datasets.find((d) => d.level === "absent")!;
    ds.measured = { count: 3 };
    expect(validateLegislatureCoverage(cov, numbers).join()).toContain("absent avec un effectif");
  });
});

describe("isIsoDate", () => {
  it("valide les dates réelles uniquement", () => {
    expect(isIsoDate("2024-06-09")).toBe(true);
    expect(isIsoDate("2024-02-30")).toBe(false);
    expect(isIsoDate("09/06/2024")).toBe(false);
  });
});
