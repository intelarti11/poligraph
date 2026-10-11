import AdmZip from "adm-zip";
import type { IntercommunaliteNature } from "@/generated/prisma";
import {
  METROPOLE_DE_LYON_SIREN,
  METROPOLE_DU_GRAND_PARIS_SIREN,
} from "@/config/intercommunalites";

/**
 * Pure parsing and planning for the INSEE intercommunality files (#1052, lot 1.8). No network,
 * no database: `intercommunalites.ts` downloads, reconciles and writes.
 */

// ─── Minimal XLSX reader ────────────────────────────────────────
// The two INSEE workbooks hold plain strings only. A dependency-free reader of shared strings and
// inline strings is enough, and fails loudly on anything it does not recognise.

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (match, body: string) => {
    if (body.startsWith("#x")) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? match;
  });
}

/** Concatenated `<t>` runs of a fragment (rich text splits a string into several runs). */
function textRuns(fragment: string): string {
  let out = "";
  for (const m of fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1];
  return decodeXml(out);
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0];
  if (!letters) throw new Error(`Référence de cellule illisible : ${ref}`);
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function entryText(zip: AdmZip, name: string): string | null {
  const entry = zip.getEntry(name);
  return entry ? entry.getData().toString("utf8") : null;
}

/** Rows of the named sheet, as strings; empty cells are "". */
export function readXlsxSheet(xlsx: Buffer, sheetName: string): string[][] {
  const zip = new AdmZip(xlsx);
  const workbook = entryText(zip, "xl/workbook.xml");
  const rels = entryText(zip, "xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new Error("Classeur XLSX invalide : workbook.xml absent");

  const sheet = [...workbook.matchAll(/<sheet\s[^>]*>/g)]
    .map((m) => m[0])
    .find((tag) => decodeXml(/\sname="([^"]*)"/.exec(tag)?.[1] ?? "") === sheetName);
  const rid = sheet && /\sr:id="([^"]*)"/.exec(sheet)?.[1];
  if (!rid) throw new Error(`Feuille « ${sheetName} » absente du classeur`);
  const relTag = [...rels.matchAll(/<Relationship\s[^>]*>/g)]
    .map((m) => m[0])
    .find((tag) => tag.includes(`Id="${rid}"`));
  const target = relTag && /\sTarget="([^"]*)"/.exec(relTag)?.[1];
  if (!target) throw new Error(`Relation ${rid} introuvable`);
  const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;

  const shared: string[] = [];
  const sst = entryText(zip, "xl/sharedStrings.xml");
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textRuns(m[1]!));

  const xml = entryText(zip, path);
  if (!xml) throw new Error(`Feuille ${path} absente de l'archive`);

  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cell of rowMatch[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1]!;
      const body = cell[2] ?? "";
      const ref = /\sr="([A-Z]+[0-9]+)"/.exec(attrs)?.[1];
      if (!ref) continue;
      const type = /\st="([^"]*)"/.exec(attrs)?.[1];
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "inlineStr") value = textRuns(body);
      else if (raw === undefined) value = "";
      else if (type === "s") {
        const s = shared[Number.parseInt(raw, 10)];
        if (s === undefined) throw new Error(`Chaîne partagée ${raw} introuvable`);
        value = s;
      } else value = decodeXml(raw);
      const index = columnIndex(ref);
      while (row.length < index) row.push("");
      row[index] = value;
    }
    rows.push(row);
  }
  return rows;
}

/** The single `.xlsx` of an INSEE download archive. */
export function extractXlsx(zipBuffer: Buffer): Buffer {
  const entries = new AdmZip(zipBuffer).getEntries().filter((e) => e.entryName.endsWith(".xlsx"));
  if (entries.length !== 1) {
    throw new Error(`Archive INSEE : ${entries.length} classeur(s) au lieu d'un`);
  }
  return entries[0]!.getData();
}

// ─── INSEE files ────────────────────────────────────────────────

export type IntercoFileKind = "epci" | "ept";

/** Code INSEE uses for "no body" ("Sans objet"). */
export const SANS_OBJET = "ZZZZZZZZZ";

export interface InseeBody {
  siren: string;
  name: string;
  /** Nature as written in the file (CC, CA, CU, METRO; EPT for the EPT file). */
  rawNature: string;
  declaredCommunes: number | null;
}

export interface InseeCompositionRow {
  communeCode: string;
  communeName: string;
  /** Null when the file says "Sans objet". */
  siren: string | null;
  departmentCode: string;
}

export interface InseeIntercoFile {
  kind: IntercoFileKind;
  /** "Géographie au JJ/MM/AAAA", as a UTC date. */
  situationDate: Date;
  bodies: InseeBody[];
  composition: InseeCompositionRow[];
}

const SHEETS: Record<IntercoFileKind, { list: string; code: string }> = {
  epci: { list: "EPCI", code: "EPCI" },
  ept: { list: "EPT", code: "EPT" },
};

/** "Mise en ligne le 19/03/2026       Géographie au 01/01/2026" -> 2026-01-01. */
export function parseSituationDate(rows: string[][]): Date {
  for (const row of rows.slice(0, 6)) {
    const m = /Géographie au (\d{2})\/(\d{2})\/(\d{4})/.exec(row.join(" "));
    if (m) return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  }
  throw new Error("Date de situation (« Géographie au ») introuvable dans l'en-tête");
}

/** Data rows after the line of variable codes (the line above it holds their French labels). */
function dataRows(rows: string[][], expected: string[]): string[][] {
  const header = rows.findIndex(
    (r) => r.slice(0, expected.length).join("|") === expected.join("|")
  );
  if (header < 0) throw new Error(`Ligne de variables introuvable : ${expected.join(", ")}`);
  return rows.slice(header + 1).filter((r) => (r[0] ?? "").trim() !== "");
}

export function parseInseeIntercoFile(xlsx: Buffer, kind: IntercoFileKind): InseeIntercoFile {
  const { list, code } = SHEETS[kind];
  const listRows = readXlsxSheet(xlsx, list);
  const compositionRows = readXlsxSheet(xlsx, "Composition_communale");
  const situationDate = parseSituationDate(listRows);
  const compositionDate = parseSituationDate(compositionRows);
  if (compositionDate.getTime() !== situationDate.getTime()) {
    throw new Error("Les deux feuilles du fichier n'ont pas la même date de situation");
  }

  const listColumns =
    kind === "epci" ? ["EPCI", "LIBEPCI", "NATURE_EPCI", "NB_COM"] : ["EPT", "LIBEPT", "NB_COM"];
  const bodies: InseeBody[] = dataRows(listRows, listColumns)
    .filter((r) => r[0] !== SANS_OBJET)
    .map((r) => {
      const declared = Number.parseInt(r[listColumns.indexOf("NB_COM")] ?? "", 10);
      return {
        siren: r[0]!.trim(),
        name: (r[1] ?? "").trim(),
        rawNature: kind === "epci" ? (r[2] ?? "").trim() : "EPT",
        declaredCommunes: Number.isFinite(declared) ? declared : null,
      };
    });

  const composition = dataRows(compositionRows, [
    "CODGEO",
    "LIBGEO",
    code,
    `LIB${code}`,
    "DEP",
    "REG",
  ]).map((r) => ({
    communeCode: r[0]!.trim(),
    communeName: (r[1] ?? "").trim(),
    siren: r[2]?.trim() && r[2].trim() !== SANS_OBJET ? r[2].trim() : null,
    departmentCode: (r[4] ?? "").trim(),
  }));

  return { kind, situationDate, bodies, composition };
}

// ─── Observation: what the two files establish together ─────────

const EPCI_NATURES: Record<string, IntercommunaliteNature> = {
  CC: "CC",
  CA: "CA",
  CU: "CU",
  METRO: "METRO",
};

export interface ObservedBody {
  siren: string;
  name: string;
  nature: IntercommunaliteNature;
  kind: IntercoFileKind;
}

export interface ObservedMembership {
  communeCode: string;
  /** Null: the EPCI file lists the commune with no EPCI à fiscalité propre. */
  siren: string | null;
  kind: IntercoFileKind;
  departmentCode: string;
}

export interface Observation {
  situationDate: Date;
  bodies: ObservedBody[];
  memberships: ObservedMembership[];
  anomalies: string[];
}

/**
 * Bodies and memberships established by the EPCI and EPT files of the same situation date.
 * Anything the files contradict is reported as an anomaly and left out, never guessed.
 */
export function buildObservation(epci: InseeIntercoFile, ept: InseeIntercoFile): Observation {
  if (epci.situationDate.getTime() !== ept.situationDate.getTime()) {
    throw new Error("Les fichiers EPCI et EPT n'ont pas la même date de situation");
  }
  const anomalies: string[] = [];
  const bodies = new Map<string, ObservedBody>();

  for (const b of epci.bodies) {
    const nature =
      b.siren === METROPOLE_DE_LYON_SIREN ? "MET69" : (EPCI_NATURES[b.rawNature] ?? null);
    if (!nature) {
      anomalies.push(`EPCI ${b.siren} (${b.name}) : nature inconnue « ${b.rawNature} », ignoré`);
      continue;
    }
    bodies.set(b.siren, { siren: b.siren, name: b.name, nature, kind: "epci" });
  }
  for (const b of ept.bodies) {
    if (bodies.has(b.siren)) {
      anomalies.push(`EPT ${b.siren} (${b.name}) : SIREN déjà présent parmi les EPCI, ignoré`);
      continue;
    }
    bodies.set(b.siren, { siren: b.siren, name: b.name, nature: "EPT", kind: "ept" });
  }

  const memberships: ObservedMembership[] = [];
  const epciByCommune = new Map<string, string | null>();
  const conflicted = new Set<string>();
  for (const row of epci.composition) {
    if (!epciByCommune.has(row.communeCode)) {
      epciByCommune.set(row.communeCode, row.siren);
      continue;
    }
    const previous = epciByCommune.get(row.communeCode) ?? null;
    if (previous !== row.siren && !conflicted.has(row.communeCode)) {
      conflicted.add(row.communeCode);
      anomalies.push(
        `Commune ${row.communeCode} (${row.communeName}) dans deux EPCI à fiscalité propre : ${previous ?? "sans objet"} et ${row.siren ?? "sans objet"}, aucune retenue`
      );
    }
  }
  const epciRows = new Map(epci.composition.map((r) => [r.communeCode, r]));
  for (const [communeCode, siren] of epciByCommune) {
    if (conflicted.has(communeCode)) continue;
    const row = epciRows.get(communeCode)!;
    if (siren && !bodies.has(siren)) {
      anomalies.push(`Commune ${communeCode} : EPCI ${siren} absent de la liste, ignorée`);
      continue;
    }
    memberships.push({ communeCode, siren, kind: "epci", departmentCode: row.departmentCode });
  }

  const seenEpt = new Set<string>();
  for (const row of ept.composition) {
    if (!row.siren) continue;
    if (seenEpt.has(row.communeCode)) {
      anomalies.push(`Commune ${row.communeCode} listée deux fois dans le fichier EPT, ignorée`);
      continue;
    }
    seenEpt.add(row.communeCode);
    if (bodies.get(row.siren)?.nature !== "EPT") {
      anomalies.push(`Commune ${row.communeCode} : EPT ${row.siren} absent de la liste, ignorée`);
      continue;
    }
    // An EPT is a subdivision of the Métropole du Grand Paris: a commune in an EPT outside it
    // would contradict the law the file describes.
    if (epciByCommune.get(row.communeCode) !== METROPOLE_DU_GRAND_PARIS_SIREN) {
      anomalies.push(
        `Commune ${row.communeCode} (${row.communeName}) dans l'EPT ${row.siren} sans être membre de la Métropole du Grand Paris`
      );
    }
    memberships.push({
      communeCode: row.communeCode,
      siren: row.siren,
      kind: "ept",
      departmentCode: row.departmentCode,
    });
  }

  for (const file of [epci, ept]) {
    const counted = new Map<string, number>();
    for (const r of file.composition) {
      if (r.siren) counted.set(r.siren, (counted.get(r.siren) ?? 0) + 1);
    }
    for (const b of file.bodies) {
      if (b.declaredCommunes != null && b.declaredCommunes !== (counted.get(b.siren) ?? 0)) {
        anomalies.push(
          `${b.siren} (${b.name}) : ${b.declaredCommunes} communes annoncées, ${counted.get(b.siren) ?? 0} listées`
        );
      }
    }
  }

  return {
    situationDate: epci.situationDate,
    bodies: [...bodies.values()],
    memberships,
    anomalies,
  };
}

// ─── Plan against the base ──────────────────────────────────────

export interface OpenMembership {
  id: string;
  communeId: string;
  siren: string | null;
}

export interface MembershipPlan {
  toCreate: ObservedMembership[];
  /** Open rows the new file no longer lists: closed at its situation date, never deleted. */
  toClose: OpenMembership[];
  /** Open rows the new file still lists: their situation date moves forward. */
  toConfirm: OpenMembership[];
}

const key = (communeId: string, siren: string | null) => `${communeId}|${siren ?? "-"}`;

export function planMemberships(
  open: OpenMembership[],
  observed: ObservedMembership[]
): MembershipPlan {
  const openByKey = new Map(open.map((o) => [key(o.communeId, o.siren), o]));
  const observedKeys = new Set(observed.map((m) => key(m.communeCode, m.siren)));
  return {
    toCreate: observed.filter((m) => !openByKey.has(key(m.communeCode, m.siren))),
    toClose: open.filter((o) => !observedKeys.has(key(o.communeId, o.siren))),
    toConfirm: open.filter((o) => observedKeys.has(key(o.communeId, o.siren))),
  };
}
