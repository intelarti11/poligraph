/**
 * Climat, lot R3 de « Le territoire en chiffres » (#1052).
 *
 * Lit les fiches climatologiques de Météo-France (une par station, licence ouverte 2.0), retient
 * pour chaque commune la station la plus proche de son département sous le seuil de distance, et
 * écrit un lot en BROUILLON, relu puis publié depuis /admin/territoires/reperes. Chaque valeur
 * garde la période mesurée par sa station. Les fiches sont mises en cache dans
 * scripts/.local/climat-cache (gitignoré), vidé quand data.gouv.fr annonce une mise à jour.
 *
 * Usage :
 *   npx tsx --env-file=.env scripts/sync-reperes-climat.ts           (aperçu, aucune écriture)
 *   npx tsx --env-file=.env scripts/sync-reperes-climat.ts --write   (écrit le brouillon)
 *   Option : --km=30 (seuil de distance à la station, en kilomètres)
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { syncReperesClimat } from "@/services/sync/reperes-climat";

const quantile = (sorted: number[], q: number) =>
  sorted.length === 0
    ? 0
    : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);

async function main() {
  const write = process.argv.includes("--write");
  console.log(`Climat${write ? "" : " [APERÇU, aucune écriture]"}`);
  const km = process.argv.find((a) => a.startsWith("--km="))?.split("=")[1];
  if (km !== undefined && !(Number(km) > 0)) throw new Error("--km attend un nombre positif");
  const r = await syncReperesClimat({
    dryRun: !write,
    maxKm: km ? Number(km) : undefined,
    cacheDir: "scripts/.local/climat-cache/data",
    onProgress: (m) => console.log(`  ${m}`),
  });
  const { report: p } = r;
  console.log(`Fiches listées : ${p.stationsListed}, lues : ${p.stations.length}`);
  console.log(`  illisibles : ${p.unreadable.length} ${p.unreadable.slice(0, 10).join(" ")}`);
  console.log(
    `  sans température moyenne : ${p.withoutTemp}, sans précipitations : ${p.withoutPrecip}`
  );
  console.log(
    `  période plus courte que 30 ans : température ${p.shortTemp}, précipitations ${p.shortPrecip}`
  );
  console.log(`Seuil retenu : ${p.maxKm} km`);
  console.log(
    `Communes avec coordonnées : ${p.communes} (sans coordonnées, sans ligne : ${p.communesWithoutCoordinates})`
  );
  console.log(`  avec une station de référence : ${p.established}`);
  console.log(`  lignes écrites : ${p.rows.length}`);
  for (const [reason, n] of Object.entries(p.notEstablished))
    console.log(`  non établi, ${reason} : ${n} lignes`);
  console.log(
    `Communes avec station selon le seuil : ${Object.entries(p.byThreshold)
      .map(([k, n]) => `${k} km ${n}`)
      .join(", ")}`
  );
  const d = [...p.distances].sort((a, b) => a - b);
  console.log(
    `Distances (km) : médiane ${quantile(d, 0.5).toFixed(1)}, p90 ${quantile(d, 0.9).toFixed(1)}, max ${quantile(d, 1).toFixed(1)}`
  );
  console.log(`Outre-mer : ${p.overseas.established} établies sur ${p.overseas.communes} communes`);
  if (r.importId) console.log(`Lot BROUILLON ${r.importId} : ${r.rowsWritten} lignes écrites`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
