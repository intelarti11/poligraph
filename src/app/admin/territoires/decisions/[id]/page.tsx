import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import {
  CURATION_STATUS_LABELS,
  DATE_PRECISION_LABELS,
  DECISION_OUTCOME_LABELS,
  TERRITORIAL_SOURCE_KIND_LABELS,
} from "@/config/decisions-territoriales";
import { db } from "@/lib/db";
import { availableTransitions } from "@/lib/territoires/decisions";
import { DecisionForm, DecisionTransitions } from "../_components/DecisionAdminForms";
import { getDecisionFormOptions, isoDay } from "../_data";

export const metadata = { title: "Décision (admin)", robots: { index: false } };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminDecisionPage({ params }: PageProps) {
  const { id } = await params;
  const decision = await db.decision.findUnique({
    where: { id },
    include: { institution: true, source: true, commune: { select: { name: true } } },
  });
  if (!decision) notFound();

  const [options, history] = await Promise.all([
    decision.status === "DRAFT" ? getDecisionFormOptions() : null,
    db.auditLog.findMany({
      where: { entityType: "Decision", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, action: true, createdAt: true, changes: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-muted-foreground">
          {decision.institution.name} · {decision.commune.name} ({decision.communeId})
        </p>
        <h1 className="text-2xl font-display font-bold tracking-tight">{decision.title}</h1>
        <p className="mt-1 text-sm">
          État : <strong>{CURATION_STATUS_LABELS[decision.status]}</strong>
          {decision.reviewedBy &&
            ` · relue par ${decision.reviewedBy} le ${isoDay(decision.reviewedAt)}`}
          {decision.rejectionReason && ` · motif du rejet : ${decision.rejectionReason}`}
        </p>
      </header>

      <Card className="space-y-2 p-4 text-sm">
        <p>
          Adoptée le {isoDay(decision.adoptionDate)} (
          {DATE_PRECISION_LABELS[decision.adoptionDatePrecision].toLowerCase()}) ·{" "}
          {DECISION_OUTCOME_LABELS[decision.outcome]}
          {decision.outcomeWording && ` (« ${decision.outcomeWording} »)`}
        </p>
        <p>
          Source : {TERRITORIAL_SOURCE_KIND_LABELS[decision.source.kind]}, {decision.source.title},{" "}
          {decision.sourceLocator} ·{" "}
          <a
            href={decision.source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            ouvrir le document
          </a>
        </p>
      </Card>

      <section aria-labelledby="transitions" className="space-y-3">
        <h2 id="transitions" className="text-lg font-semibold">
          Revue et publication
        </h2>
        <DecisionTransitions
          decisionId={decision.id}
          actions={availableTransitions(decision.status)}
        />
      </section>

      {options && (
        <section aria-labelledby="edition" className="space-y-3">
          <h2 id="edition" className="text-lg font-semibold">
            Modifier le brouillon
          </h2>
          <Card className="p-4">
            <DecisionForm
              decisionId={decision.id}
              institutions={options.institutions}
              sources={options.sources}
              initial={{
                institutionId: decision.institutionId,
                communeId: decision.communeId,
                reference: decision.reference ?? "",
                title: decision.title,
                adoptionDate: isoDay(decision.adoptionDate),
                adoptionDatePrecision: decision.adoptionDatePrecision,
                publicationDate: isoDay(decision.publicationDate),
                effectiveDate: isoDay(decision.effectiveDate),
                outcome: decision.outcome,
                outcomeWording: decision.outcomeWording ?? "",
                sourceId: decision.sourceId,
                sourceLocator: decision.sourceLocator,
              }}
            />
          </Card>
        </section>
      )}

      <section aria-labelledby="historique" className="space-y-2">
        <h2 id="historique" className="text-lg font-semibold">
          Historique
        </h2>
        <ul className="space-y-1 text-sm">
          {history.map((h) => (
            <li key={h.id}>
              {h.createdAt.toISOString().slice(0, 16).replace("T", " ")} · {h.action}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
