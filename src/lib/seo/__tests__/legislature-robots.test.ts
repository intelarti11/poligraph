import { describe, expect, it } from "vitest";
import { AN_LEGISLATURE_COVERAGE } from "@/config/legislatures";
import {
  indexableLegislatureNumbers,
  isLegislatureIndexable,
  legislatureRobotsMetadata,
} from "../legislature-robots";

const cov = (n: number) => AN_LEGISLATURE_COVERAGE.find((c) => c.number === n)!;

describe("robots des pages de législature", () => {
  it("laisse indexables les législatures avec des scrutins importés", () => {
    expect(legislatureRobotsMetadata(cov(16))).toEqual({});
    expect(legislatureRobotsMetadata(cov(17))).toEqual({});
  });

  it("passe en noindex,follow la 15e, sans scrutin ni vote importé", () => {
    expect(legislatureRobotsMetadata(cov(15))).toEqual({ robots: { index: false, follow: true } });
  });

  it("ne met dans le sitemap que les pages indexables", () => {
    expect(indexableLegislatureNumbers()).toEqual([16, 17]);
    expect(isLegislatureIndexable(cov(15))).toBe(false);
  });

  it("peut échouer : une 15e avec des scrutins deviendrait indexable", () => {
    const withData = structuredClone(cov(15));
    withData.datasets.find((d) => d.dataset === "scrutins")!.level = "partial";
    expect(isLegislatureIndexable(withData)).toBe(true);
  });
});
