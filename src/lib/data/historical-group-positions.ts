/**
 * Reading side of the historical group counts of a scrutin (lot 6).
 *
 * The ONLY module that names the public views of `2026-10-21-historical-groups-public-read.sql`
 * (`HistoricalGroupPositionPublic`, `HistoricalScrutinPublicStatus`). Never the raw tables of the
 * lot 5: an architecture test keeps it that way. The views hold the whole publication policy (a
 * completed run, pinned snapshots verified and released, a publishable position, no excluded
 * vote). This module adds the bounds: one scrutin at a time, a fixed row cap, strict parsing.
 *
 * Reads only. No fallback to the current affiliation of a deputy: when the views say nothing, the
 * answer is "nothing", and `buildHistoricalPositionsView` turns that into an explicit state.
 */
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import type {
  HistoricalGroupRow,
  HistoricalPositionsData,
  HistoricalScrutinStatus,
} from "@/lib/votes/historical-positions";

/** A legislature seats fewer than twenty groups. The cap is a bound, not a target. */
export const MAX_GROUP_ROWS = 40;

/** External ids look like `VTANR5L17V1234`. Anything else never reaches the database. */
const SCRUTIN_EXTERNAL_ID = /^[A-Za-z0-9_-]{1,64}$/;

const count = z.number().int().min(0).max(2_000_000);

/**
 * The source links are rendered as hrefs, so they are checked here and not trusted from the view:
 * https only, and the open data host of the Assemblée nationale (same rule as `officialSourceOf`).
 */
const ASSEMBLY_HOSTS = new Set(["data.assemblee-nationale.fr", "www.assemblee-nationale.fr"]);
const assemblyUrl = z
  .string()
  .max(500)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && ASSEMBLY_HOSTS.has(url.hostname);
    } catch {
      return false;
    }
  }, "not an https link to the Assemblée nationale");

const rowSchema = z.object({
  organRef: z.string().min(1).max(32),
  organLabel: z.string().min(1).max(300),
  organAbbreviation: z.string().max(40).nullable(),
  forCount: count,
  againstCount: count,
  abstainCount: count,
  nonVoterCount: count,
  sameAbbreviationElsewhere: z.boolean(),
});

const withheldSchema = z.object({
  label: z.string().min(1).max(300),
  abbreviation: z.string().max(40).nullable(),
  reason: z.enum(["EXCLUDED_VOTES_PRESENT", "NO_ATTESTED_VOTE", "UNLABELLED_GROUP"]),
});

const statusSchema = z.object({
  legislature: z.number().int(),
  countCoherence: z.enum(["COHERENT", "COUNT_MISMATCH", "UNVERIFIABLE", "COUNT_COHERENCE_UNKNOWN"]),
  groupsShown: count,
  groupsWithheld: count,
  withheldGroups: z.array(withheldSchema).max(MAX_GROUP_ROWS),
  nonInscritVotes: count,
  excludedConflictVotes: count,
  excludedUnknownGroupVotes: count,
  affiliationsUrl: assemblyUrl.nullable(),
  affiliationsFetchedAt: z.date().nullable(),
  affiliationsAsOf: z.date().nullable(),
  scrutinsUrl: assemblyUrl.nullable(),
  scrutinsFetchedAt: z.date().nullable(),
});

/**
 * Cached read. Throws when the views cannot be read (not applied yet, database unavailable): a
 * throw is not cached, so a transient failure does not freeze "unavailable" for a day. Callers go
 * through `readHistoricalGroupPositions`.
 */
export async function getHistoricalGroupPositions(
  scrutinExternalId: string
): Promise<Exclude<HistoricalPositionsData, { unreadable: true }>> {
  "use cache";
  cacheTag("votes");
  cacheLife("synced");

  if (!SCRUTIN_EXTERNAL_ID.test(scrutinExternalId)) return { status: null, rows: [] };

  const [statusRows, positionRows] = await Promise.all([
    db.$queryRaw<unknown[]>(Prisma.sql`
      SELECT "legislature", "countCoherence", "groupsShown", "groupsWithheld", "withheldGroups",
             "nonInscritVotes", "excludedConflictVotes", "excludedUnknownGroupVotes",
             "affiliationsUrl", "affiliationsFetchedAt", "affiliationsAsOf",
             "scrutinsUrl", "scrutinsFetchedAt"
      FROM "HistoricalScrutinPublicStatus"
      WHERE "scrutinExternalId" = ${scrutinExternalId}
      LIMIT 1
    `),
    db.$queryRaw<unknown[]>(Prisma.sql`
      SELECT "organRef", "organLabel", "organAbbreviation", "forCount", "againstCount",
             "abstainCount", "nonVoterCount", "sameAbbreviationElsewhere"
      FROM "HistoricalGroupPositionPublic"
      WHERE "scrutinExternalId" = ${scrutinExternalId}
      ORDER BY "organLabel", "organRef"
      LIMIT ${MAX_GROUP_ROWS}
    `),
  ]);

  const status: HistoricalScrutinStatus | null =
    statusRows.length === 0 ? null : statusSchema.parse(statusRows[0]);
  const rows: HistoricalGroupRow[] = positionRows.map((raw) => {
    const r = rowSchema.parse(raw);
    return {
      organRef: r.organRef,
      label: r.organLabel,
      abbreviation: r.organAbbreviation,
      forCount: r.forCount,
      againstCount: r.againstCount,
      abstainCount: r.abstainCount,
      nonVoterCount: r.nonVoterCount,
      sameAbbreviationElsewhere: r.sameAbbreviationElsewhere,
    };
  });
  return { status, rows };
}

/**
 * Uncached wrapper used by the page. A failed or malformed read becomes `{ unreadable: true }`,
 * reported once to Sentry, instead of failing the whole scrutin page or showing a guess.
 */
export async function readHistoricalGroupPositions(
  scrutinExternalId: string
): Promise<HistoricalPositionsData> {
  try {
    return await getHistoricalGroupPositions(scrutinExternalId);
  } catch (error) {
    void import("@sentry/nextjs")
      .then((Sentry) => {
        Sentry.captureException(error, {
          level: "warning",
          fingerprint: ["historical-group-positions-unreadable"],
        });
      })
      .catch(() => {});
    return { unreadable: true };
  }
}
