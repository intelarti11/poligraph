import { describe, expect, it } from "vitest";
import { dmsToDecimal, ficheDepartmentOf, parseFiche } from "@/lib/territoires/climat-fiche";

const months = "Janv.;     Févr.;      Mars;     Avril;       Mai;      Juin;";
const header = (line: string) =>
  [
    "FICHE CLIMATOLOGIQUE;",
    ";",
    "Statistiques  1991-2020  et  records;",
    line,
    "Edité le : 15/10/2026 dans l'état de la base;",
    "",
    `            ;     ${months}     Année;`,
    "",
  ].join("\r\n");

const CESSY = header(
  `CESSY (01)      Indicatif : 01071001, alt : 507m, lat : 46°18'37"N, lon : 6°04'49"E;`
);

const body = (temp: string, precip: string) =>
  [
    "Température moyenne (Moyenne en °C);",
    ...temp.split("|"),
    "",
    "Précipitations : Hauteur moyenne mensuelle (mm);",
    ...precip.split("|"),
  ].join("\r\n");

const row = (annual: string) =>
  `            ;       1.8;       2.5;       6.4;      10.8;      14.3;      18.7;      20.5;      19.9;      16.1;      11.5;       6.3;       2.4;     ${annual};`;

describe("lecture d'une fiche climatologique", () => {
  it("lit l'en-tête : nom, département, indicatif, altitude, coordonnées", () => {
    const s = parseFiche(CESSY + body(row("9.8"), row("1100")));
    expect(s).toMatchObject({
      id: "01071001",
      name: "CESSY",
      departmentCode: "01",
      altitudeM: 507,
    });
    expect(s?.lat).toBeCloseTo(46.3103, 3);
    expect(s?.lon).toBeCloseTo(6.0803, 3);
  });

  it("prend la période du titre quand le bloc n'en annonce pas", () => {
    const s = parseFiche(CESSY + body(row("9.8"), row("1100")));
    expect(s?.tempMoyenne).toEqual({ value: 9.8, startYear: 1991, endYear: 2020 });
    expect(s?.precipitations).toEqual({ value: 1100, startYear: 1991, endYear: 2020 });
  });

  it("garde la période annoncée par le bloc, plus courte que celle du titre (station de 2002)", () => {
    const stated = "Statistiques établies sur la période 2002-2020;";
    const s = parseFiche(CESSY + body(`${stated}|${row("9.8")}`, `${stated}|${row("1100")}`));
    expect(s?.tempMoyenne).toEqual({ value: 9.8, startYear: 2002, endYear: 2020 });
    expect(s?.precipitations).toEqual({ value: 1100, startYear: 2002, endYear: 2020 });
  });

  it("lit la période de chaque grandeur séparément", () => {
    const s = parseFiche(
      CESSY + body(row("9.8"), `Statistiques établies sur la période 2007-2020;|${row("1100")}`)
    );
    expect(s?.tempMoyenne?.startYear).toBe(1991);
    expect(s?.precipitations?.startYear).toBe(2007);
  });

  it("ne fait jamais un zéro d'une valeur absente ou non disponible", () => {
    const dot = parseFiche(CESSY + body(row("."), "Données non disponibles;"));
    expect(dot?.tempMoyenne).toBeNull();
    expect(dot?.precipitations).toBeNull();
    const missing = parseFiche(CESSY + "Température moyenne (Moyenne en °C);");
    expect(missing?.tempMoyenne).toBeNull();
  });

  it("garde une température négative", () => {
    const s = parseFiche(CESSY + body(row("-1.4"), row("1100")));
    expect(s?.tempMoyenne?.value).toBe(-1.4);
  });

  it("rend null quand l'en-tête est illisible", () => {
    expect(parseFiche("FICHE CLIMATOLOGIQUE;\r\nn'importe quoi")).toBeNull();
  });

  it("lit un département d'outre-mer et ses coordonnées ouest", () => {
    const s = parseFiche(
      header(
        `LE RAIZET AERO (971)      Indicatif : 97101015, alt : 11m, lat : 16°15'50"N, lon : 61°30'58"O;`
      ) + body(row("26.7"), row("1557.8"))
    );
    expect(s).toMatchObject({ departmentCode: "971", name: "LE RAIZET AERO" });
    expect(s?.lon).toBeLessThan(0);
  });
});

describe("degrés, minutes, secondes", () => {
  it("convertit, avec le sud et l'ouest négatifs", () => {
    expect(dmsToDecimal(46, 30, 0, "N")).toBe(46.5);
    expect(dmsToDecimal(21, 0, 36, "S")).toBeCloseTo(-21.01, 5);
    expect(dmsToDecimal(61, 30, 58, "O")).toBeCloseTo(-61.5161, 3);
    expect(dmsToDecimal(6, 4, 49, "E")).toBeGreaterThan(0);
  });
});

describe("département d'une commune face à une fiche", () => {
  it("rassemble 2A et 2B sous le 20 des fiches, et ne touche aucun autre code", () => {
    expect(ficheDepartmentOf("2A")).toBe("20");
    expect(ficheDepartmentOf("2B")).toBe("20");
    expect(ficheDepartmentOf("35")).toBe("35");
    expect(ficheDepartmentOf("971")).toBe("971");
  });
});
