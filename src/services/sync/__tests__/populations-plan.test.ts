import { describe, expect, it } from "vitest";
import {
  INSEE_POPULATIONS_2022,
  INSEE_POPULATIONS_2023,
  OVERSEAS_POPULATION_SERIES,
} from "@/config/populations-reference";
import {
  dropChangedTerritories,
  overseasRecords,
  parseInseeNationalFile,
  pickInForce,
  planPopulationImport,
  territoryChangedCodes,
  type CommuneSnapshot,
  type PopulationRecord,
} from "../populations-plan";

const COMMUNES_CSV = [
  "REG;Région;DEP;CODARR;CODCAN;CODCOM;COM;Commune;PMUN;PCAP;PTOT",
  "53;Bretagne;35;3;;238;35238;Rennes;230890;4060;234950",
  "11;Île-de-France;75;1;;101;75101;Paris 1er Arrondissement;15114;93;15207",
  "11;Île-de-France;75;1;;102;75102;Paris 2e Arrondissement;20000;7;20007",
  "04;La Réunion;974;1;;411;97411;Saint-Denis;155634;1508;157142",
].join("\r\n");

const COLLECTIVITES_CSV = [
  "COL;Collectivité;CODCOM;COM;Commune;PMUN;PCAP;PTOT",
  "975;Saint-Pierre-et-Miquelon;502;97502;Saint-Pierre;5194;151;5345",
].join("\r\n");

function record(over: Partial<PopulationRecord> = {}): PopulationRecord {
  return {
    communeId: "35238",
    departmentCode: "35",
    millesime: 2023,
    populationMunicipale: 230890,
    populationCompteeAPart: 4060,
    populationTotale: 234950,
    effectiveFrom: "2026-01-01",
    producer: "INSEE",
    sourceLabel: "INSEE 2023",
    sourceUrl: "https://www.insee.fr/fr/statistiques/8680726",
    ...over,
  };
}

function commune(over: Partial<CommuneSnapshot> = {}): CommuneSnapshot {
  return { id: "35238", departmentCode: "35", population: 230890, maireEtabli: true, ...over };
}

describe("parseInseeNationalFile", () => {
  it("lit les communes et les collectivités, et somme les arrondissements de Paris", () => {
    const parsed = parseInseeNationalFile(INSEE_POPULATIONS_2023, COMMUNES_CSV, COLLECTIVITES_CSV);

    expect(parsed.linesRead).toBe(5);
    expect(parsed.arrondissementsAggregated).toBe(2);
    const byCode = new Map(parsed.records.map((r) => [r.communeId, r]));
    expect([...byCode.keys()].sort()).toEqual(["35238", "75056", "97411", "97502"]);
    expect(byCode.get("75056")).toMatchObject({
      populationMunicipale: 35114,
      populationCompteeAPart: 100,
      populationTotale: 35214,
      departmentCode: "75",
    });
    expect(byCode.get("97502")).toMatchObject({
      departmentCode: "975",
      populationMunicipale: 5194,
    });
    expect(byCode.get("35238")).toMatchObject({
      millesime: 2023,
      effectiveFrom: "2026-01-01",
      producer: "INSEE",
      sourceUrl: INSEE_POPULATIONS_2023.url,
    });
  });

  it("refuse un fichier dont une ligne est illisible", () => {
    const broken = COMMUNES_CSV.replace("230890", "n.d.");
    expect(() => parseInseeNationalFile(INSEE_POPULATIONS_2022, broken, COLLECTIVITES_CSV)).toThrow(
      /illisible/
    );
  });
});

describe("territoryChangedCodes", () => {
  const MVT = [
    '"MOD","DATE_EFF","TYPECOM_AV","COM_AV","TNCC_AV","NCC_AV","NCCENR_AV","LIBELLE_AV","TYPECOM_AP","COM_AP","TNCC_AP","NCC_AP","NCCENR_AP","LIBELLE_AP"',
    '"32","2025-01-01","COM","01187","0","A","A","A","COM","01187","0","A","A","A"',
    '"32","2025-01-01","COM","01330","0","R","R","R","COM","01187","0","A","A","A"',
    '"32","2024-01-01","COM","02000","0","X","X","X","COM","02001","0","Y","Y","Y"',
    '"21","2025-01-01","COMD","15031","0","C","C","C","COM","15031","0","C","C","C"',
    '"21","2025-01-01","COM","15141","0","N","N","N","COM","15031","0","C","C","C"',
  ].join("\n");

  it("retient les deux côtés d'un événement entre codes différents, dans la fenêtre seulement", () => {
    const changed = territoryChangedCodes(MVT, "2024-01-01", "2025-01-01");
    expect([...changed].sort()).toEqual(["01187", "01330", "15031", "15141"]);
  });

  it("écarte la ligne 2022 d'une commune dont le territoire a changé", () => {
    const { kept, dropped } = dropChangedTerritories(
      [record({ communeId: "01187" }), record({ communeId: "35238" })],
      new Set(["01187"])
    );
    expect(kept.map((r) => r.communeId)).toEqual(["35238"]);
    expect(dropped.map((r) => r.communeId)).toEqual(["01187"]);
  });
});

describe("pickInForce", () => {
  it("prend le dernier millésime entré en vigueur, jamais un millésime futur", () => {
    const r22 = record({ millesime: 2022, effectiveFrom: "2025-01-01" });
    const r23 = record({ millesime: 2023, effectiveFrom: "2026-01-01" });
    const r24 = record({ millesime: 2024, effectiveFrom: "2027-01-01" });
    expect(pickInForce([r22, r24, r23], "2026-10-11")?.millesime).toBe(2023);
    expect(pickInForce([r22, r23], "2025-06-30")?.millesime).toBe(2022);
    expect(pickInForce([r24], "2026-10-11")).toBeUndefined();
  });
});

describe("planPopulationImport", () => {
  it("rapproche par code exact et signale les codes sans commune et les communes sans série", () => {
    const plan = planPopulationImport(
      [record(), record({ communeId: "01330", departmentCode: "01" })],
      [commune(), commune({ id: "98901", departmentCode: "989", population: null })],
      "2026-10-11"
    );
    expect(plan.matchedRecords.map((r) => r.communeId)).toEqual(["35238"]);
    expect(plan.byDepartment.find((d) => d.departmentCode === "01")?.unmatchedCodes).toEqual([
      "01330",
    ]);
    expect(
      plan.byDepartment.find((d) => d.departmentCode === "989")?.communesWithoutSeries
    ).toEqual(["98901"]);
    expect(plan.differing).toEqual([]);
  });

  it("mesure les écarts, les seuils franchis et les changements d'indexation", () => {
    const plan = planPopulationImport(
      [
        record({ communeId: "A", populationMunicipale: 1005 }),
        record({ communeId: "B", populationMunicipale: 995 }),
        record({ communeId: "C", populationMunicipale: 20100 }),
        record({ communeId: "D", populationMunicipale: 500 }),
        record({ communeId: "E", populationMunicipale: 1200 }),
      ],
      [
        commune({ id: "A", population: 990 }),
        commune({ id: "B", population: 1010 }),
        commune({ id: "C", population: 19900 }),
        commune({ id: "D", population: 500 }),
        commune({ id: "E", population: 990, maireEtabli: false }),
      ],
      "2026-10-11"
    );
    expect(plan.differing.map((d) => d.communeId)).toEqual(["A", "B", "C", "E"]);
    expect(plan.crossesIndexFloor.map((d) => d.communeId)).toEqual(["A", "B", "E"]);
    expect(plan.crossesDeputeThreshold.map((d) => d.communeId)).toEqual(["C"]);
    // E crosses the floor but has no established mayor: its indexing does not change.
    expect(plan.indexationGained).toEqual(["A"]);
    expect(plan.indexationLost).toEqual(["B"]);
  });

  it("compte une population jusque-là inconnue comme un écart", () => {
    const plan = planPopulationImport(
      [record({ populationMunicipale: 1500 })],
      [commune({ population: null })],
      "2026-10-11"
    );
    expect(plan.differing).toEqual([{ communeId: "35238", before: null, after: 1500 }]);
    expect(plan.indexationGained).toEqual(["35238"]);
  });
});

describe("séries ultramarines transcrites des décrets", () => {
  it("retrouve le total de l'article 1er de chaque décret", () => {
    for (const series of OVERSEAS_POPULATION_SERIES) {
      const total = series.rows.reduce((n, [, , pmun]) => n + pmun, 0);
      expect(total, series.source.key).toBe(series.decreeTotalMunicipale);
    }
  });

  it("vérifie population totale = municipale + comptée à part, et les codes du territoire", () => {
    for (const series of OVERSEAS_POPULATION_SERIES) {
      for (const [code, name, pmun, pcap, ptot] of series.rows) {
        expect(ptot, `${code} ${name}`).toBe(pmun + pcap);
        expect(code.startsWith(series.departmentCode), code).toBe(true);
      }
    }
  });

  it("couvre toutes les communes de Mayotte, de Polynésie, de Nouvelle-Calédonie et de Wallis-et-Futuna", () => {
    const counts = Object.fromEntries(
      OVERSEAS_POPULATION_SERIES.map((s) => [s.departmentCode, s.rows.length])
    );
    expect(counts).toEqual({ "976": 17, "987": 48, "988": 33, "986": 3 });
    expect(new Set(overseasRecords().map((r) => r.communeId)).size).toBe(101);
  });
});
