import { Card } from "@/components/ui/card";
import {
  INSTITUTION_KIND_LABELS,
  TERRITORIAL_SOURCE_KIND_LABELS,
} from "@/config/decisions-territoriales";
import { db } from "@/lib/db";
import { InstitutionForm, SourceForm } from "../_components/DecisionAdminForms";
import { isoDay } from "../_data";

export const metadata = { title: "Institutions et sources (admin)", robots: { index: false } };

const LIST_LIMIT = 100;

export default async function DecisionReferencesPage() {
  const [institutions, sources] = await Promise.all([
    db.institution.findMany({ orderBy: { name: "asc" }, take: LIST_LIMIT }),
    db.territorialSource.findMany({ orderBy: { createdAt: "desc" }, take: LIST_LIMIT }),
  ]);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-display font-bold tracking-tight">Institutions et sources</h1>

      <section aria-labelledby="institutions" className="space-y-3">
        <h2 id="institutions" className="text-lg font-semibold">
          Institutions
        </h2>
        <Card className="p-4">
          <InstitutionForm />
        </Card>
        <ul className="space-y-1 text-sm">
          {institutions.map((i) => (
            <li key={i.id}>
              {i.name} · {INSTITUTION_KIND_LABELS[i.kind]} · {i.communeId ?? `SIREN ${i.sirenEpci}`}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="sources" className="space-y-3">
        <h2 id="sources" className="text-lg font-semibold">
          Sources ({sources.length} plus récentes)
        </h2>
        <Card className="p-4">
          <SourceForm />
        </Card>
        <ul className="space-y-1 text-sm">
          {sources.map((s) => (
            <li key={s.id}>
              {TERRITORIAL_SOURCE_KIND_LABELS[s.kind]} · {s.title} · {s.producer} · consultée le{" "}
              {isoDay(s.lastVerifiedAt)} ·{" "}
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">
                ouvrir
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
