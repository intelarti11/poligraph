import { db } from "@/lib/db";
import {
  INTERCOMMUNALITES_PAGE_URL,
  INTERCOMMUNALITES_SYNC_KEY,
  intercommunaliteSourceLabel,
  intercommunalitesFileUrl,
} from "@/config/intercommunalites";
import { TERRITOIRES_HORS_REGION } from "@/config/regions";
import { USER_AGENT } from "@/config/site";
import {
  buildObservation,
  extractXlsx,
  parseInseeIntercoFile,
  planMemberships,
  type IntercoFileKind,
  type InseeIntercoFile,
  type ObservedMembership,
} from "./intercommunalites-parse";

/**
 * Import of the INSEE intercommunality files into `Intercommunalite` and the dated
 * `CommuneIntercommunalite` (#1052, lot 1.8). Idempotent: the same file twice changes nothing.
 * A membership the new file no longer lists is closed at the file's situation date, never
 * deleted. A file older than the last one imported is refused.
 */

export interface DepartmentLine {
  departmentCode: string;
  /** Communes of this department in the base. */
  inBase: number;
  /** Communes of the base the EPCI file attaches to an EPCI à fiscalité propre (or Lyon). */
  rattachees: number;
  /** Communes of the base the EPCI file lists as "Sans objet". */
  sansObjet: number;
  /** Communes of the base also in an EPT. */
  ept: number;
  /** Communes of the base absent from the source: their intercommunality stays not established. */
  absentesDeLaSource: number;
}

export interface IntercommunalitesReport {
  dryRun: boolean;
  /** False until the manual SQL has created the tables: the plan is then computed on empty ones. */
  tablesReady: boolean;
  situationDate: string;
  fileUrls: Record<IntercoFileKind, string>;
  bodiesByNature: Record<string, number>;
  bodiesToCreate: number;
  bodiesToUpdate: number;
  membershipsObserved: number;
  /** Source communes with no row in `Commune`: skipped, the foreign key would refuse them. */
  communesInconnues: string[];
  departments: DepartmentLine[];
  toCreate: number;
  toClose: number;
  toConfirm: number;
  anomalies: string[];
}

async function download(url: string): Promise<Buffer | null> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status} pour ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

/** The files of `year`, or of the year before when INSEE has not published them yet. */
async function fetchFiles(year: number | undefined): Promise<{
  epci: InseeIntercoFile;
  ept: InseeIntercoFile;
  urls: Record<IntercoFileKind, string>;
}> {
  const candidates = year ? [year] : [new Date().getUTCFullYear(), new Date().getUTCFullYear() - 1];
  for (const y of candidates) {
    const urls = {
      epci: intercommunalitesFileUrl("epci", y),
      ept: intercommunalitesFileUrl("ept", y),
    };
    const epciZip = await download(urls.epci);
    if (!epciZip) continue;
    const eptZip = await download(urls.ept);
    if (!eptZip) throw new Error(`Fichier EPCI ${y} publié sans fichier EPT : ${urls.ept}`);
    return {
      epci: parseInseeIntercoFile(extractXlsx(epciZip), "epci"),
      ept: parseInseeIntercoFile(extractXlsx(eptZip), "ept"),
      urls,
    };
  }
  throw new Error(`Aucun fichier INSEE trouvé pour ${candidates.join(" ou ")}`);
}

const CHUNK = 2_000;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

/** "01" < "2A" < "95" < "971" < "988". */
function departmentOrder(a: string, b: string): number {
  return a.localeCompare(b, "fr", { numeric: true });
}

export function buildDepartmentLines(
  communes: { id: string; departmentCode: string }[],
  memberships: ObservedMembership[]
): DepartmentLine[] {
  const byCommune = new Map<string, ObservedMembership[]>();
  for (const m of memberships) {
    const list = byCommune.get(m.communeCode) ?? [];
    list.push(m);
    byCommune.set(m.communeCode, list);
  }
  const lines = new Map<string, DepartmentLine>();
  for (const c of communes) {
    const line = lines.get(c.departmentCode) ?? {
      departmentCode: c.departmentCode,
      inBase: 0,
      rattachees: 0,
      sansObjet: 0,
      ept: 0,
      absentesDeLaSource: 0,
    };
    line.inBase++;
    const own = byCommune.get(c.id) ?? [];
    const epci = own.find((m) => m.kind === "epci");
    if (!epci) line.absentesDeLaSource++;
    else if (epci.siren) line.rattachees++;
    else line.sansObjet++;
    if (own.some((m) => m.kind === "ept")) line.ept++;
    lines.set(c.departmentCode, line);
  }
  return [...lines.values()].sort((a, b) => departmentOrder(a.departmentCode, b.departmentCode));
}

export async function syncIntercommunalites(options: {
  dryRun: boolean;
  year?: number;
}): Promise<IntercommunalitesReport> {
  const { epci, ept, urls } = await fetchFiles(options.year);
  const observation = buildObservation(epci, ept);
  const situation = observation.situationDate;
  const situationYear = situation.getUTCFullYear();

  const meta = await db.syncMetadata.findUnique({
    where: { sourceKey: INTERCOMMUNALITES_SYNC_KEY },
    select: { cursor: true },
  });
  if (meta?.cursor && new Date(meta.cursor).getTime() > situation.getTime()) {
    throw new Error(
      `Situation ${situation.toISOString().slice(0, 10)} antérieure à la dernière importée (${meta.cursor}) : refus`
    );
  }

  const communes = await db.commune.findMany({ select: { id: true, departmentCode: true } });
  const known = new Set(communes.map((c) => c.id));
  const communesInconnues = [
    ...new Set(
      observation.memberships.filter((m) => !known.has(m.communeCode)).map((m) => m.communeCode)
    ),
  ].sort();
  const observed = observation.memberships.filter((m) => known.has(m.communeCode));

  // Before the manual SQL is applied, a dry run still reports what the source holds.
  const regclass = await db.$queryRaw<{ ready: boolean }[]>`
    SELECT to_regclass('public."CommuneIntercommunalite"') IS NOT NULL AS ready`;
  const ready = regclass[0]?.ready === true;
  if (!ready && !options.dryRun) {
    throw new Error(
      "Tables absentes : appliquer prisma/migrations/manual/2026-10-11-intercommunalites.sql"
    );
  }

  const existingBodies = ready
    ? await db.intercommunalite.findMany({ select: { siren: true, name: true, nature: true } })
    : [];
  const existingBySiren = new Map(existingBodies.map((b) => [b.siren, b]));
  const bodiesToCreate = observation.bodies.filter((b) => !existingBySiren.has(b.siren));
  const bodiesToUpdate = observation.bodies.filter((b) => {
    const e = existingBySiren.get(b.siren);
    return e && (e.name !== b.name || e.nature !== b.nature);
  });

  const open = ready
    ? await db.communeIntercommunalite.findMany({
        where: { validTo: null },
        select: { id: true, communeId: true, siren: true },
      })
    : [];
  const plan = planMemberships(open, observed);

  const bodiesByNature: Record<string, number> = {};
  for (const b of observation.bodies)
    bodiesByNature[b.nature] = (bodiesByNature[b.nature] ?? 0) + 1;

  const report: IntercommunalitesReport = {
    dryRun: options.dryRun,
    tablesReady: ready,
    situationDate: situation.toISOString().slice(0, 10),
    fileUrls: urls,
    bodiesByNature,
    bodiesToCreate: bodiesToCreate.length,
    bodiesToUpdate: bodiesToUpdate.length,
    membershipsObserved: observed.length,
    communesInconnues,
    departments: buildDepartmentLines(communes, observed),
    toCreate: plan.toCreate.length,
    toClose: plan.toClose.length,
    toConfirm: plan.toConfirm.length,
    anomalies: observation.anomalies,
  };
  if (options.dryRun) return report;

  const source = (kind: IntercoFileKind) => ({
    sourceLabel: intercommunaliteSourceLabel(kind, situationYear),
    sourceUrl: INTERCOMMUNALITES_PAGE_URL,
  });

  // Bodies first: memberships reference them.
  await db.intercommunalite.createMany({
    data: bodiesToCreate.map((b) => ({
      siren: b.siren,
      name: b.name,
      nature: b.nature,
      ...source(b.kind),
      situationDate: situation,
    })),
    skipDuplicates: true,
  });
  for (const b of bodiesToUpdate) {
    await db.intercommunalite.update({
      where: { siren: b.siren },
      data: { name: b.name, nature: b.nature },
    });
  }
  for (const kind of ["epci", "ept"] as const) {
    const sirens = observation.bodies.filter((b) => b.kind === kind).map((b) => b.siren);
    await db.intercommunalite.updateMany({
      where: { siren: { in: sirens } },
      data: { ...source(kind), situationDate: situation },
    });
  }

  for (const batch of chunks(plan.toClose)) {
    await db.communeIntercommunalite.updateMany({
      where: { id: { in: batch.map((o) => o.id) }, validTo: null },
      data: { validTo: situation },
    });
  }
  for (const batch of chunks(plan.toConfirm)) {
    await db.communeIntercommunalite.updateMany({
      where: { id: { in: batch.map((o) => o.id) } },
      data: { situationDate: situation },
    });
  }
  for (const batch of chunks(plan.toCreate)) {
    await db.communeIntercommunalite.createMany({
      data: batch.map((m) => ({
        communeId: m.communeCode,
        siren: m.siren,
        validFrom: situation,
        situationDate: situation,
        ...source(m.kind),
      })),
      skipDuplicates: true,
    });
  }

  await db.syncMetadata.upsert({
    where: { sourceKey: INTERCOMMUNALITES_SYNC_KEY },
    create: {
      sourceKey: INTERCOMMUNALITES_SYNC_KEY,
      lastSyncAt: new Date(),
      cursor: report.situationDate,
      itemCount: observed.length,
    },
    update: { lastSyncAt: new Date(), cursor: report.situationDate, itemCount: observed.length },
  });

  return report;
}

/** Overseas departments and collectivities, for the detailed lines of the report. */
export function isOutreMer(departmentCode: string): boolean {
  return departmentCode.startsWith("97") || departmentCode in TERRITOIRES_HORS_REGION;
}
