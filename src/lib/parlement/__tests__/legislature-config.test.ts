import { describe, expect, it } from "vitest";
import { AN_LEGISLATURE_COVERAGE, AN_LEGISLATURE_FACTS, AN_SOURCES } from "@/config/legislatures";
import {
  isIsoDate,
  publicDates,
  staleDatasets,
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

  it("marque les trois arbitrages comme résolus, avec leur résolution", () => {
    const contradictions = AN_LEGISLATURE_FACTS.flatMap((l) => l.contradictions);
    expect(contradictions).toHaveLength(3);
    for (const c of contradictions) {
      expect(c.arbitrated).toBe(true);
      expect(c.resolution?.length).toBeGreaterThan(20);
    }
  });

  it("15e : garde distincts le 21 juin (interne), le 23 juin (archives) et le 27 juin (séance)", () => {
    const l15 = AN_LEGISLATURE_FACTS[0]!;
    const get = (k: string) => l15.dates.find((d) => d.kind === k)!;
    expect(get("mandate-start").date).toBe("2017-06-21");
    expect(get("mandate-start").display).toBe("internal-only");
    expect(get("archive-start").date).toBe("2017-06-23");
    expect(get("archive-start").explanation).toContain("Aucune signification juridique");
    expect(get("opening-sitting").date).toBe("2017-06-27");
    expect(publicDates(l15).map((d) => d.date)).not.toContain("2017-06-21");
  });

  it("15e : l'expiration du 20 juin 2017 s'appuie sur le décret 2012-558", () => {
    const l15 = AN_LEGISLATURE_FACTS[0]!;
    const prev = l15.dates.find((d) => d.kind === "previous-election-second-round")!;
    expect(prev.date).toBe("2012-06-17");
    expect(prev.sourceIds).toEqual(["decret-2012-558"]);
    expect(l15.dates.find((d) => d.kind === "previous-powers-expiry")!.date).toBe("2017-06-20");
    expect(AN_SOURCES.find((s) => s.id === "decret-2012-558")!.url).toContain(
      "JORFTEXT000025746924"
    );
  });

  it("16e : quatre dates de fin distinctes, publication et entrée en vigueur le 10 juin", () => {
    const l16 = AN_LEGISLATURE_FACTS[1]!;
    const get = (k: string) => l16.dates.find((d) => d.kind === k)!;
    expect(get("archive-end").date).toBe("2024-06-09");
    expect(get("dissolution-decree").date).toBe("2024-06-09");
    expect(get("dissolution-publication").date).toBe("2024-06-10");
    expect(get("dissolution-entry-into-force").date).toBe("2024-06-10");
    expect(get("archive-end").explanation).toContain("n'est ni la date de publication");
  });

  it("17e : aucune date unique de début de mandat publique, 18 juillet = première séance", () => {
    const l17 = AN_LEGISLATURE_FACTS[2]!;
    expect(publicDates(l17).some((d) => d.kind === "mandate-start")).toBe(false);
    for (const leg of AN_LEGISLATURE_FACTS) {
      expect(publicDates(leg).some((d) => d.kind === "mandate-start")).toBe(false);
    }
    expect(l17.dates.find((d) => d.kind === "opening-sitting")!.date).toBe("2024-07-18");
  });

  it("17e : le 19 juin 2029 est une échéance conditionnelle", () => {
    const expiry = AN_LEGISLATURE_FACTS[2]!.dates.find((d) => d.kind === "powers-expiry")!;
    expect(expiry.date).toBe("2029-06-19");
    expect(expiry.basis).toBe("derived");
    expect(expiry.conditional).toContain("absence de dissolution");
  });

  it("LO 121 pointe vers la version en vigueur", () => {
    const lo121 = AN_SOURCES.find((s) => s.id === "lo-121")!;
    expect(lo121.url).toBe("https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006353288");
    expect(lo121.label).not.toContain("2023");
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

  it("liste la 15e dans la navigation, jeux absents nommés, sans confondre import et activité", () => {
    for (const cov of AN_LEGISLATURE_COVERAGE) expect(cov.navigation.listed).toBe(true);
    const c15 = AN_LEGISLATURE_COVERAGE.find((c) => c.number === 15)!;
    const absent = c15.datasets.filter((d) => d.level === "absent").map((d) => d.dataset);
    expect(absent).toEqual(
      expect.arrayContaining(["scrutins", "individual-votes", "official-group-counts"])
    );
    expect(c15.navigation.absenceNotice).toContain(
      "Ce n'est pas une absence d'activité parlementaire"
    );
  });

  it("ne porte aucune valeur attendue sans total officiellement attesté", () => {
    for (const cov of AN_LEGISLATURE_COVERAGE) {
      for (const ds of cov.datasets) {
        expect(ds.measured.expected, `${cov.number}/${ds.dataset}`).toBeUndefined();
      }
    }
  });

  it("n'attribue aucun statut global de complétude à une législature", () => {
    for (const cov of AN_LEGISLATURE_COVERAGE) {
      expect(cov).not.toHaveProperty("status");
      expect(cov).not.toHaveProperty("level");
      expect(cov).not.toHaveProperty("overall");
    }
  });

  it("préserve la date de mesure et signale les mesures périmées", () => {
    const cov = AN_LEGISLATURE_COVERAGE[2]!;
    expect(cov.datasets.every((d) => d.measuredAt === "2026-10-15")).toBe(true);
    expect(cov.refresh.onPageCreation).toBe(true);
    expect(staleDatasets(cov, new Date("2026-10-20T00:00:00Z"))).toEqual([]);
    expect(staleDatasets(cov, new Date("2026-12-01T00:00:00Z")).length).toBe(cov.datasets.length);
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

describe("arbitrages et affichage : cas d'échec", () => {
  const base = () => clone(AN_LEGISLATURE_FACTS) as LegislatureFacts[];

  it("refuse un arbitrage sans résolution", () => {
    const facts = base();
    delete facts[0]!.contradictions[0]!.resolution;
    expect(validateLegislatureFacts(facts, AN_SOURCES).join()).toContain("sans résolution");
  });

  it("refuse une date observée affichable ou un début de mandat public", () => {
    const facts = base();
    const ms = facts[2]!.dates.find((d) => d.kind === "mandate-start")!;
    delete ms.display;
    expect(validateLegislatureFacts(facts, AN_SOURCES).join()).toContain("affichable au public");
  });

  it("refuse une échéance théorique sans condition", () => {
    const facts = base();
    delete facts[2]!.dates.find((d) => d.kind === "powers-expiry")!.conditional;
    expect(validateLegislatureFacts(facts, AN_SOURCES).join()).toContain("sans condition");
  });

  it("refuse une dissolution sans entrée en vigueur", () => {
    const facts = base();
    facts[1]!.dates = facts[1]!.dates.filter((d) => d.kind !== "dissolution-entry-into-force");
    expect(validateLegislatureFacts(facts, AN_SOURCES).join()).toContain("sans entrée en vigueur");
  });
});

describe("validateLegislatureCoverage : navigation et valeurs attendues", () => {
  const base = () => clone(AN_LEGISLATURE_COVERAGE) as LegislatureCoverage[];

  it("refuse une valeur attendue sans source officielle", () => {
    const cov = base();
    cov[1]!.datasets[0]!.measured.expected = 4105;
    expect(validateLegislatureCoverage(cov, numbers).join()).toContain("sans source officielle");
  });

  it("accepte une valeur attendue avec source", () => {
    const cov = base();
    cov[1]!.datasets[0]!.measured.expected = 4105;
    cov[1]!.datasets[0]!.measured.expectedSourceId = "an-archives-16";
    expect(validateLegislatureCoverage(cov, numbers)).toEqual([]);
  });

  it("refuse une législature retirée de la navigation ou un jeu absent sans mention", () => {
    const a = base();
    a[0]!.navigation.listed = false;
    expect(validateLegislatureCoverage(a, numbers).join()).toContain("absente de la navigation");
    const b = base();
    delete b[0]!.navigation.absenceNotice;
    expect(validateLegislatureCoverage(b, numbers).join()).toContain("absence d'import");
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
    ds.measured = { count: 100, expected: 100, expectedSourceId: "an-archives-16" };
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
