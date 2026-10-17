import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  anOrgan: { upsert: vi.fn(), groupBy: vi.fn() },
  $transaction: vi.fn(),
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

/** One valid group for each wanted legislature. */
function validArchive(): Record<string, string> {
  return {
    "PO15.json": organFile("PO15", { legislature: "15" }),
    "PO16.json": organFile("PO16", { legislature: "16" }),
    "PO17.json": organFile("PO17"),
  };
}

/** Simulates the extraction by writing the organ files where the archive would put them. */
function stubArchive(files: Record<string, string>) {
  extractZipMock.mockImplementation((_zip: string, outputDir: string) => {
    const dir = path.join(outputDir, "json", "organe");
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(dir, name), content);
    }
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
    dbMock.anOrgan.upsert.mockImplementation((args: unknown) => ({ upsert: args }));
    dbMock.$transaction.mockResolvedValue([]);
  });

  it("writes the groups of the 15th to 17th legislatures in a single transaction", async () => {
    stubArchive({
      ...validArchive(),
      "PO2.json": organFile("PO2", { codeType: "COMPER" }),
      "PO3.json": organFile("PO3", { legislature: "14" }),
    });

    const stats = await syncAnOrganes(false);

    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
    const operations = dbMock.$transaction.mock.calls[0]![0] as unknown[];
    expect(operations).toHaveLength(3);
    expect(dbMock.anOrgan.upsert.mock.calls.map(([args]) => args.where.organeRef)).toEqual([
      "PO15",
      "PO16",
      "PO17",
    ]);
    expect(stats).toMatchObject({
      filesRead: 5,
      groupsFound: 3,
      written: 3,
      skipped: { "not-parliamentary-group": 1, "legislature-out-of-scope": 1 },
      errors: [],
    });
  });

  it("writes nothing in dry-run but still reports what it found", async () => {
    stubArchive(validArchive());

    const stats = await syncAnOrganes(true);

    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ groupsFound: 3, written: 0, errors: [] });
  });

  it("writes nothing when an organ file is unreadable", async () => {
    stubArchive({ ...validArchive(), "PO4.json": "{not json" });

    const stats = await syncAnOrganes(false);

    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(stats.errors).toContain("1 unreadable organ file(s)");
  });

  it("writes nothing when a group has an impossible date", async () => {
    stubArchive({
      ...validArchive(),
      "PO5.json": organFile("PO5", { viMoDe: { dateDebut: "2024-02-31", dateFin: null } }),
    });

    const stats = await syncAnOrganes(false);

    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(stats.errors.join(" ")).toContain("invalid-date");
  });

  it("writes nothing when a group has no label or no legislature", async () => {
    stubArchive({
      ...validArchive(),
      "PO6.json": organFile("PO6", { libelle: "" }),
      "PO7.json": organFile("PO7", { legislature: null }),
    });

    const stats = await syncAnOrganes(false);

    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(stats.errors.join(" ")).toContain("missing-label");
    expect(stats.errors.join(" ")).toContain("missing-legislature");
  });

  it("writes nothing when a wanted legislature has no group, or a reference is duplicated", async () => {
    stubArchive({ "PO17.json": organFile("PO17"), "copy.json": organFile("PO17") });

    const stats = await syncAnOrganes(false);

    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(stats.errors).toEqual(
      expect.arrayContaining([
        "duplicate organeRef: PO17",
        "no group for legislature 15",
        "no group for legislature 16",
      ])
    );
  });

  it("reports a failed transaction as nothing written", async () => {
    stubArchive(validArchive());
    dbMock.$transaction.mockRejectedValue(new Error("connection lost"));

    const stats = await syncAnOrganes(false);

    expect(stats.written).toBe(0);
    expect(stats.errors).toEqual(["connection lost"]);
  });

  it("reports an HTTP failure and writes nothing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    const stats = await syncAnOrganes(false);

    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(stats.errors[0]).toContain("HTTP 503");
  });
});
