import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AN_LEGISLATURE_COVERAGE } from "@/config/legislatures";
import { DATASET_LABELS } from "@/lib/parlement/legislature-labels";
import { CoverageTable } from "../CoverageTable";
import { LegislatureTimeline } from "../LegislatureTimeline";

const coverage = (n: number) => AN_LEGISLATURE_COVERAGE.find((c) => c.number === n)!;

function renderTable(n: number) {
  const { container } = render(
    <CoverageTable coverage={coverage(n)} caption={`Jeux de la ${n}e`} />
  );
  const cards = container.querySelector("[data-coverage-cards]") as HTMLElement;
  const list = within(cards).getByRole("list");
  return { container, cards, list, table: screen.getByRole("table") };
}

describe("CoverageTable responsive", () => {
  it("tableau à partir de 640 px, cartes en dessous, une seule présentation visible", () => {
    const { cards, table } = renderTable(16);
    expect(table.closest("div.hidden")?.className).toContain("sm:block");
    expect(cards.className).toContain("sm:hidden");
    expect(cards.className).not.toContain("hidden ");
  });

  it.each([15, 16, 17])("%ie : chaque carte porte jeu, statut, quantité et date", (n) => {
    const { list } = renderTable(n);
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(coverage(n).datasets.length);
    coverage(n).datasets.forEach((ds, i) => {
      const li = items[i]!;
      const card = within(li);
      expect(card.getByRole("heading", { level: 3 })).toHaveTextContent(DATASET_LABELS[ds.dataset]);
      expect(card.getByText("Niveau")).toBeInTheDocument();
      expect(card.getByText("Importé")).toBeInTheDocument();
      expect(card.getByText("Mesure du")).toBeInTheDocument();
      expect(li.querySelector("[data-status]")).not.toBeNull();
      expect(li.querySelector(`time[datetime="${ds.measuredAt}"]`)).not.toBeNull();
      if (ds.level !== "absent" && ds.level !== "withheld") {
        expect(li.textContent).toContain(ds.measured.count.toLocaleString("fr-FR"));
      }
    });
  });

  it("garde les notes explicatives dans les deux présentations, sans le périmètre interne", () => {
    const { list, table } = renderTable(17);
    const note = "Au moins 42 numéros de scrutin sont absents de la liste importée.";
    expect(within(table).getByText(new RegExp(note))).toBeInTheDocument();
    expect(within(list).getByText(new RegExp(note))).toBeInTheDocument();
    for (const ds of coverage(17).datasets) {
      expect(table.textContent).not.toContain(ds.perimeter);
      expect(list.textContent).not.toContain(ds.perimeter);
    }
  });

  it("« Non publié » reste distinct de « Pas encore importé » (jeu masqué, jeu absent)", () => {
    const { list } = renderTable(16);
    const items = within(list).getAllByRole("listitem");
    const withheld = items.find((li) => li.textContent?.includes("Positions de groupe calculées"))!;
    expect(withheld.querySelector('[data-status="pending"]')?.textContent).toContain("Non publié");
    expect(withheld.textContent).not.toContain("Pas encore importé");
    const absent = items.find((li) => li.textContent?.includes("Décompte officiel par groupe"))!;
    expect(absent.textContent).toContain("Pas encore importé");
    expect(absent.textContent).toContain("Aucun");
    expect(absent.textContent).not.toContain("Non publié");
  });

  it("ne dépend d'aucun id fixe : deux tableaux n'ont pas d'identifiants en double", () => {
    const { container } = render(
      <>
        <CoverageTable coverage={coverage(16)} caption="A" />
        <CoverageTable coverage={coverage(17)} caption="B" />
      </>
    );
    const ids = [...container.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("LegislatureTimeline : libellé de niveau", () => {
  const item = {
    number: 15,
    startYear: 2017,
    endYear: 2022,
    status: "pending" as const,
    statusScope: "Scrutins publics",
    href: "/x",
  };

  it("utilise le libellé précis plutôt que « En attente »", () => {
    render(
      <LegislatureTimeline
        items={[
          { ...item, statusLabel: "Pas encore importé" },
          { ...item, number: 16, statusLabel: "Non publié" },
        ]}
        referenceYear={2026}
      />
    );
    expect(screen.getByText(/Pas encore importé/)).toBeInTheDocument();
    expect(screen.getByText(/Non publié/)).toBeInTheDocument();
    expect(screen.queryByText(/En attente/)).toBeNull();
  });
});
