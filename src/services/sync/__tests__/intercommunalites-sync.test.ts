// @vitest-environment node
import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EPCI_COMPOSITION,
  EPCI_LIST,
  EPT_COMPOSITION,
  EPT_LIST,
  MGP,
  PLAINE_COMMUNE,
  RENNES_METRO,
  epciXlsx,
  eptXlsx,
} from "./intercommunalites-fixtures";

const mocks = vi.hoisted(() => ({
  syncFindUnique: vi.fn(),
  syncUpsert: vi.fn(),
  communeFindMany: vi.fn(),
  bodyFindMany: vi.fn(),
  bodyCreateMany: vi.fn(),
  bodyUpdate: vi.fn(),
  bodyUpdateMany: vi.fn(),
  memberFindMany: vi.fn(),
  memberCreateMany: vi.fn(),
  memberUpdateMany: vi.fn(),
  memberDeleteMany: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    syncMetadata: { findUnique: mocks.syncFindUnique, upsert: mocks.syncUpsert },
    commune: { findMany: mocks.communeFindMany },
    intercommunalite: {
      findMany: mocks.bodyFindMany,
      createMany: mocks.bodyCreateMany,
      update: mocks.bodyUpdate,
      updateMany: mocks.bodyUpdateMany,
    },
    communeIntercommunalite: {
      findMany: mocks.memberFindMany,
      createMany: mocks.memberCreateMany,
      updateMany: mocks.memberUpdateMany,
      deleteMany: mocks.memberDeleteMany,
    },
    $queryRaw: mocks.queryRaw,
  },
}));

import { syncIntercommunalites } from "../intercommunalites";

function zipped(name: string, xlsx: Buffer): ArrayBuffer {
  const zip = new AdmZip();
  zip.addFile(name, xlsx);
  const buf = zip.toBuffer();
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const COMMUNES = [
  { id: "35238", departmentCode: "35" },
  { id: "69123", departmentCode: "69" },
  { id: "75056", departmentCode: "75" },
  { id: "93066", departmentCode: "93" },
  { id: "29155", departmentCode: "29" },
  { id: "98735", departmentCode: "987" },
];

const SITUATION = new Date("2026-01-01T00:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  const epci = zipped("EPCI.xlsx", epciXlsx(EPCI_LIST, EPCI_COMPOSITION));
  const ept = zipped("EPT.xlsx", eptXlsx(EPT_LIST, EPT_COMPOSITION));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("epci_au_01-01-2026.zip")) return new Response(epci);
      if (url.endsWith("ept_au_01-01-2026.zip")) return new Response(ept);
      return new Response("", { status: 404 });
    })
  );
  mocks.queryRaw.mockResolvedValue([{ ready: true }]);
  mocks.syncFindUnique.mockResolvedValue(null);
  mocks.communeFindMany.mockResolvedValue(COMMUNES);
  mocks.bodyFindMany.mockResolvedValue([]);
  mocks.memberFindMany.mockResolvedValue([]);
});

afterEach(() => vi.unstubAllGlobals());

describe("syncIntercommunalites", () => {
  it("en dry-run, rapporte sans rien écrire", async () => {
    const report = await syncIntercommunalites({ dryRun: true, year: 2026 });

    expect(report.situationDate).toBe("2026-01-01");
    expect(report.bodiesByNature).toEqual({ METRO: 2, MET69: 1, EPT: 1 });
    expect(report.toCreate).toBe(6);
    // Papeete is in the base, not in the source: its intercommunality stays not established.
    expect(report.departments.find((d) => d.departmentCode === "987")).toMatchObject({
      inBase: 1,
      absentesDeLaSource: 1,
      rattachees: 0,
    });
    expect(report.departments.find((d) => d.departmentCode === "29")?.sansObjet).toBe(1);
    expect(report.departments.find((d) => d.departmentCode === "93")?.ept).toBe(1);
    for (const write of [
      mocks.bodyCreateMany,
      mocks.bodyUpdate,
      mocks.bodyUpdateMany,
      mocks.memberCreateMany,
      mocks.memberUpdateMany,
      mocks.syncUpsert,
    ]) {
      expect(write).not.toHaveBeenCalled();
    }
  });

  it("en dry-run, fonctionne avant la création des tables, sans les lire", async () => {
    mocks.queryRaw.mockResolvedValue([{ ready: false }]);
    const report = await syncIntercommunalites({ dryRun: true, year: 2026 });
    expect(report.tablesReady).toBe(false);
    expect(mocks.bodyFindMany).not.toHaveBeenCalled();
    expect(mocks.memberFindMany).not.toHaveBeenCalled();
    await expect(syncIntercommunalites({ dryRun: false, year: 2026 })).rejects.toThrow(
      /Tables absentes/
    );
  });

  it("ouvre les appartenances datées à la situation du fichier au premier import", async () => {
    await syncIntercommunalites({ dryRun: false, year: 2026 });

    const created = mocks.memberCreateMany.mock.calls.flatMap(
      (c) => (c[0] as { data: Record<string, unknown>[] }).data
    );
    expect(created).toHaveLength(6);
    expect(
      created.find((m) => m.communeId === "93066" && m.siren === PLAINE_COMMUNE)
    ).toMatchObject({
      validFrom: SITUATION,
      situationDate: SITUATION,
      sourceLabel: "INSEE, établissements publics territoriaux au 1er janvier 2026",
    });
    expect(created.find((m) => m.communeId === "29155")).toMatchObject({ siren: null });
    expect(created.some((m) => m.communeId === "98735")).toBe(false);
    expect(mocks.syncUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ cursor: "2026-01-01" }),
      })
    );
  });

  it("ferme sans supprimer une appartenance que le fichier ne liste plus", async () => {
    mocks.memberFindMany.mockResolvedValue([
      { id: "old", communeId: "35238", siren: "200000172" },
      { id: "keep", communeId: "75056", siren: MGP },
    ]);
    await syncIntercommunalites({ dryRun: false, year: 2026 });

    expect(mocks.memberUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["old"] }, validTo: null },
      data: { validTo: SITUATION },
    });
    expect(mocks.memberUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["keep"] } },
      data: { situationDate: SITUATION },
    });
    const created = mocks.memberCreateMany.mock.calls.flatMap(
      (c) => (c[0] as { data: { communeId: string; siren: string | null }[] }).data
    );
    expect(created.some((m) => m.communeId === "75056")).toBe(false);
    expect(created.some((m) => m.communeId === "35238" && m.siren === RENNES_METRO)).toBe(true);
    expect(mocks.memberDeleteMany).not.toHaveBeenCalled();
  });

  it("refuse un fichier plus ancien que le dernier importé", async () => {
    mocks.syncFindUnique.mockResolvedValue({ cursor: "2027-01-01" });
    await expect(syncIntercommunalites({ dryRun: false, year: 2026 })).rejects.toThrow(
      /antérieure/
    );
    expect(mocks.memberCreateMany).not.toHaveBeenCalled();
  });

  it("se rabat sur l'année précédente quand l'INSEE n'a pas encore publié", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-15T00:00:00Z"));
    try {
      const report = await syncIntercommunalites({ dryRun: true });
      expect(report.fileUrls.epci).toMatch(/epci_au_01-01-2026\.zip$/);
    } finally {
      vi.useRealTimers();
    }
  });
});
