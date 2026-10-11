import AdmZip from "adm-zip";
import { parseInseeIntercoFile, type InseeIntercoFile } from "../intercommunalites-parse";

// ─── A real (tiny) XLSX, built the way INSEE ships it: shared strings, one sheet per tab ───

function columnRef(i: number): string {
  let out = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/'/g, "&apos;");

export function buildXlsx(sheets: Record<string, string[][]>): Buffer {
  const shared: string[] = [];
  const index = (s: string) => {
    const i = shared.indexOf(s);
    if (i >= 0) return i;
    shared.push(s);
    return shared.length - 1;
  };
  const zip = new AdmZip();
  const names = Object.keys(sheets);
  names.forEach((name, n) => {
    const rows = sheets[name]!.map(
      (row, r) =>
        `<row r="${r + 1}">${row
          .map((v, c) =>
            v === "" ? "" : `<c r="${columnRef(c)}${r + 1}" s="1" t="s"><v>${index(v)}</v></c>`
          )
          .join("")}</row>`
    ).join("");
    zip.addFile(
      `xl/worksheets/sheet${n + 1}.xml`,
      Buffer.from(`<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`)
    );
  });
  zip.addFile(
    "xl/workbook.xml",
    Buffer.from(
      `<workbook><sheets>${names
        .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("")}</sheets></workbook>`
    )
  );
  zip.addFile(
    "xl/_rels/workbook.xml.rels",
    Buffer.from(
      `<Relationships>${names
        .map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join("")}</Relationships>`
    )
  );
  zip.addFile(
    "xl/sharedStrings.xml",
    Buffer.from(
      `<sst>${shared.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`
    )
  );
  return zip.toBuffer();
}

export const HEAD = (title: string) => [
  [title],
  ["France - Liste"],
  ["Mise en ligne le 19/03/2026       Géographie au 01/01/2026"],
  ["Source(s) : Insee, Code officiel géographique"],
];

export function epciXlsx(list: string[][], composition: string[][]): Buffer {
  return buildXlsx({
    EPCI: [
      ...HEAD("Intercommunalité et Métropole"),
      ["EPCI - Métropole", "Libellé", "Nature d'EPCI", "Nombre communes"],
      ["EPCI", "LIBEPCI", "NATURE_EPCI", "NB_COM"],
      ...list,
    ],
    Composition_communale: [
      ...HEAD("Intercommunalité et Métropole"),
      ["Code géographique", "Libellé", "EPCI - Métropole", "Libellé EPCI", "Département", "Région"],
      ["CODGEO", "LIBGEO", "EPCI", "LIBEPCI", "DEP", "REG"],
      ...composition,
    ],
  });
}

export function eptXlsx(list: string[][], composition: string[][]): Buffer {
  return buildXlsx({
    EPT: [
      ...HEAD("Établissements publics territoriaux"),
      ["EPT", "Libellé de l'EPT", "Nombre de communes"],
      ["EPT", "LIBEPT", "NB_COM"],
      ...list,
    ],
    Composition_communale: [
      ...HEAD("Établissements publics territoriaux"),
      ["Code géographique", "Libellé", "EPT", "Libellé de l'EPT", "Département", "Région"],
      ["CODGEO", "LIBGEO", "EPT", "LIBEPT", "DEP", "REG"],
      ...composition,
    ],
  });
}

export const MGP = "200054781";
export const LYON = "200046977";
export const RENNES_METRO = "243500139";
export const PLAINE_COMMUNE = "200057867";

export const EPCI_LIST = [
  [RENNES_METRO, "Rennes Métropole", "METRO", "1"],
  [LYON, "Métropole de Lyon", "METRO", "1"],
  [MGP, "Métropole du Grand Paris", "METRO", "2"],
  ["ZZZZZZZZZ", "Sans objet", "ZZ", "1"],
];
export const EPCI_COMPOSITION = [
  ["35238", "Rennes", RENNES_METRO, "Rennes Métropole", "35", "53"],
  ["69123", "Lyon", LYON, "Métropole de Lyon", "69", "84"],
  ["75056", "Paris", MGP, "Métropole du Grand Paris", "75", "11"],
  ["93066", "Saint-Denis", MGP, "Métropole du Grand Paris", "93", "11"],
  ["29155", "Ouessant", "ZZZZZZZZZ", "Sans objet", "29", "53"],
];
export const EPT_LIST = [
  [PLAINE_COMMUNE, "Plaine Commune", "1"],
  ["ZZZZZZZZZ", "Sans objet", "4"],
];
export const EPT_COMPOSITION = [
  ["35238", "Rennes", "ZZZZZZZZZ", "Sans objet", "35", "53"],
  ["69123", "Lyon", "ZZZZZZZZZ", "Sans objet", "69", "84"],
  ["75056", "Paris", "ZZZZZZZZZ", "Sans objet", "75", "11"],
  ["93066", "Saint-Denis", PLAINE_COMMUNE, "Plaine Commune", "93", "11"],
  ["29155", "Ouessant", "ZZZZZZZZZ", "Sans objet", "29", "53"],
];

export function files(
  epci = { list: EPCI_LIST, composition: EPCI_COMPOSITION },
  ept = { list: EPT_LIST, composition: EPT_COMPOSITION }
): { epci: InseeIntercoFile; ept: InseeIntercoFile } {
  return {
    epci: parseInseeIntercoFile(epciXlsx(epci.list, epci.composition), "epci"),
    ept: parseInseeIntercoFile(eptXlsx(ept.list, ept.composition), "ept"),
  };
}
