import type { ReactNode } from "react";
import { MissingData } from "@/components/ui/MissingData";
import { SourceLine, type SourceRef } from "@/components/ui/SourceLine";
import { DATA_STATUS_DESCRIPTIONS, type DataStatusKind } from "@/lib/parlement/data-status";
import { DataStatus } from "./DataStatus";

interface DataProvenanceProps {
  status: DataStatusKind;
  /** Périmètre du statut : « Composition », « Dates officielles »… */
  scope: string;
  sources: SourceRef[];
  consultedAt?: Date | string | null;
  /** Limites connues, une phrase par entrée. */
  limits?: ReactNode[];
  className?: string;
}

/**
 * DataProvenance : bloc « d'où vient ce chiffre, jusqu'où il est complet ».
 * Réunit le statut, la ligne de source et les limites connues, pour qu'une page n'ait
 * pas à recomposer ces trois éléments à chaque fois.
 */
export function DataProvenance({
  status,
  scope,
  sources,
  consultedAt,
  limits = [],
  className,
}: DataProvenanceProps) {
  const hasSource = sources.some((source) => source.label.trim().length > 0);

  return (
    <aside aria-label="Provenance et couverture des données" className={className}>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <DataStatus status={status} scope={scope} showScope />
        <span className="text-muted-foreground">{DATA_STATUS_DESCRIPTIONS[status]}</span>
      </p>
      {hasSource ? (
        <SourceLine sources={sources} consultedAt={consultedAt} className="mt-2" />
      ) : (
        <MissingData title="Source non renseignée" className="mt-2">
          Aucune source n&apos;est associée à cette donnée. Elle ne doit pas être citée telle
          quelle.
        </MissingData>
      )}
      {limits.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-semibold">Limites des données</p>
          <ul
            aria-label="Limites des données"
            className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground"
          >
            {limits.map((limit, index) => (
              <li key={index}>{limit}</li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
