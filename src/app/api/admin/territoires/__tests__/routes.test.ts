import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  isAuthenticated: vi.fn(),
  transitionDecision: vi.fn(),
  createDecision: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ isAuthenticated: h.isAuthenticated }));
vi.mock("@/lib/territoires/decisions", () => ({
  transitionDecision: h.transitionDecision,
  createDecision: h.createDecision,
}));

import { POST as transition } from "../decisions/[id]/transition/route";
import { POST as create } from "../decisions/route";

const ctx = { params: Promise.resolve({ id: "dec-1" }) };

function post(body: unknown) {
  return new NextRequest("http://localhost/api/admin/territoires/decisions/dec-1/transition", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.isAuthenticated.mockResolvedValue(true);
});

describe("admin decision routes", () => {
  it("refuse an unauthenticated transition before reading the body", async () => {
    h.isAuthenticated.mockResolvedValue(false);
    const res = await transition(post({ action: "PUBLISH", reviewedBy: "x" }), ctx);
    expect(res.status).toBe(401);
    expect(h.transitionDecision).not.toHaveBeenCalled();
  });

  it("refuse an unauthenticated creation", async () => {
    h.isAuthenticated.mockResolvedValue(false);
    const res = await create(post({}), ctx);
    expect(res.status).toBe(401);
    expect(h.createDecision).not.toHaveBeenCalled();
  });

  it("reject an invalid body with 400", async () => {
    const res = await transition(post({ action: "FORCE_PUBLISH" }), ctx);
    expect(res.status).toBe(400);
    expect(h.transitionDecision).not.toHaveBeenCalled();
  });

  it("relay the business status of a refused transition", async () => {
    h.transitionDecision.mockResolvedValue({ ok: false, httpStatus: 409, message: "Impossible" });
    const res = await transition(post({ action: "PUBLISH", reviewedBy: "Relecteur" }), ctx);
    expect(res.status).toBe(409);
    expect(h.transitionDecision).toHaveBeenCalledWith(
      "dec-1",
      { action: "PUBLISH", reviewedBy: "Relecteur", reason: null },
      expect.objectContaining({ ip: expect.any(String) })
    );
  });
});
