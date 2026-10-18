import { describe, expect, it } from "vitest";
import { MandateType } from "@/generated/prisma";
import { findOverlappingParliamentaryMandates, type MandateInterval } from "../overlaps";

function mandate(
  overrides: Partial<MandateInterval> & Pick<MandateInterval, "id">
): MandateInterval {
  const { id, ...rest } = overrides;
  return {
    id,
    politicianId: "jadot",
    type: MandateType.SENATEUR,
    startDate: new Date("2023-10-01T00:00:00.000Z"),
    endDate: null,
    isCurrent: true,
    ...rest,
  };
}

describe("findOverlappingParliamentaryMandates", () => {
  it("repère l'ancien mandat sénatorial qui chevauche celui de Yannick Jadot", () => {
    const erroneous = mandate({
      id: "erroneous-2020-row",
      startDate: new Date("2020-10-01T00:00:00.000Z"),
      endDate: new Date("2026-02-15T00:00:00.000Z"),
      isCurrent: false,
    });
    const current = mandate({ id: "valid-2023-row" });

    expect(findOverlappingParliamentaryMandates([erroneous, current])).toEqual([
      { first: erroneous, second: current },
    ]);
  });

  it("ne signale pas deux mandats successifs, même avec le même identifiant officiel", () => {
    const previous = mandate({
      id: "previous-term",
      externalId: "senat-21093M",
      startDate: new Date("2020-10-01T00:00:00.000Z"),
      endDate: new Date("2026-10-01T00:00:00.000Z"),
      isCurrent: false,
    });
    const next = mandate({
      id: "next-term",
      externalId: "senat-21093M",
      startDate: new Date("2026-10-01T00:00:00.000Z"),
      endDate: null,
      isCurrent: true,
    });

    expect(findOverlappingParliamentaryMandates([previous, next])).toEqual([]);
  });

  it("ne compare pas des personnes ou des fonctions différentes", () => {
    const senator = mandate({ id: "senator" });
    const deputy = mandate({ id: "deputy", type: MandateType.DEPUTE });
    const otherPerson = mandate({ id: "other-person", politicianId: "other" });

    expect(findOverlappingParliamentaryMandates([senator, deputy, otherPerson])).toEqual([]);
  });

  it("ne présente pas une fin inconnue comme un chevauchement démontré", () => {
    const unknownEnd = mandate({ id: "closed-without-end", isCurrent: false, endDate: null });
    const current = mandate({ id: "current", startDate: new Date("2024-01-01T00:00:00.000Z") });

    expect(findOverlappingParliamentaryMandates([unknownEnd, current])).toEqual([]);
  });
});
