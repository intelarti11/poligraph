import { useId } from "react";
import { formatIsoDateFr } from "@/lib/parlement/format-iso-date";
import {
  COVERAGE_LEVEL_LABELS,
  DATASET_DESCRIPTIONS,
  DATASET_LABELS,
  coverageToStatus,
} from "@/lib/parlement/legislature-labels";
import type { DatasetCoverage, LegislatureCoverage } from "@/lib/parlement/legislature-types";
import { DataStatus } from "./DataStatus";

interface CoverageTableProps {
  coverage: LegislatureCoverage;
  caption: string;
  className?: string;
}

function datasetNote(ds: DatasetCoverage): string {
  return ds.publicNote
    ? `${DATASET_DESCRIPTIONS[ds.dataset]} ${ds.publicNote}`
    : DATASET_DESCRIPTIONS[ds.dataset];
}

function Status({ ds }: { ds: DatasetCoverage }) {
  return (
    <DataStatus
      status={coverageToStatus(ds.level)}
      scope={DATASET_LABELS[ds.dataset]}
      label={COVERAGE_LEVEL_LABELS[ds.level]}
    />
  );
}

/** Effectif mesuré. « Aucun » (absent) et « Non publié » (masqué) restent deux états distincts. */
function Quantity({ ds }: { ds: DatasetCoverage }) {
  if (ds.level === "absent") return <span className="text-muted-foreground">Aucun</span>;
  if (ds.level === "withheld") return <span className="text-muted-foreground">Non publié</span>;
  return (
    <>
      {ds.measured.count.toLocaleString("fr-FR")}
      {ds.measured.outOf !== undefined && (
        <span className="text-muted-foreground">
          {" "}
          sur {ds.measured.outOf.toLocaleString("fr-FR")}
        </span>
      )}
    </>
  );
}

function MeasuredAt({ ds }: { ds: DatasetCoverage }) {
  return <time dateTime={ds.measuredAt}>{formatIsoDateFr(ds.measuredAt)}</time>;
}

/**
 * CoverageTable : ce que PoliGraph a importé, jeu par jeu, avec la date de la mesure.
 * Chaque ligne a son propre niveau. Il n'y a ni total ni niveau global : un jeu complet
 * ne rend pas les autres complets. Les chiffres sont des comptages de PoliGraph, jamais
 * des statistiques de l'Assemblée. Le périmètre méthodologique (`ds.perimeter`) n'est pas
 * affiché : seule la description publique l'est.
 *
 * Deux présentations du même contenu, une seule visible à la fois : tableau à partir de 640 px,
 * cartes verticales en dessous (le tableau défilait sur mobile et cachait la date). `hidden`
 * retire la présentation inactive de l'arbre d'accessibilité, il n'y a donc pas de doublon.
 */
export function CoverageTable({ coverage, caption, className }: CoverageTableProps) {
  const captionId = useId();
  return (
    <div className={className}>
      <div className="hidden sm:block">
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
                      {datasetNote(ds)}
                    </span>
                  </th>
                  <td className="px-3 py-2">
                    <Status ds={ds} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <Quantity ds={ds} />
                  </td>
                  <td className="py-2 pl-3 text-muted-foreground">
                    <MeasuredAt ds={ds} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="sm:hidden" data-coverage-cards>
        <p id={captionId} className="pb-2 font-medium">
          {caption}
        </p>
        <ul aria-labelledby={captionId} className="space-y-3">
          {coverage.datasets.map((ds) => (
            <li key={ds.dataset} className="rounded-lg border bg-card p-4">
              <h3 className="font-medium">{DATASET_LABELS[ds.dataset]}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{datasetNote(ds)}</p>
              <dl className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Niveau</dt>
                <dd>
                  <Status ds={ds} />
                </dd>
                <dt className="text-muted-foreground">Importé</dt>
                <dd className="tabular-nums">
                  <Quantity ds={ds} />
                </dd>
                <dt className="text-muted-foreground">Mesure du</dt>
                <dd>
                  <MeasuredAt ds={ds} />
                </dd>
              </dl>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        Ces nombres sont des comptages faits par PoliGraph sur ses propres données, à la date
        indiquée pour chaque ligne. Ils ne reprennent aucune statistique officielle de
        l&apos;Assemblée nationale.
      </p>
    </div>
  );
}
