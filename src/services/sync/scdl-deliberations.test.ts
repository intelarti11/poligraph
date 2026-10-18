import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/fetch-public-photo", () => ({
  checkPublicUrl: async (url: string) => new URL(url),
}));

import { reportScdlSource } from "./scdl-deliberations";
import type { ScdlSource } from "@/config/scdl-sources";

const HEADER =
  "COLL_NOM;COLL_SIRET;DELIB_ID;DELIB_DATE;DELIB_MATIERE_CODE;DELIB_MATIERE_NOM;DELIB_OBJET;TYPE_ACTE";
const CSV = [
  HEADER,
  "Ville de Brest;;1;2026-03-05;1.1;Marchés;Budget primitif;Délibération",
  "Ville de Brest;;2;2026-03-06;1.1;Marchés;Voirie;Délibération",
  "Ville de Brest;;3;2026-03-07;1.1;Marchés;Stationnement;Arrêté",
  "Ville de Brest;;4;2026-03-08;1.1;Marchés;Subvention;Décision",
].join("\n");

const source: ScdlSource = {
  key: "test",
  label: "Test",
  datasetId: "abc",
  actTypes: ["Délibération"],
  authorities: [
    { name: "Ville de Brest", institution: { kind: "CONSEIL_MUNICIPAL", communeId: "29019" } },
  ],
};

afterEach(() => vi.unstubAllGlobals());

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/api/1/datasets/")) {
        return Response.json({
          title: "Actes",
          license: "odc-odbl",
          resources: [{ title: "actes", format: "csv", url: "https://example.org/actes.csv" }],
        });
      }
      return new Response(CSV);
    })
  );
}

describe("reportScdlSource", () => {
  it("garde les types d'acte exclus dans le décompte des types d'acte", async () => {
    stubFetch();
    const report = await reportScdlSource(source);

    expect(report.excludedByActType).toBe(2);
    expect(report.candidates).toBe(2);
    expect(Object.fromEntries(report.actTypes.map((t) => [t.type, t.rows]))).toEqual({
      Délibération: 2,
      Arrêté: 1,
      Décision: 1,
    });
  });
});
