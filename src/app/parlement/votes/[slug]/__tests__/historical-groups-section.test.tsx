/**
 * Branchement du bloc « Vote de chaque groupe » dans la page de scrutin (lot 6).
 *
 * L'interrupteur éditorial est simulé : le test prouve les deux côtés. Éteint, la page est celle
 * d'avant et la couche de lecture n'est jamais appelée. Allumé, chaque état s'affiche, et l'ancien
 * bloc calculé sur le groupe actuel ne coexiste jamais avec un décompte daté.
 */
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: false,
  findScrutin: vi.fn(),
  getPositions: vi.fn(),
  getOfficialGroups: vi.fn(),
  readHistorical: vi.fn(),
}));

vi.mock("@/config/historical-positions", () => ({
  get HISTORICAL_GROUP_POSITIONS_PUBLIC() {
    return mocks.enabled;
  },
  HISTORICAL_POSITIONS_LEGISLATURES: [15, 16, 17],
}));
vi.mock("@/lib/data/historical-group-positions", () => ({
  readHistoricalGroupPositions: (...args: unknown[]) => mocks.readHistorical(...args),
}));
vi.mock("@/lib/db", () => ({
  db: {
    scrutin: { findUnique: (...args: unknown[]) => mocks.findScrutin(...args), findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/data/groupes", () => ({
  getScrutinGroupPositions: (...args: unknown[]) => mocks.getPositions(...args),
  getScrutinAnalysis: vi.fn(async () => null),
}));
vi.mock("@/lib/data/scrutin-official-groups", () => ({
  getScrutinOfficialGroups: (...args: unknown[]) => mocks.getOfficialGroups(...args),
}));
vi.mock("@/components/ui/ShareBar", () => ({ ShareBar: () => null }));
vi.mock("@/components/votes/DailyVotesPage", () => ({ DailyVotesPage: () => null }));
vi.mock("@/components/politicians/PoliticianAvatar", () => ({ PoliticianAvatar: () => null }));
vi.mock("@/components/votes", () => ({
  VotePositionBadge: ({ position }: { position: string }) => <span>{position}</span>,
  VotingResultBadge: () => null,
}));
vi.mock("@/components/votes/ScrutinContext", () => ({
  ScrutinContext: ({ votesDetailSlot }: { votesDetailSlot?: ReactNode }) => (
    <div data-testid="context">{votesDetailSlot}</div>
  ),
}));

import ScrutinPage from "@/app/parlement/votes/[slug]/page";
import type {
  HistoricalGroupRow,
  HistoricalPositionsData,
  HistoricalScrutinStatus,
} from "@/lib/votes/historical-positions";

function scrutin(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    slug: "scrutin-test",
    externalId: "VTANR5L16V2978",
    title: "l'article 3 de la proposition de loi",
    chamber: "AN",
    legislature: 16,
    type: "ORDINAIRE",
    theme: null,
    result: "ADOPTED",
    votingDate: new Date("2023-11-13T23:00:00Z"),
    votesFor: 3,
    votesAgainst: 2,
    votesAbstain: 1,
    sourceUrl: "https://www.assemblee-nationale.fr/dyn/16/scrutins/2978",
    summary: null,
    citizenImpact: null,
    policyTitle: null,
    importance: null,
    dossierLegislatif: null,
    votes: [],
    ...overrides,
  };
}

const COMPUTED = [
  {
    id: "p1",
    position: "POUR",
    forCount: 3,
    againstCount: 0,
    abstainCount: 0,
    cohesionPct: 100,
    group: {
      id: "g",
      code: "RN",
      name: "Rassemblement National",
      shortName: null,
      color: null,
      slug: null,
    },
  },
];

const ROW: HistoricalGroupRow = {
  organRef: "PO800490",
  label: "La France insoumise - Nouvelle Union Populaire écologique et sociale",
  abbreviation: "LFI - NUPES",
  forCount: 21,
  againstCount: 0,
  abstainCount: 0,
  nonVoterCount: 0,
  sameAbbreviationElsewhere: false,
};

function status(overrides: Partial<HistoricalScrutinStatus> = {}): HistoricalScrutinStatus {
  return {
    legislature: 16,
    countCoherence: "COHERENT",
    groupsShown: 1,
    groupsWithheld: 0,
    withheldGroups: [],
    nonInscritVotes: 0,
    excludedConflictVotes: 0,
    excludedUnknownGroupVotes: 0,
    affiliationsUrl: null,
    affiliationsFetchedAt: null,
    affiliationsAsOf: null,
    scrutinsUrl: null,
    scrutinsFetchedAt: null,
    ...overrides,
  };
}

async function renderPage() {
  const ui = await ScrutinPage({ params: Promise.resolve({ slug: "scrutin-test" }) });
  return render(ui);
}
const text = (c: HTMLElement) => c.textContent ?? "";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = false;
  mocks.getPositions.mockResolvedValue([]);
  mocks.getOfficialGroups.mockResolvedValue({
    snapshot: { imported: false, issues: [], rows: [] },
    organes: [],
    fetchedAt: null,
  });
  mocks.findScrutin.mockResolvedValue(scrutin());
  mocks.readHistorical.mockResolvedValue({
    status: status(),
    rows: [ROW],
  } as HistoricalPositionsData);
});

describe("interrupteur éteint", () => {
  it("la couche de lecture n'est jamais appelée et la page est celle d'avant", async () => {
    const { container } = await renderPage();
    expect(mocks.readHistorical).not.toHaveBeenCalled();
    expect(text(container)).not.toContain("Vote de chaque groupe");
    // Ancienne mention pour une législature ancienne sans position calculée.
    expect(text(container)).toContain("Positions calculées non affichées");
  });

  it("l'ancien bloc calculé s'affiche comme avant", async () => {
    mocks.getPositions.mockResolvedValue(COMPUTED);
    const { container } = await renderPage();
    expect(text(container)).toContain("Positions calculées par PoliGraph");
  });
});

describe("interrupteur allumé", () => {
  beforeEach(() => {
    mocks.enabled = true;
  });

  it("présente le décompte daté et retire l'ancienne mention et l'ancien bloc", async () => {
    mocks.getPositions.mockResolvedValue(COMPUTED);
    const { container } = await renderPage();
    expect(mocks.readHistorical).toHaveBeenCalledWith("VTANR5L16V2978");
    expect(text(container)).toContain("Vote de chaque groupe le 14 novembre 2023");
    expect(text(container)).toContain("La France insoumise");
    expect(text(container)).not.toContain("Positions calculées par PoliGraph");
    expect(text(container)).not.toContain("Positions calculées non affichées");
  });

  it("scrutin discordant : explication, pas de chiffres de groupe, pas d'ancien bloc", async () => {
    mocks.getPositions.mockResolvedValue(COMPUTED);
    mocks.readHistorical.mockResolvedValue({
      status: status({ countCoherence: "COUNT_MISMATCH" }),
      rows: [ROW],
    });
    const { container } = await renderPage();
    expect(text(container)).toContain("Décompte par groupe non présenté");
    expect(text(container)).not.toContain("La France insoumise");
    expect(text(container)).not.toContain("Positions calculées par PoliGraph");
  });

  it("aucune donnée : message d'indisponibilité, l'ancien bloc reste avec sa mise en garde", async () => {
    mocks.findScrutin.mockResolvedValue(scrutin({ legislature: 17 }));
    mocks.getPositions.mockResolvedValue(COMPUTED);
    mocks.readHistorical.mockResolvedValue({ status: null, rows: [] });
    const { container } = await renderPage();
    expect(text(container)).toContain("Groupes à la date du scrutin pas encore disponibles");
    expect(text(container)).toContain("groupe actuel de chaque député");
  });

  it("lecture en échec : la page se rend quand même", async () => {
    mocks.readHistorical.mockResolvedValue({ unreadable: true });
    const { container } = await renderPage();
    expect(text(container)).toContain("Décompte par groupe momentanément indisponible");
    expect(text(container)).toContain("Résultat officiel");
  });

  it("scrutin du Sénat : aucune lecture historique", async () => {
    mocks.findScrutin.mockResolvedValue(
      scrutin({ chamber: "SENAT", legislature: 2023, externalId: "2024-63", sourceUrl: null })
    );
    const { container } = await renderPage();
    expect(mocks.readHistorical).not.toHaveBeenCalled();
    expect(text(container)).not.toContain("Vote de chaque groupe");
  });
});
