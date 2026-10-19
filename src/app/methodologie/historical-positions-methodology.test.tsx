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

  it("répond aux quatre questions, dans l'ordre", () => {
    render(<HistoricalPositionsMethodology />);

    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "Que montre le tableau ?",
      "D'où viennent les chiffres ?",
      "Pourquoi des chiffres peuvent manquer",
      "Ce que ces chiffres ne permettent pas de conclure",
    ]);
  });

  it("refuse la position majoritaire et garde l'exemple « pour 12, contre 3 »", () => {
    const { container } = render(<HistoricalPositionsMethodology />);
    const text = container.textContent ?? "";

    expect(text).toMatch(/n'en calcule\s*aucune/);
    expect(text).toMatch(/pour 12, contre 3/);
    expect(text).toMatch(/groupe auquel chaque député appartenait le jour du vote/);
  });

  it("n'affirme ni certitude absolue ni définition officielle des non-votants", () => {
    const { container } = render(<HistoricalPositionsMethodology />);
    const text = container.textContent ?? "";

    expect(text).not.toMatch(/sans doute possible|ne peuvent pas être juste|figées/);
    expect(text).toMatch(/reprend le classement de l'Assemblée sans\s*l'interpréter/);
    expect(text).toMatch(/pas la date de publication/);
  });

  it("couvre chaque état où le tableau manque", () => {
    render(<HistoricalPositionsMethodology />);

    for (const title of [
      "Les totaux ne concordent pas",
      "Les totaux ne peuvent pas être comparés",
      "Le groupe d'un député est incertain",
      "Un groupe sans vote pour, contre ou abstention",
      "Les non-inscrits",
      "Un groupe renommé",
      "Pas de données pour ce scrutin",
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
