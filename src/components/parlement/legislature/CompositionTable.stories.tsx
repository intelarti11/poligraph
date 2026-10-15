import type { Meta, StoryObj } from "@storybook/react";
import { CompositionTable } from "./CompositionTable";

const meta: Meta<typeof CompositionTable> = {
  title: "Parlement/CompositionTable",
  component: CompositionTable,
};

export default meta;
type Story = StoryObj<typeof CompositionTable>;

// Effectifs d'illustration, sans valeur factuelle.
const rows = [
  { key: "a", name: "Groupe d'exemple A", code: "GA", count: 300, status: "partial" as const },
  { key: "b", name: "Groupe d'exemple B", code: "GB", count: 270, status: "partial" as const },
];

export const Coherente: Story = {
  args: {
    caption: "Groupes d'exemple, en fin de législature",
    rows,
    totals: { seats: 577, filled: 570, vacant: 7 },
  },
};

export const NonImportee: Story = {
  args: { caption: "Groupes d'exemple", rows: null },
};

export const NeBoucle: Story = {
  args: {
    caption: "Groupes d'exemple",
    rows,
    totals: { seats: 577, filled: 560, vacant: 7 },
  },
};
