import type { PublishedGovernment } from "@/lib/governments/mapping";
import { formatDay, formatMonth, plural } from "./format";

/**
 * Scope, completeness and verification of the published governments, as three separate
 * statements (2a). Computed from the published set only.
 */
export function CoverageSummary({
  govs,
  coverage,
}: {
  govs: PublishedGovernment[];
  coverage: { from: string; to: string } | null;
}) {
  const partial = govs.filter((g) => g.completeness === "PARTIAL" || g.hiddenCount > 0).length;
  const checked = govs
    .map((g) => g.compositionCheckedAt)
    .filter((d): d is string => d !== null)
    .sort()
    .at(-1);

  const cells = [
    {
      title: "Périmètre",
      body: coverage
        ? `Périodes documentées : ${formatMonth(coverage.from)} à ${formatMonth(coverage.to)}. Les lacunes sont signalées sur chaque gouvernement concerné.`
        : "Aucune période documentée pour le moment.",
    },
    {
      title: "Complétude",
      body:
        partial > 0
          ? `Partielle : ${plural(partial, "gouvernement comporte", "gouvernements comportent")} des changements ou des personnes encore à documenter.`
          : "Indiquée sur chaque gouvernement.",
    },
    {
      title: "Vérification",
      body: checked
        ? `Dernière vérification : ${formatDay(checked)}.`
        : "Date de vérification non renseignée.",
    },
  ];

  return (
    <div className="grid divide-y rounded-2xl border bg-card md:grid-cols-3 md:divide-x md:divide-y-0">
      {cells.map((cell) => (
        <div key={cell.title} className="px-4 py-2.5 md:px-5 md:py-4">
          <p className="text-[13px] md:font-bold">
            <span className="font-bold">{cell.title}</span>
            <span className="md:hidden"> : </span>
            <span className="text-muted-foreground md:mt-1 md:block md:font-normal">
              {cell.body}
            </span>
          </p>
        </div>
      ))}
    </div>
  );
}
