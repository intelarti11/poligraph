import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");

/** Body of the first top-level block whose selector starts with `selector`. */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `bloc ${selector} introuvable`).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

function oklch(body: string, token: string): [number, number, number] {
  const match = body.match(new RegExp(`${token}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)`));
  expect(match, `${token} introuvable`).not.toBeNull();
  return [Number(match![1]), Number(match![2]), Number(match![3])];
}

/** Relative luminance of an OKLCH colour (OKLab to linear sRGB, then WCAG weights). */
function luminance([L, C, h]: [number, number, number]): number {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const r = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bl = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// AA asks 4.5:1. Rendered colours are rounded to 8 bits, which cost 0.02 on the dark badge
// (4.51 computed, 4.49 measured by axe), so the floor keeps a margin.
const FLOOR = 4.6;

describe("text on a brand fill", () => {
  it.each([
    ["clair", ":root"],
    ["sombre", ".dark"],
  ])("garde un contraste suffisant en thème %s", (_theme, selector) => {
    const body = block(selector);
    const ratio = contrast(oklch(body, "--brand-foreground"), oklch(body, "--brand"));
    expect(ratio).toBeGreaterThanOrEqual(FLOOR);
  });
});
