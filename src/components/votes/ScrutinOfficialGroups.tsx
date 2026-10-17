import { Card, CardContent } from "@/components/ui/card";
import { MissingData } from "@/components/ui/MissingData";
import { SourceLine } from "@/components/ui/SourceLine";
import { GROUP_POSITION_LABELS } from "@/config/labels";
import type { OfficialGroupCountsView, OfficialSource } from "@/lib/votes/scrutin-provenance";

interface ScrutinOfficialGroupsProps {
  view: OfficialGroupCountsView;
  source: OfficialSource | null;
  fetchedAt: Date | null;
}

const WITHHELD_TITLES = {
  import: "Décompte officiel par groupe pas encore disponible",
  source: "Décompte officiel par groupe non affiché : anomalie dans la source",
  inconsistent: "Décompte officiel par groupe non affiché : incohérence",
} as const;

/**
 * Bloc C1 de la page de scrutin : le décompte par groupe publié par l'institution, nommé avec les
 * libellés du référentiel officiel. Masqué avec sa raison quand il ne peut pas être garanti, et le
 * lien vers la source reste toujours accessible.
 */
export function ScrutinOfficialGroups({ view, source, fetchedAt }: ScrutinOfficialGroupsProps) {
  const sourceLink = source ? (
    <SourceLine sources={[{ label: source.label, url: source.url }]} className="mt-2" />
  ) : null;

  if (view.kind === "not-imported") {
    return (
      <MissingData title="Décompte officiel par groupe pas encore importé" className="mb-8">
        L&apos;Assemblée nationale publie ce décompte avec chaque scrutin. PoliGraph ne l&apos;a pas
        encore repris pour celui-ci.
        {sourceLink}
      </MissingData>
    );
  }

  if (view.kind === "withheld") {
    return (
      <MissingData title={WITHHELD_TITLES[view.origin]} className="mb-8">
        {view.reason}
        {sourceLink}
      </MissingData>
    );
  }

  return (
    <Card className="mb-8">
      <CardContent className="pt-6">
        <h3 className="text-base font-semibold">Décompte officiel par groupe</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Décompte publié avec le scrutin. Chaque groupe porte le libellé du référentiel officiel de
          l&apos;Assemblée nationale.
        </p>
        {/* Mobile: one block per group, so no column is hidden behind a horizontal scroll. */}
        <ul className="mt-3 divide-y sm:hidden" aria-label="Décompte officiel par groupe">
          {view.rows.map((row) => (
            <li key={row.organeRef} className="py-3">
              <p className="font-medium">
                {row.label}
                {row.abbreviation && row.abbreviation !== row.label ? (
                  <span className="ml-1 font-normal text-muted-foreground">
                    ({row.abbreviation})
                  </span>
                ) : null}
              </p>
              <p className="mt-1 text-sm tabular-nums text-muted-foreground">
                Pour {row.forCount} · Contre {row.againstCount} · Abstentions {row.abstainCount}
                {row.nonVoterCount !== null ? ` · Non-votants ${row.nonVoterCount}` : ""}
              </p>
              {row.majorityPosition ? (
                <p className="text-sm text-muted-foreground">
                  Position majoritaire : {GROUP_POSITION_LABELS[row.majorityPosition]}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
        <div
          className="mt-3 hidden overflow-x-auto sm:block"
          role="region"
          aria-label="Décompte officiel par groupe"
          tabIndex={0}
        >
          <table className="w-full min-w-[34rem] text-sm">
            <caption className="sr-only">
              Pour, contre, abstentions et non-votants de chaque groupe, tels que publiés.
            </caption>
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Groupe
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  Pour
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  Contre
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  Abstentions
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  Non-votants
                </th>
                <th scope="col" className="py-2 pl-3 font-medium">
                  Position majoritaire
                </th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <tr key={row.organeRef} className="border-b last:border-0">
                  <th scope="row" className="py-2 pr-3 text-left font-medium">
                    {row.label}
                    {row.abbreviation && row.abbreviation !== row.label ? (
                      <span className="ml-1 font-normal text-muted-foreground">
                        ({row.abbreviation})
                      </span>
                    ) : null}
                  </th>
                  <td className="px-2 py-2 text-right tabular-nums">{row.forCount}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{row.againstCount}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{row.abstainCount}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{row.nonVoterCount ?? ""}</td>
                  <td className="py-2 pl-3">
                    {row.majorityPosition ? GROUP_POSITION_LABELS[row.majorityPosition] : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SourceLine
          sources={source ? [{ label: source.label, url: source.url }] : []}
          consultedAt={fetchedAt}
          note="Position majoritaire : libellé de la source"
          className="mt-3"
        />
      </CardContent>
    </Card>
  );
}
