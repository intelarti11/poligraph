"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DATE_PRECISION_LABELS,
  DECISION_OUTCOME_LABELS,
  DECISION_TRANSITION_LABELS,
  TERRITORIAL_SOURCE_KIND_LABELS,
} from "@/config/decisions-territoriales";

const SELECT_CLASS = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm";

type Option = { id: string; label: string };

/** Sends the form as JSON. Errors from the API are shown in the form, never as an alert. */
function useJsonSubmit(onSuccess: (json: { id?: string }) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(url: string, method: "POST" | "PATCH", body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const issues = Array.isArray(json.issues)
          ? json.issues.map(
              (i: { path: string[]; message: string }) => `${i.path.join(".")} : ${i.message}`
            )
          : [];
        setError([json.error ?? `Erreur ${res.status}`, ...issues].join(" · "));
        return;
      }
      onSuccess(json);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, send };
}

function fieldsOf(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries(
    [...new FormData(form).entries()].map(([k, v]) => [k, String(v).trim()])
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function FormError({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
}

export interface DecisionFormValues {
  institutionId: string;
  communeId: string;
  reference: string;
  title: string;
  adoptionDate: string;
  adoptionDatePrecision: string;
  publicationDate: string;
  effectiveDate: string;
  outcome: string;
  outcomeWording: string;
  sourceId: string;
  sourceLocator: string;
}

export function DecisionForm({
  decisionId,
  initial,
  institutions,
  sources,
}: {
  decisionId?: string;
  initial?: DecisionFormValues;
  institutions: Option[];
  sources: Option[];
}) {
  const router = useRouter();
  const { busy, error, send } = useJsonSubmit((json) => {
    if (decisionId) router.refresh();
    else router.push(`/admin/territoires/decisions/${json.id}`);
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = fieldsOf(event.currentTarget);
    void send(
      decisionId
        ? `/api/admin/territoires/decisions/${decisionId}`
        : "/api/admin/territoires/decisions",
      decisionId ? "PATCH" : "POST",
      body
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
      <Field id="institutionId" label="Autorité (institution)">
        <select
          id="institutionId"
          name="institutionId"
          required
          defaultValue={initial?.institutionId}
          className={SELECT_CLASS}
        >
          <option value="">Choisir</option>
          {institutions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <Field id="communeId" label="Commune concernée (code INSEE)">
        <Input id="communeId" name="communeId" required defaultValue={initial?.communeId} />
      </Field>
      <Field id="title" label="Objet, fidèle à la source">
        <Input id="title" name="title" required maxLength={500} defaultValue={initial?.title} />
      </Field>
      <Field id="reference" label="Référence (n° de délibération)">
        <Input id="reference" name="reference" maxLength={120} defaultValue={initial?.reference} />
      </Field>
      <Field id="adoptionDate" label="Date d'adoption">
        <Input
          id="adoptionDate"
          name="adoptionDate"
          type="date"
          required
          defaultValue={initial?.adoptionDate}
        />
      </Field>
      <Field id="adoptionDatePrecision" label="Précision de la date d'adoption">
        <select
          id="adoptionDatePrecision"
          name="adoptionDatePrecision"
          defaultValue={initial?.adoptionDatePrecision ?? "DAY"}
          className={SELECT_CLASS}
        >
          {Object.entries(DATE_PRECISION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field id="publicationDate" label="Date de publication (facultative)">
        <Input
          id="publicationDate"
          name="publicationDate"
          type="date"
          defaultValue={initial?.publicationDate}
        />
      </Field>
      <Field id="effectiveDate" label="Date de prise d'effet (facultative)">
        <Input
          id="effectiveDate"
          name="effectiveDate"
          type="date"
          defaultValue={initial?.effectiveDate}
        />
      </Field>
      <Field id="outcome" label="Résultat établi par la source">
        <select
          id="outcome"
          name="outcome"
          required
          defaultValue={initial?.outcome}
          className={SELECT_CLASS}
        >
          <option value="">Choisir</option>
          {Object.entries(DECISION_OUTCOME_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field id="outcomeWording" label="Formulation du résultat dans la source (facultative)">
        <Input
          id="outcomeWording"
          name="outcomeWording"
          maxLength={300}
          defaultValue={initial?.outcomeWording}
        />
      </Field>
      <Field id="sourceId" label="Source">
        <select
          id="sourceId"
          name="sourceId"
          required
          defaultValue={initial?.sourceId}
          className={SELECT_CLASS}
        >
          <option value="">Choisir</option>
          {sources.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <Field id="sourceLocator" label="Localisation dans la source (page, point)">
        <Input
          id="sourceLocator"
          name="sourceLocator"
          required
          maxLength={200}
          defaultValue={initial?.sourceLocator}
        />
      </Field>
      <div className="md:col-span-2 space-y-2">
        <FormError error={error} />
        <Button type="submit" disabled={busy}>
          {decisionId ? "Enregistrer le brouillon" : "Créer le brouillon"}
        </Button>
      </div>
    </form>
  );
}

export function DecisionTransitions({
  decisionId,
  actions,
}: {
  decisionId: string;
  actions: (keyof typeof DECISION_TRANSITION_LABELS)[];
}) {
  const router = useRouter();
  const { busy, error, send } = useJsonSubmit(() => router.refresh());
  const needsReviewer = actions.includes("PUBLISH");
  const needsReason = actions.includes("REJECT") || actions.includes("UNPUBLISH");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const fields = fieldsOf(event.currentTarget);
    void send(`/api/admin/territoires/decisions/${decisionId}/transition`, "POST", {
      action: submitter?.value,
      reviewedBy: fields.reviewedBy || null,
      reason: fields.reason || null,
    });
  }

  if (actions.length === 0) return null;
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {needsReviewer && (
        <Field id="reviewedBy" label="Relu contre la source par (nom)">
          <Input id="reviewedBy" name="reviewedBy" maxLength={100} />
        </Field>
      )}
      {needsReason && (
        <Field id="reason" label="Motif (rejet ou dépublication)">
          <Input id="reason" name="reason" maxLength={500} />
        </Field>
      )}
      <FormError error={error} />
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action}
            type="submit"
            name="action"
            value={action}
            disabled={busy}
            variant="outline"
          >
            {DECISION_TRANSITION_LABELS[action]}
          </Button>
        ))}
      </div>
    </form>
  );
}

export function InstitutionForm() {
  const router = useRouter();
  const [kind, setKind] = useState("CONSEIL_MUNICIPAL");
  const { busy, error, send } = useJsonSubmit(() => router.refresh());

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = fieldsOf(event.currentTarget);
    const body =
      f.kind === "CONSEIL_MUNICIPAL"
        ? { kind: f.kind, name: f.name, communeId: f.code }
        : { kind: f.kind, name: f.name, sirenEpci: f.code };
    void send("/api/admin/territoires/institutions", "POST", body);
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-3">
      <Field id="kind" label="Type">
        <select
          id="kind"
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="CONSEIL_MUNICIPAL">Conseil municipal</option>
          <option value="CONSEIL_COMMUNAUTAIRE">Conseil communautaire</option>
        </select>
      </Field>
      <Field id="institution-name" label="Nom">
        <Input id="institution-name" name="name" required maxLength={200} />
      </Field>
      <Field
        id="code"
        label={kind === "CONSEIL_MUNICIPAL" ? "Code INSEE de la commune" : "SIREN de l'EPCI"}
      >
        <Input id="code" name="code" required />
      </Field>
      <div className="md:col-span-3 space-y-2">
        <FormError error={error} />
        <Button type="submit" disabled={busy}>
          Ajouter l{"'"}institution
        </Button>
      </div>
    </form>
  );
}

export function SourceForm() {
  const router = useRouter();
  const { busy, error, send } = useJsonSubmit(() => router.refresh());

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send("/api/admin/territoires/sources", "POST", fieldsOf(event.currentTarget));
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-2">
      <Field id="source-kind" label="Nature du document">
        <select id="source-kind" name="kind" required className={SELECT_CLASS}>
          {Object.entries(TERRITORIAL_SOURCE_KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field id="source-title" label="Titre du document">
        <Input id="source-title" name="title" required maxLength={300} />
      </Field>
      <Field id="producer" label="Producteur (ex. : Commune de ...)">
        <Input id="producer" name="producer" required maxLength={200} />
      </Field>
      <Field id="url" label="URL du document (http ou https)">
        <Input id="url" name="url" type="url" required maxLength={2048} />
      </Field>
      <Field id="archiveUrl" label="URL d'archive (facultative)">
        <Input id="archiveUrl" name="archiveUrl" type="url" maxLength={2048} />
      </Field>
      <Field id="documentDate" label="Date du document (facultative)">
        <Input id="documentDate" name="documentDate" type="date" />
      </Field>
      <Field id="lastVerifiedAt" label="Dernière consultation du document">
        <Input id="lastVerifiedAt" name="lastVerifiedAt" type="date" required />
      </Field>
      <div className="md:col-span-2 space-y-2">
        <FormError error={error} />
        <Button type="submit" disabled={busy}>
          Ajouter la source
        </Button>
      </div>
    </form>
  );
}
