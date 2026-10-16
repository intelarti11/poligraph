import { formatIsoDateFr } from "@/lib/parlement/format-iso-date";
import {
  COVERAGE_LEVEL_LABELS,
  DATASET_DESCRIPTIONS,
  DATASET_LABELS,
  coverageToStatus,
} from "@/lib/parlement/legislature-labels";
import type { LegislatureCoverage } from "@/lib/parlement/legislature-types";
import { DataStatus } from "./DataStatus";

interface CoverageTableProps {
  coverage: LegislatureCoverage;
  caption: string;
  className?: string;
}

/**
 * CoverageTable : ce que PoliGraph a importé, jeu par jeu, avec la date de la mesure.
 * Chaque ligne a son propre niveau. Il n'y a ni total ni niveau global : un jeu complet
 * ne rend pas les autres complets. Les chiffres sont des comptages de PoliGraph, jamais
 * des statistiques de l'Assemblée. Le périmètre méthodologique (`ds.perimeter`) n'est pas
 * affiché : seule la description publique l'est.
 */
export function CoverageTable({ coverage, caption, className }: CoverageTableProps) {
  return (
    <div className={className}>
      <div className="overflow-x-auto" role="region" aria-label={caption} tabIndex={0}>
        <table className="w-full text-sm">
          <caption className="pb-2 text-left font-medium">{caption}</caption>
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">
                Jeu de données
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Niveau
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Importé
              </th>
              <th scope="col" className="py-2 pl-3 font-medium">
                Mesure du
              </th>
            </tr>
          </thead>
          <tbody>
            {coverage.datasets.map((ds) => (
              <tr key={ds.dataset} className="border-b align-top last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  <span className="font-medium">{DATASET_LABELS[ds.dataset]}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {DATASET_DESCRIPTIONS[ds.dataset]}
                    {ds.publicNote ? ` ${ds.publicNote}` : ""}
                  </span>
                </th>
                <td className="px-3 py-2">
                  <DataStatus
                    status={coverageToStatus(ds.level)}
                    scope={DATASET_LABELS[ds.dataset]}
                    label={COVERAGE_LEVEL_LABELS[ds.level]}
                  />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {ds.level === "absent" || ds.level === "withheld" ? (
                    <span className="text-muted-foreground">
                      {ds.level === "absent" ? "Aucun" : "Non publié"}
                    </span>
                  ) : (
                    ds.measured.count.toLocaleString("fr-FR")
                  )}
                  {ds.measured.outOf !== undefined &&
                    ds.level !== "absent" &&
                    ds.level !== "withheld" && (
                      <span className="text-muted-foreground">
                        {" "}
                        sur {ds.measured.outOf.toLocaleString("fr-FR")}
                      </span>
                    )}
                </td>
                <td className="py-2 pl-3 text-muted-foreground">
                  <time dateTime={ds.measuredAt}>{formatIsoDateFr(ds.measuredAt)}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        Ces nombres sont des comptages faits par PoliGraph sur ses propres données, à la date
        indiquée pour chaque ligne. Ils ne reprennent aucune statistique officielle de
        l&apos;Assemblée nationale.
      </p>
    </div>
  );
}
