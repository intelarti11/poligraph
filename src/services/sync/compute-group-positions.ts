import type { GroupPosition } from "@/generated/prisma";
import { db } from "@/lib/db";

interface VoteInput {
  position: string;
}

interface GroupAggregation {
  position: GroupPosition;
  forCount: number;
  againstCount: number;
  abstainCount: number;
  cohesionPct: number;
}

const ACTIVE_POSITIONS = new Set(["POUR", "CONTRE", "ABSTENTION"]);
const POSITION_PRIORITY: GroupPosition[] = ["POUR", "CONTRE", "ABSTENTION"];

export function aggregateGroupVotes(votes: VoteInput[]): GroupAggregation | null {
  let forCount = 0;
  let againstCount = 0;
  let abstainCount = 0;

  for (const v of votes) {
    if (!ACTIVE_POSITIONS.has(v.position)) continue;
    if (v.position === "POUR") forCount++;
    else if (v.position === "CONTRE") againstCount++;
    else if (v.position === "ABSTENTION") abstainCount++;
  }

  const total = forCount + againstCount + abstainCount;
  if (total === 0) return null;

  const counts: Record<GroupPosition, number> = {
    POUR: forCount,
    CONTRE: againstCount,
    ABSTENTION: abstainCount,
  };

  let position: GroupPosition = "POUR";
  let maxCount = 0;
  for (const p of POSITION_PRIORITY) {
    if (counts[p] > maxCount) {
      maxCount = counts[p];
      position = p;
    }
  }

  const cohesionPct = Math.round((maxCount / total) * 1000) / 10;

  return { position, forCount, againstCount, abstainCount, cohesionPct };
}

/**
 * Compute group positions for a single scrutin (call right after vote insertion).
 *
 * La jointure passe par le mandat `isCurrent`, donc par le groupe actuel du député. Elle
 * n'est valable que pour les scrutins de la législature de ce groupe : le filtre
 * `g.legislature = s.legislature` (AN) empêche d'écrire un vote de la 16e sous un groupe
 * de la 17e. Voir src/lib/votes/group-attribution.ts.
 */
export async function computeGroupPositionsForScrutin(scrutinId: string): Promise<number> {
  const rows = await db.$queryRaw<Array<{ groupId: string; position: string; voteCount: bigint }>>`
    SELECT
      mp."parliamentaryGroupId" AS "groupId",
      v.position,
      COUNT(*) AS "voteCount"
    FROM "Vote" v
    JOIN "Scrutin" s ON s.id = v."scrutinId"
    JOIN "Mandate" m ON m."politicianId" = v."politicianId"
      AND m."isCurrent" = true
    JOIN "MandateParliamentary" mp ON mp."mandateId" = m.id
    JOIN "ParliamentaryGroup" g ON g.id = mp."parliamentaryGroupId"
    WHERE v."scrutinId" = ${scrutinId}
      AND v.position IN ('POUR', 'CONTRE', 'ABSTENTION')
      AND mp."parliamentaryGroupId" IS NOT NULL
      AND g.chamber = s.chamber
      AND (s.chamber = 'SENAT' OR g.legislature = s.legislature)
    GROUP BY mp."parliamentaryGroupId", v.position
  `;

  const grouped = new Map<string, VoteInput[]>();
  for (const row of rows) {
    if (!grouped.has(row.groupId)) grouped.set(row.groupId, []);
    const count = Number(row.voteCount);
    for (let i = 0; i < count; i++) {
      grouped.get(row.groupId)!.push({ position: row.position });
    }
  }

  let created = 0;
  const upserts: Array<Promise<unknown>> = [];
  for (const [groupId, votes] of grouped) {
    const agg = aggregateGroupVotes(votes);
    if (!agg) continue;
    upserts.push(
      db.scrutinGroupPosition.upsert({
        where: { scrutinId_groupId: { scrutinId, groupId } },
        create: { scrutinId, groupId, ...agg },
        update: agg,
      })
    );
    created++;
  }
  if (upserts.length > 0) await Promise.all(upserts);
  return created;
}

export async function computeGroupPositions(opts?: { since?: Date }): Promise<{
  scrutinsProcessed: number;
  positionsCreated: number;
}> {
  const since = opts?.since;
  const rows = await db.$queryRaw<
    Array<{
      scrutinId: string;
      groupId: string;
      position: string;
      voteCount: bigint;
    }>
  >`
    SELECT
      v."scrutinId",
      mp."parliamentaryGroupId" AS "groupId",
      v.position,
      COUNT(*) AS "voteCount"
    FROM "Vote" v
    JOIN "Scrutin" s ON s.id = v."scrutinId"
    JOIN "Mandate" m ON m."politicianId" = v."politicianId"
      AND m."isCurrent" = true
    JOIN "MandateParliamentary" mp ON mp."mandateId" = m.id
    JOIN "ParliamentaryGroup" g ON g.id = mp."parliamentaryGroupId"
    WHERE v.position IN ('POUR', 'CONTRE', 'ABSTENTION')
      AND mp."parliamentaryGroupId" IS NOT NULL
      AND g.chamber = s.chamber
      AND (s.chamber = 'SENAT' OR g.legislature = s.legislature)
      AND (${since}::timestamptz IS NULL OR s."votingDate" >= ${since})
    GROUP BY v."scrutinId", mp."parliamentaryGroupId", v.position
  `;

  const grouped = new Map<string, Map<string, VoteInput[]>>();
  const scrutinIds = new Set<string>();

  for (const row of rows) {
    scrutinIds.add(row.scrutinId);
    const key = row.scrutinId;
    if (!grouped.has(key)) grouped.set(key, new Map());
    const groupMap = grouped.get(key)!;
    if (!groupMap.has(row.groupId)) groupMap.set(row.groupId, []);
    const count = Number(row.voteCount);
    for (let i = 0; i < count; i++) {
      groupMap.get(row.groupId)!.push({ position: row.position });
    }
  }

  let positionsCreated = 0;
  const upserts: Array<Promise<unknown>> = [];

  for (const [scrutinId, groupMap] of grouped) {
    for (const [groupId, votes] of groupMap) {
      const agg = aggregateGroupVotes(votes);
      if (!agg) continue;

      upserts.push(
        db.scrutinGroupPosition.upsert({
          where: { scrutinId_groupId: { scrutinId, groupId } },
          create: { scrutinId, groupId, ...agg },
          update: agg,
        })
      );
      positionsCreated++;

      if (upserts.length >= 10) {
        await Promise.all(upserts);
        upserts.length = 0;
      }
    }
  }
  if (upserts.length > 0) await Promise.all(upserts);

  return { scrutinsProcessed: scrutinIds.size, positionsCreated };
}
