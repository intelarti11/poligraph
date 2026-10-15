import { Badge } from "@/components/ui/badge";
import {
  DATA_STATUS_DESCRIPTIONS,
  DATA_STATUS_LABELS,
  type DataStatusKind,
} from "@/lib/parlement/data-status";

const GLYPHS: Record<DataStatusKind, string> = {
  complete: "✓",
  partial: "◐",
  unverified: "?",
  pending: "…",
};

const VARIANTS = {
  complete: "success",
  partial: "warning",
  unverified: "neutral",
  pending: "outline",
} as const;

interface DataStatusProps {
  status: DataStatusKind;
  /** Périmètre auquel le statut s'applique : « Composition », « Votes individuels »… */
  scope: string;
  /** Écrit le périmètre devant le libellé (« Composition : partiel »). */
  showScope?: boolean;
  /** Remplace le libellé par défaut quand le contexte demande plus de précision. */
  label?: string;
  className?: string;
}

/**
 * DataStatus : dit à quel point une donnée est complète, jamais par la couleur seule.
 * Le glyphe et le libellé portent l'information, la variante n'est qu'un renfort.
 */
export function DataStatus({
  status,
  scope,
  showScope = false,
  label,
  className,
}: DataStatusProps) {
  return (
    <Badge
      variant={VARIANTS[status]}
      className={className}
      title={`${scope} : ${DATA_STATUS_DESCRIPTIONS[status]}`}
      data-status={status}
    >
      <span aria-hidden="true">{GLYPHS[status]}</span>
      <span className={showScope ? undefined : "sr-only"}>
        {showScope ? `${scope} : ` : `Statut des données (${scope}) : `}
      </span>
      {label ?? DATA_STATUS_LABELS[status]}
    </Badge>
  );
}
