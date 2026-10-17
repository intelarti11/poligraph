import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  anOrgan: { upsert: vi.fn(), groupBy: vi.fn() },
}));
const extractZipMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/parsing/unzip", () => ({ extractZip: extractZipMock }));

import { syncAnOrganes } from "@/services/sync/an-organes";

function organFile(uid: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    organe: {
      uid,
      codeType: "GP",
      libelle: `Groupe ${uid}`,
      libelleAbrege: uid,
      viMoDe: { dateDebut: "2024-07-18", dateFin: null },
      legislature: "17",
      ...extra,
    },
  });
}

/** Simulates the extraction by writing the organ files where the archive would put them. */
function stubArchive(files: Record<string, string>) {
  extractZipMock.mockImplementation((_zip: string, outputDir: string) => {
    const dir = path.join(outputDir, "json", "organe");
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files))
      writeFileSync(path.join(dir, name), content);
  });
}

describe("syncAnOrganes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) })
    );
    dbMock.anOrgan.upsert.mockResolvedValue({});
  });

  it("writes only parliamentary groups of the 15th to 17th legislatures, into AnOrgan only", async () => {
    stubArchive({
      "PO1.json": organFile("PO1"),
      "PO2.json": organFile("PO2", { codeType: "COMPER" }),
      "PO3.json": organFile("PO3", { legislature: "14" }),
      "PO4.json": "{not json",
    });

    const stats = await syncAnOrganes(false);

    expect(dbMock.anOrgan.upsert).toHaveBeenCalledTimes(1);
    expect(dbMock.anOrgan.upsert.mock.calls[0]![0]).toMatchObject({
      where: { organeRef: "PO1" },
      create: { organeRef: "PO1", legislature: 17, label: "Groupe PO1" },
    });
    expect(stats).toMatchObject({
      filesRead: 4,
      groupsFound: 1,
      written: 1,
      unreadable: 1,
      skipped: { "not-parliamentary-group": 1, "legislature-out-of-scope": 1 },
      errors: [],
    });
  });

  it("writes nothing in dry-run but still reports what it found", async () => {
    stubArchive({ "PO1.json": organFile("PO1") });

    const stats = await syncAnOrganes(true);

    expect(dbMock.anOrgan.upsert).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ groupsFound: 1, written: 0 });
  });

  it("reports an HTTP failure and writes nothing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    const stats = await syncAnOrganes(false);

    expect(dbMock.anOrgan.upsert).not.toHaveBeenCalled();
    expect(stats.errors[0]).toContain("HTTP 503");
  });
});
