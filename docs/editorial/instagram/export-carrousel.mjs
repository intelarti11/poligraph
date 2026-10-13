/**
 * Export d'un carrousel Instagram depuis un kit `.dc.html`, en 1080 x 1350.
 *
 *   node export-carrousel.mjs <kit.dc.html> <dossier-de-sortie> [préfixe-des-slides]
 *
 * Exemples :
 *   node export-carrousel.mjs "post-01…/Instagram Kit.dc.html" "post-01…/export" 07-
 *   node export-carrousel.mjs "post-epingle…/Post-instagram-poligraph.dc.html" "post-epingle…/export"
 *
 * Trois gardes, chacune née d'un défaut réellement rencontré :
 *
 * 1. La police. Outfit porte les titres et vient de Google Fonts ; sa requête peut être abandonnée.
 *    Le style calculé continue alors d'annoncer « Outfit » pendant que le navigateur rend une
 *    police système, et un PNG ne trahit rien. On refuse d'exporter dans ce cas.
 * 2. Le dossier. Un dédoublement de slide avait laissé un fichier périmé à côté de ses
 *    remplaçants : publier le dossier entier publiait une slide morte. Le dossier est vidé, puis
 *    recompté. Vérifier ce qu'on produit ne suffit pas, il faut vérifier ce qui reste.
 * 3. Le nommage. Instagram trie par nom de fichier : les slides sortent numérotées par rang, pas
 *    par étiquette, sinon « 04 » se glisse avant « 04a ».
 *
 * Le script écrit aussi un `ALT.md` à côté du dossier d'export. Nos slides sont du texte cuit dans
 * un PNG : sans texte alternatif, tout ce que porte la slide disparaît pour qui ne voit pas
 * l'image, et Instagram n'écrit alors que la date de prise de vue. Le fichier se remplit à la
 * publication, une entrée par slide, dans l'ordre.
 */
import { chromium } from "playwright";
import { rmSync, mkdirSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";

// --alt : n'écrit que le texte alternatif. Sert à rattraper un post déjà publié, dont
// les PNG ne doivent surtout pas être régénérés.
const altSeul = process.argv.includes("--alt");
const [kitArg, outArg, prefixe = ""] = process.argv.slice(2).filter((a) => a !== "--alt");
if (!kitArg || !outArg) {
  console.error("usage : node export-carrousel.mjs <kit.dc.html> <dossier-de-sortie> [préfixe]");
  process.exit(1);
}
const KIT_PATH = resolve(kitArg);
const OUT = resolve(outArg);
if (!existsSync(KIT_PATH)) {
  console.error(`kit introuvable : ${KIT_PATH}`);
  process.exit(1);
}

if (!altSeul) {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1300, height: 1500 },
  deviceScaleFactor: 1,
});
const echecs = [];
page.on("requestfailed", (r) => echecs.push(r.url().split("/").pop()));

await page.goto(`file://${KIT_PATH.replace(/ /g, "%20")}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

async function policePrete() {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() =>
    [...document.fonts].some((f) => f.family === "Outfit" && f.status === "loaded")
  );
}
let prete = await policePrete();
for (let essai = 1; !prete && essai <= 3; essai++) {
  console.log(`Outfit absente, rechargement (essai ${essai})`);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  prete = await policePrete();
}
if (!prete) {
  console.error("ABANDON : Outfit non chargée, l'export sortirait en police de repli.");
  await browser.close();
  process.exit(1);
}
console.log("Outfit chargée\n");

const cadres = await page.evaluate((p) => {
  const out = [];
  for (const n of document.querySelectorAll("[data-screen-label]")) {
    const label = n.getAttribute("data-screen-label");
    if (p && !label.startsWith(p)) continue;
    const r = n.getBoundingClientRect();
    out.push({
      label,
      w: Math.round(r.width),
      h: Math.round(r.height),
      images: [...n.querySelectorAll("img")].map((i) => ({
        src: i.getAttribute("src"),
        ok: i.complete && i.naturalWidth > 0,
      })),
      // Reliquats d'atelier qui ne doivent jamais partir en publication.
      atelier: /à remplacer|placeholder|Lorem/i.test(n.textContent || ""),
      // Le texte de la slide, dans l'ordre de lecture, pour le texte alternatif.
      // On descend jusqu'au dernier conteneur de bloc : un <b> ou un <span> inline
      // reste soudé à sa phrase, une carte ou un paragraphe fait une unité à part.
      unites: (() => {
        const u = [];
        const bloc = (el) => {
          const d = getComputedStyle(el).display;
          return d !== "inline" && d !== "inline-block" && d !== "contents";
        };
        const propre = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
        const walk = (el) => {
          const sousBlocs = [...el.children].filter((c) => bloc(c) && propre(c));
          if (!sousBlocs.length) {
            const t = propre(el);
            if (t) u.push(t);
            return;
          }
          for (const c of el.childNodes) {
            if (c.nodeType === 3) {
              const t = c.textContent.replace(/\s+/g, " ").trim();
              if (t) u.push(t);
            } else if (c.nodeType === 1) {
              if (bloc(c)) walk(c);
              else {
                const t = propre(c);
                if (t) u.push(t);
              }
            }
          }
        };
        walk(n);
        return u;
      })(),
    });
  }
  return out;
}, prefixe);

if (!cadres.length) {
  console.error(`aucun cadre ne correspond au préfixe « ${prefixe} »`);
  await browser.close();
  process.exit(1);
}

let souci = 0;
for (const [i, f] of cadres.entries()) {
  const taille = f.w === 1080 && f.h === 1350 ? "1080x1350" : `!! ${f.w}x${f.h}`;
  const cassees = f.images.filter((im) => !im.ok).map((im) => im.src);
  if (!taille.startsWith("1080") || cassees.length || f.atelier) souci++;
  console.log(
    `${String(i + 1).padStart(2)}. ${f.label.padEnd(18)} ${taille}` +
      (f.images.length
        ? `  images ${f.images.filter((im) => im.ok).length}/${f.images.length}`
        : "") +
      (cassees.length ? `  CASSÉES: ${cassees.join(",")}` : "") +
      (f.atelier ? "  RELIQUAT D'ATELIER" : "")
  );
  if (!altSeul) {
    await page
      .locator(`[data-screen-label="${f.label}"]`)
      .screenshot({ path: `${OUT}/${i + 1}.png` });
  }
}

// --- Texte alternatif -------------------------------------------------------
// Le filigrane de marque et l'indice de défilement se répètent sur chaque slide et
// n'apprennent rien à qui écoute la publication : ils sortent. Le numéro d'étape se
// recolle à son intitulé, sinon le lecteur d'écran énonce un « 1 » orphelin.
const BRUIT = /^(poligraph|poligraph\.fr(\/\S*)?|@poligraph_fr|faites glisser\s*→?)$/i;
const ponctue = (t) => (/[.!?:»]$/.test(t) ? t : `${t}.`);

const alt = cadres.map((f, i) => {
  const gardees = [];
  const rejetees = [];
  for (const t of f.unites) (BRUIT.test(t) ? rejetees : gardees).push(t);
  const fusion = [];
  for (const t of gardees) {
    if (/^\d{1,2}$/.test(t)) fusion.push({ num: t, txt: null });
    else if (fusion.length && fusion.at(-1).num && fusion.at(-1).txt === null)
      fusion.at(-1).txt = t;
    else fusion.push({ num: null, txt: t });
  }
  const texte = fusion
    .map((e) => (e.num ? `${e.num}. ${ponctue(e.txt ?? "")}` : ponctue(e.txt)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return { rang: i + 1, label: f.label, texte, rejetees };
});

// Une entrée relue à la main vaut mieux que l'extraction : quand un ALT.md existe déjà,
// on écrit à côté au lieu de l'écraser. Le réexport ne doit jamais coûter une relecture.
const nomPost = basename(dirname(OUT));
const dejaLa = existsSync(`${dirname(OUT)}/ALT.md`);
const ALT = `${dirname(OUT)}/${dejaLa ? "ALT.nouveau.md" : "ALT.md"}`;
writeFileSync(
  ALT,
  [
    `# Texte alternatif : ${nomPost}`,
    "",
    "Une entrée par slide, dans l'ordre de publication. À coller dans le champ de texte",
    "alternatif d'Instagram, slide par slide, au moment de la publication.",
    "",
    "Ces slides sont du texte cuit dans un PNG. Sans ce champ, Instagram écrit lui-même",
    "la date de prise de vue et tout le contenu disparaît pour qui n'accède pas à l'image.",
    "",
    "Le texte ci-dessous est extrait du kit, donc fidèle mais littéral. Relire chaque entrée :",
    "une slide dont le sens tient à la mise en page peut demander une phrase réécrite.",
    "",
    ...alt.flatMap((a) => [
      `## ${a.rang}.png : ${a.label}`,
      "",
      "```",
      a.texte,
      "```",
      "",
      `${a.texte.length} caractères.` +
        (a.rejetees.length ? ` Retiré : ${a.rejetees.join(", ")}.` : ""),
      "",
    ]),
  ].join("\n"),
  "utf-8"
);
console.log(
  `\ntexte alternatif : ${ALT}${dejaLa ? "  (ALT.md existe déjà, à comparer puis supprimer)" : ""}`
);
for (const a of alt)
  console.log(
    `  ${a.rang}.png  ${String(a.texte.length).padStart(4)} car.  ${a.texte.slice(0, 58)}…`
  );

const fichiers = altSeul ? [] : readdirSync(OUT).filter((n) => n.endsWith(".png"));
console.log(
  `\nressources en échec : ${echecs.length ? [...new Set(echecs)].join(", ") : "aucune"}`
);
if (!altSeul) {
  console.log(`fichiers écrits : ${fichiers.length} pour ${cadres.length} slides`);
  if (fichiers.length !== cadres.length)
    console.error("!! le dossier contient des fichiers en trop");
}
console.log(souci ? `${souci} slide(s) à revoir` : `les ${cadres.length} slides sont conformes`);

await browser.close();
process.exit(souci || (!altSeul && fichiers.length !== cadres.length) ? 1 : 0);
