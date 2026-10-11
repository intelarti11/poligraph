import type { CurationStatus, InstitutionKind } from "@/generated/prisma";
import { db } from "@/lib/db";
import { revalidateTags } from "@/lib/cache";
import type { RequestMeta } from "@/lib/security/audit";
import type {
  CreateInstitutionInput,
  DecisionInput,
  DecisionTransitionInput,
  TerritorialSourceInput,
} from "@/lib/security/schemas/decision-territoriale";

/**
 * Writes on curated territorial decisions (#1052, lot 2). The only module that changes a
 * Decision: the admin routes validate the body and call it, nothing else.
 *
 * Invariants:
 * - a notice is edited only while DRAFT, so what a reviewer approved is what gets published;
 * - publication goes through IN_REVIEW and names its reviewer;
 * - every write and every transition lands in AuditLog in the same transaction;
 * - a decision is never attached to a person: the institution and the dates carry it.
 */

export type DecisionTransitionAction = DecisionTransitionInput["action"];

const TRANSITIONS: Record<DecisionTransitionAction, { from: CurationStatus; to: CurationStatus }> =
  {
    SUBMIT: { from: "DRAFT", to: "IN_REVIEW" },
    RETURN_TO_DRAFT: { from: "IN_REVIEW", to: "DRAFT" },
    PUBLISH: { from: "IN_REVIEW", to: "PUBLISHED" },
    REJECT: { from: "IN_REVIEW", to: "REJECTED" },
    UNPUBLISH: { from: "PUBLISHED", to: "DRAFT" },
    REOPEN: { from: "REJECTED", to: "DRAFT" },
  };

/** The status an action leads to from `current`, or null when the action is not allowed. */
export function resolveTransition(
  current: CurationStatus,
  action: DecisionTransitionAction
): CurationStatus | null {
  const rule = TRANSITIONS[action];
  return rule.from === current ? rule.to : null;
}

/** Actions offered from a status, in display order. */
export function availableTransitions(current: CurationStatus): DecisionTransitionAction[] {
  return (Object.keys(TRANSITIONS) as DecisionTransitionAction[]).filter(
    (action) => TRANSITIONS[action].from === current
  );
}

/** What an action needs beyond the status. Null when the input is complete. */
export function missingTransitionInput(input: DecisionTransitionInput): string | null {
  if (input.action === "PUBLISH" && !input.reviewedBy) {
    return "La publication exige le nom de la personne qui a relu la notice contre sa source.";
  }
  if ((input.action === "REJECT" || input.action === "UNPUBLISH") && !input.reason) {
    return "Un motif est exigé pour rejeter ou dépublier.";
  }
  return null;
}

/**
 * A municipal council decides for its own commune only. An intercommunal council may concern
 * any commune: the decision stays attributed to that council, never to the commune's mayor.
 */
export function institutionMismatch(
  institution: { kind: InstitutionKind; communeId: string | null },
  communeId: string
): string | null {
  if (institution.kind === "CONSEIL_MUNICIPAL" && institution.communeId !== communeId) {
    return "Un conseil municipal ne décide que pour sa propre commune.";
  }
  return null;
}

export type DecisionWriteResult =
  | { ok: true; id: string; status: CurationStatus }
  | { ok: false; httpStatus: 400 | 404 | 409; message: string };

async function checkReferences(input: DecisionInput): Promise<DecisionWriteResult | null> {
  const [institution, source, commune] = await Promise.all([
    db.institution.findUnique({
      where: { id: input.institutionId },
      select: { kind: true, communeId: true },
    }),
    db.territorialSource.findUnique({ where: { id: input.sourceId }, select: { id: true } }),
    db.commune.findUnique({ where: { id: input.communeId }, select: { id: true } }),
  ]);
  if (!institution) return { ok: false, httpStatus: 400, message: "Institution inconnue." };
  if (!source) return { ok: false, httpStatus: 400, message: "Source inconnue." };
  if (!commune) return { ok: false, httpStatus: 400, message: "Commune inconnue." };
  const mismatch = institutionMismatch(institution, input.communeId);
  return mismatch ? { ok: false, httpStatus: 400, message: mismatch } : null;
}

export async function createDecision(
  input: DecisionInput,
  meta: RequestMeta
): Promise<DecisionWriteResult> {
  const invalid = await checkReferences(input);
  if (invalid) return invalid;

  return db.$transaction(async (tx) => {
    const decision = await tx.decision.create({ data: input, select: { id: true, status: true } });
    await tx.auditLog.create({
      data: {
        action: "CREATE",
        entityType: "Decision",
        entityId: decision.id,
        changes: JSON.parse(JSON.stringify(input)),
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return { ok: true as const, id: decision.id, status: decision.status };
  });
}

export async function updateDecision(
  id: string,
  input: DecisionInput,
  meta: RequestMeta
): Promise<DecisionWriteResult> {
  const invalid = await checkReferences(input);
  if (invalid) return invalid;

  return db.$transaction(async (tx) => {
    // The status sits in the WHERE clause: a notice submitted between the read and the write
    // is not modified behind its reviewer's back.
    const { count } = await tx.decision.updateMany({ where: { id, status: "DRAFT" }, data: input });
    if (count === 0) {
      const exists = await tx.decision.findUnique({ where: { id }, select: { status: true } });
      return exists
        ? {
            ok: false as const,
            httpStatus: 409 as const,
            message: "Seul un brouillon se modifie. Repassez la notice en brouillon d'abord.",
          }
        : { ok: false as const, httpStatus: 404 as const, message: "Décision introuvable." };
    }
    await tx.auditLog.create({
      data: {
        action: "UPDATE",
        entityType: "Decision",
        entityId: id,
        changes: JSON.parse(JSON.stringify(input)),
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return { ok: true as const, id, status: "DRAFT" as const };
  });
}

export async function transitionDecision(
  id: string,
  input: DecisionTransitionInput,
  meta: RequestMeta
): Promise<DecisionWriteResult> {
  const missing = missingTransitionInput(input);
  if (missing) return { ok: false, httpStatus: 400, message: missing };

  const current = await db.decision.findUnique({
    where: { id },
    select: { status: true, communeId: true },
  });
  if (!current) return { ok: false, httpStatus: 404, message: "Décision introuvable." };

  const to = resolveTransition(current.status, input.action);
  if (!to) {
    return {
      ok: false,
      httpStatus: 409,
      message: "Cette action n'est pas possible depuis l'état actuel de la notice.",
    };
  }

  const now = new Date();
  const result = await db.$transaction(async (tx) => {
    const { count } = await tx.decision.updateMany({
      where: { id, status: current.status },
      data: {
        status: to,
        ...(input.action === "SUBMIT" && { submittedAt: now }),
        ...(input.action === "PUBLISH" && { reviewedAt: now, reviewedBy: input.reviewedBy }),
        ...(input.action === "REJECT" && { rejectionReason: input.reason }),
        ...(input.action === "REOPEN" && { rejectionReason: null }),
      },
    });
    if (count === 0) {
      return {
        ok: false as const,
        httpStatus: 409 as const,
        message: "La notice a changé d'état entre-temps. Rechargez la page.",
      };
    }
    await tx.auditLog.create({
      data: {
        action: input.action,
        entityType: "Decision",
        entityId: id,
        changes: {
          from: current.status,
          to,
          reviewedBy: input.reviewedBy,
          reason: input.reason,
        },
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return { ok: true as const, id, status: to };
  });

  // Only a change of public visibility reaches the public pages, keyed by the commune concerned.
  if (result.ok && (to === "PUBLISHED" || current.status === "PUBLISHED")) {
    revalidateTags([`territoire:${current.communeId}`]);
  }
  return result;
}

// ─── Institutions and sources ─────────────────────────────────

export type ReferenceWriteResult =
  | { ok: true; id: string }
  | { ok: false; httpStatus: 400 | 404 | 409; message: string };

export async function createInstitution(
  input: CreateInstitutionInput,
  meta: RequestMeta
): Promise<ReferenceWriteResult> {
  if (input.kind === "CONSEIL_MUNICIPAL") {
    const commune = await db.commune.findUnique({
      where: { id: input.communeId },
      select: { id: true },
    });
    if (!commune) return { ok: false, httpStatus: 400, message: "Commune inconnue." };
  }
  const unique =
    input.kind === "CONSEIL_MUNICIPAL"
      ? { kind: input.kind, communeId: input.communeId }
      : { kind: input.kind, sirenEpci: input.sirenEpci };
  const existing = await db.institution.findFirst({ where: unique, select: { id: true } });
  if (existing) {
    return { ok: false, httpStatus: 409, message: "Cette institution existe déjà." };
  }

  return db.$transaction(async (tx) => {
    const institution = await tx.institution.create({ data: input, select: { id: true } });
    await tx.auditLog.create({
      data: {
        action: "CREATE",
        entityType: "Institution",
        entityId: institution.id,
        changes: input,
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return { ok: true as const, id: institution.id };
  });
}

export async function createTerritorialSource(
  input: TerritorialSourceInput,
  meta: RequestMeta
): Promise<ReferenceWriteResult> {
  return db.$transaction(async (tx) => {
    const source = await tx.territorialSource.create({ data: input, select: { id: true } });
    await tx.auditLog.create({
      data: {
        action: "CREATE",
        entityType: "TerritorialSource",
        entityId: source.id,
        changes: JSON.parse(JSON.stringify(input)),
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return { ok: true as const, id: source.id };
  });
}
