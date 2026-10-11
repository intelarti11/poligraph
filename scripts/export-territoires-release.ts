/**
 * Publie la version datée du fichier national des communes (rubrique Territoires, lot 3.2).
 *
 * Le fichier national dépasse la limite de 4,5 Mo d'une réponse de fonction Vercel (10,3 Mo
 * mesurés le 11 octobre 2026) : il ne passe pas par une route. Ce script le construit avec le
 * même code que l'export par département (`queryCommuneExportRows`), le dépose sur Vercel Blob
 * sous un nom daté qu'il ne réécrit jamais, puis l'enregistre dans `SyncMetadata` (clé
 * `territoires-release:communes:<jour>`, nombre de lignes, empreinte SHA-256, taille, URL).
 * La page /territoires/donnees liste ces versions.
 *
 * Usage :
 *   npm run territoires:release -- --dry-run [--out fichier.csv]   (lecture seule)
 *   npm run territoires:release            (variables : DATABASE_URL, BLOB_READ_WRITE_TOKEN)
 *
 * Une seule version par jour : relancer le même jour échoue sans rien écrire.
 */

import "dotenv/config";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { put } from "@vercel/blob";
import { db } from "../src/lib/db";
import { toCSV } from "../src/lib/csv";
import { queryCommuneExportRows } from "../src/lib/territoires/export-query";
import {
  COMMUNE_COLUMNS,
  RELEASE_BLOB_PREFIX,
  RELEASE_KEY_PREFIX,
  releaseFileName,
} from "../src/lib/territoires/exports";

/** Day in Paris, so a run at 00:30 is not filed under the previous day. */
function parisDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(date);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const outIndex = args.indexOf("--out");
  const out = outIndex >= 0 ? args[outIndex + 1] : undefined;

  const now = new Date();
  const day = parisDay(now);
  const sourceKey = `${RELEASE_KEY_PREFIX}${day}`;

  const existing = await db.syncMetadata.findUnique({ where: { sourceKey } });
  if (existing) {
    throw new Error(`Une version du ${day} existe déjà (${sourceKey}). Rien n'a été écrit.`);
  }

  const rows = await queryCommuneExportRows(null);
  const body = Buffer.from("﻿" + toCSV(rows, COMMUNE_COLUMNS, { neutralizeFormulas: true }));
  const sha256 = createHash("sha256").update(body).digest("hex");
  const pathname = `${RELEASE_BLOB_PREFIX}${releaseFileName(day)}`;

  const states = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.maire_etat] = (acc[r.maire_etat] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`Fichier : ${pathname}`);
  console.log(`Lignes : ${rows.length}, octets : ${body.length}, SHA-256 : ${sha256}`);
  console.log(`Maires : ${JSON.stringify(states)}`);

  if (dryRun) {
    if (out) {
      writeFileSync(out, body);
      console.log(`Écrit localement : ${out}`);
    }
    console.log("Simulation : rien n'a été déposé ni enregistré.");
    return;
  }

  // allowOverwrite false: a dated file is immutable, a second upload under the same name fails.
  const blob = await put(pathname, body, {
    access: "public",
    contentType: "text/csv; charset=utf-8",
    addRandomSuffix: false,
    allowOverwrite: false,
  });

  await db.syncMetadata.create({
    data: {
      sourceKey,
      lastSyncAt: now,
      itemCount: rows.length,
      contentHash: sha256,
      extra: { url: blob.downloadUrl, pathname: blob.pathname, byteSize: body.length },
    },
  });
  console.log(`Publié : ${blob.downloadUrl}`);
  console.log(
    "La page /territoires/donnees l'affichera après la prochaine purge « politicians » ou une purge « territoires »."
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
