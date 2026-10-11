/**
 * Reader-facing wording of a population vintage (lot 1.7 Territoires). Pure, no server
 * import, so components and tests can use it directly.
 */

/** "1er janvier 2026": French ordinal for the first day of the month. */
export function formatEffectiveDate(iso: string): string {
  const text = new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return text.replace(/^1 /, "1er ");
}

/** "Population municipale 2023, en vigueur au 1er janvier 2026 (INSEE)". */
export function populationVintageLabel(v: {
  millesime: number;
  effectiveFrom: string;
  producer: string;
}): string {
  return `Population municipale ${v.millesime}, en vigueur au ${formatEffectiveDate(v.effectiveFrom)} (${v.producer})`;
}
