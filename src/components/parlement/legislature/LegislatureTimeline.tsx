import Link from "next/link";
import { cn } from "@/lib/utils";
import { DataStatus } from "./DataStatus";
import type { DataStatusKind } from "@/lib/parlement/data-status";

export interface TimelineLegislature {
  number: number;
  /** Année de début. */
  startYear: number;
  /** Année de fin, `null` pour une législature en cours. */
  endYear: number | null;
  /** Événement d'ouverture sourcé : « Élection de juin 2022 ». */
  startEvent?: string;
  /** Statut d'UN jeu de données, pas de la législature entière. */
  status: DataStatusKind;
  /** Jeu de données concerné : « Composition », « Votes individuels »… */
  statusScope: string;
  href: string;
}

interface LegislatureTimelineProps {
  items: TimelineLegislature[];
  /** Année de référence pour une législature en cours (longueur du segment). */
  referenceYear: number;
  current?: number;
  className?: string;
}

function ordinal(n: number): string {
  return n === 1 ? "1re" : `${n}e`;
}

/** Durée utilisée pour la largeur du segment, jamais inférieure à un an. */
export function timelineSpan(item: TimelineLegislature, referenceYear: number): number {
  const end = item.endYear ?? referenceYear;
  return Math.max(1, end - item.startYear);
}

function periodLabel(item: TimelineLegislature): string {
  return item.endYear === null ? `depuis ${item.startYear}` : `${item.startYear}-${item.endYear}`;
}

/**
 * LegislatureTimeline : frise proportionnelle des législatures.
 *
 * La liste ordonnée est l'équivalent textuel de la frise : dates, statut et événement
 * d'ouverture y sont écrits, la largeur des segments n'est qu'un renfort visuel. Sur
 * mobile, les segments s'empilent. Aucun chiffre de composition n'y figure.
 */
export function LegislatureTimeline({
  items,
  referenceYear,
  current,
  className,
}: LegislatureTimelineProps) {
  if (items.length === 0) return null;
  return (
    <ol
      aria-label="Frise des législatures"
      className={cn("flex flex-col gap-2 sm:flex-row", className)}
    >
      {items.map((item) => {
        const isCurrent = item.number === current;
        return (
          <li
            key={item.number}
            className="min-w-0 sm:min-w-[7rem]"
            style={{ flexGrow: timelineSpan(item, referenceYear), flexBasis: 0 }}
          >
            <Link
              href={item.href}
              aria-current={isCurrent ? "page" : undefined}
              className={cn(
                "flex h-full min-h-11 flex-col gap-1 rounded-md border p-3 text-sm outline-none",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                isCurrent ? "border-primary bg-accent" : "bg-card hover:bg-accent"
              )}
            >
              <span className="font-semibold">
                {ordinal(item.number)} législature
                {item.endYear === null && <span className="font-normal">, en cours</span>}
              </span>
              <span className={isCurrent ? "text-accent-foreground" : "text-muted-foreground"}>
                {periodLabel(item)}
              </span>
              {item.startEvent && (
                <span
                  className={cn(
                    "text-xs",
                    isCurrent ? "text-accent-foreground" : "text-muted-foreground"
                  )}
                >
                  {item.startEvent}
                </span>
              )}
              <DataStatus
                status={item.status}
                scope={item.statusScope}
                showScope
                className="mt-auto"
              />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
