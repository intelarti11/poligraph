import { parse } from "csv-parse/sync";
import { isHttpUrl } from "@/lib/security/schemas/decision-territoriale";

/**
 * Parsing of the open-data files that follow, more or less closely, the national schema
 * `scdl/deliberations` (#1052, lot 2). Pure: no network, no database, nothing is written.
 *
 * Files seen on data.gouv.fr differ on delimiter, encoding, date format, column spelling and
 * the share of optional fields filled. Whatever cannot be read with certainty is rejected with
 * a reason, never guessed: a notice is a public statement about an elected body.
 */

export type RejectReason =
  | "DATE_ILLISIBLE"
  | "OBJET_VIDE"
  | "IDENTIFIANT_VIDE"
  | "AUTORITE_VIDE"
  | "TITRE_TROP_LONG";

export interface ScdlCandidate {
  /** 1-based line in the file, header included. */
  line: number;
  authorityName: string;
  /** Null when absent or unreadable (a spreadsheet turns 14 digits into "2,22E+13"). */
  siret: string | null;
  reference: string;
  adoptionDate: string;
  title: string;
  /** True when the object column held several lines and only the first one was kept. */
  titleFromFirstLine: boolean;
  matiereCode: string | null;
  matiereName: string | null;
  /** `TYPE_ACTE` of the mixed files (délibération, arrêté, décision...); null in a pure SCDL file. */
  actType: string | null;
  votes: {
    pour: number | null;
    contre: number | null;
    abstention: number | null;
    effectif: number | null;
    reel: number | null;
  };
  /** Derived from the counts only; null when they are missing or tied. */
  outcomeHint: "ADOPTEE" | "REJETEE" | null;
  prefectureDate: string | null;
  documentUrl: string | null;
}

export interface ScdlParseResult {
  /** True when every required column of the national schema was found. */
  conformingHeaders: boolean;
  missingColumns: string[];
  delimiter: string;
  encoding: "utf-8" | "windows-1252";
  linesRead: number;
  candidates: ScdlCandidate[];
  rejects: Array<{ line: number; reason: RejectReason }>;
  duplicates: number;
}

const REQUIRED = ["COLL_NOM", "DELIB_ID", "DELIB_DATE", "DELIB_OBJET"] as const;

/** Header spellings met in the wild, after upper-casing and removing accents and separators. */
const ALIASES: Record<string, string> = {
  COLLNOM: "COLL_NOM",
  COLLECTIVITE: "COLL_NOM",
  NOMCOLLECTIVITE: "COLL_NOM",
  COLLSIRET: "COLL_SIRET",
  SIRET: "COLL_SIRET",
  DELIBID: "DELIB_ID",
  IDENTIFIANT: "DELIB_ID",
  NUMERO: "DELIB_ID",
  DELIBDATE: "DELIB_DATE",
  DATE: "DELIB_DATE",
  DATESEANCE: "DELIB_DATE",
  DELIBOBJET: "DELIB_OBJET",
  OBJET: "DELIB_OBJET",
  DELIBMATIERECODE: "DELIB_MATIERE_CODE",
  DELIBMATIERENOM: "DELIB_MATIERE_NOM",
  PREFDATE: "PREF_DATE",
  VOTEEFFECTIF: "VOTE_EFFECTIF",
  VOTEREEL: "VOTE_REEL",
  VOTEPOUR: "VOTE_POUR",
  VOTECONTRE: "VOTE_CONTRE",
  VOTEABSTENTION: "VOTE_ABSTENTION",
  DELIBURL: "DELIB_URL",
  TYPEACTE: "TYPE_ACTE",
};

function headerKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function decode(buffer: Buffer): { text: string; encoding: "utf-8" | "windows-1252" } {
  const utf8 = buffer.toString("utf8");
  // U+FFFD appears when a Latin-1 file is read as UTF-8: read it as Windows-1252 instead.
  if (!utf8.includes("�")) return { text: utf8.replace(/^﻿/, ""), encoding: "utf-8" };
  return { text: new TextDecoder("windows-1252").decode(buffer), encoding: "windows-1252" };
}

function detectDelimiter(firstLine: string): string {
  const counts: Array<[string, number]> = [";", ",", "\t"].map((d) => [
    d,
    firstLine.split(d).length,
  ]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![0];
}

/** "2026-03-05", "2026-03-05T00:00:00", "05/03/2026", "05-03-2026": nothing else. */
export function parseDay(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  const fr = value.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  const y = iso ? iso[1] : fr ? fr[3] : undefined;
  const m = iso ? iso[2] : fr ? fr[2] : undefined;
  const d = iso ? iso[3] : fr ? fr[1] : undefined;
  if (!y || !m || !d) return null;
  const date = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== `${y}-${m}-${d}`) {
    return null;
  }
  if (Number(y) < 1950 || Number(y) > 2100) return null;
  return `${y}-${m}-${d}`;
}

function parseCount(raw: string | undefined): number | null {
  const value = raw?.trim();
  if (!value || !/^\d{1,6}$/.test(value)) return null;
  return Number(value);
}

/** Exactly 14 digits. A value in scientific notation lost its low digits and is not repaired. */
export function parseSiret(raw: string | undefined): string | null {
  const value = raw?.replace(/\s/g, "");
  return value && /^\d{14}$/.test(value) ? value : null;
}

/**
 * Some files put the whole text of the deliberation in the object column. The title is then its
 * first non-empty line, whitespace collapsed; the rest is never kept. A single-line object is
 * only whitespace-collapsed.
 */
export function deriveTitle(raw: string | undefined): { title: string; fromFirstLine: boolean } {
  const lines = (raw ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return { title: lines[0] ?? "", fromFirstLine: lines.length > 1 };
}

const MAX_TITLE = 500;
const MAX_REFERENCE = 120;

export function parseScdlFile(buffer: Buffer): ScdlParseResult {
  const { text, encoding } = decode(buffer);
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);

  // Header names come from the parser callback so a file without data rows keeps its columns.
  let headerNames: string[] = [];
  const rows = parse(text, {
    delimiter,
    columns: (header: string[]) => {
      headerNames = header.map((h) => ALIASES[headerKey(h)] ?? h.trim());
      return headerNames;
    },
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    bom: true,
  }) as Array<Record<string, string>>;

  const present = new Set(headerNames);
  const missingColumns = REQUIRED.filter((c) => !present.has(c));

  const candidates: ScdlCandidate[] = [];
  const rejects: ScdlParseResult["rejects"] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  rows.forEach((row, index) => {
    const line = index + 2;
    const authorityName = row.COLL_NOM?.trim() ?? "";
    const reference = row.DELIB_ID?.trim() ?? "";
    const { title, fromFirstLine } = deriveTitle(row.DELIB_OBJET);
    const adoptionDate = parseDay(row.DELIB_DATE);

    if (!authorityName) return void rejects.push({ line, reason: "AUTORITE_VIDE" });
    if (!reference || reference.length > MAX_REFERENCE) {
      return void rejects.push({ line, reason: "IDENTIFIANT_VIDE" });
    }
    if (!adoptionDate) return void rejects.push({ line, reason: "DATE_ILLISIBLE" });
    if (!title) return void rejects.push({ line, reason: "OBJET_VIDE" });
    if (title.length > MAX_TITLE) return void rejects.push({ line, reason: "TITRE_TROP_LONG" });

    const key = `${authorityName}|${reference}`;
    if (seen.has(key)) {
      duplicates++;
      return;
    }
    seen.add(key);

    const pour = parseCount(row.VOTE_POUR);
    const contre = parseCount(row.VOTE_CONTRE);
    const url = row.DELIB_URL?.trim() ?? "";

    candidates.push({
      line,
      authorityName,
      siret: parseSiret(row.COLL_SIRET),
      reference,
      adoptionDate,
      title,
      titleFromFirstLine: fromFirstLine,
      matiereCode: row.DELIB_MATIERE_CODE?.trim() || null,
      matiereName: row.DELIB_MATIERE_NOM?.trim() || null,
      actType: row.TYPE_ACTE?.trim() || null,
      votes: {
        pour,
        contre,
        abstention: parseCount(row.VOTE_ABSTENTION),
        effectif: parseCount(row.VOTE_EFFECTIF),
        reel: parseCount(row.VOTE_REEL),
      },
      outcomeHint:
        pour != null && contre != null && pour !== contre
          ? pour > contre
            ? "ADOPTEE"
            : "REJETEE"
          : null,
      prefectureDate: parseDay(row.PREF_DATE),
      documentUrl: url && isHttpUrl(url) ? url : null,
    });
  });

  return {
    conformingHeaders: missingColumns.length === 0,
    missingColumns,
    delimiter,
    encoding,
    linesRead: rows.length,
    candidates,
    rejects,
    duplicates,
  };
}
