/**
 * Contrôle de fraîcheur des mesures de couverture des législatures (lecture seule).
 *
 * Aucune requête, aucun import : compare `measuredAt` de la configuration à la date du jour.
 * Code de sortie 1 si une mesure dépasse `maxAgeDays`, à lancer pendant les vérifications de
 * déploiement. Rafraîchir les chiffres reste une opération manuelle et séparée.
 *
 * Usage : npm run audit:legislature-coverage-age [-- --now=2026-12-01]
 */
import { AN_LEGISLATURE_COVERAGE } from "../src/config/legislatures";
import { staleDatasets } from "../src/lib/parlement/legislature-config";

const nowArg = process.argv.find((a) => a.startsWith("--now="))?.slice("--now=".length);
const now = nowArg ? new Date(`${nowArg}T00:00:00Z`) : new Date();
if (Number.isNaN(now.getTime())) {
  console.error(`Date invalide pour --now : ${nowArg}`);
  process.exit(2);
}

let staleCount = 0;
for (const coverage of AN_LEGISLATURE_COVERAGE) {
  const stale = staleDatasets(coverage, now);
  staleCount += stale.length;
  for (const d of stale) {
    console.log(
      `L${coverage.number}/${d.dataset}: mesure vieille de ${d.ageDays} jours (maximum ${coverage.refresh.maxAgeDays})`
    );
  }
}

if (staleCount > 0) {
  console.error(
    `${staleCount} mesure(s) trop ancienne(s) : actualiser avant de citer ces chiffres.`
  );
  process.exit(1);
}
console.log("Couverture des législatures : toutes les mesures sont récentes.");
