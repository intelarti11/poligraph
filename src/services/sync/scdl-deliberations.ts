import { checkPublicUrl } from "@/lib/api/fetch-public-photo";
import { USER_AGENT } from "@/config/site";
import { isCouncilActType, type ScdlSource } from "@/config/scdl-sources";
import { parseScdlFile, type RejectReason, type ScdlCandidate } from "./scdl-deliberations-parse";

/**
 * Read-only report on an open-data deliberation source (#1052, lot 2). Downloads the files of a
 * data.gouv.fr dataset, parses them, and says what a notice import would keep and reject. Nothing
 * is written: the protocol of the decisions is not published, and no notice may be entered
 * before it is.
 */

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const DATASET_API = "https://www.data.gouv.fr/api/1/datasets/";

interface DatasetResource {
  title?: string;
  url?: string;
  format?: string;
}

export interface ScdlReport {
  source: string;
  datasetTitle: string;
  license: string | null;
  files: Array<{
    title: string;
    format: string;
    status: "lu" | "ignoré" | "erreur";
    detail?: string;
    conforming?: boolean;
    encoding?: string;
    delimiter?: string;
    lines?: number;
  }>;
  candidates: number;
  rejectsByReason: Partial<Record<RejectReason, number>>;
  duplicates: number;
  /** Rows left out because their `TYPE_ACTE` is not a council deliberation. */
  excludedByActType: number;
  dateRange: [string, string] | null;
  /** Share of candidates (0 to 100) with each optional field filled. */
  fill: { votes: number; documentUrl: number; matiere: number; siret: number };
  outcomeHints: Record<string, number>;
  /** `COLL_NOM` values met, how many rows each, and whether the config maps them to a council. */
  authorities: Array<{
    name: string;
    rows: number;
    mapped: "conseil" | "hors-périmètre" | "non-mappé";
  }>;
  matieres: Array<{ code: string; name: string; rows: number }>;
  /** Rows per `TYPE_ACTE`; empty for a file without that column. */
  actTypes: Array<{ type: string; rows: number }>;
  sample: ScdlCandidate[];
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`HTTP ${response.status} pour ${url}`);
  return (await response.json()) as T;
}

const MAX_REDIRECTS = 3;

/** Follows redirects by hand so every hop is checked against internal addresses (SSRF). */
async function download(rawUrl: string): Promise<Buffer> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = await checkPublicUrl(current);
    if (!(checked instanceof URL)) throw new Error(`adresse refusée : ${checked.reason}`);
    const response = await fetch(checked, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`HTTP ${response.status} sans destination`);
      current = new URL(location, checked).toString();
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_FILE_BYTES)
      throw new Error(`fichier de ${declared} octets, au-delà de la limite`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_FILE_BYTES) throw new Error("fichier au-delà de la limite");
    return buffer;
  }
  throw new Error("trop de redirections");
}

export async function reportScdlSource(source: ScdlSource): Promise<ScdlReport> {
  const dataset = await getJson<{
    title: string;
    license: string | null;
    resources: DatasetResource[];
  }>(`${DATASET_API}${source.datasetId}/`);

  const report: ScdlReport = {
    source: source.key,
    datasetTitle: dataset.title,
    license: dataset.license,
    files: [],
    candidates: 0,
    rejectsByReason: {},
    duplicates: 0,
    excludedByActType: 0,
    dateRange: null,
    fill: { votes: 0, documentUrl: 0, matiere: 0, siret: 0 },
    outcomeHints: {},
    authorities: [],
    matieres: [],
    actTypes: [],
    sample: [],
  };

  const all: ScdlCandidate[] = [];
  const authorityRows = new Map<string, number>();
  const actTypeRows = new Map<string, number>();

  for (const resource of dataset.resources) {
    const title = resource.title ?? "(sans titre)";
    const format = (resource.format ?? "").toLowerCase();
    if (
      format !== "csv" ||
      !resource.url ||
      (source.resourceTitleContains &&
        !title.toLowerCase().includes(source.resourceTitleContains.toLowerCase()))
    ) {
      report.files.push({
        title,
        format,
        status: "ignoré",
        detail: format !== "csv" ? "format" : "titre",
      });
      continue;
    }
    try {
      const parsed = parseScdlFile(await download(resource.url));
      report.files.push({
        title,
        format,
        status: "lu",
        conforming: parsed.conformingHeaders,
        encoding: parsed.encoding,
        delimiter: parsed.delimiter,
        lines: parsed.linesRead,
        detail: parsed.conformingHeaders
          ? undefined
          : `colonnes absentes : ${parsed.missingColumns.join(", ")}`,
      });
      for (const r of parsed.rejects) {
        report.rejectsByReason[r.reason] = (report.rejectsByReason[r.reason] ?? 0) + 1;
      }
      report.duplicates += parsed.duplicates;
      for (const c of parsed.candidates) {
        // Counted before the filter: the excluded types stay visible to audit it.
        if (c.actType) actTypeRows.set(c.actType, (actTypeRows.get(c.actType) ?? 0) + 1);
        if (!isCouncilActType(source, c.actType)) {
          report.excludedByActType++;
          continue;
        }
        all.push(c);
        authorityRows.set(c.authorityName, (authorityRows.get(c.authorityName) ?? 0) + 1);
      }
    } catch (error) {
      report.files.push({
        title,
        format,
        status: "erreur",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  report.candidates = all.length;
  const pct = (n: number) => (all.length ? Math.round((n * 100) / all.length) : 0);
  report.fill = {
    votes: pct(all.filter((c) => c.votes.pour != null && c.votes.contre != null).length),
    documentUrl: pct(all.filter((c) => c.documentUrl).length),
    matiere: pct(all.filter((c) => c.matiereCode).length),
    siret: pct(all.filter((c) => c.siret).length),
  };
  const dates = all.map((c) => c.adoptionDate).sort();
  report.dateRange = dates.length ? [dates[0]!, dates[dates.length - 1]!] : null;
  for (const c of all) {
    const k = c.outcomeHint ?? "non déduite";
    report.outcomeHints[k] = (report.outcomeHints[k] ?? 0) + 1;
  }
  report.authorities = [...authorityRows.entries()]
    .map(([name, rows]) => {
      const found = source.authorities.find((a) => a.name === name);
      const mapped = !found ? "non-mappé" : found.institution ? "conseil" : "hors-périmètre";
      return { name, rows, mapped: mapped as "conseil" | "hors-périmètre" | "non-mappé" };
    })
    .sort((a, b) => b.rows - a.rows);

  const matieres = new Map<string, { name: string; rows: number }>();
  for (const c of all) {
    if (!c.matiereCode) continue;
    const m = matieres.get(c.matiereCode) ?? { name: c.matiereName ?? "", rows: 0 };
    m.rows++;
    matieres.set(c.matiereCode, m);
  }
  report.matieres = [...matieres.entries()]
    .map(([code, m]) => ({ code, ...m }))
    .sort((a, b) => b.rows - a.rows)
    .slice(0, 20);
  report.actTypes = [...actTypeRows.entries()]
    .map(([type, rows]) => ({ type, rows }))
    .sort((a, b) => b.rows - a.rows);
  report.sample = all.slice(0, 3);
  return report;
}
