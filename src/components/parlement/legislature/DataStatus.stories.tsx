import type { Meta, StoryObj } from "@storybook/react";
import { DataStatus } from "./DataStatus";

const meta: Meta<typeof DataStatus> = {
  title: "Parlement/DataStatus",
  component: DataStatus,
};

export default meta;
type Story = StoryObj<typeof DataStatus>;

export const Complete: Story = { args: { status: "complete", scope: "Composition" } };
export const Partial: Story = { args: { status: "partial", scope: "Composition" } };
export const Unverified: Story = { args: { status: "unverified", scope: "Composition" } };
export const Pending: Story = { args: { status: "pending", scope: "Composition" } };
