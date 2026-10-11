import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("q=Belley"),
}));

import { SearchClient } from "../SearchClient";

const RESPONSE = {
  politicians: [],
  parties: [],
  affairs: [],
  scrutins: [],
  factchecks: [],
  dossiers: [],
  communes: [{ id: "01034", name: "Belley", departmentName: "Ain", population: 9388 }],
  departements: [],
};

describe("recherche globale, résultats de communes", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(RESPONSE), { status: 200 }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mène à la page Territoires de la commune, comme la palette", async () => {
    render(<SearchClient />);
    const link = await screen.findByRole("link", { name: /Belley/ }, { timeout: 3000 });
    expect(link.getAttribute("href")).toBe("/territoires/communes/01034");
  });
});
