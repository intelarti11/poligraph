import { chromium } from "playwright";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const [kitArg, outArg] = process.argv.slice(2);
if (!kitArg || !outArg) {
  console.error("usage : node export-story.mjs <kit.html> <dossier-de-sortie>");
  process.exit(1);
}

const kit = resolve(kitArg);
const out = resolve(outArg);
if (!existsSync(kit)) {
  console.error(`kit introuvable : ${kit}`);
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1300, height: 2100 },
  deviceScaleFactor: 1,
});
const failed = [];
page.on("requestfailed", (request) => failed.push(request.url()));

await page.goto(`file://${kit.replace(/ /g, "%20")}`, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);

const outfitReady = await page.evaluate(() =>
  [...document.fonts].some((font) => font.family === "Outfit" && font.status === "loaded")
);
if (!outfitReady) {
  console.error("ABANDON : la police Outfit n’est pas chargée.");
  await browser.close();
  process.exit(1);
}

const frames = await page.locator("[data-screen-label]").all();
let invalid = 0;
for (const [index, frame] of frames.entries()) {
  const box = await frame.boundingBox();
  const label = await frame.getAttribute("data-screen-label");
  const ok = Math.round(box?.width ?? 0) === 1080 && Math.round(box?.height ?? 0) === 1920;
  // A template placeholder left in a screen must never be published.
  const leftover = /à remplacer/i.test((await frame.textContent()) ?? "");
  if (!ok || leftover) invalid += 1;
  console.log(
    `${index + 1}. ${label} ${ok ? "1080x1920" : "TAILLE INVALIDE"}${leftover ? "  TEXTE DU GABARIT" : ""}`
  );
  await frame.screenshot({ path: `${out}/${index + 1}.png` });
}

const pngs = readdirSync(out).filter((name) => name.endsWith(".png"));
console.log(`ressources en échec : ${failed.length ? failed.join(", ") : "aucune"}`);
console.log(`fichiers écrits : ${pngs.length} pour ${frames.length} écrans`);

await browser.close();
process.exit(invalid || pngs.length !== frames.length ? 1 : 0);
