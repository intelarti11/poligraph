import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEPARTMENTS } from "@/config/departments";
import { REGIONS } from "@/config/regions";
import {
  DEPARTMENT_OUTLINES,
  FRANCE_DROM_INSETS,
  FRANCE_MINI_OUTLINE,
  FRANCE_OUTLINE,
  REGION_OUTLINES,
  projectInDepartment,
} from "@/config/territoires-shapes";
import { TerritoryShape } from "../TerritoryShape";

const ROOT = process.cwd();
const METROPOLE = Object.keys(DEPARTMENTS).filter((code) => code.length === 2);
const OUTRE_MER = ["971", "972", "973", "974", "975", "976", "977", "978", "986", "987", "988"];
const outreMer = JSON.parse(readFileSync(join(ROOT, "public/data/outremer.geojson"), "utf-8")) as {
  features: { properties: { code: string }; geometry: { type: string } }[];
};

/** Rings of a generated path (`M x y l dx dy ... z`), in viewBox units. */
function rings(d: string): [number, number][][] {
  return d
    .split("z")
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^M(-?\d+) (-?\d+)l?(.*)$/)!;
      let x = Number(m[1]);
      let y = Number(m[2]);
      const points: [number, number][] = [[x, y]];
      const deltas = (m[3]!.match(/-?\d+/g) ?? []).map(Number);
      for (let i = 0; i + 1 < deltas.length; i += 2) {
        x += deltas[i]!;
        y += deltas[i + 1]!;
        points.push([x, y]);
      }
      return points;
    });
}

/** 0 inside the outline, else the distance to its nearest edge. */
function distanceToOutline([px, py]: [number, number], d: string): number {
  let inside = false;
  let best = Infinity;
  for (const ring of rings(d)) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      const dx = xj - xi;
      const dy = yj - yi;
      const length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, ((px - xi) * dx + (py - yi) * dy) / length)) : 0;
      best = Math.min(best, Math.hypot(px - (xi + t * dx), py - (yi + t * dy)));
    }
  }
  return inside ? 0 : best;
}

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

  it("gives every DROM and COM its own outline, from a polygon of outremer.geojson", () => {
    const sourced = outreMer.features.map((f) => f.properties.code).sort();
    expect(sourced).toEqual(OUTRE_MER);
    for (const { properties, geometry } of outreMer.features) {
      expect(geometry.type, properties.code).toBe("MultiPolygon");
      expect(DEPARTMENT_OUTLINES[properties.code]?.d, properties.code).toMatch(/^M\d/);
    }
    // No department page, no outline: never a stand-in.
    expect(Object.keys(DEPARTMENT_OUTLINES)).not.toContain("984");
    expect(Object.keys(DEPARTMENT_OUTLINES)).not.toContain("989");
  });

  it("keeps every island group of an archipelago", () => {
    // Guadeloupe: Basse-Terre and Grande-Terre, Marie-Galante, La Désirade, Les Saintes.
    expect(rings(DEPARTMENT_OUTLINES["971"]!.d).length).toBeGreaterThanOrEqual(5);
    // Wallis, Futuna and Alofi.
    expect(rings(DEPARTMENT_OUTLINES["986"]!.d)).toHaveLength(3);
    // Five archipelagos over about 2,300 km: dozens of islands, most drawn as dots.
    expect(rings(DEPARTMENT_OUTLINES["987"]!.d).length).toBeGreaterThan(80);
  });

  it("has one outline per region, holding exactly its departments", () => {
    const regions = new Set(METROPOLE.map((code) => DEPARTMENTS[code]!.region));
    const drom = REGIONS.filter((r) => r.outreMer);
    expect(drom).toHaveLength(5);
    expect(Object.keys(REGION_OUTLINES).sort()).toEqual(
      [...regions, ...drom.map((r) => r.name)].sort()
    );
    for (const [name, outline] of Object.entries(REGION_OUTLINES)) {
      const region = drom.find((r) => r.name === name);
      const expected = region
        ? [...region.departmentCodes]
        : METROPOLE.filter((code) => DEPARTMENTS[code]!.region === name);
      expect(Object.keys(outline.departments).sort(), name).toEqual(expected.sort());
    }
    expect(REGION_OUTLINES["La Réunion"]!.departments["974"]).toBe(DEPARTMENT_OUTLINES["974"]!.d);
  });

  // Commune coordinates as stored in production (geo.api.gouv.fr). The expected position, as
  // a share of the frame, is the geography: Saint-Denis on the north coast, Cayenne in the
  // north-east, Mamoudzou on the east coast, Papeete in the Society Islands west of the
  // Tuamotu, Nouméa in the south of Grande Terre, Saint-Pierre in the south-east.
  it.each([
    ["974", "Saint-Denis", -20.9434, 55.4444, 0.37, 0.15],
    ["973", "Cayenne", 4.9464, -52.3319, 0.75, 0.23],
    ["976", "Mamoudzou", -12.7875, 45.1964, 0.62, 0.42],
    ["987", "Papeete", -17.5572, -149.5555, 0.26, 0.45],
    ["988", "Nouméa", -22.3363, 166.4076, 0.62, 0.83],
    ["975", "Saint-Pierre", 46.788, -56.1805, 0.81, 0.9],
  ])("projects %s %s onto its own territory", (code, _name, lat, lon, fx, fy) => {
    const outline = DEPARTMENT_OUTLINES[code]!;
    const [w, h] = viewBoxSize(outline.viewBox);
    const point = projectInDepartment(code, lon, lat)!;
    expect(point[0] / w).toBeCloseTo(fx, 1);
    expect(point[1] / h).toBeCloseTo(fy, 1);
    // On the coast or inland, within a few units of a 300-unit drawing.
    expect(distanceToOutline(point, outline.d)).toBeLessThanOrEqual(4);
  });

  it("places the five DROM in boxes under metropolitan France, each linked to its region", () => {
    const [, franceHeight] = viewBoxSize(FRANCE_OUTLINE.viewBox);
    const [width, height] = viewBoxSize(FRANCE_DROM_INSETS.viewBox);
    expect(FRANCE_DROM_INSETS.boxes.map((b) => b.code)).toEqual([
      "971",
      "972",
      "973",
      "974",
      "976",
    ]);
    for (const { code, region, box, d } of FRANCE_DROM_INSETS.boxes) {
      expect(REGIONS.find((r) => r.name === region)?.departmentCodes, code).toEqual([code]);
      const [x, y, w, h] = box;
      expect(y).toBeGreaterThan(franceHeight);
      expect(x + w).toBeLessThanOrEqual(width);
      expect(y + h).toBeLessThanOrEqual(height);
      // Every vertex stays inside its own box.
      for (const ring of rings(d))
        for (const [px, py] of ring) {
          expect(px, code).toBeGreaterThanOrEqual(x);
          expect(px, code).toBeLessThanOrEqual(x + w);
          expect(py, code).toBeGreaterThanOrEqual(y);
          expect(py, code).toBeLessThanOrEqual(y + h);
        }
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

  it.each(["99", "984", "989", ""])("renders nothing for %j", (code) => {
    expect(renderToStaticMarkup(<TerritoryShape kind="departement" code={code} />)).toBe("");
    expect(
      renderToStaticMarkup(<TerritoryShape kind="france" size="mini" highlightDepartment={code} />)
    ).toBe("");
    expect(renderToStaticMarkup(<TerritoryShape kind="france" highlightDepartment={code} />)).toBe(
      ""
    );
  });

  it.each(OUTRE_MER)("draws %s with its own outline and the commune marker", (code) => {
    const outline = DEPARTMENT_OUTLINES[code]!;
    const html = renderToStaticMarkup(<TerritoryShape kind="departement" code={code} />);
    expect(html).toMatch(/^<svg[^>]*aria-hidden="true"/);
    expect(html).toContain(`viewBox="${outline.viewBox}"`);
    expect(html).toContain(`d="${outline.d}"`);
  });

  it("keeps the overseas territories out of the mini France inset", () => {
    for (const code of ["971", "974", "987"]) {
      expect(
        renderToStaticMarkup(
          <TerritoryShape kind="france" size="mini" highlightDepartment={code} />
        )
      ).toBe("");
    }
    expect(
      renderToStaticMarkup(
        <TerritoryShape kind="france" size="mini" highlightRegion="Guadeloupe" />
      )
    ).toBe("");
  });

  it("highlights a DROM in its box on the full map", () => {
    const html = renderToStaticMarkup(<TerritoryShape kind="france" highlightRegion="Mayotte" />);
    expect(html).toMatch(/data-drom="976"><rect[^>]*><\/rect><path[^>]*fill-opacity="0.9"/);
    expect(html).toMatch(/data-drom="971"><rect[^>]*><\/rect><path[^>]*fill-opacity="0.1"/);
  });

  it("renders nothing for an unknown region", () => {
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
    expect(anchors).toHaveLength(13 + 5);
    for (const a of anchors) expect(a).toContain('tabindex="-1"');
    for (const name of ["Guadeloupe", "Martinique", "Guyane", "La Réunion", "Mayotte"]) {
      expect(html).toContain(`href="/territoires/${name}"`);
    }
    expect(html).toMatch(/^<svg[^>]*aria-hidden="true"/);
  });
});
