import { formatIsoDateFr } from "@/lib/parlement/format-iso-date";
import { DATE_KIND_LABELS } from "@/lib/parlement/legislature-labels";
import type { InstitutionalDate } from "@/lib/parlement/legislature-types";

interface LegislatureDatesProps {
  dates: InstitutionalDate[];
  className?: string;
}

/**
 * LegislatureDates : dates institutionnelles, chacune avec sa nature.
 * Une date calculée ou conditionnelle le dit. Aucune date n'est présentée comme « le
 * début » ou « la fin » sans dire de quelle date il s'agit.
 */
export function LegislatureDates({ dates, className }: LegislatureDatesProps) {
  return (
    <dl className={className}>
      {dates.map((d) => (
        <div
          key={`${d.kind}-${d.date}`}
          className="border-b py-3 last:border-0 sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4"
        >
          <dt className="text-sm font-medium">{DATE_KIND_LABELS[d.kind]}</dt>
          <dd className="mt-1 text-sm sm:mt-0">
            <time dateTime={d.date} className="font-semibold">
              {formatIsoDateFr(d.date)}
            </time>
            {d.basis === "derived" && (
              <span className="text-muted-foreground"> · date calculée à partir de la loi</span>
            )}
            {d.conditional && (
              <span className="mt-1 block text-muted-foreground">
                Échéance théorique : elle ne vaut qu&apos;en l&apos;absence de dissolution avant
                cette date.
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
