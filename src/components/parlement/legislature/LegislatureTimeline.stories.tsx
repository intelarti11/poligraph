import type { Meta, StoryObj } from "@storybook/react";
import { LegislatureTimeline } from "./LegislatureTimeline";

const meta: Meta<typeof LegislatureTimeline> = {
  title: "Parlement/LegislatureTimeline",
  component: LegislatureTimeline,
};

export default meta;
type Story = StoryObj<typeof LegislatureTimeline>;

export const Defaut: Story = {
  args: {
    referenceYear: 2026,
    current: 17,
    items: [
      { number: 15, startYear: 2017, endYear: 2022, status: "pending", href: "#15" },
      { number: 16, startYear: 2022, endYear: 2024, status: "partial", href: "#16" },
      {
        number: 17,
        startYear: 2024,
        endYear: null,
        startEvent: "Dissolution et élection de 2024",
        status: "complete",
        href: "#17",
      },
    ],
  },
};
