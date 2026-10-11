import { describe, expect, it } from "vitest";
import {
  isIndexableTerritoireCommune,
  territoireCommuneRobotsMetadata,
  TERRITOIRE_COMMUNE_MIN_POPULATION,
} from "../territoire-robots";
import { COMMUNE_MIN_POPULATION } from "../commune-robots";

const NOINDEX_FOLLOW = { robots: { index: false, follow: true } };

describe("indexation des pages commune Territoires", () => {
  it("partage le seuil démographique des municipales", () => {
    expect(TERRITOIRE_COMMUNE_MIN_POPULATION).toBe(COMMUNE_MIN_POPULATION);
  });

  it("indexe une commune d'au moins 1 000 habitants avec un maire public établi", () => {
    const signals = { population: TERRITOIRE_COMMUNE_MIN_POPULATION, maireEtabli: true };
    expect(isIndexableTerritoireCommune(signals)).toBe(true);
    expect(territoireCommuneRobotsMetadata(signals)).toEqual({});
  });

  it("n'indexe pas une grande commune dont le maire n'est pas établi", () => {
    expect(territoireCommuneRobotsMetadata({ population: 230_000, maireEtabli: false })).toEqual(
      NOINDEX_FOLLOW
    );
  });

  it("n'indexe pas une petite commune, même avec un maire établi", () => {
    expect(
      territoireCommuneRobotsMetadata({
        population: TERRITOIRE_COMMUNE_MIN_POPULATION - 1,
        maireEtabli: true,
      })
    ).toEqual(NOINDEX_FOLLOW);
  });

  it("ne présume rien d'une population inconnue", () => {
    expect(isIndexableTerritoireCommune({ population: null, maireEtabli: true })).toBe(false);
    expect(isIndexableTerritoireCommune({ population: undefined, maireEtabli: true })).toBe(false);
  });
});
