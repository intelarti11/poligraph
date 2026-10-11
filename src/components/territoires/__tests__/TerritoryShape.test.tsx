import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEPARTMENTS } from "@/config/departments";
import {
  DEPARTMENT_OUTLINES,
  FRANCE_MINI_OUTLINE,
  FRANCE_OUTLINE,
  REGION_OUTLINES,
  projectInDepartment,
} from "@/config/territoires-shapes";
import { TerritoryShape } from "../TerritoryShape";

const ROOT = process.cwd();
const METROPOLE = Object.keys(DEPARTMENTS).filter((code) => code.length === 2);
const domtom = JSON.parse(readFileSync(join(ROOT, "public/data/domtom.geojson"), "utf-8")) as {
  features: { properties: { code: string }; geometry: { type: string } }[];
};

function viewBoxSize(viewBox: string): [number, number] {
  const [, , w, h] = viewBox.split(" ").map(Number);
  return [w!, h!];
}

describe("territoires-shapes (generated)", () => {
  it("covers the 96 metropolitan departments in every drawing", () => {
    expect(METROPOLE).toHaveLength(96);
    for (const code of METROPOLE) {
      expect(DEPARTMENT_OUTLINES[code]?.d, code).toMatch(/^M\d/);
      expect(FRANCE_OUTLINE.departments[code], code).toMatch(/^M\d/);
      expect(FRANCE_MINI_OUTLINE.departments[code], code).toMatch(/^M\d/);
    }
  });

  it("gives an outline to an overseas department exactly when domtom.geojson has a polygon", () => {
    expect(domtom.features.length).toBeGreaterThan(0);
    for (const { properties, geometry } of domtom.features) {
      const hasPolygon = geometry.type === "Polygon" || geometry.type === "MultiPolygon";
      expect(properties.code in DEPARTMENT_OUTLINES, properties.code).toBe(hasPolygon);
    }
  });

  it("has one outline per metropolitan region, holding exactly its departments", () => {
    const regions = new Set(METROPOLE.map((code) => DEPARTMENTS[code]!.region));
    expect(Object.keys(REGION_OUTLINES).sort()).toEqual([...regions].sort());
    for (const [name, outline] of Object.entries(REGION_OUTLINES)) {
      const expected = METROPOLE.filter((code) => DEPARTMENTS[code]!.region === name);
      expect(Object.keys(outline.departments).sort(), name).toEqual(expected.sort());
    }
  });

  it("stays within its size budget", () => {
    const bytes = statSync(join(ROOT, "src/config/territoires-shapes.ts")).size;
    expect(bytes).toBeLessThan(400 * 1024);
    for (const [code, outline] of Object.entries(DEPARTMENT_OUTLINES)) {
      expect(outline.d.length, code).toBeLessThan(8 * 1024);
    }
  });

  it("projects Rennes inside the Ille-et-Vilaine frame", () => {
    const point = projectInDepartment("35", -1.68, 48.11);
    const [w, h] = viewBoxSize(DEPARTMENT_OUTLINES["35"]!.viewBox);
    expect(point).not.toBeNull();
    const [x, y] = point!;
    // Rennes sits near the middle of the department, not on an edge.
    expect(x).toBeGreaterThan(w * 0.3);
    expect(x).toBeLessThan(w * 0.7);
    expect(y).toBeGreaterThan(h * 0.3);
    expect(y).toBeLessThan(h * 0.7);
  });

  it("puts north at the top and Corsica in the south-east of France", () => {
    const [, h] = viewBoxSize(FRANCE_OUTLINE.viewBox);
    const firstY = (d: string) => Number(d.match(/^M\d+ (\d+)/)![1]);
    expect(firstY(FRANCE_OUTLINE.departments["59"]!)).toBeLessThan(h * 0.15);
    expect(firstY(FRANCE_OUTLINE.departments["2A"]!)).toBeGreaterThan(h * 0.8);
  });
});

describe("TerritoryShape", () => {
  it("renders a decorative svg for a department, with the commune marker", () => {
    const html = renderToStaticMarkup(
      <TerritoryShape kind="departement" code="35" marker={{ lat: 48.11, lon: -1.68 }} />
    );
    expect(html).toMatch(/^<svg[^>]*aria-hidden="true"/);
    expect(html).toContain('focusable="false"');
    expect(html).toContain("data-territory-marker");
  });

  it("drops a marker that falls outside the department", () => {
    const html = renderToStaticMarkup(
      <TerritoryShape kind="departement" code="35" marker={{ lat: 48.86, lon: 2.35 }} />
    );
    expect(html).toContain("<path");
    expect(html).not.toContain("data-territory-marker");
  });

  it.each(["99", "987", "975", "971", "976", ""])("renders nothing for %j", (code) => {
    expect(renderToStaticMarkup(<TerritoryShape kind="departement" code={code} />)).toBe("");
    expect(
      renderToStaticMarkup(<TerritoryShape kind="france" size="mini" highlightDepartment={code} />)
    ).toBe("");
  });

  it("renders nothing for an unknown region", () => {
    expect(renderToStaticMarkup(<TerritoryShape kind="region" region="Guadeloupe" />)).toBe("");
    expect(renderToStaticMarkup(<TerritoryShape kind="region" region="toString" />)).toBe("");
    expect(
      renderToStaticMarkup(<TerritoryShape kind="france" highlightRegion="Région fictive" />)
    ).toBe("");
  });

  it("draws a region with each of its departments", () => {
    const html = renderToStaticMarkup(<TerritoryShape kind="region" region="Bretagne" />);
    expect(html.match(/<path /g)).toHaveLength(4);
  });

  it("marks a department too small to see in the inset with a halo", () => {
    const paris = renderToStaticMarkup(
      <TerritoryShape kind="france" size="mini" highlightDepartment="75" />
    );
    const rennes = renderToStaticMarkup(
      <TerritoryShape kind="france" size="mini" highlightDepartment="35" />
    );
    expect(paris).toContain("<circle");
    expect(rennes).not.toContain("<circle");
  });

  it("keeps region links out of the tab order", () => {
    const html = renderToStaticMarkup(
      <TerritoryShape kind="france" regionHref={(region) => `/territoires/${region}`} />
    );
    const anchors = html.match(/<a [^>]*>/g) ?? [];
    expect(anchors).toHaveLength(13);
    for (const a of anchors) expect(a).toContain('tabindex="-1"');
    expect(html).toMatch(/^<svg[^>]*aria-hidden="true"/);
  });
});
