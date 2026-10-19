/**
 * Proportion of pour, contre and abstention among the expressed votes of one group.
 *
 * Decorative: `aria-hidden`. The counts are always written next to it, so nothing is carried by
 * the colour or the length alone. Colours come from the theme variables (`--vote-pour`, ...), which
 * have a dark-mode value. The non-voters are not part of the bar: they are not an expressed vote.
 */
interface PositionCountBarProps {
  forCount: number;
  againstCount: number;
  abstainCount: number;
  className?: string;
}

export function PositionCountBar({
  forCount,
  againstCount,
  abstainCount,
  className,
}: PositionCountBarProps) {
  const total = forCount + againstCount + abstainCount;
  if (total === 0) return null;
  const parts = [
    { key: "pour", count: forCount, color: "var(--vote-pour)" },
    { key: "contre", count: againstCount, color: "var(--vote-contre)" },
    { key: "abstention", count: abstainCount, color: "var(--vote-abstention)" },
  ];
  return (
    <span
      aria-hidden="true"
      data-testid="position-count-bar"
      className={`flex h-2 w-full overflow-hidden rounded-full bg-muted ${className ?? ""}`.trim()}
    >
      {parts.map((part) =>
        part.count > 0 ? (
          <span
            key={part.key}
            data-part={part.key}
            style={{ width: `${(part.count / total) * 100}%`, backgroundColor: part.color }}
          />
        ) : null
      )}
    </span>
  );
}
