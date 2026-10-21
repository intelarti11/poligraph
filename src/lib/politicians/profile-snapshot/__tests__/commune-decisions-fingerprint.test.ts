import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

import { profileCommune } from "@/lib/data/politician-profile-reads";
import { hashSerializedDocument } from "../document";

/**
 * Regression for #1052, lot 2: the published-decision flag must not change the fingerprint of
 * the ~35 000 stored mayor profiles, nor move it when a commune goes from one decision to two.
 */
function document(commune: object): Prisma.InputJsonValue {
  return {
    identity: {
      slug: "camille-exemple",
      mandates: [
        {
          id: "m-1",
          type: "MAIRE",
          constituency: "Rennes (35238)",
          localData: { commune },
        },
      ],
    },
  } as Prisma.InputJsonValue;
}

// Projection on main before the lot: `localData.commune` selected the population only.
const BEFORE = hashSerializedDocument(document({ population: 230890 }));

describe("decision flag in the profile document", () => {
  it("leaves the fingerprint of a commune without published decision unchanged", () => {
    const now = profileCommune({ id: "35238", population: 230890, _count: { decisions: 0 } });
    expect(hashSerializedDocument(document(now))).toBe(BEFORE);
  });

  it("changes it once a decision is published, then not between one and two", () => {
    const one = profileCommune({ id: "35238", population: 230890, _count: { decisions: 1 } });
    const two = profileCommune({ id: "35238", population: 230890, _count: { decisions: 2 } });
    expect(hashSerializedDocument(document(one))).not.toBe(BEFORE);
    expect(hashSerializedDocument(document(two))).toBe(hashSerializedDocument(document(one)));
  });
});
