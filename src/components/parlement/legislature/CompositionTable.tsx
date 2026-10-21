import Link from "next/link";
import { MissingData } from "@/components/ui/MissingData";
import {
  checkCompositionTotals,
  COMPOSITION_ISSUE_LABELS,
  seatShare,
  type CompositionTotals,
} from "@/lib/parlement/composition";
import type { DataStatusKind } from "@/lib/parlement/data-status";
import { DataStatus } from "./DataStatus";

export interface CompositionRow {
  key: string;
  /** Nom du groupe tel qu'il s'appelait à cette période. */
  name: string;
  /** Sigle du groupe à cette période. */
  code: string;
  count: number;
  color?: string | null;
  /** Obligatoire : une ligne sans statut ne dit pas à quel point elle est fiable. */
  status: DataStatusKind;
  href?: string;
}

interface CompositionTableProps {
  /** Légende visible : « Groupes de la 16e législature, en fin de législature ». */
  caption: string;
  /** `null` : composition non importée. `[]` : importée et vide, ce qui est un fait. */
  rows: CompositionRow[] | null;
  totals?: CompositionTotals;
  /**
   * Députés non inscrits : ils n'appartiennent à aucun groupe et ne vont pas dans `rows`.
   * `null` ou absent : effectif non renseigné.
   */
  unaffiliated?: number | null;
  className?: string;
}

/**
 * CompositionTable : répartition des sièges par groupe, en tableau.
 *
 * C'est la vue de référence, l'hémicycle n'est jamais seul. L'absence de donnée (`rows` nul)
 * et un effectif nul sont deux états distincts. Si les totaux ne bouclent pas, la table le
 * dit au lieu de corriger.
 */
export function CompositionTable({
  caption,
  rows,
  totals,
  unaffiliated = null,
  className,
}: CompositionTableProps) {
  if (rows === null) {
    return (
      <MissingData title="Composition non importée" className={className}>
        La composition de cette période n&apos;est pas encore dans PoliGraph. Ce n&apos;est pas une
        assemblée vide.
      </MissingData>
    );
  }

  const issues = totals
    ? checkCompositionTotals(
        totals,
        rows.map((row) => row.count),
        { unaffiliated }
      )
    : [];
  const filled =
    totals?.filled ?? rows.reduce((acc, row) => acc + row.count, 0) + (unaffiliated ?? 0);

  return (
    <div className={className}>
      <div className="overflow-x-auto" role="region" aria-label={caption} tabIndex={0}>
        <table className="w-full text-sm">
          <caption className="pb-2 text-left font-medium">{caption}</caption>
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">
                Groupe à cette période
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Députés
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Part des sièges pourvus
              </th>
              <th scope="col" className="hidden py-2 pl-3 font-medium sm:table-cell">
                Donnée
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-3 text-muted-foreground">
                  Aucun groupe dans cette composition.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const share = seatShare(row.count, filled);
                return (
                  <tr key={row.key} className="border-b last:border-0">
                    <th scope="row" className="py-2 pr-3 text-left font-normal">
                      <span className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="inline-flex items-center gap-2">
                          {row.color && (
                            <span
                              aria-hidden="true"
                              className="h-3 w-3 shrink-0 rounded-full border"
                              style={{ backgroundColor: row.color }}
                            />
                          )}
                          {row.href ? (
                            <Link
                              href={row.href}
                              className="inline-flex min-h-11 items-center underline hover:text-primary"
                            >
                              {row.name}
                            </Link>
                          ) : (
                            row.name
                          )}
                        </span>
                        <span className="text-muted-foreground">({row.code})</span>
                        <DataStatus
                          status={row.status}
                          scope="Effectif du groupe"
                          className="sm:hidden"
                        />
                      </span>
                    </th>
                    <td className="px-3 py-2 text-right tabular-nums">{row.count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {share === null ? "Non calculée" : `${share.toLocaleString("fr-FR")} %`}
                    </td>
                    <td className="hidden py-2 pl-3 sm:table-cell">
                      <DataStatus status={row.status} scope="Effectif du groupe" />
                    </td>
                  </tr>
                );
              })
            )}
            {unaffiliated !== null && (
              <tr className="border-b">
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  <span className="flex min-h-11 flex-wrap items-center gap-x-2">
                    Députés non inscrits
                    <span className="text-xs text-muted-foreground">(aucun groupe)</span>
                  </span>
                </th>
                <td className="px-3 py-2 text-right tabular-nums">{unaffiliated}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {seatShare(unaffiliated, filled) === null
                    ? "Non calculée"
                    : `${seatShare(unaffiliated, filled)!.toLocaleString("fr-FR")} %`}
                </td>
                <td className="hidden sm:table-cell" />
              </tr>
            )}
          </tbody>
          {totals && (
            <tfoot>
              <tr className="border-t font-medium">
                <th scope="row" className="py-2 pr-3 text-left">
                  Sièges pourvus
                </th>
                <td className="px-3 py-2 text-right tabular-nums">{totals.filled}</td>
                <td colSpan={2} />
              </tr>
              <tr>
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  Sièges vacants
                </th>
                <td className="px-3 py-2 text-right tabular-nums">{totals.vacant}</td>
                <td colSpan={2} />
              </tr>
              <tr>
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  Total des sièges
                </th>
                <td className="px-3 py-2 text-right tabular-nums">{totals.seats}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {issues.length > 0 && (
        <MissingData title="Composition non vérifiée" className="mt-3">
          <ul className="list-disc space-y-1 pl-5">
            {issues.map((issue) => (
              <li key={issue}>{COMPOSITION_ISSUE_LABELS[issue]}</li>
            ))}
          </ul>
        </MissingData>
      )}
    </div>
  );
}
