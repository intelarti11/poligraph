import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const tx = {
    decision: { create: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
    institution: { create: vi.fn() },
    territorialSource: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    tx,
    db: {
      decision: { findUnique: vi.fn() },
      institution: { findUnique: vi.fn(), findFirst: vi.fn() },
      territorialSource: { findUnique: vi.fn() },
      commune: { findUnique: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
    revalidateTags: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/cache", () => ({ revalidateTags: h.revalidateTags }));

import {
  availableTransitions,
  createDecision,
  institutionMismatch,
  resolveTransition,
  transitionDecision,
  updateDecision,
} from "../decisions";
import type { DecisionInput } from "@/lib/security/schemas/decision-territoriale";

const META = { ip: "203.0.113.1", userAgent: "test" };
const INPUT: DecisionInput = {
  institutionId: "inst-1",
  communeId: "35238",
  reference: null,
  title: "Objet",
  adoptionDate: new Date("2026-06-04T00:00:00.000Z"),
  adoptionDatePrecision: "DAY",
  publicationDate: null,
  effectiveDate: null,
  outcome: "ADOPTEE",
  outcomeWording: null,
  sourceId: "src-1",
  sourceLocator: "page 4",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.db.institution.findUnique.mockResolvedValue({ kind: "CONSEIL_MUNICIPAL", communeId: "35238" });
  h.db.territorialSource.findUnique.mockResolvedValue({ id: "src-1" });
  h.db.commune.findUnique.mockResolvedValue({ id: "35238" });
  h.tx.decision.create.mockResolvedValue({ id: "dec-1", status: "DRAFT" });
  h.tx.decision.updateMany.mockResolvedValue({ count: 1 });
});

describe("transition table", () => {
  it("publishes only from review", () => {
    expect(resolveTransition("IN_REVIEW", "PUBLISH")).toBe("PUBLISHED");
    expect(resolveTransition("DRAFT", "PUBLISH")).toBeNull();
    expect(resolveTransition("REJECTED", "PUBLISH")).toBeNull();
  });

  it("offers each state its own actions", () => {
    expect(availableTransitions("DRAFT")).toEqual(["SUBMIT"]);
    expect(availableTransitions("IN_REVIEW")).toEqual(["RETURN_TO_DRAFT", "PUBLISH", "REJECT"]);
    expect(availableTransitions("PUBLISHED")).toEqual(["UNPUBLISH"]);
    expect(availableTransitions("REJECTED")).toEqual(["REOPEN"]);
  });
});

describe("institutionMismatch", () => {
  it("keeps a municipal council to its own commune", () => {
    expect(
      institutionMismatch({ kind: "CONSEIL_MUNICIPAL", communeId: "35238" }, "35238")
    ).toBeNull();
    expect(
      institutionMismatch({ kind: "CONSEIL_MUNICIPAL", communeId: "35238" }, "35047")
    ).not.toBeNull();
  });

  it("lets an intercommunal council concern any member commune", () => {
    expect(
      institutionMismatch({ kind: "CONSEIL_COMMUNAUTAIRE", communeId: null }, "35047")
    ).toBeNull();
  });
});

describe("createDecision", () => {
  it("creates a draft and audits it in the same transaction", async () => {
    const result = await createDecision(INPUT, META);
    expect(result).toEqual({ ok: true, id: "dec-1", status: "DRAFT" });
    expect(h.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "CREATE",
        entityType: "Decision",
        entityId: "dec-1",
      }),
    });
  });

  it("refuses a municipal council deciding for another commune", async () => {
    h.db.commune.findUnique.mockResolvedValue({ id: "35047" });
    const result = await createDecision({ ...INPUT, communeId: "35047" }, META);
    expect(result.ok).toBe(false);
    expect(h.tx.decision.create).not.toHaveBeenCalled();
  });

  it("refuses an unknown source", async () => {
    h.db.territorialSource.findUnique.mockResolvedValue(null);
    expect((await createDecision(INPUT, META)).ok).toBe(false);
    expect(h.tx.decision.create).not.toHaveBeenCalled();
  });
});

describe("updateDecision", () => {
  it("edits drafts only, with the status in the WHERE clause", async () => {
    await updateDecision("dec-1", INPUT, META);
    expect(h.tx.decision.updateMany).toHaveBeenCalledWith({
      where: { id: "dec-1", status: "DRAFT" },
      data: INPUT,
    });
  });

  it("answers 409 on a notice that left the draft state", async () => {
    h.tx.decision.updateMany.mockResolvedValue({ count: 0 });
    h.tx.decision.findUnique.mockResolvedValue({ status: "PUBLISHED" });
    const result = await updateDecision("dec-1", INPUT, META);
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(h.tx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe("transitionDecision", () => {
  it("refuses to publish without a named reviewer", async () => {
    h.db.decision.findUnique.mockResolvedValue({ status: "IN_REVIEW", communeId: "35238" });
    const result = await transitionDecision(
      "dec-1",
      { action: "PUBLISH", reviewedBy: null, reason: null },
      META
    );
    expect(result).toMatchObject({ ok: false, httpStatus: 400 });
    expect(h.tx.decision.updateMany).not.toHaveBeenCalled();
  });

  it("refuses to publish a draft that skipped review", async () => {
    h.db.decision.findUnique.mockResolvedValue({ status: "DRAFT", communeId: "35238" });
    const result = await transitionDecision(
      "dec-1",
      { action: "PUBLISH", reviewedBy: "Relecteur", reason: null },
      META
    );
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(h.tx.decision.updateMany).not.toHaveBeenCalled();
  });

  it("publishes, records the reviewer, audits and refreshes the commune pages", async () => {
    h.db.decision.findUnique.mockResolvedValue({ status: "IN_REVIEW", communeId: "35238" });
    const result = await transitionDecision(
      "dec-1",
      { action: "PUBLISH", reviewedBy: "Relecteur", reason: null },
      META
    );
    expect(result).toEqual({ ok: true, id: "dec-1", status: "PUBLISHED" });
    expect(h.tx.decision.updateMany).toHaveBeenCalledWith({
      where: { id: "dec-1", status: "IN_REVIEW" },
      data: expect.objectContaining({ status: "PUBLISHED", reviewedBy: "Relecteur" }),
    });
    expect(h.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "PUBLISH",
        changes: expect.objectContaining({ from: "IN_REVIEW", to: "PUBLISHED" }),
      }),
    });
    expect(h.revalidateTags).toHaveBeenCalledWith(["territoire:35238"]);
  });

  it("refreshes nothing public on a move between private states", async () => {
    h.db.decision.findUnique.mockResolvedValue({ status: "DRAFT", communeId: "35238" });
    await transitionDecision("dec-1", { action: "SUBMIT", reviewedBy: null, reason: null }, META);
    expect(h.revalidateTags).not.toHaveBeenCalled();
  });

  it("requires a reason to unpublish and refreshes the pages when it goes", async () => {
    h.db.decision.findUnique.mockResolvedValue({ status: "PUBLISHED", communeId: "35238" });
    const missing = await transitionDecision(
      "dec-1",
      { action: "UNPUBLISH", reviewedBy: null, reason: null },
      META
    );
    expect(missing.ok).toBe(false);
    await transitionDecision(
      "dec-1",
      { action: "UNPUBLISH", reviewedBy: null, reason: "Date erronée" },
      META
    );
    expect(h.revalidateTags).toHaveBeenCalledWith(["territoire:35238"]);
  });

  it("reports a concurrent change instead of overwriting it", async () => {
    h.db.decision.findUnique.mockResolvedValue({ status: "IN_REVIEW", communeId: "35238" });
    h.tx.decision.updateMany.mockResolvedValue({ count: 0 });
    const result = await transitionDecision(
      "dec-1",
      { action: "REJECT", reviewedBy: null, reason: "Hors protocole" },
      META
    );
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(h.tx.auditLog.create).not.toHaveBeenCalled();
  });
});
