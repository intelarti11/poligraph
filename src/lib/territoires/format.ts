/**
 * French number with a regular no-break space as thousands separator. `toLocaleString("fr-FR")`
 * emits U+202F (narrow no-break space), which the display font lacks: "5 115" rendered "5115".
 */
export function formatNombre(n: number): string {
  return n.toLocaleString("fr-FR").replace(/ /g, " ");
}

/** "1 commune", "5 115 communes". */
export function formatCompte(n: number, singular: string, plural: string): string {
  return `${formatNombre(n)} ${n > 1 ? plural : singular}`;
}
