/**
 * Relève les tailles de texte réellement rendues dans chaque slide d'un kit.
 *
 *   node audit-typo.mjs <kit.dc.html> [préfixe]
 *
 * Le kit fixe un plancher : jamais moins de 24 px, corps 30 à 38, légendes 26. Une slide peut
 * respecter le plancher et rester illisible une fois affichée sur un téléphone : 1080 px de large
 * s'affichent autour de 400 px, donc un texte de 26 px se lit vers 10 px réels. La colonne
 * « ~tel. » donne cette taille apparente.
 */
import { chromium } from "playwright";
import { resolve } from "node:path";

const [kitArg, prefixe = ""] = process.argv.slice(2);
if (!kitArg) {
  console.error("usage : node audit-typo.mjs <kit.dc.html> [préfixe]");
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1300, height: 1500 } });
await page.goto(`file://${resolve(kitArg).replace(/ /g, "%20")}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.evaluate(() => document.fonts.ready);

const releve = await page.evaluate((p) => {
  const out = [];
  for (const cadre of document.querySelectorAll("[data-screen-label]")) {
    const label = cadre.getAttribute("data-screen-label");
    if (p && !label.startsWith(p)) continue;
    const textes = [];
    for (const n of cadre.querySelectorAll("*")) {
      // Seuls les nœuds qui portent eux-mêmes du texte, pas leurs conteneurs.
      const propre = [...n.childNodes]
        .filter((c) => c.nodeType === 3)
        .map((c) => c.textContent.trim())
        .join(" ")
        .trim();
      if (!propre) continue;
      const r = n.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      textes.push({
        px: Math.round(parseFloat(getComputedStyle(n).fontSize)),
        t: propre.slice(0, 46),
      });
    }
    out.push({ label, textes });
  }
  return out;
}, prefixe);

const PLANCHER = 24;
let alertes = 0;
for (const c of releve) {
  const tailles = c.textes.map((t) => t.px);
  const min = Math.min(...tailles);
  console.log(`\n${c.label}  (min ${min}px, ${c.textes.length} blocs)`);
  for (const t of c.textes.sort((a, b) => a.px - b.px).slice(0, 5)) {
    const tel = (t.px * 0.37).toFixed(1); // 1080 px affichés ~400 px de large
    const drapeau = t.px < PLANCHER ? "  << SOUS LE PLANCHER" : t.px <= 26 ? "  < petit" : "";
    if (t.px < PLANCHER) alertes++;
    console.log(`   ${String(t.px).padStart(3)}px  ~tel. ${tel}px  « ${t.t} »${drapeau}`);
  }
}
console.log(
  alertes
    ? `\n${alertes} bloc(s) sous le plancher de ${PLANCHER}px`
    : `\nplancher de ${PLANCHER}px respecté partout`
);
await browser.close();
