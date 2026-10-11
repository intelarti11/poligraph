import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type {
  DatePrecision,
  DecisionOutcome,
  InstitutionKind,
  TerritorialSourceKind,
} from "@/generated/prisma";
import { db } from "@/lib/db";
import { PUBLIC_POLITICIAN_PUBLICATION_STATUS } from "@/lib/api/public-contract";
import { normalizeInseeCode } from "@/lib/data/territoires";
import {
  groupDecisionsByPeriod,
  type DecisionPeriods,
  type MayorMandate,
} from "@/lib/territoires/decision-periods";

/**
 * Public read of the curated decisions of a commune (#1052, lot 2). PUBLISHED notices only: a
 * draft, a notice in review or a rejected one never leaves the admin.
 *
 * Bounded: the pilot covers a dozen communes and a documented selection of acts. Past the cap
 * the page says the list is truncated rather than loading without limit.
 */
export const COMMUNE_DECISIONS_CAP = 200;
const MAYOR_MANDATES_CAP = 50;

export interface PublicDecision {
  id: string;
  title: string;
  reference: string | null;
  adoptionDate: Date;
  adoptionDatePrecision: DatePrecision;
  publicationDate: Date | null;
  effectiveDate: Date | null;
  outcome: DecisionOutcome;
  outcomeWording: string | null;
  reviewedAt: Date | null;
  institution: { kind: InstitutionKind; name: string };
  source: {
    kind: TerritorialSourceKind;
    title: string;
    producer: string;
    url: string;
    archiveUrl: string | null;
    lastVerifiedAt: Date;
  };
  sourceLocator: string;
}

export interface CommuneDecisions {
  commune: { inseeCode: string; name: string };
  /** Municipal council decisions, placed in mayor periods. */
  periods: DecisionPeriods<PublicDecision>;
  /** Intercommunal council decisions concerning the commune: never placed under a mayor. */
  intercommunal: PublicDecision[];
  total: number;
  truncated: boolean;
}

const PUBLISHED = "PUBLISHED" as const;

/** Null when the commune does not exist or has no published decision: the page then 404s. */
export async function getCommuneDecisions(code: string): Promise<CommuneDecisions | null> {
  const inseeCode = normalizeInseeCode(code);
  if (!inseeCode) return null;
  return readCommuneDecisions(inseeCode);
}

async function readCommuneDecisions(inseeCode: string): Promise<CommuneDecisions | null> {
  "use cache";
  cacheLife("synced");
  cacheTag("territoires", "politicians", `territoire:${inseeCode}`);

  const total = await db.decision.count({ where: { communeId: inseeCode, status: PUBLISHED } });
  if (total === 0) return null;

  const [commune, rows, mandates] = await Promise.all([
    db.commune.findUnique({ where: { id: inseeCode }, select: { id: true, name: true } }),
    db.decision.findMany({
      where: { communeId: inseeCode, status: PUBLISHED },
      orderBy: { adoptionDate: "desc" },
      take: COMMUNE_DECISIONS_CAP,
      select: {
        id: true,
        title: true,
        reference: true,
        adoptionDate: true,
        adoptionDatePrecision: true,
        publicationDate: true,
        effectiveDate: true,
        outcome: true,
        outcomeWording: true,
        reviewedAt: true,
        sourceLocator: true,
        institution: { select: { kind: true, name: true } },
        source: {
          select: {
            kind: true,
            title: true,
            producer: true,
            url: true,
            archiveUrl: true,
            lastVerifiedAt: true,
          },
        },
      },
    }),
    db.mandate.findMany({
      where: { type: "MAIRE", localData: { communeId: inseeCode } },
      orderBy: { startDate: "asc" },
      take: MAYOR_MANDATES_CAP,
      select: {
        id: true,
        politicianId: true,
        startDate: true,
        endDate: true,
        isCurrent: true,
        politician: { select: { fullName: true, slug: true, publicationStatus: true } },
      },
    }),
  ]);
  if (!commune) return null;

  const mayorMandates: MayorMandate[] = mandates.map((m) => ({
    mandateId: m.id,
    politicianId: m.politicianId,
    person:
      m.politician.publicationStatus === PUBLIC_POLITICIAN_PUBLICATION_STATUS
        ? { fullName: m.politician.fullName, slug: m.politician.slug }
        : null,
    startDate: m.startDate,
    endDate: m.endDate,
    isCurrent: m.isCurrent,
  }));

  const municipal = rows.filter((d) => d.institution.kind === "CONSEIL_MUNICIPAL");
  const intercommunal = rows.filter((d) => d.institution.kind === "CONSEIL_COMMUNAUTAIRE");

  return {
    commune: { inseeCode: commune.id, name: commune.name },
    // Mandates are counted before the public filter: a non-public mayor still occupies the
    // period, so the decisions under it stay unestablished instead of moving to a neighbour.
    periods: groupDecisionsByPeriod(municipal, mayorMandates),
    intercommunal,
    total,
    truncated: total > rows.length,
  };
}
