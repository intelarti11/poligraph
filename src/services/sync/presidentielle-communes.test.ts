import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import {
  buildImportPlan,
  decodeResultsFile,
  normalizeCandidateName,
  parseResultsFile,
  participationRate,
  toInseeCode,
} from "./presidentielle-communes";

const HEADER =
  "Code du département;Libellé du département;Code de la commune;Libellé de la commune;Etat saisie;Inscrits;Abstentions;% Abs/Ins;Votants;% Vot/Ins;Blancs;% Blancs/Ins;% Blancs/Vot;Nuls;% Nuls/Ins;% Nuls/Vot;Exprimés;% Exp/Ins;% Exp/Vot;N°Panneau;Sexe;Nom;Prénom;Voix;% Voix/Ins;% Voix/Exp";

function line(dept: string, code: string, label: string, votes: [number, number]): string {
  const valid = votes[0] + votes[1];
  return `${dept};Libellé ${dept};${code};${label};Complet;100;20;20,00;80;80,00;3;3,00;3,75;2;2,00;2,50;${valid};75,00;93,75;1;M;MACRON;Emmanuel;${votes[0]};0;0;2;F;LE PEN;Marine;${votes[1]};0;0`;
}

describe("toInseeCode", () => {
  it.each([
    ["01", "001", "01001"],
    ["1", "1", "01001"],
    ["2A", "004", "2A004"],
    ["ZA", "101", "97101"],
    ["ZB", "201", "97201"],
    ["ZC", "302", "97302"],
    ["ZD", "411", "97411"],
    ["ZM", "611", "97611"],
    ["ZS", "502", "97502"],
    ["ZX", "701", "97701"],
    ["ZX", "801", "97801"],
    ["ZN", "801", "98801"],
    ["ZP", "735", "98735"],
    ["971", "101", "97101"],
  ])("%s %s → %s", (dept, commune, expected) => {
    expect(toInseeCode(dept, commune)).toEqual({ kind: "commune", inseeCode: expected });
  });

  it("exclut les Français de l'étranger", () => {
    expect(toInseeCode("ZZ", "001")).toEqual({ kind: "abroad" });
  });

  it("ne devine pas Wallis-et-Futuna, publié en un seul agrégat", () => {
    expect(toInseeCode("ZW", "001").kind).toBe("unmapped");
  });

  it("refuse un code inconnu", () => {
    expect(toInseeCode("ZQ", "001").kind).toBe("unmapped");
    expect(toInseeCode("ZA", "1A").kind).toBe("unmapped");
  });
});

describe("parseResultsFile", () => {
  it("lit les colonnes par leur en-tête et chaque groupe candidat", () => {
    const rows = parseResultsFile(`${HEADER}\r\n${line("35", "238", "Rennes", [60, 15])}\r\n`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      departmentCode: "35",
      communeCode: "238",
      registeredVoters: 100,
      actualVoters: 80,
      blankVotes: 3,
      nullVotes: 2,
      validVotes: 75,
    });
    expect(rows[0]!.candidates).toEqual([
      { firstName: "Emmanuel", lastName: "MACRON", votes: 60 },
      { firstName: "Marine", lastName: "LE PEN", votes: 15 },
    ]);
  });

  it("décode un fichier ISO-8859-1 comme celui de 2022", () => {
    const latin1 = Uint8Array.from(Buffer.from(`${HEADER}\n`, "latin1"));
    expect(decodeResultsFile(latin1)).toContain("Exprimés");
    const utf8 = new TextEncoder().encode(`${HEADER}\n`);
    expect(decodeResultsFile(utf8)).toContain("Exprimés");
  });

  it("refuse un nombre illisible plutôt que de compter zéro", () => {
    const bad = line("35", "238", "Rennes", [60, 15]).replace(";100;", ";n/a;");
    expect(() => parseResultsFile(`${HEADER}\n${bad}`)).toThrow(/Inscrits/);
  });

  it("refuse un en-tête sans colonne Exprimés", () => {
    expect(() => parseResultsFile(HEADER.replace("Exprimés", "Total"))).toThrow(/exprimes/);
  });
});

describe("normalizeCandidateName", () => {
  it("rapproche le bulletin et la candidature", () => {
    expect(normalizeCandidateName("Jean-Luc MÉLENCHON")).toBe(
      normalizeCandidateName("Jean-Luc Mélenchon")
    );
    expect(normalizeCandidateName("Éric ZEMMOUR")).toBe("ERIC ZEMMOUR");
  });
});

describe("buildImportPlan", () => {
  const candidacies = [
    { id: "c-macron", candidateName: "Emmanuel Macron" },
    { id: "c-lepen", candidateName: "Marine Le Pen" },
  ];

  it("écrit les communes rapprochées et compte à part l'étranger et le reste", () => {
    const rows = parseResultsFile(
      [
        HEADER,
        line("35", "238", "Rennes", [60, 15]),
        line("ZD", "411", "Saint-Denis", [10, 20]),
        line("ZZ", "001", "Europe", [5, 1]),
        line("ZW", "001", "Wallis-Et-Futuna", [2, 2]),
        line("01", "039", "Commune fusionnée", [1, 1]),
      ].join("\n")
    );
    const plan = buildImportPlan(rows, new Set(["35238", "97411"]), candidacies);

    expect(plan.communeRounds.map((r) => r.communeId)).toEqual(["35238", "97411"]);
    expect(plan.results).toHaveLength(4);
    expect(plan.results).toContainEqual({ communeId: "97411", candidacyId: "c-lepen", votes: 20 });
    expect(plan.abroadLines).toBe(1);
    expect(plan.territories.get("ZW")?.unmatched).toHaveLength(1);
    expect(plan.territories.get("01")?.unmatched[0]).toContain("absent du référentiel");

    const macron = plan.candidates.find((c) => c.candidacyId === "c-macron")!;
    expect(macron).toMatchObject({
      fileVotes: 78,
      matchedVotes: 70,
      abroadVotes: 5,
      unmatchedVotes: 3,
    });
    expect(plan.unmatchedCandidates).toEqual([]);
  });

  it("signale un candidat sans candidature et un doublon de commune", () => {
    const rows = parseResultsFile(
      [HEADER, line("35", "238", "Rennes", [1, 1]), line("35", "238", "Rennes", [1, 1])].join("\n")
    );
    const plan = buildImportPlan(rows, new Set(["35238"]), [candidacies[0]!]);
    expect(plan.unmatchedCandidates).toEqual(["Marine LE PEN"]);
    expect(plan.duplicates).toHaveLength(1);
    expect(plan.results.every((r) => r.candidacyId === "c-macron")).toBe(true);
  });

  it("calcule la participation sur les inscrits", () => {
    expect(participationRate(35_923_707, 48_747_876)).toBe(73.69);
    expect(participationRate(0, 0)).toBe(0);
  });
});
