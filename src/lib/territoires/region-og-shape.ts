import { REGION_OUTLINES } from "@/config/territoires-shapes";

/**
 * The region outline as an SVG data URI, departments drawn as hairlines. Null when no outline
 * exists (unknown name): the card then carries no shape rather than another territory's.
 */
export function regionOutlineDataUri(regionName: string): string | null {
  const outline = REGION_OUTLINES[regionName];
  if (!outline) return null;
  const paths = Object.values(outline.departments)
    .map(
      (d) =>
        `<path d="${d}" fill="#ffffff" fill-opacity="0.12" stroke="#ffffff" stroke-opacity="0.7" stroke-width="1.2"/>`
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${outline.viewBox}" fill-rule="evenodd" stroke-linejoin="round">${paths}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
