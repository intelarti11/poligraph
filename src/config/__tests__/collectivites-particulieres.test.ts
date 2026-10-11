import { describe, expect, it } from "vitest";
import {
  COLLECTIVITES_PARTICULIERES,
  getCollectivitesForCommune,
  getCollectivitesForDepartment,
  getCollectivitesForRegion,
} from "@/config/collectivites-particulieres";
import { DEPARTMENTS } from "@/config/departments";
import { getRegionByCode } from "@/config/regions";

const OFFICIAL_HOSTS = ["www.legifrance.gouv.fr", "www.collectivites-locales.gouv.fr"];

describe("collectivités à statut particulier", () => {
  it("cite une source officielle par entrée", () => {
    for (const entry of COLLECTIVITES_PARTICULIERES) {
      const url = new URL(entry.source.url);
      expect(url.protocol, entry.id).toBe("https:");
      expect(OFFICIAL_HOSTS, entry.id).toContain(url.host);
      expect(entry.source.label.length, entry.id).toBeGreaterThan(10);
    }
  });

  it("rattache chaque entrée à au moins un territoire connu", () => {
    for (const entry of COLLECTIVITES_PARTICULIERES) {
      const scopes = [
        ...(entry.communes ?? []),
        ...(entry.departements ?? []),
        ...(entry.regions ?? []),
      ];
      expect(scopes.length, entry.id).toBeGreaterThan(0);
      for (const d of entry.departements ?? []) expect(DEPARTMENTS[d], d).toBeDefined();
      for (const r of entry.regions ?? []) expect(getRegionByCode(r), r).not.toBeNull();
      for (const c of entry.communes ?? []) expect(c).toMatch(/^[0-9][0-9AB][0-9]{3}$/);
    }
  });

  it("écrit des notes courtes, sans tiret cadratin ni demi-cadratin", () => {
    for (const entry of COLLECTIVITES_PARTICULIERES) {
      expect(entry.note, entry.id).not.toMatch(/[–—]/);
      expect(entry.note.length, entry.id).toBeLessThan(260);
    }
    expect(new Set(COLLECTIVITES_PARTICULIERES.map((c) => c.id)).size).toBe(
      COLLECTIVITES_PARTICULIERES.length
    );
  });

  it("couvre les cas de la décision : Paris, Lyon, Marseille, Corse, Alsace, Guyane, Martinique, Mayotte", () => {
    expect(getCollectivitesForCommune("75056").map((c) => c.id)).toContain("ville-de-paris");
    expect(getCollectivitesForDepartment("75").map((c) => c.id)).toContain("ville-de-paris");
    expect(getCollectivitesForCommune("69123").map((c) => c.collectivite)).toContain(
      "Métropole de Lyon"
    );
    expect(getCollectivitesForDepartment("69")).toHaveLength(1);
    expect(getCollectivitesForCommune("13055").map((c) => c.id)).toEqual(["marseille-secteurs"]);
    expect(getCollectivitesForDepartment("2a").map((c) => c.id)).toEqual(["collectivite-de-corse"]);
    expect(getCollectivitesForRegion("94").map((c) => c.id)).toEqual(["collectivite-de-corse"]);
    expect(getCollectivitesForDepartment("67")).toHaveLength(1);
    expect(getCollectivitesForDepartment("68")).toHaveLength(1);
    expect(getCollectivitesForRegion("03")).toHaveLength(1);
    expect(getCollectivitesForRegion("02")).toHaveLength(1);
    expect(getCollectivitesForDepartment("976")).toHaveLength(1);
  });

  it("ne dit rien d'un territoire de droit commun", () => {
    expect(getCollectivitesForCommune("35238")).toEqual([]);
    expect(getCollectivitesForDepartment("35")).toEqual([]);
    expect(getCollectivitesForRegion("53")).toEqual([]);
  });
});
