import type { Meta, StoryObj } from "@storybook/react";
import { HistoricalGroupPositions } from "./HistoricalGroupPositions";
import {
  buildHistoricalPositionsView,
  type HistoricalGroupRow,
  type HistoricalScrutinStatus,
} from "@/lib/votes/historical-positions";

/**
 * Données simulées, représentatives de la 16e législature : aucune ne vient de la base. Chaque
 * histoire est un état que la page peut afficher, y compris ceux où rien n'est présenté.
 */
const meta: Meta<typeof HistoricalGroupPositions> = {
  title: "Votes/HistoricalGroupPositions",
  component: HistoricalGroupPositions,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof HistoricalGroupPositions>;

const DATE = new Date("2023-11-13T23:00:00Z");

const status = (overrides: Partial<HistoricalScrutinStatus> = {}): HistoricalScrutinStatus => ({
  legislature: 16,
  countCoherence: "COHERENT",
  groupsShown: 3,
  groupsWithheld: 0,
  withheldGroups: [],
  nonInscritVotes: 0,
  excludedConflictVotes: 0,
  excludedUnknownGroupVotes: 0,
  affiliationsUrl:
    "https://data.assemblee-nationale.fr/static/openData/repository/17/amo/x.json.zip",
  affiliationsFetchedAt: new Date("2026-10-18T21:26:12Z"),
  affiliationsAsOf: new Date("2026-10-17T00:34:00Z"),
  scrutinsUrl:
    "https://data.assemblee-nationale.fr/static/openData/repository/16/loi/scrutins/Scrutins.js",
  scrutinsFetchedAt: new Date("2026-10-18T22:03:56Z"),
  ...overrides,
});

const LFI: HistoricalGroupRow = {
  organRef: "PO800490",
  label: "La France insoumise - Nouvelle Union Populaire écologique et sociale",
  abbreviation: "LFI - NUPES",
  forCount: 71,
  againstCount: 0,
  abstainCount: 0,
  nonVoterCount: 0,
  sameAbbreviationElsewhere: false,
};

const RENAISSANCE: HistoricalGroupRow = {
  organRef: "PO800538",
  label: "Renaissance",
  abbreviation: "RE",
  forCount: 0,
  againstCount: 118,
  abstainCount: 4,
  nonVoterCount: 2,
  sameAbbreviationElsewhere: false,
};

const MODEM: HistoricalGroupRow = {
  organRef: "PO800484",
  label: "Démocrate (MoDem et Indépendants)",
  abbreviation: "Dem",
  forCount: 12,
  againstCount: 21,
  abstainCount: 9,
  nonVoterCount: 1,
  sameAbbreviationElsewhere: false,
};

const rows: HistoricalGroupRow[] = [LFI, RENAISSANCE, MODEM];

const view = (data: Parameters<typeof buildHistoricalPositionsView>[0]["data"], legislature = 16) =>
  buildHistoricalPositionsView({ legislature, data });

export const Complete: Story = {
  args: { scrutinDate: DATE, view: view({ status: status(), rows }) },
};

export const PartialWithReasons: Story = {
  args: {
    scrutinDate: DATE,
    view: view({
      status: status({
        groupsWithheld: 2,
        withheldGroups: [
          { label: "Les Républicains", abbreviation: "LR", reason: "EXCLUDED_VOTES_PRESENT" },
          {
            label: "Gauche démocrate et républicaine - NUPES",
            abbreviation: "GDR - NUPES",
            reason: "NO_ATTESTED_VOTE",
          },
        ],
        excludedConflictVotes: 2,
        nonInscritVotes: 9,
      }),
      rows,
    }),
  },
};

export const RenamedGroups: Story = {
  args: {
    scrutinDate: DATE,
    view: view({
      status: status({ groupsShown: 2 }),
      rows: [
        {
          ...LFI,
          organRef: "PO800508",
          label: "Socialistes et apparentés (membre de la Nupes)",
          abbreviation: "SOC",
          sameAbbreviationElsewhere: true,
        },
        {
          ...RENAISSANCE,
          organRef: "PO835112",
          label: "Socialistes et apparentés",
          abbreviation: "SOC",
          sameAbbreviationElsewhere: true,
        },
      ],
    }),
  },
};

export const DiscordantTotals: Story = {
  args: {
    scrutinDate: DATE,
    view: view({ status: status({ countCoherence: "COUNT_MISMATCH" }), rows }),
  },
};

export const UnverifiableTotals: Story = {
  args: {
    scrutinDate: DATE,
    view: view({ status: status({ countCoherence: "UNVERIFIABLE" }), rows: [] }),
  },
};

export const NoGroupPresentable: Story = {
  args: {
    scrutinDate: DATE,
    view: view({
      status: status({
        groupsShown: 0,
        groupsWithheld: 1,
        withheldGroups: [
          { label: "Renaissance", abbreviation: "RE", reason: "EXCLUDED_VOTES_PRESENT" },
        ],
        nonInscritVotes: 3,
      }),
      rows: [],
    }),
  },
};

export const HistoryNotAvailable: Story = {
  args: { scrutinDate: DATE, view: view({ status: null, rows: [] }) },
};

export const LegislatureNotDocumented: Story = {
  args: { scrutinDate: DATE, view: view({ status: null, rows: [] }, 14) },
};

export const ReadFailed: Story = {
  args: { scrutinDate: DATE, view: view({ unreadable: true }) },
};
