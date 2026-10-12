import * as cheerio from "cheerio";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma";
import { httpClient } from "@/lib/api/http-client";
import { INTERIEUR_RATE_LIMIT_MS } from "@/config/rate-limits";

// --- Configuration ---

// Ministry results URL structure:
// /municipales2026/ensemble_geographique/{regionCode}/{deptCode}/{inseeCode}/
const BASE_URL =
  "https://www.resultats-elections.interieur.gouv.fr/municipales2026/ensemble_geographique";

// All French department codes
const DEPARTMENT_CODES = [
  ...Array.from({ length: 95 }, (_, i) => String(i + 1).padStart(2, "0")),
  "2A",
  "2B", // Corsica
  "971",
  "972",
  "973",
  "974",
  "976", // DOM
].filter((d) => d !== "20"); // Replace 20 with 2A/2B

interface SyncOptions {
  dryRun?: boolean;
  dept?: string;
}

interface ParsedCommuneResult {
  inseeCode: string;
  communeName: string;
  registeredVoters: number;
  actualVoters: number;
  blankVotes: number;
  nullVotes: number;
  validVotes: number;
  participationRate: number;
  lists: ParsedListResult[];
}

interface ParsedListResult {
  listName: string;
  leaderName: string;
  nuance: string;
  round1Votes: number;
  round1Pct: number;
  round1Qualified: boolean;
  isElected: boolean;
}

// --- Parsing ---

/** Parse a French formatted number: "12 345" → 12345, "28,97" → 28.97 */
function parseFrenchNumber(raw: string): number {
  return parseFloat(raw.replace(/\s/g, "").replace(",", ".")) || 0;
}

/**
 * Parse a commune results page HTML from the ministry site.
 * Structure: "Mentions 1er tour" table for participation,
 * "Résultats au 1er tour" table for list results.
 */
export function parseCommuneResultsHtml(
  html: string,
  inseeCode: string
): ParsedCommuneResult | null {
  const $ = cheerio.load(html);

  // Check if results are available
  if (html.includes("résultats non parvenus")) return null;

  // --- Parse participation table (caption contains "Mentions 1er tour") ---
  const mentionsTable = $('table caption:contains("Mentions 1")').closest("table").find("tbody tr");

  if (mentionsTable.length === 0) return null;

  const participationData: Record<string, number> = {};
  mentionsTable.each((_, row) => {
    const cells = $(row).find("td");
    const label = cells.eq(0).text().trim();
    const value = parseFrenchNumber(cells.eq(1).text().trim());
    participationData[label] = value;
  });

  const registeredVoters = participationData["Inscrits"] || 0;
  const actualVoters = participationData["Votants"] || 0;
  const blankVotes = participationData["Blancs"] || 0;
  const nullVotes = participationData["Nuls"] || 0;
  const validVotes = participationData["Exprimés"] || 0;
  const participationRate = registeredVoters > 0 ? (actualVoters / registeredVoters) * 100 : 0;

  // --- Parse results table (caption contains "Résultats") ---
  const resultsTableEl = $('table caption:contains("Résultats")').closest("table");
  const resultsTable = resultsTableEl.find("tbody tr");

  // Detect column layout: small communes (<1000 hab) omit the "Nuance" column
  // 7 cols: listName, leaderName, nuance, votes, %inscrits, %exprimes, seats
  // 6 cols: listName, leaderName, votes, %inscrits, %exprimes, seats
  const headerCols = resultsTableEl.find("thead th").length;
  const hasNuance = headerCols >= 7;
  const colOffset = hasNuance ? 0 : -1;

  const lists: ParsedListResult[] = [];
  resultsTable.each((_, row) => {
    const cells = $(row).find("td");
    const listName = cells.eq(0).text().trim();
    const leaderName = cells.eq(1).text().trim();
    const nuance = hasNuance ? cells.eq(2).text().trim() : "";
    const round1Votes = parseFrenchNumber(
      cells
        .eq(3 + colOffset)
        .text()
        .trim()
    );
    // Skip % Inscrits, use % Exprimes
    const round1Pct = parseFrenchNumber(
      cells
        .eq(5 + colOffset)
        .text()
        .trim()
    );
    const seatsWon = parseFrenchNumber(
      cells
        .eq(6 + colOffset)
        .text()
        .trim()
    );

    if (!listName) return;

    lists.push({
      listName,
      leaderName,
      nuance,
      round1Votes,
      round1Pct,
      round1Qualified: round1Pct >= 10, // T2 qualification threshold
      // seatsWon > 0 means the list got council seats (proportional), but a list wins at T1
      // only with >50% of votes cast AND a quarter of registered voters (art. L. 262).
      // Without a registered-voters count, the quarter cannot be checked and is skipped.
      isElected:
        seatsWon > 0 &&
        round1Pct > 50 &&
        (registeredVoters <= 0 || round1Votes * 4 >= registeredVoters),
    });
  });

  // Extract commune name from page title
  const communeName = $("h5.fr-h2").text().trim().split("(")[0]?.trim() || inseeCode;

  return {
    inseeCode,
    communeName,
    registeredVoters,
    actualVoters,
    blankVotes,
    nullVotes,
    validVotes,
    participationRate: Math.round(participationRate * 100) / 100,
    lists,
  };
}

/**
 * Normalize a list name for matching against existing Candidacy records.
 * Handles casing, extra whitespace, punctuation differences.
 */
export function normalizeListName(raw: string): string {
  return raw
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// --- Database operations ---

async function upsertCommuneParticipation(
  communeId: string,
  electionId: string,
  data: ParsedCommuneResult
) {
  await db.communeElectionRound.upsert({
    where: {
      communeId_electionId_round: {
        communeId,
        electionId,
        round: 1,
      },
    },
    update: {
      registeredVoters: data.registeredVoters,
      actualVoters: data.actualVoters,
      participationRate: new Prisma.Decimal(data.participationRate),
      blankVotes: data.blankVotes,
      nullVotes: data.nullVotes,
      validVotes: data.validVotes,
    },
    create: {
      communeId,
      electionId,
      round: 1,
      registeredVoters: data.registeredVoters,
      actualVoters: data.actualVoters,
      participationRate: new Prisma.Decimal(data.participationRate),
      blankVotes: data.blankVotes,
      nullVotes: data.nullVotes,
      validVotes: data.validVotes,
    },
  });
}

async function updateCandidacyResults(
  electionId: string,
  communeId: string,
  list: ParsedListResult
) {
  const normalizedName = normalizeListName(list.listName);

  // Find matching candidacies by commune + normalized list name
  const candidacies = await db.candidacy.findMany({
    where: { electionId, communeId },
    select: { id: true, listName: true },
  });

  const matchingIds = candidacies
    .filter((c) => c.listName && normalizeListName(c.listName) === normalizedName)
    .map((c) => c.id);

  if (matchingIds.length === 0) {
    // Fallback: try partial match on first significant words
    const words = normalizedName
      .split(" ")
      .filter((w) => w.length > 3)
      .slice(0, 3);
    if (words.length > 0) {
      const fallbackIds = candidacies
        .filter((c) => {
          if (!c.listName) return false;
          const norm = normalizeListName(c.listName);
          return words.every((w) => norm.includes(w));
        })
        .map((c) => c.id);

      if (fallbackIds.length > 0) {
        console.warn(
          `  [FALLBACK] "${list.listName}" matched ${fallbackIds.length} candidacies via partial match in ${communeId}`
        );
        await db.candidacy.updateMany({
          where: { id: { in: fallbackIds } },
          data: {
            round1Votes: list.round1Votes,
            round1Pct: new Prisma.Decimal(list.round1Pct),
            round1Qualified: list.round1Qualified,
            isElected: list.isElected,
          },
        });
        return fallbackIds.length;
      }
    }

    console.warn(`  [WARN] No match for list "${list.listName}" in commune ${communeId}`);
    return 0;
  }

  await db.candidacy.updateMany({
    where: { id: { in: matchingIds } },
    data: {
      round1Votes: list.round1Votes,
      round1Pct: new Prisma.Decimal(list.round1Pct),
      round1Qualified: list.round1Qualified,
      isElected: list.isElected,
    },
  });

  return matchingIds.length;
}

// --- Stats snapshot ---

async function updateResultsSnapshot(stats: {
  communesDepouillees: number;
  participationMoyenne: number;
  eluesT1: number;
  auSecondTour: number;
}) {
  const key = "municipales-2026-resultats";
  const existing = await db.statsSnapshot.findUnique({ where: { key } });
  const merged = {
    ...((existing?.data as Record<string, unknown>) ?? {}),
    ...stats,
  };

  await db.statsSnapshot.upsert({
    where: { key },
    update: { data: merged },
    create: { key, data: merged },
  });
}

// --- Helpers ---

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Main orchestrator ---

export async function syncResultatsT1({ dryRun = false, dept }: SyncOptions = {}) {
  console.log(`\n=== Sync Resultats T1 ${dryRun ? "(DRY RUN)" : ""} ===\n`);

  const election = await db.election.findUnique({
    where: { slug: "municipales-2026" },
    select: { id: true },
  });

  if (!election) {
    console.error("Election municipales-2026 not found");
    return;
  }

  const departments = dept ? [dept] : DEPARTMENT_CODES;
  let totalCommunesProcessed = 0;
  let totalCommunesNoResults = 0;
  let totalCommunesSkipped = 0;
  let totalWarnings = 0;
  let totalEluesT1 = 0;
  let totalSecondTour = 0;
  let participationSum = 0;
  let participationCount = 0;

  for (const deptCode of departments) {
    console.log(`\n--- Department ${deptCode} ---`);

    // Get communes in this department that have candidacies for this election
    const communes = await db.commune.findMany({
      where: {
        departmentCode: deptCode,
        candidacies: { some: { electionId: election.id } },
      },
      select: { id: true, name: true, regionCode: true },
    });

    console.log(`  ${communes.length} communes with candidacies`);

    for (const commune of communes) {
      if (!commune.regionCode) {
        console.warn(`  [SKIP] ${commune.name} (${commune.id}): no regionCode`);
        totalCommunesSkipped++;
        continue;
      }

      const url = `${BASE_URL}/${commune.regionCode}/${deptCode}/${commune.id}/`;

      await sleep(INTERIEUR_RATE_LIMIT_MS);

      let html: string;
      try {
        const response = await httpClient.getText(url);
        html = response.data;
      } catch (err) {
        console.warn(
          `  [ERR] ${commune.name} (${commune.id}): fetch failed - ${err instanceof Error ? err.message : err}`
        );
        totalCommunesSkipped++;
        continue;
      }

      const result = parseCommuneResultsHtml(html, commune.id);
      if (!result) {
        totalCommunesNoResults++;
        continue;
      }

      if (!dryRun) {
        await upsertCommuneParticipation(commune.id, election.id, result);
        for (const list of result.lists) {
          const count = await updateCandidacyResults(election.id, commune.id, list);
          if (count === 0) totalWarnings++;
        }
      }

      const hasElected = result.lists.some((l) => l.isElected);
      if (hasElected) totalEluesT1++;
      else totalSecondTour++;
      participationSum += result.participationRate;
      participationCount++;
      totalCommunesProcessed++;

      console.log(
        `  ${result.communeName}: ${result.lists.length} listes, ${result.participationRate}% participation${hasElected ? " [ELU T1]" : ""}`
      );
    }
  }

  // Update stats snapshot
  if (!dryRun && participationCount > 0) {
    await updateResultsSnapshot({
      communesDepouillees: totalCommunesProcessed,
      participationMoyenne: Math.round((participationSum / participationCount) * 100) / 100,
      eluesT1: totalEluesT1,
      auSecondTour: totalSecondTour,
    });
  }

  console.log(`\n=== Summary ===`);
  console.log(`Communes processed: ${totalCommunesProcessed}`);
  console.log(`Communes no results: ${totalCommunesNoResults}`);
  console.log(`Communes skipped: ${totalCommunesSkipped}`);
  console.log(`Warnings (matching): ${totalWarnings}`);
  console.log(`Elected T1: ${totalEluesT1}`);
  console.log(`Second tour: ${totalSecondTour}`);
  if (participationCount > 0) {
    console.log(`Avg participation: ${(participationSum / participationCount).toFixed(2)}%`);
  }
}
