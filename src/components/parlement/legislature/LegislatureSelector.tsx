import Link from "next/link";
import { cn } from "@/lib/utils";
import type { DataStatusKind } from "@/lib/parlement/data-status";
import { DATA_STATUS_LABELS } from "@/lib/parlement/data-status";

export interface LegislatureOption {
  number: number;
  /** « 2022-2024 », « depuis 2024 ». */
  period: string;
  href: string;
  status: DataStatusKind;
  /** Jeu de données auquel le statut s'applique. */
  statusScope: string;
  /** Libellé précis du niveau (« Pas encore importé », « Non publié »), sinon celui du statut. */
  statusLabel?: string;
}

interface LegislatureSelectorProps {
  options: LegislatureOption[];
  /** Numéro de la législature affichée, s'il y en a une. */
  current?: number;
  className?: string;
}

function ordinal(n: number): string {
  return n === 1 ? "1re" : `${n}e`;
}

/**
 * LegislatureSelector : choix d'une législature de l'Assemblée nationale.
 *
 * Une liste de vrais liens, pas un menu déroulant : elle marche sans JavaScript, se parcourt
 * au clavier avec Tab, et chaque cible fait au moins 44 px. La page courante est annoncée par
 * `aria-current="page"`. Le mot « législature » n'est jamais utilisé côté Sénat.
 */
export function LegislatureSelector({ options, current, className }: LegislatureSelectorProps) {
  if (options.length === 0) return null;
  return (
    <nav aria-label="Législatures de l'Assemblée nationale" className={className}>
      <ul className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isCurrent = option.number === current;
          return (
            <li key={option.number}>
              <Link
                href={option.href}
                aria-current={isCurrent ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 flex-col justify-center rounded-md border px-3 py-1.5 text-sm outline-none",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  isCurrent
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-card hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <span className="font-semibold">{ordinal(option.number)} législature</span>
                <span
                  className={isCurrent ? "text-primary-foreground/90" : "text-muted-foreground"}
                >
                  {option.period}
                  <span className="sr-only">
                    {" "}
                    · {option.statusScope} :{" "}
                    {option.statusLabel ?? DATA_STATUS_LABELS[option.status]}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
