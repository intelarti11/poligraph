/**
 * Read-only report on the open-data deliberation sources (#1052, lot 2). Writes nothing.
 *
 * Usage :
 *   npx tsx scripts/scdl-report.ts            (every configured source)
 *   npx tsx scripts/scdl-report.ts --source=la-possession
 */
import { SCDL_SOURCES } from "@/config/scdl-sources";
import { reportScdlSource } from "@/services/sync/scdl-deliberations";

async function main() {
  const only = process.argv.find((a) => a.startsWith("--source="))?.slice("--source=".length);
  const sources = SCDL_SOURCES.filter((s) => !only || s.key === only);
  if (!sources.length) throw new Error(`source inconnue : ${only}`);

  for (const source of sources) {
    const r = await reportScdlSource(source);
    console.log(`\n=== ${source.label} | ${r.datasetTitle} | licence : ${r.license ?? "inconnue"}`);
    const read = r.files.filter((f) => f.status === "lu");
    console.log(
      `  fichiers : ${r.files.length} (${read.length} lus, ${r.files.filter((f) => f.status === "erreur").length} en erreur, ${r.files.filter((f) => f.status === "ignoré").length} ignorés)`
    );
    console.log(
      `  conformes au schéma : ${read.filter((f) => f.conforming).length}/${read.length}`
    );
    for (const f of r.files.filter((f) => f.status !== "lu" || !f.conforming).slice(0, 5)) {
      console.log(`    - ${f.title.slice(0, 60)} | ${f.status} | ${f.detail ?? ""}`);
    }
    console.log(
      `  lignes retenues : ${r.candidates} | doublons : ${r.duplicates} | hors délibérations : ${r.excludedByActType}`
    );
    console.log(`  rejets : ${JSON.stringify(r.rejectsByReason)}`);
    console.log(`  période : ${r.dateRange ? r.dateRange.join(" au ") : "-"}`);
    console.log(
      `  remplissage : votes ${r.fill.votes} %, URL du document ${r.fill.documentUrl} %, matière ${r.fill.matiere} %, SIRET lisible ${r.fill.siret} %`
    );
    console.log(`  issue indicative : ${JSON.stringify(r.outcomeHints)}`);
    console.log("  collectivités (COLL_NOM) :");
    for (const a of r.authorities.slice(0, 8))
      console.log(`    ${a.rows} | ${a.name} | ${a.mapped}`);
    if (r.actTypes.length) {
      console.log("  types d'acte (TYPE_ACTE) :");
      for (const t of r.actTypes.slice(0, 12)) console.log(`    ${t.rows} | ${t.type}`);
    }
    if (r.matieres.length) {
      console.log("  matières :");
      for (const m of r.matieres.slice(0, 12)) console.log(`    ${m.rows} | ${m.code} | ${m.name}`);
    }
    for (const c of r.sample) {
      console.log(
        `  exemple L${c.line} : ${c.adoptionDate} | ${c.reference} | ${c.title.slice(0, 90)}`
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
