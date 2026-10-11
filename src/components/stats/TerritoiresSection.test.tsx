import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
import { render, screen } from "@testing-library/react";
import { TerritoiresSection } from "./TerritoiresSection";
import { buildTerritoiresStats } from "@/lib/data/territoires-stats";

const stats = buildTerritoiresStats(
  {
    etablis: 34796,
    from_rne: 33511,
    femmes: 7956,
    hommes: 26837,
    civ_inconnue: 3,
    age_moins_40: 1362,
    age_40_49: 4541,
    age_50_59: 9208,
    age_60_69: 11933,
    age_70_plus: 6508,
    age_inconnu: 1244,
    median_age: 61,
    computed_at: new Date("2026-10-11T08:00:00Z"),
  },
  {
    total: 34969,
    pop_moins_500: 18264,
    pop_500_999: 6600,
    pop_1000_3499: 6809,
    pop_3500_9999: 2223,
    pop_10000_plus: 1067,
    pop_inconnue: 6,
  },
  new Date("2026-08-10T09:00:00Z")
);

describe("TerritoiresSection", () => {
  it("affiche les chiffres en texte, au format français", () => {
    const { container } = render(<TerritoiresSection stats={stats} />);
    const text = container.textContent ?? "";
    expect(text).toContain("34 796");
    expect(text).toContain("22,9 %");
    expect(text).toContain("61 ans");
    expect(text).toContain("11 octobre 2026");
  });

  it("nomme les absences au lieu de les taire", () => {
    render(<TerritoiresSection stats={stats} />);
    expect(screen.getByText("Civilité non renseignée")).toBeInTheDocument();
    expect(screen.getByText("Date de naissance non renseignée")).toBeInTheDocument();
    expect(screen.getByText("Population non renseignée")).toBeInTheDocument();
  });

  it("n'affiche ni profession, ni renouvellement, ni présidences, ni couverture éditoriale", () => {
    render(<TerritoiresSection stats={stats} />);
    const headings = screen.getAllByRole("heading").map((h) => h.textContent ?? "");
    expect(headings).toEqual([
      "Parité des maires",
      "Âge des maires",
      "Communes par taille",
      "Méthode et sources",
    ]);
    const { container } = render(<TerritoiresSection stats={stats} />);
    expect(container.textContent).not.toMatch(/réélus|dossiers curés|socle officiel/i);
  });

  it("ne limite pas le scrutin de liste paritaire aux communes de 1 000 habitants et plus", () => {
    const { container } = render(<TerritoiresSection stats={stats} />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/communes de 1 000 habitants et plus sont élus/);
    expect(text).toContain("toutes les communes");
  });

  it("ne date pas la population d'un millésime", () => {
    const { container } = render(<TerritoiresSection stats={stats} />);
    expect(container.textContent).not.toMatch(/millésime|population légale 20\d\d/i);
    expect(container.textContent).toContain("importée le 10 août 2026");
  });

  it("garde les liens internes hors préchargement", () => {
    render(<TerritoiresSection stats={stats} />);
    expect(screen.getByRole("link", { name: "rubrique Territoires" })).toHaveAttribute(
      "href",
      "/territoires"
    );
  });
});
