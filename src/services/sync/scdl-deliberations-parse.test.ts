import { describe, expect, it } from "vitest";
import { deriveTitle, parseDay, parseScdlFile, parseSiret } from "./scdl-deliberations-parse";

const HEADER =
  "COLL_NOM;COLL_SIRET;DELIB_ID;DELIB_DATE;DELIB_MATIERE_CODE;DELIB_MATIERE_NOM;DELIB_OBJET;VOTE_POUR;VOTE_CONTRE;VOTE_ABSTENTION;DELIB_URL";
const file = (...lines: string[]) => Buffer.from([HEADER, ...lines].join("\n"), "utf8");

describe("parseDay", () => {
  it("lit l'ISO et le format français, refuse le reste", () => {
    expect(parseDay("2026-03-05")).toBe("2026-03-05");
    expect(parseDay("05/03/2026")).toBe("2026-03-05");
    expect(parseDay("27/01/2026")).toBe("2026-01-27");
    expect(parseDay("2026-03-05T00:00:00")).toBe("2026-03-05");
    expect(parseDay("31/02/2026")).toBeNull();
    expect(parseDay("mars 2026")).toBeNull();
    expect(parseDay("03/05/26")).toBeNull();
    expect(parseDay("")).toBeNull();
  });
});

describe("deriveTitle", () => {
  it("prend la première ligne quand l'objet contient tout le texte de la délibération", () => {
    expect(
      deriveTitle("AFFAIRE N° 06 : \tAFFECTATION DE RÉSULTAT\n\nEn l'absence de Monsieur...")
    ).toEqual({
      title: "AFFAIRE N° 06 : AFFECTATION DE RÉSULTAT",
      fromFirstLine: true,
    });
  });

  it("ne marque pas une ligne unique", () => {
    expect(deriveTitle("  Budget   primitif 2026 ")).toEqual({
      title: "Budget primitif 2026",
      fromFirstLine: false,
    });
    expect(deriveTitle(undefined)).toEqual({ title: "", fromFirstLine: false });
  });
});

describe("parseSiret", () => {
  it("n'accepte que 14 chiffres et ne répare pas une notation scientifique", () => {
    expect(parseSiret("21974008100019")).toBe("21974008100019");
    expect(parseSiret("219 740 081 00019")).toBe("21974008100019");
    expect(parseSiret("2,22E+13")).toBeNull();
    expect(parseSiret(undefined)).toBeNull();
  });
});

describe("parseScdlFile", () => {
  it("lit une ligne complète et en tire une issue indicative des seuls décomptes", () => {
    const r = parseScdlFile(
      file(
        "Ville de La Possession;21974008100019;D-01;2026-07-18;7.1;Finances;Budget supplémentaire 2026;35;2;1;https://exemple.fr/d1.pdf"
      )
    );
    expect(r.conformingHeaders).toBe(true);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({
      authorityName: "Ville de La Possession",
      siret: "21974008100019",
      reference: "D-01",
      adoptionDate: "2026-07-18",
      title: "Budget supplémentaire 2026",
      matiereCode: "7.1",
      outcomeHint: "ADOPTEE",
      documentUrl: "https://exemple.fr/d1.pdf",
    });
    expect(r.candidates[0]!.votes).toMatchObject({ pour: 35, contre: 2, abstention: 1 });
  });

  it("ne déduit aucune issue quand les votes manquent ou sont à égalité", () => {
    const r = parseScdlFile(
      file("Ville X;;A;2026-01-01;;;Objet A;;;;", "Ville X;;B;2026-01-01;;;Objet B;10;10;0;")
    );
    expect(r.candidates.map((c) => c.outcomeHint)).toEqual([null, null]);
  });

  it("refuse une URL qui n'est pas http(s) et un SIRET abîmé", () => {
    const r = parseScdlFile(
      file("Département du Cher;2,22E+13;C1;27/01/2026;;;Rapport;38;0;0;javascript:alert(1)")
    );
    expect(r.candidates[0]).toMatchObject({
      siret: null,
      documentUrl: null,
      adoptionDate: "2026-01-27",
    });
  });

  it("détecte la virgule, l'encodage Windows-1252 et les en-têtes non conformes", () => {
    const text = "Collectivité,Identifiant,Date,Objet\nVille Y,1,2026-02-02,Délibération été";
    const r = parseScdlFile(Buffer.from(text, "latin1"));
    expect(r.encoding).toBe("windows-1252");
    expect(r.delimiter).toBe(",");
    expect(r.conformingHeaders).toBe(true);
    expect(r.candidates[0]!.title).toBe("Délibération été");
  });

  it("signale les colonnes obligatoires absentes", () => {
    const r = parseScdlFile(Buffer.from("Foo;Bar\n1;2", "utf8"));
    expect(r.conformingHeaders).toBe(false);
    expect(r.missingColumns).toEqual(["COLL_NOM", "DELIB_ID", "DELIB_DATE", "DELIB_OBJET"]);
  });

  it("rejette avec une raison, compte les doublons, ne tronque jamais un titre", () => {
    const long = "x".repeat(501);
    const r = parseScdlFile(
      file(
        "V;;1;31/02/2026;;;Objet;;;;",
        "V;;2;2026-01-01;;;;;;;",
        ";;3;2026-01-01;;;Objet;;;;",
        `V;;4;2026-01-01;;;${long};;;;`,
        "V;;5;2026-01-01;;;Bon;;;;",
        "V;;5;2026-01-01;;;Bon;;;;"
      )
    );
    expect(r.rejects.map((x) => x.reason)).toEqual([
      "DATE_ILLISIBLE",
      "OBJET_VIDE",
      "AUTORITE_VIDE",
      "TITRE_TROP_LONG",
    ]);
    expect(r.candidates).toHaveLength(1);
    expect(r.duplicates).toBe(1);
  });

  it("garde les colonnes d'un fichier sans ligne de données", () => {
    const r = parseScdlFile(file());
    expect(r.missingColumns).toEqual([]);
    expect(r.conformingHeaders).toBe(true);
    expect(r.candidates).toHaveLength(0);
  });
});
