import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { departementRows, regionRows } from "@/lib/territoires/exports";

const mocks = vi.hoisted(() => ({ getTerritoireReleases: vi.fn() }));

const COMMUNES = new Map([
  ["35", 333],
  ["987", 48],
]);

vi.mock("@/lib/data/territoires-exports", () => ({
  getTerritoireReleases: () => mocks.getTerritoireReleases(),
  getDepartementExportRows: async () =>
    departementRows({ communes: COMMUNES, deputes: new Map(), senateurs: new Map() }),
  getRegionExportRows: async () => regionRows(COMMUNES),
}));

import TerritoiresDonneesPage, { metadata } from "../page";

async function renderPage() {
  cleanup();
  render(await TerritoiresDonneesPage());
}

describe("/territoires/donnees", () => {
  beforeEach(() => mocks.getTerritoireReleases.mockResolvedValue([]));

  it("is indexable, with its own canonical", () => {
    expect(metadata.robots).toBeUndefined();
    expect(metadata.alternates?.canonical).toBe("/territoires/donnees");
  });

  it("lists a release with its date, rows and size", async () => {
    mocks.getTerritoireReleases.mockResolvedValue([
      {
        day: "2026-10-11",
        url: "https://blob.example/communes-france-2026-10-11.csv",
        byteSize: 10327467,
        rowCount: 34963,
        sha256: "abc",
      },
    ]);
    await renderPage();
    const link = screen.getByRole("link", { name: "Communes au 11 octobre 2026 (CSV)" });
    expect(link.getAttribute("href")).toBe("https://blob.example/communes-france-2026-10-11.csv");
    expect(screen.getByText("34 963 lignes, 10,3 Mo")).toBeTruthy();
  });

  it("says plainly that no release exists yet", async () => {
    await renderPage();
    expect(screen.getByText(/Aucune version datée n'est encore publiée/)).toBeTruthy();
  });

  it("links a commune file for a COM, none for TAAF", async () => {
    await renderPage();
    const polynesie = screen.getByRole("link", { name: /Polynésie française \(987\), 48 lignes/ });
    expect(polynesie.getAttribute("href")).toBe(
      "https://poligraph.fr/api/export/territoires/communes/987"
    );
    expect(screen.queryByRole("link", { name: /\(984\)/ })).toBeNull();
  });

  it("states the ODbL for the compilation and lists the sources in use", async () => {
    await renderPage();
    expect(screen.getByRole("link", { name: /Open Database License \(ODbL\) 1\.0/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Répertoire national des élus/ })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("renders no em or en dash", async () => {
    await renderPage();
    expect(document.body.textContent).not.toMatch(/[–—]/);
  });
});
