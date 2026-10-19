import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HISTORICAL_POSITIONS_SECTION_ID,
  HistoricalPositionsMethodology,
} from "./HistoricalPositionsMethodology";

const FORBIDDEN_DASHES = /[–—]/;

describe("méthodologie des votes de groupe à la date du scrutin", () => {
  afterEach(() => {
    vi.doUnmock("@/config/historical-positions");
    vi.resetModules();
  });

  it("nomme les trois notions et refuse la position majoritaire", () => {
    const { container } = render(<HistoricalPositionsMethodology />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Votes des groupes à la date du scrutin" })
    ).toBeInTheDocument();
    expect(container.textContent).toMatch(/publié par l'Assemblée, nom par nom/);
    expect(container.textContent).toMatch(/addition faite par PoliGraph/);
    expect(container.textContent).toMatch(/ne calcule aucune position majoritaire/);
    expect(container.textContent).toMatch(/groupe du référentiel|référentiel de l'Assemblée/);
  });

  it("couvre chaque état où le tableau manque", () => {
    render(<HistoricalPositionsMethodology />);

    for (const title of [
      "Totaux qui ne concordent pas",
      "Totaux impossibles à comparer",
      "Vote qui ne peut pas être rattaché",
      "Groupe sans vote attesté",
      "Non-inscrits",
      "Groupes renommés",
      "Pas de données",
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it("ne contient ni tiret long ni jargon de modèle de données", () => {
    const { container } = render(<HistoricalPositionsMethodology />);
    const text = container.textContent ?? "";

    expect(text).not.toMatch(FORBIDDEN_DASHES);
    expect(text).not.toMatch(/snapshot|publishable|run |hash|organRef|quarantaine|pin /i);
  });

  it("garde l'ancre que le bloc de scrutin vise", () => {
    expect(HISTORICAL_POSITIONS_SECTION_ID).toBe("votes-historiques-des-groupes");
  });

  it("n'apparaît sur la page que si la décision éditoriale est prise", async () => {
    vi.resetModules();
    vi.doMock("@/config/historical-positions", () => ({
      HISTORICAL_GROUP_POSITIONS_PUBLIC: false,
    }));
    const off = await import("./page");
    const { container, unmount } = render(<off.default />);
    expect(container.querySelector(`#${HISTORICAL_POSITIONS_SECTION_ID}`)).toBeNull();
    unmount();

    vi.resetModules();
    vi.doMock("@/config/historical-positions", () => ({ HISTORICAL_GROUP_POSITIONS_PUBLIC: true }));
    const on = await import("./page");
    const rendered = render(<on.default />);
    expect(rendered.container.querySelector(`#${HISTORICAL_POSITIONS_SECTION_ID}`)).not.toBeNull();
    expect(
      screen.getByRole("link", { name: /Votes des groupes à la date du scrutin/ })
    ).toHaveAttribute("href", `#${HISTORICAL_POSITIONS_SECTION_ID}`);
  });
});
