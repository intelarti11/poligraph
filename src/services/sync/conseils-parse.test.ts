import { describe, expect, it } from "vitest";
import { parseConseilRows } from "./conseils-parse";

const cd = (over: Record<string, string> = {}) => ({
  "Code du département": "01",
  "Libellé du département": "Ain",
  "Code du canton": "0101",
  "Libellé du canton": "Ambérieu-En-Bugey",
  "Nom de l'élu": "BRUNET",
  "Prénom de l'élu": "Joël",
  "Code sexe": "M",
  "Date de naissance": "1955-05-02",
  "Date de début du mandat": "2021-07-01",
  "Libellé de la fonction": "",
  "Date de début de la fonction": "",
  ...over,
});

describe("parseConseilRows", () => {
  it("lit un conseiller départemental avec son canton", () => {
    const { rows } = parseConseilRows("DEPARTEMENTAL", [cd()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      niveau: "DEPARTEMENTAL",
      territoryCode: "01",
      subdivisionCode: "0101",
      subdivisionLabel: "Ambérieu-En-Bugey",
      lastName: "Brunet",
      firstName: "Joël",
      functionLabel: null,
    });
  });

  it("ne garde ni la date de naissance ni la profession dans la ligne", () => {
    const { rows } = parseConseilRows("DEPARTEMENTAL", [cd()]);
    expect(JSON.stringify(rows[0])).not.toContain("1955");
  });

  it("distingue deux homonymes par la date de naissance", () => {
    const { rows, duplicates } = parseConseilRows("DEPARTEMENTAL", [
      cd(),
      cd({ "Date de naissance": "1980-01-01" }),
    ]);
    expect(rows).toHaveLength(2);
    expect(duplicates).toBe(0);
  });

  it("écarte une ligne listée deux fois", () => {
    const { rows, duplicates } = parseConseilRows("DEPARTEMENTAL", [cd(), cd()]);
    expect(rows).toHaveLength(1);
    expect(duplicates).toBe(1);
  });

  it("garde la fonction la plus récente d'une personne listée deux fois", () => {
    const older = cd({
      "Libellé de la fonction": "4ème Vice-président du conseil départemental",
      "Date de début de la fonction": "2021-07-01",
    });
    const newer = cd({
      "Libellé de la fonction": "2ème Vice-président du conseil départemental",
      "Date de début de la fonction": "2025-02-12",
    });
    for (const input of [
      [older, newer],
      [newer, older],
    ]) {
      const { rows } = parseConseilRows("DEPARTEMENTAL", input);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.functionLabel).toBe("2ème Vice-président du conseil départemental");
    }
  });

  it("compte sans deviner une ligne sans nom ou sans territoire", () => {
    const { rows, skipped } = parseConseilRows("DEPARTEMENTAL", [
      cd({ "Nom de l'élu": "" }),
      cd({ "Code du département": "" }),
    ]);
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(2);
  });

  it("lit la section départementale d'un conseiller régional", () => {
    const { rows } = parseConseilRows("REGIONAL", [
      {
        "Code de la région": "01",
        "Code de la section départementale": "971",
        "Libellé de la section départementale": "Guadeloupe",
        "Nom de l'élu": "ARMOUGOM",
        "Prénom de l'élu": "Betty Véronique",
        "Date de naissance": "1965-07-09",
        "Libellé de la fonction": "Présidente du conseil régional",
      },
    ]);
    expect(rows[0]).toMatchObject({
      territoryCode: "01",
      subdivisionCode: "971",
      functionLabel: "Présidente du conseil régional",
    });
  });
});
