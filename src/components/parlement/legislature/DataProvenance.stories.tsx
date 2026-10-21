import type { Meta, StoryObj } from "@storybook/react";
import { DataProvenance } from "./DataProvenance";

const meta: Meta<typeof DataProvenance> = {
  title: "Parlement/DataProvenance",
  component: DataProvenance,
};

export default meta;
type Story = StoryObj<typeof DataProvenance>;

export const Partial: Story = {
  args: {
    status: "partial",
    scope: "Composition",
    sources: [{ label: "Assemblée nationale", url: "https://www.assemblee-nationale.fr" }],
    consultedAt: "2026-10-15",
    limits: [
      "Les appartenances de groupe sont connues en fin de législature, pas à chaque date.",
      "Les députés remplacés en cours de mandat peuvent manquer.",
    ],
  },
};

export const SansSource: Story = {
  args: { status: "unverified", scope: "Dates officielles", sources: [] },
};
