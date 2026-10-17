import { describe, expect, it } from "vitest";
import { AN_LEGISLATURE_COVERAGE, AN_SOURCES } from "@/config/legislatures";
import { COVERAGE_LEVEL_LABELS, DATASET_DESCRIPTIONS } from "./../legislature-labels";

const NORMALIZE = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "");

describe("textes publics des législatures", () => {
  it("les descriptions de jeu restent vraies à tout niveau de couverture", () => {
    for (const [key, text] of Object.entries(DATASET_DESCRIPTIONS)) {
      expect(text, key).not.toMatch(/import|repris|enregistr|référencé|disponible/i);
      expect(text, key).toMatch(/\.$/);
    }
  });

  it("une note publique ne répète ni la description ni le niveau affiché", () => {
    for (const leg of AN_LEGISLATURE_COVERAGE) {
      for (const ds of leg.datasets) {
        const tag = `L${leg.number}/${ds.dataset}`;
        if (!ds.publicNote) continue;
        expect(NORMALIZE(ds.publicNote), tag).not.toContain(
          NORMALIZE(DATASET_DESCRIPTIONS[ds.dataset])
        );
        if (ds.level === "absent") expect(ds.publicNote, tag).not.toMatch(/pas encore import/i);
        if (ds.level === "withheld") expect(ds.publicNote, tag).not.toMatch(/non publi/i);
        expect(ds.publicNote, tag).not.toMatch(/[—–]/);
      }
    }
  });

  it("absent et masqué gardent deux libellés distincts", () => {
    expect(COVERAGE_LEVEL_LABELS.absent).toBe("Pas encore importé");
    expect(COVERAGE_LEVEL_LABELS.withheld).toBe("Non publié");
  });

  it("aucun intitulé de source ne montre une date brute AAAA-MM-JJ", () => {
    for (const s of AN_SOURCES) expect(s.label, s.id).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("la date de consultation est écrite en français, les dates juridiques restent intactes", () => {
    const label = (id: string) => AN_SOURCES.find((s) => s.id === id)!.label;
    expect(label("lo-121")).toContain("relue le 16 octobre 2026");
    expect(label("lo-121")).toContain("depuis le 16 mai 2001");
    expect(label("lo-121")).toContain("loi organique n° 2001-419");
    expect(label("decret-2024-527")).toContain("9 juin 2024");
  });
});
