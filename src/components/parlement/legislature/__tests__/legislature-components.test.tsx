import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CompositionTable } from "../CompositionTable";
import { DataProvenance } from "../DataProvenance";
import { DataStatus } from "../DataStatus";
import { LegislatureSelector } from "../LegislatureSelector";
import { LegislatureTimeline, timelineSpan } from "../LegislatureTimeline";

describe("DataStatus", () => {
  it.each([
    ["complete", "Complet"],
    ["partial", "Partiel"],
    ["unverified", "Non vérifié"],
    ["pending", "En attente"],
  ] as const)("écrit le statut %s en toutes lettres", (status, label) => {
    render(<DataStatus status={status} />);
    expect(screen.getByText(label, { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Statut des données :", { exact: false })).toBeInTheDocument();
  });
});

describe("LegislatureSelector", () => {
  const options = [
    { number: 16, period: "2022-2024", href: "/x/16", status: "partial" as const },
    { number: 17, period: "depuis 2024", href: "/x/17", status: "complete" as const },
  ];

  it("annonce la législature courante et laisse les autres en liens simples", () => {
    render(<LegislatureSelector options={options} current={16} />);

    const links = within(screen.getByRole("navigation")).getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("aria-current", "page");
    expect(links[1]).not.toHaveAttribute("aria-current");
    expect(links[1]).toHaveAttribute("href", "/x/17");
  });

  it("n'affiche rien sans option", () => {
    const { container } = render(<LegislatureSelector options={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("LegislatureTimeline", () => {
  const items = [
    { number: 15, startYear: 2017, endYear: 2022, status: "pending" as const, href: "/15" },
    { number: 16, startYear: 2022, endYear: 2024, status: "partial" as const, href: "/16" },
    {
      number: 17,
      startYear: 2024,
      endYear: null,
      startEvent: "Dissolution et élection de 2024",
      status: "complete" as const,
      href: "/17",
    },
  ];

  it("liste chaque législature avec ses dates en texte", () => {
    render(<LegislatureTimeline items={items} referenceYear={2026} current={17} />);

    const list = screen.getByRole("list", { name: "Frise des législatures" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByText("2017-2022")).toBeInTheDocument();
    expect(within(list).getByText("depuis 2024")).toBeInTheDocument();
    expect(within(list).getByText("Dissolution et élection de 2024")).toBeInTheDocument();
  });

  it("proportionne la largeur à la durée, sans segment nul", () => {
    expect(timelineSpan(items[0]!, 2026)).toBe(5);
    expect(timelineSpan(items[1]!, 2026)).toBe(2);
    expect(timelineSpan(items[2]!, 2026)).toBe(2);
    expect(timelineSpan({ ...items[1]!, startYear: 2024, endYear: 2024 }, 2026)).toBe(1);
  });
});

describe("CompositionTable", () => {
  const rows = [
    { key: "a", name: "Groupe A", code: "GA", count: 300, status: "partial" as const },
    { key: "b", name: "Groupe B", code: "GB", count: 270, status: "partial" as const },
  ];

  it("distingue « non importée » d'une composition vide", () => {
    const { rerender } = render(<CompositionTable caption="Test" rows={null} />);
    expect(screen.getByText("Composition non importée")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    rerender(<CompositionTable caption="Test" rows={[]} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Aucun groupe dans cette composition.")).toBeInTheDocument();
  });

  it("affiche effectifs, parts et totaux cohérents", () => {
    render(
      <CompositionTable
        caption="Groupes"
        rows={rows}
        totals={{ seats: 577, filled: 570, vacant: 7 }}
      />
    );

    expect(screen.getByRole("table", { name: "Groupes" })).toBeInTheDocument();
    expect(screen.getByText("52,6 %")).toBeInTheDocument();
    expect(screen.queryByText("Composition non vérifiée")).not.toBeInTheDocument();
  });

  it("signale des totaux qui ne bouclent pas au lieu de les corriger", () => {
    render(
      <CompositionTable
        caption="Groupes"
        rows={rows}
        totals={{ seats: 577, filled: 560, vacant: 7 }}
      />
    );

    expect(screen.getByText("Composition non vérifiée")).toBeInTheDocument();
    expect(
      screen.getByText("La somme des groupes ne correspond pas aux sièges pourvus.")
    ).toBeInTheDocument();
  });
});

describe("DataProvenance", () => {
  it("affiche statut, source, date de consultation et limites", () => {
    render(
      <DataProvenance
        status="partial"
        sources={[{ label: "Assemblée nationale" }]}
        consultedAt="2026-10-15"
        limits={["Les appartenances datées ne sont pas importées."]}
      />
    );

    expect(screen.getByText("Assemblée nationale")).toBeInTheDocument();
    expect(screen.getByText(/Consulté le/)).toBeInTheDocument();
    expect(screen.getByText("Les appartenances datées ne sont pas importées.")).toBeInTheDocument();
  });

  it("dit qu'une donnée sans source ne doit pas être citée", () => {
    render(<DataProvenance status="unverified" sources={[]} />);
    expect(screen.getByText("Source non renseignée")).toBeInTheDocument();
  });
});
