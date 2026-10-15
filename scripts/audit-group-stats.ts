/**
 * Recalcul à blanc des statistiques de groupe AN : lecture seule, aucune écriture.
 * Compare les valeurs persistées à celles que produirait le calcul borné à la législature
 * du groupe (src/services/sync/compute-group-stats.ts). Sert à valider le recalcul contrôlé
 * avant de passer AN_GROUP_STATS_PUBLISHABLE à true.
 *
 *   npx tsx --env-file=.env scripts/audit-group-stats.ts
 */
import { db } from "../src/lib/db";
import { CURRENT_LEGISLATURE, GOVERNMENT_GROUP_CODE } from "../src/config/scrutin-importance";
import {
  computeAlignmentRates,
  computeAverageCohesion,
} from "../src/services/sync/compute-group-stats";

async function main() {
  const groups = await db.parliamentaryGroup.findMany({
    where: { chamber: "AN", legislature: CURRENT_LEGISLATURE },
    select: { id: true, code: true, stats: { orderBy: { computedAt: "desc" }, take: 1 } },
    orderBy: { code: "asc" },
  });
  const select = {
    scrutinId: true,
    position: true,
    cohesionPct: true,
    scrutin: { select: { type: true } },
  } as const;
  const scope = { scrutin: { legislature: CURRENT_LEGISLATURE } };

  const gov = groups.find((g) => g.code === GOVERNMENT_GROUP_CODE);
  const govPositions = gov
    ? await db.scrutinGroupPosition.findMany({ where: { groupId: gov.id, ...scope }, select })
    : [];

  const rows = [];
  for (const g of groups) {
    const [all, scoped] = await Promise.all([
      db.scrutinGroupPosition.count({ where: { groupId: g.id } }),
      db.scrutinGroupPosition.findMany({ where: { groupId: g.id, ...scope }, select }),
    ]);
    const rates = computeAlignmentRates({
      groupPositions: scoped,
      govGroupPositions: govPositions,
    });
    const persisted = g.stats[0];
    rows.push({
      groupe: g.code,
      positions_total: all,
      positions_17e: scoped.length,
      cohesion_persistee: persisted?.cohesionPct ?? null,
      cohesion_recalculee: computeAverageCohesion(scoped),
      alignement_persiste: persisted?.governmentAlignmentPct ?? null,
      alignement_recalcule: rates.governmentAlignmentPct,
      final_persiste: persisted?.finalVoteAlignmentPct ?? null,
      final_recalcule: rates.finalVoteAlignmentPct,
    });
  }
  console.table(rows);
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
