import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { getEnabledFlags } from "@/lib/feature-flags";
import { NAV_ELECTIONS, type ElectionNavItem } from "@/config/navigation";

/** FeatureFlag.name of the election put forward in the header and at the top of the mobile menu. */
export const ELECTION_SPOTLIGHT_FLAG = "ELECTION_SPOTLIGHT";

interface SpotlightFlagRow {
  enabled: boolean;
  value: unknown;
  startDate: Date | null;
  endDate: Date | null;
}

async function loadSpotlightFlag(): Promise<SpotlightFlagRow | null> {
  "use cache";
  cacheTag("feature-flags");
  cacheLife("synced");

  return db.featureFlag.findUnique({
    where: { name: ELECTION_SPOTLIGHT_FLAG },
    select: { enabled: true, value: true, startDate: true, endDate: true },
  });
}

async function electionExists(slug: string): Promise<boolean> {
  "use cache";
  cacheTag("elections");
  cacheLife("synced");

  const election = await db.election.findUnique({ where: { slug }, select: { id: true } });
  return election !== null;
}

function readSlug(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const slug = (value as Record<string, unknown>).slug;
  return typeof slug === "string" ? slug : null;
}

/**
 * The NAV_ELECTIONS entry put forward, or null.
 *
 * Every condition must hold, because `getFeatureValue()` alone returns the value of a disabled
 * flag: the flag is enabled, `now` sits inside its optional date window, its `value.slug` names a
 * NAV_ELECTIONS entry, that entry's own flag (if any) is enabled, and the Election row exists.
 *
 * The date window is evaluated here, outside the cached read, so a cached row does not keep the
 * verdict of the moment it was cached.
 */
export async function getElectionSpotlight(
  now: Date = new Date()
): Promise<ElectionNavItem | null> {
  const flag = await loadSpotlightFlag();
  if (!flag?.enabled) return null;
  if (flag.startDate && now < flag.startDate) return null;
  if (flag.endDate && now > flag.endDate) return null;

  const slug = readSlug(flag.value);
  const item = NAV_ELECTIONS.find((election) => election.slug === slug);
  if (!item) return null;

  if (item.featureFlag) {
    const enabledFlags = await getEnabledFlags();
    if (!enabledFlags.has(item.featureFlag)) return null;
  }

  return (await electionExists(item.slug)) ? item : null;
}
