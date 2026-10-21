/**
 * Populations de référence millésimées des communes (lot 1.7 Territoires, #1052).
 *
 * Importe la série INSEE (millésimes 2023 et 2022) et les recensements propres à Mayotte,
 * à la Polynésie française, à la Nouvelle-Calédonie et à Wallis-et-Futuna dans
 * CommunePopulation, puis aligne Commune.population sur la population municipale en vigueur.
 * Idempotent. Le mode --dry-run télécharge, rapproche et imprime le rapport sans rien écrire.
 *
 * Usage :
 *   npx tsx --env-file=.env scripts/sync-populations.ts --dry-run
 *   npx tsx --env-file=.env scripts/sync-populations.ts
 *   Option : --date=2026-10-11 (date de référence pour « en vigueur », aujourd'hui par défaut)
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { syncPopulations } from "@/services/sync/populations";
import type { ThresholdCrossing } from "@/services/sync/populations-plan";

const OUTRE_MER = [
  "971",
  "972",
  "973",
  "974",
  "975",
  "976",
  "977",
  "978",
  "984",
  "986",
  "987",
  "988",
  "989",
];
const SAMPLE = 15;

function fmt(n: number | null): string {
  return n == null ? "inconnue" : n.toLocaleString("fr-FR");
}

function printCrossings(title: string, list: ThresholdCrossing[]) {
  console.log(`  ${title} : ${list.length}`);
  for (const c of list.slice(0, SAMPLE)) {
    console.log(`    ${c.communeId} ${fmt(c.before)} -> ${fmt(c.after)}`);
  }
  if (list.length > SAMPLE) console.log(`    ... et ${list.length - SAMPLE} autres`);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const onDate = process.argv.find((a) => a.startsWith("--date="))?.slice("--date=".length);
  if (onDate && !/^\d{4}-\d{2}-\d{2}$/.test(onDate)) throw new Error("--date attend AAAA-MM-JJ");
  console.log(`Populations de référence${dryRun ? " [DRY-RUN, aucune écriture]" : ""}`);

  const r = await syncPopulations({ dryRun, onDate });
  const { plan } = r;

  console.log(`\nDate de référence (en vigueur) : ${r.onDate}`);
  console.log("\n=== Lignes lues ===");
  for (const s of r.sources) {
    const arr = s.arrondissementsAggregated
      ? `, ${s.arrondissementsAggregated} arrondissements agrégés (Paris, Lyon, Marseille)`
      : "";
    console.log(`  ${s.key} : ${s.linesRead} lignes, ${s.records} enregistrements${arr}`);
    if (s.droppedChangedTerritory.length) {
      console.log(
        `    écartés, territoire modifié depuis la géographie du fichier : ${s.droppedChangedTerritory.length} (${s.droppedChangedTerritory.slice(0, SAMPLE).join(" ")}${s.droppedChangedTerritory.length > SAMPLE ? " ..." : ""})`
      );
    }
  }

  console.log(`\n=== Rapprochement (code INSEE exact) ===`);
  console.log(`  communes en base : ${r.communesInBase}`);
  console.log(`  enregistrements rapprochés : ${plan.matchedRecords.length}`);
  const matchedBySource = new Map<string, number>();
  for (const m of plan.matchedRecords) {
    const k = `${m.producer} ${m.millesime}`;
    matchedBySource.set(k, (matchedBySource.get(k) ?? 0) + 1);
  }
  for (const [k, n] of matchedBySource) console.log(`    ${k} : ${n}`);
  console.log(`  communes avec une population en vigueur : ${plan.inForce.size}`);

  const metro = plan.byDepartment.filter((d) => !OUTRE_MER.includes(d.departmentCode));
  const metroIssues = metro.filter(
    (d) => d.unmatchedCodes.length > 0 || d.communesWithoutSeries.length > 0
  );
  console.log(
    `\n  Hexagone et Corse : ${metro.length} départements, ${metro.reduce((n, d) => n + d.matched, 0)}/${metro.reduce((n, d) => n + d.records, 0)} enregistrements rapprochés`
  );
  for (const d of metroIssues) {
    console.log(
      `    ${d.departmentCode} : ${d.matched}/${d.records} rapprochés` +
        (d.unmatchedCodes.length
          ? `, sans commune en base : ${d.unmatchedCodes.slice(0, SAMPLE).join(" ")}`
          : "") +
        (d.communesWithoutSeries.length
          ? `, communes sans série : ${d.communesWithoutSeries.slice(0, SAMPLE).join(" ")}`
          : "")
    );
  }

  console.log("\n  Outre-mer, territoire par territoire :");
  for (const code of OUTRE_MER) {
    const d = plan.byDepartment.find((x) => x.departmentCode === code);
    const inForce = [...plan.inForce.values()].filter((p) => p.departmentCode === code);
    const vintage = inForce[0]
      ? `millésime ${inForce[0].millesime} en vigueur au ${inForce[0].effectiveFrom} (${inForce[0].producer})`
      : "aucune série";
    console.log(
      `    ${code} : ${d ? `${d.matched}/${d.records} rapprochés` : "aucun enregistrement source"}, ${inForce.length} communes avec population en vigueur, ${vintage}` +
        (d?.unmatchedCodes.length ? `, sans commune en base : ${d.unmatchedCodes.join(" ")}` : "") +
        (d?.communesWithoutSeries.length
          ? `, communes sans série : ${d.communesWithoutSeries.join(" ")}`
          : "")
    );
  }

  console.log("\n=== Écarts avec Commune.population actuelle ===");
  printCrossings("communes dont la population changerait", plan.differing);
  printCrossings("franchissent le seuil de 1 000 habitants (indexation)", plan.crossesIndexFloor);
  printCrossings(
    "franchissent le seuil de 20 000 habitants (réserve député)",
    plan.crossesDeputeThreshold
  );
  console.log(
    `  statut d'indexation (isIndexableTerritoireCommune) : ${plan.indexationGained.length} deviendraient indexables, ${plan.indexationLost.length} cesseraient de l'être`
  );
  if (plan.indexationGained.length) console.log(`    gagnent : ${plan.indexationGained.join(" ")}`);
  if (plan.indexationLost.length) console.log(`    perdent : ${plan.indexationLost.join(" ")}`);

  if (r.written) {
    console.log("\n=== Écritures ===");
    console.log(`  CommunePopulation créées : ${r.written.created}`);
    console.log(`  CommunePopulation mises à jour : ${r.written.updated}`);
    console.log(`  Commune.population alignées : ${r.written.communePopulationAligned}`);
  }
}

main()
  .catch((e) => {
    console.error("ERREUR", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
