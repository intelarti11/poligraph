// @vitest-environment node
import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import {
  buildObservation,
  extractXlsx,
  parseInseeIntercoFile,
  parseSituationDate,
  planMemberships,
  readXlsxSheet,
} from "../intercommunalites-parse";
import {
  EPCI_COMPOSITION,
  EPCI_LIST,
  EPT_COMPOSITION,
  EPT_LIST,
  HEAD,
  LYON,
  MGP,
  PLAINE_COMMUNE,
  RENNES_METRO,
  buildXlsx,
  files,
} from "./intercommunalites-fixtures";

describe("lecture XLSX", () => {
  it("lit chaînes partagées, entités et cellules vides à leur colonne", () => {
    const xlsx = buildXlsx({ Feuille: [["a", "", "L'Île-d'Yeu & co"]] });
    expect(readXlsxSheet(xlsx, "Feuille")).toEqual([["a", "", "L'Île-d'Yeu & co"]]);
    expect(() => readXlsxSheet(xlsx, "Absente")).toThrow(/absente/);
  });

  it("extrait l'unique classeur de l'archive INSEE", () => {
    const xlsx = buildXlsx({ F: [["x"]] });
    const zip = new AdmZip();
    zip.addFile("EPCI_au_01-01-2026.xlsx", xlsx);
    expect(extractXlsx(zip.toBuffer()).equals(xlsx)).toBe(true);
    expect(() => extractXlsx(new AdmZip().toBuffer())).toThrow(/0 classeur/);
  });

  it("refuse un fichier sans date de situation", () => {
    expect(parseSituationDate([["Mise en ligne le 19/03/2026"]].concat(HEAD("x")))).toEqual(
      new Date(Date.UTC(2026, 0, 1))
    );
    expect(() => parseSituationDate([["Mise en ligne le 19/03/2026"]])).toThrow(/situation/);
  });

  it("refuse des colonnes inattendues plutôt que de lire de travers", () => {
    const xlsx = buildXlsx({
      EPCI: [...HEAD("x"), ["EPCI", "LIBEPCI", "NATURE", "NB_COM"]],
      Composition_communale: [...HEAD("x")],
    });
    expect(() => parseInseeIntercoFile(xlsx, "epci")).toThrow(/Ligne de variables/);
  });
});

describe("buildObservation", () => {
  it("lit la situation, les natures et laisse « Sans objet » hors des établissements", () => {
    const { epci, ept } = files();
    const obs = buildObservation(epci, ept);
    expect(obs.situationDate.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(obs.bodies.map((b) => [b.siren, b.nature])).toEqual([
      [RENNES_METRO, "METRO"],
      [LYON, "MET69"],
      [MGP, "METRO"],
      [PLAINE_COMMUNE, "EPT"],
    ]);
    expect(obs.anomalies).toEqual([]);
  });

  it("présente la Métropole de Lyon comme collectivité, pas comme métropole intercommunale", () => {
    const { epci, ept } = files();
    const lyon = buildObservation(epci, ept).bodies.find((b) => b.siren === LYON);
    expect(lyon?.nature).toBe("MET69");
  });

  it("rattache une commune de petite couronne à la MGP et à son EPT, Paris à la seule MGP", () => {
    const { epci, ept } = files();
    const obs = buildObservation(epci, ept);
    const of = (code: string) =>
      obs.memberships.filter((m) => m.communeCode === code).map((m) => [m.kind, m.siren]);
    expect(of("93066")).toEqual([
      ["epci", MGP],
      ["ept", PLAINE_COMMUNE],
    ]);
    expect(of("75056")).toEqual([["epci", MGP]]);
  });

  it("garde l'absence établie par la source pour une île mono-communale", () => {
    const { epci, ept } = files();
    const ouessant = buildObservation(epci, ept).memberships.filter(
      (m) => m.communeCode === "29155"
    );
    expect(ouessant).toEqual([
      { communeCode: "29155", siren: null, kind: "epci", departmentCode: "29" },
    ]);
  });

  it("signale une commune dans deux EPCI à fiscalité propre et n'en retient aucun", () => {
    const { epci, ept } = files({
      list: [...EPCI_LIST, ["200000172", "CC Faucigny-Glières", "CC", "1"]],
      composition: [
        ...EPCI_COMPOSITION,
        ["35238", "Rennes", "200000172", "CC Faucigny-Glières", "35", "53"],
      ],
    });
    const obs = buildObservation(epci, ept);
    expect(obs.memberships.some((m) => m.communeCode === "35238")).toBe(false);
    expect(obs.anomalies.some((a) => a.includes("35238") && a.includes("deux EPCI"))).toBe(true);
  });

  it("signale un EPT hors de la Métropole du Grand Paris", () => {
    const { epci, ept } = files(undefined, {
      list: EPT_LIST,
      composition: [
        ...EPT_COMPOSITION.filter((r) => r[0] !== "35238"),
        ["35238", "Rennes", PLAINE_COMMUNE, "Plaine Commune", "35", "53"],
      ],
    });
    const obs = buildObservation(epci, ept);
    expect(obs.anomalies.some((a) => a.includes("35238") && a.includes("Grand Paris"))).toBe(true);
  });

  it("écarte une nature inconnue et un nombre de communes incohérent", () => {
    const { epci, ept } = files({
      list: [
        [RENNES_METRO, "Rennes Métropole", "METRO", "3"],
        ["999999999", "Syndicat", "SIVU", "0"],
        ...EPCI_LIST.slice(1),
      ],
      composition: EPCI_COMPOSITION,
    });
    const obs = buildObservation(epci, ept);
    expect(obs.bodies.some((b) => b.siren === "999999999")).toBe(false);
    expect(obs.anomalies).toEqual(
      expect.arrayContaining([
        expect.stringContaining("nature inconnue « SIVU »"),
        expect.stringContaining("3 communes annoncées, 1 listées"),
      ])
    );
  });
});

describe("planMemberships", () => {
  const observed = [
    { communeCode: "35238", siren: RENNES_METRO, kind: "epci" as const, departmentCode: "35" },
    { communeCode: "29155", siren: null, kind: "epci" as const, departmentCode: "29" },
  ];

  it("ouvre tout au premier import", () => {
    const plan = planMemberships([], observed);
    expect(plan.toCreate).toEqual(observed);
    expect(plan.toClose).toEqual([]);
  });

  it("ne change rien quand le même fichier repasse (idempotent)", () => {
    const open = [
      { id: "a", communeId: "35238", siren: RENNES_METRO },
      { id: "b", communeId: "29155", siren: null },
    ];
    const plan = planMemberships(open, observed);
    expect(plan.toCreate).toEqual([]);
    expect(plan.toClose).toEqual([]);
    expect(plan.toConfirm.map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("ferme l'ancienne appartenance et ouvre la nouvelle quand une commune change d'EPCI", () => {
    const open = [
      { id: "a", communeId: "35238", siren: "200000172" },
      { id: "b", communeId: "29155", siren: null },
    ];
    const plan = planMemberships(open, observed);
    expect(plan.toClose.map((o) => o.id)).toEqual(["a"]);
    expect(plan.toCreate.map((m) => m.siren)).toEqual([RENNES_METRO]);
  });
});
