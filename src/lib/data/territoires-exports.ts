import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import {
  queryCommuneExportRows,
  queryDepartementExportRows,
  queryRegionExportRows,
  queryTerritoireReleases,
  type TerritoireRelease,
} from "@/lib/territoires/export-query";
import type {
  CommuneExportRow,
  DepartementExportRow,
  RegionExportRow,
} from "@/lib/territoires/exports";

/**
 * Cached readers of the Territoires CSV exports (#1052, lot 3.2). Same tags as the Territoires
 * pages (`src/lib/data/territoires.ts`), so the files and the pages refresh on the same purges.
 * Key space bounded: the department code is checked against `EXPORT_DEPARTMENT_CODES` by the
 * route before reaching this boundary.
 */
const TAGS = ["territoires", "politicians", "elections"] as const;

export async function getCommuneExportRows(departmentCode: string): Promise<CommuneExportRow[]> {
  "use cache";
  cacheLife("synced");
  cacheTag(...TAGS, `territoire:${departmentCode}`);
  return queryCommuneExportRows(departmentCode);
}

export async function getDepartementExportRows(): Promise<DepartementExportRow[]> {
  "use cache";
  cacheLife("synced");
  cacheTag(...TAGS);
  return queryDepartementExportRows();
}

export async function getRegionExportRows(): Promise<RegionExportRow[]> {
  "use cache";
  cacheLife("synced");
  cacheTag(...TAGS);
  return queryRegionExportRows();
}

/**
 * National releases written by `npm run territoires:release`. The script cannot purge a cache:
 * a new file appears with the next daily `politicians` purge, or at once after an operator
 * purge of `territoires`.
 */
export async function getTerritoireReleases(): Promise<TerritoireRelease[]> {
  "use cache";
  cacheLife("synced");
  cacheTag(...TAGS);
  return queryTerritoireReleases();
}
