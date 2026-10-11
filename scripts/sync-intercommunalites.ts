/**
 * Intercommunalités et appartenances datées des communes (#1052, lot 1.8).
 * Source : fichiers INSEE « EPCI à fiscalité propre » et « EPT » au 1er janvier.
 *
 * Usage :
 *   npx tsx --env-file=.env scripts/sync-intercommunalites.ts --dry-run
 *   npx tsx --env-file=.env scripts/sync-intercommunalites.ts
 *   npx tsx --env-file=.env scripts/sync-intercommunalites.ts --annee=2026
 *
 * Sans --annee : l'année en cours, sinon la précédente si l'INSEE ne l'a pas encore publiée.
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { isOutreMer, syncIntercommunalites } from "@/services/sync/intercommunalites";

function parseYear(): number | undefined {
  const arg = process.argv.find((a) => a.startsWith("--annee="));
  if (!arg) return undefined;
  const year = Number.parseInt(arg.slice("--annee=".length), 10);
  if (!Number.isInteger(year) || year < 2016 || year > 2100) {
    throw new Error(`--annee invalide : ${arg}`);
  }
  return year;
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)} %`);

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Intercommunalités (INSEE)${dryRun ? " [DRY-RUN, aucune écriture]" : ""}`);

  const r = await syncIntercommunalites({ dryRun, year: parseYear() });

  console.log(`\nSituation au ${r.situationDate}`);
  if (!r.tablesReady) console.log("  (tables absentes : plan calculé sur une base vide)");
  console.log(`  ${r.fileUrls.epci}\n  ${r.fileUrls.ept}`);

  console.log("\n=== Établissements lus par nature ===");
  for (const [nature, n] of Object.entries(r.bodiesByNature))
    console.log(`  ${nature.padEnd(6)} ${n}`);
  console.log(`  à créer : ${r.bodiesToCreate}, à renommer ou requalifier : ${r.bodiesToUpdate}`);

  console.log("\n=== Communes par département ===");
  console.log(
    "  dép.   en base  rattachées  sans objet  EPT  absentes de la source  rapprochement"
  );
  const totals = { inBase: 0, rattachees: 0, sansObjet: 0, ept: 0, absentes: 0 };
  for (const d of r.departments) {
    totals.inBase += d.inBase;
    totals.rattachees += d.rattachees;
    totals.sansObjet += d.sansObjet;
    totals.ept += d.ept;
    totals.absentes += d.absentesDeLaSource;
    const covered = d.inBase - d.absentesDeLaSource;
    const line = `  ${d.departmentCode.padEnd(5)} ${String(d.inBase).padStart(8)} ${String(d.rattachees).padStart(11)} ${String(d.sansObjet).padStart(11)} ${String(d.ept).padStart(4)} ${String(d.absentesDeLaSource).padStart(22)}  ${pct(covered, d.inBase)}`;
    if (isOutreMer(d.departmentCode) || d.sansObjet > 0 || d.absentesDeLaSource > 0 || d.ept > 0) {
      console.log(line);
    }
  }
  const metro = r.departments.filter(
    (d) =>
      !isOutreMer(d.departmentCode) &&
      d.sansObjet === 0 &&
      d.absentesDeLaSource === 0 &&
      d.ept === 0
  );
  console.log(
    `  (+ ${metro.length} départements entièrement rattachés : ${metro.reduce((a, d) => a + d.inBase, 0)} communes)`
  );
  console.log(
    `  TOTAL ${String(totals.inBase).padStart(8)} ${String(totals.rattachees).padStart(11)} ${String(totals.sansObjet).padStart(11)} ${String(totals.ept).padStart(4)} ${String(totals.absentes).padStart(22)}  ${pct(totals.inBase - totals.absentes, totals.inBase)}`
  );

  console.log(`\nCommunes de la source absentes de la base : ${r.communesInconnues.length}`);
  if (r.communesInconnues.length > 0)
    console.log(`  ${r.communesInconnues.slice(0, 30).join(", ")}`);

  console.log("\n=== Appartenances ===");
  console.log(`  lues et rapprochées : ${r.membershipsObserved}`);
  console.log(`  à ouvrir            : ${r.toCreate}`);
  console.log(`  à fermer            : ${r.toClose}`);
  console.log(`  confirmées          : ${r.toConfirm}`);

  console.log(`\n=== Anomalies (${r.anomalies.length}) ===`);
  for (const a of r.anomalies.slice(0, 50)) console.log(`  ${a}`);
}

main()
  .catch((e) => {
    console.error("ERREUR", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
