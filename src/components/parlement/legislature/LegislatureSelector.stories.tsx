import type { Meta, StoryObj } from "@storybook/react";
import { LegislatureSelector } from "./LegislatureSelector";

const meta: Meta<typeof LegislatureSelector> = {
  title: "Parlement/LegislatureSelector",
  component: LegislatureSelector,
};

export default meta;
type Story = StoryObj<typeof LegislatureSelector>;

export const Defaut: Story = {
  args: {
    current: 16,
    options: [
      { number: 15, period: "2017-2022", href: "#15", status: "pending" },
      { number: 16, period: "2022-2024", href: "#16", status: "partial" },
      { number: 17, period: "depuis 2024", href: "#17", status: "complete" },
    ],
  },
};
