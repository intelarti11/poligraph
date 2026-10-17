import type { Chamber } from "@/generated/prisma";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SourceLine } from "@/components/ui/SourceLine";
import type { OfficialSource } from "@/lib/votes/scrutin-provenance";

const CENSURE_THRESHOLD = 289;

interface ScrutinResultCardProps {
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  chamber: Chamber;
  /** Source institutionnelle, ou `null` quand le lien n'en est pas une. */
  source: OfficialSource | null;
  /** Détecté sur le titre officiel du scrutin. */
  isMotionDeCensure: boolean;
}

/**
 * Bloc A de la page de scrutin : ce que l'institution a publié. Quand le lien ne pointe pas vers
 * un site institutionnel, le bloc ne s'intitule pas « officiel ».
 */
export function ScrutinResultCard({
  votesFor,
  votesAgainst,
  votesAbstain,
  chamber,
  source,
  isMotionDeCensure,
}: ScrutinResultCardProps) {
  const total = votesFor + votesAgainst + votesAbstain;
  const forPercent = total > 0 ? (votesFor / total) * 100 : 0;
  const againstPercent = total > 0 ? (votesAgainst / total) * 100 : 0;
  const abstainPercent = total > 0 ? (votesAbstain / total) * 100 : 0;

  return (
    <Card className="mb-8">
      <CardHeader>
        <h2 className="leading-none font-semibold">
          {source ? "Résultat officiel" : "Résultat du vote"}
        </h2>
      </CardHeader>
      <CardContent>
        {isMotionDeCensure ? (
          <div className="space-y-4">
            {/* Threshold bar for motion de censure */}
            <div className="relative">
              <div className="h-8 bg-muted rounded-lg overflow-hidden">
                <div
                  className="h-full flex items-center justify-center text-white text-sm font-medium bg-red-700"
                  style={{
                    width: `${Math.min((votesFor / CENSURE_THRESHOLD) * 100, 100)}%`,
                  }}
                >
                  {votesFor}
                </div>
              </div>
              {/* Threshold marker */}
              <div
                className="absolute top-0 h-8 border-r-2 border-dashed border-foreground/60"
                style={{ left: "100%" }}
              />
            </div>

            <div className="flex flex-wrap justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-700" />
                <span>{votesFor} voix pour la censure</span>
              </div>
              <span className="text-muted-foreground tabular-nums">
                {CENSURE_THRESHOLD} nécessaires (majorité absolue)
              </span>
            </div>

            <p className="text-xs text-muted-foreground">
              Une motion de censure n{"'"}est adoptée que si elle recueille la majorité absolue des
              députés ({CENSURE_THRESHOLD}/577). Seuls les députés favorables à la censure votent.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Vote bar */}
            <div className="flex h-8 rounded-lg overflow-hidden">
              <div
                className="bg-green-700 flex items-center justify-center text-white text-sm font-medium"
                style={{ width: `${forPercent}%` }}
              >
                {votesFor > 0 && votesFor}
              </div>
              <div
                className="bg-red-700 flex items-center justify-center text-white text-sm font-medium"
                style={{ width: `${againstPercent}%` }}
              >
                {votesAgainst > 0 && votesAgainst}
              </div>
              <div
                className="bg-yellow-500 flex items-center justify-center text-black text-sm font-medium"
                style={{ width: `${abstainPercent}%` }}
              >
                {votesAbstain > 0 && votesAbstain}
              </div>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap justify-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-green-700" />
                <span>
                  Pour: {votesFor} ({forPercent.toFixed(1)}%)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-700" />
                <span>
                  Contre: {votesAgainst} ({againstPercent.toFixed(1)}%)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-yellow-500" />
                <span>
                  Abstention: {votesAbstain} ({abstainPercent.toFixed(1)}%)
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 space-y-1 border-t pt-3 text-xs text-muted-foreground">
          <p>
            {source
              ? "Le titre, la date, le résultat et les totaux viennent de la source. Le thème, le type de scrutin et les synthèses sont produits par PoliGraph."
              : "Le lien enregistré ne mène pas à un site institutionnel : ces chiffres ne sont pas présentés comme officiels."}
          </p>
          <p>
            {total} votants : pour, contre et abstentions, hors non-votants.
            {chamber === "AN" ? " C'est le total que publie l'Assemblée nationale." : ""}
          </p>
          {source ? <SourceLine sources={[{ label: source.label, url: source.url }]} /> : null}
        </div>
      </CardContent>
    </Card>
  );
}
