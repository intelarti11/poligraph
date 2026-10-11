/**
 * Presidential results by commune (ministère de l'Intérieur, data.gouv.fr).
 *
 * Reads the "résultats définitifs par commune" file of one round (semicolon-separated, one line
 * per commune, one repeated group of columns per candidate) and replaces, for that election and
 * round, every CommuneElectionRound (participation) and CommuneCandidacyResult (votes) row.
 *
 * Matching is exact or nothing:
 * - candidates by normalised "first name + last name" against the election's candidacies; a
 *   single unmatched candidate aborts the write;
 * - communes by the INSEE code rebuilt from the department and commune codes. Overseas codes of
 *   the ministry (ZA, ZB...) are converted; the French abroad (ZZ) are not a commune and are
 *   counted apart; a line whose code is not in the Commune table is reported, never guessed.
 *
 * Idempotent: delete then insert for one (election, round), inside one transaction.
 */

import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma";
import { USER_AGENT } from "@/config/site";
import { presidentielleCommunesSyncKey } from "@/config/presidentielle-communes";

// ─── INSEE code ─────────────────────────────────────────────────

/** French established abroad: a constituency of its own, not a commune. */
export const ABROAD_DEPARTMENT_CODE = "ZZ";

/**
 * Ministry overseas codes whose commune code holds the last three digits of the INSEE code
 * (ZA 101 = 97101 Les Abymes, ZX 701 = 97701 Saint-Barthélemy, ZP 735 = 98735 Papeete).
 * Checked on the 2022 files. ZW (Wallis-et-Futuna) is absent on purpose: it is published as
 * one aggregate for three INSEE circonscriptions.
 */
const OVERSEAS_PREFIX: Record<string, string> = {
  ZA: "97", // Guadeloupe
  ZB: "97", // Martinique
  ZC: "97", // Guyane
  ZD: "97", // La Réunion
  ZM: "97", // Mayotte
  ZS: "97", // Saint-Pierre-et-Miquelon
  ZX: "97", // Saint-Martin, Saint-Barthélemy
  ZN: "98", // Nouvelle-Calédonie
  ZP: "98", // Polynésie française
};

export type CommuneKey =
  | { kind: "commune"; inseeCode: string }
  | { kind: "abroad" }
  | { kind: "unmapped"; reason: string };

export function toInseeCode(departmentCode: string, communeCode: string): CommuneKey {
  const dept = departmentCode.trim().toUpperCase();
  const commune = communeCode.trim().toUpperCase();
  if (dept === ABROAD_DEPARTMENT_CODE) return { kind: "abroad" };

  const prefix = OVERSEAS_PREFIX[dept];
  if (prefix) {
    return /^[0-9]{3}$/.test(commune)
      ? { kind: "commune", inseeCode: `${prefix}${commune}` }
      : { kind: "unmapped", reason: `code commune ${commune} inattendu pour ${dept}` };
  }
  // Overseas departments written with their INSEE code (971...), should a later file do so.
  if (/^9[78][0-9]$/.test(dept)) {
    if (/^[0-9]{3}$/.test(commune) && commune[0] === dept[2]) {
      return { kind: "commune", inseeCode: `${dept.slice(0, 2)}${commune}` };
    }
    if (/^[0-9]{2}$/.test(commune)) return { kind: "commune", inseeCode: `${dept}${commune}` };
    return { kind: "unmapped", reason: `code commune ${commune} inattendu pour ${dept}` };
  }
  if (/^([0-9]{1,2}|2[AB])$/.test(dept) && /^[0-9]{1,3}$/.test(commune)) {
    return { kind: "commune", inseeCode: `${dept.padStart(2, "0")}${commune.padStart(3, "0")}` };
  }
  return { kind: "unmapped", reason: `code ${dept} non reconnu` };
}

// ─── Parsing ────────────────────────────────────────────────────

export interface CandidateVotes {
  firstName: string;
  lastName: string;
  votes: number;
}

export interface CommuneLine {
  line: number;
  departmentCode: string;
  departmentLabel: string;
  communeCode: string;
  communeLabel: string;
  registeredVoters: number;
  actualVoters: number;
  blankVotes: number;
  nullVotes: number;
  validVotes: number;
  candidates: CandidateVotes[];
}

/** The 2022 files are ISO-8859-1; later ones may be UTF-8. Never guess beyond those two. */
export function decodeResultsFile(buffer: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("latin1").decode(buffer);
  }
}

function headerKey(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9%/]+/g, " ")
    .trim();
}

const REQUIRED_COLUMNS = {
  departmentCode: "code du departement",
  departmentLabel: "libelle du departement",
  communeCode: "code de la commune",
  communeLabel: "libelle de la commune",
  registeredVoters: "inscrits",
  actualVoters: "votants",
  blankVotes: "blancs",
  nullVotes: "nuls",
  validVotes: "exprimes",
} as const;

function toInt(value: string | undefined, line: number, column: string): number {
  const cleaned = (value ?? "").replace(/\s/g, "");
  if (!/^[0-9]+$/.test(cleaned)) {
    throw new Error(`Ligne ${line} : valeur entière attendue pour « ${column} », lu « ${value} »`);
  }
  return Number(cleaned);
}

/**
 * Parses the semicolon-separated file. Columns are located by their header label, and the
 * candidate group by its first column ("N°Panneau") up to the end of the header.
 */
export function parseResultsFile(text: string): CommuneLine[] {
  const lines = text.split(/\r?\n/);
  const header = (lines[0] ?? "").split(";").map(headerKey);

  const index = {} as Record<keyof typeof REQUIRED_COLUMNS, number>;
  for (const [field, label] of Object.entries(REQUIRED_COLUMNS)) {
    const i = header.indexOf(label);
    if (i < 0) throw new Error(`Colonne « ${label} » absente de l'en-tête`);
    index[field as keyof typeof REQUIRED_COLUMNS] = i;
  }
  const groupStart = header.findIndex((h) => h.includes("panneau"));
  if (groupStart < 0) throw new Error("Colonne « N°Panneau » absente de l'en-tête");
  const group = header.slice(groupStart);
  const offset = { lastName: group.indexOf("nom"), firstName: group.indexOf("prenom") };
  const votesOffset = group.indexOf("voix");
  if (offset.lastName < 0 || offset.firstName < 0 || votesOffset < 0) {
    throw new Error("Groupe candidat incomplet : colonnes Nom, Prénom et Voix attendues");
  }

  const rows: CommuneLine[] = [];
  for (let n = 1; n < lines.length; n++) {
    const raw = lines[n]!;
    if (raw.trim() === "") continue;
    const cols = raw.split(";");
    const lineNo = n + 1;
    const candidates: CandidateVotes[] = [];
    for (let start = groupStart; start + group.length <= cols.length; start += group.length) {
      const lastName = (cols[start + offset.lastName] ?? "").trim();
      if (lastName === "") continue;
      candidates.push({
        lastName,
        firstName: (cols[start + offset.firstName] ?? "").trim(),
        votes: toInt(cols[start + votesOffset], lineNo, "Voix"),
      });
    }
    rows.push({
      line: lineNo,
      departmentCode: (cols[index.departmentCode] ?? "").trim(),
      departmentLabel: (cols[index.departmentLabel] ?? "").trim(),
      communeCode: (cols[index.communeCode] ?? "").trim(),
      communeLabel: (cols[index.communeLabel] ?? "").trim(),
      registeredVoters: toInt(cols[index.registeredVoters], lineNo, "Inscrits"),
      actualVoters: toInt(cols[index.actualVoters], lineNo, "Votants"),
      blankVotes: toInt(cols[index.blankVotes], lineNo, "Blancs"),
      nullVotes: toInt(cols[index.nullVotes], lineNo, "Nuls"),
      validVotes: toInt(cols[index.validVotes], lineNo, "Exprimés"),
      candidates,
    });
  }
  return rows;
}

/** "Jean-Luc Mélenchon", "MÉLENCHON" + "Jean-Luc" → "JEAN LUC MELENCHON". */
export function normalizeCandidateName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]+/g, " ")
    .trim();
}

// ─── Plan ───────────────────────────────────────────────────────

export interface TerritoryReport {
  label: string;
  linesRead: number;
  matched: number;
  /** "code (libellé) : raison", bounded for display by the caller. */
  unmatched: string[];
}

export interface CandidateTotals {
  name: string;
  candidacyId: string | null;
  fileVotes: number;
  matchedVotes: number;
  abroadVotes: number;
  unmatchedVotes: number;
}

export interface ImportPlan {
  communeRounds: Array<{
    communeId: string;
    registeredVoters: number;
    actualVoters: number;
    participationRate: number;
    blankVotes: number;
    nullVotes: number;
    validVotes: number;
  }>;
  results: Array<{ communeId: string; candidacyId: string; votes: number }>;
  linesRead: number;
  abroadLines: number;
  duplicates: string[];
  territories: Map<string, TerritoryReport>;
  candidates: CandidateTotals[];
  unmatchedCandidates: string[];
}

/** Percentage with two decimals, as the ministry publishes it. */
export function participationRate(actualVoters: number, registeredVoters: number): number {
  if (registeredVoters === 0) return 0;
  return Math.round((actualVoters / registeredVoters) * 10_000) / 100;
}

export function buildImportPlan(
  rows: CommuneLine[],
  communeIds: ReadonlySet<string>,
  candidacies: ReadonlyArray<{ id: string; candidateName: string }>
): ImportPlan {
  const byName = new Map(candidacies.map((c) => [normalizeCandidateName(c.candidateName), c.id]));
  const totals = new Map<string, CandidateTotals>();
  const territories = new Map<string, TerritoryReport>();
  const seen = new Set<string>();
  const plan: ImportPlan = {
    communeRounds: [],
    results: [],
    linesRead: rows.length,
    abroadLines: 0,
    duplicates: [],
    territories,
    candidates: [],
    unmatchedCandidates: [],
  };

  for (const row of rows) {
    const key = toInseeCode(row.departmentCode, row.communeCode);
    const territory = territories.get(row.departmentCode) ?? {
      label: row.departmentLabel,
      linesRead: 0,
      matched: 0,
      unmatched: [],
    };
    territories.set(row.departmentCode, territory);
    territory.linesRead++;

    let communeId: string | null = null;
    if (key.kind === "abroad") {
      plan.abroadLines++;
    } else if (key.kind === "unmapped") {
      territory.unmatched.push(`${row.communeCode} (${row.communeLabel}) : ${key.reason}`);
    } else if (!communeIds.has(key.inseeCode)) {
      territory.unmatched.push(
        `${key.inseeCode} (${row.communeLabel}) : absent du référentiel des communes`
      );
    } else if (seen.has(key.inseeCode)) {
      plan.duplicates.push(`${key.inseeCode} (${row.communeLabel}), ligne ${row.line}`);
    } else {
      seen.add(key.inseeCode);
      communeId = key.inseeCode;
      territory.matched++;
      plan.communeRounds.push({
        communeId,
        registeredVoters: row.registeredVoters,
        actualVoters: row.actualVoters,
        participationRate: participationRate(row.actualVoters, row.registeredVoters),
        blankVotes: row.blankVotes,
        nullVotes: row.nullVotes,
        validVotes: row.validVotes,
      });
    }

    for (const c of row.candidates) {
      const name = normalizeCandidateName(`${c.firstName} ${c.lastName}`);
      const candidacyId = byName.get(name) ?? null;
      const total = totals.get(name) ?? {
        name: `${c.firstName} ${c.lastName}`,
        candidacyId,
        fileVotes: 0,
        matchedVotes: 0,
        abroadVotes: 0,
        unmatchedVotes: 0,
      };
      totals.set(name, total);
      total.fileVotes += c.votes;
      if (key.kind === "abroad") total.abroadVotes += c.votes;
      else if (communeId) total.matchedVotes += c.votes;
      else total.unmatchedVotes += c.votes;
      if (communeId && candidacyId) {
        plan.results.push({ communeId, candidacyId, votes: c.votes });
      }
    }
  }

  plan.candidates = [...totals.values()].sort((a, b) => b.fileVotes - a.fileVotes);
  plan.unmatchedCandidates = plan.candidates.filter((c) => !c.candidacyId).map((c) => c.name);
  return plan;
}

// ─── IO ─────────────────────────────────────────────────────────

const ALLOWED_HOSTS = new Set(["static.data.gouv.fr", "www.data.gouv.fr"]);

/** Downloads from data.gouv.fr only: the URL comes from config or the command line. */
export async function downloadResultsFile(url: string): Promise<Uint8Array> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`URL refusée (data.gouv.fr en HTTPS uniquement) : ${url}`);
  }
  const response = await fetch(parsed, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`HTTP ${response.status} pour ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

const CHUNK = 5_000;

/**
 * Replaces the election round in one transaction. Rows of the other round and of other
 * elections are untouched.
 */
export async function writeImportPlan(input: {
  electionId: string;
  electionSlug: string;
  round: 1 | 2;
  plan: ImportPlan;
  fileUrl: string;
}): Promise<{ communeRounds: number; results: number }> {
  const { electionId, electionSlug, round, plan, fileUrl } = input;
  const syncKey = presidentielleCommunesSyncKey(electionSlug);
  const started = Date.now();

  await db.$transaction(
    async (tx) => {
      await tx.communeCandidacyResult.deleteMany({ where: { round, candidacy: { electionId } } });
      await tx.communeElectionRound.deleteMany({ where: { electionId, round } });

      for (let i = 0; i < plan.communeRounds.length; i += CHUNK) {
        await tx.communeElectionRound.createMany({
          data: plan.communeRounds.slice(i, i + CHUNK).map((r) => ({
            ...r,
            electionId,
            round,
            participationRate: new Prisma.Decimal(r.participationRate),
          })),
        });
      }
      for (let i = 0; i < plan.results.length; i += CHUNK) {
        await tx.communeCandidacyResult.createMany({
          data: plan.results.slice(i, i + CHUNK).map((r) => ({ ...r, round })),
        });
      }

      const previous = await tx.syncMetadata.findUnique({
        where: { sourceKey: syncKey },
        select: { extra: true },
      });
      const extra = (previous?.extra ?? {}) as Record<string, unknown>;
      const rounds = (extra["rounds"] ?? {}) as Record<string, unknown>;
      rounds[String(round)] = {
        fileUrl,
        importedAt: new Date().toISOString(),
        communes: plan.communeRounds.length,
        results: plan.results.length,
      };
      await tx.syncMetadata.upsert({
        where: { sourceKey: syncKey },
        create: {
          sourceKey: syncKey,
          lastSyncAt: new Date(),
          itemCount: plan.results.length,
          lastDurationS: (Date.now() - started) / 1000,
          extra: { rounds } as Prisma.InputJsonValue,
        },
        update: {
          lastSyncAt: new Date(),
          itemCount: plan.results.length,
          lastDurationS: (Date.now() - started) / 1000,
          extra: { ...extra, rounds } as Prisma.InputJsonValue,
        },
      });
    },
    { timeout: 15 * 60_000, maxWait: 30_000 }
  );

  return { communeRounds: plan.communeRounds.length, results: plan.results.length };
}
