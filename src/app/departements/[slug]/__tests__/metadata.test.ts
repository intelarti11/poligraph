import { describe, it, expect, vi } from "vitest";

// The department list is static config: generateMetadata touches no database.
vi.mock("@/lib/db", () => ({ db: {} }));

import { generateMetadata } from "@/app/departements/[slug]/page";

const metadataFor = (slug: string) => generateMetadata({ params: Promise.resolve({ slug }) });

describe("/departements/[slug] metadata", () => {
  it("noindex un département inexistant au lieu de l'offrir à l'indexation", async () => {
    const m = await metadataFor("x-bidon");

    expect(m.title).toBe("Département introuvable");
    expect(m.robots).toEqual({ index: false, follow: true });
  });

  it("laisse intacte la metadata d'un département existant", async () => {
    const m = await metadataFor("loire");

    expect(m.title).toBe("Loire");
    expect(m.description).toContain("Loire");
    expect(m.alternates?.canonical).toBe("/departements/loire");
    expect(m.robots).toBeUndefined();
  });
});

describe("/departements/[slug] generateStaticParams", () => {
  it("pré-génère les vrais slugs, chacun résolu par la page", async () => {
    const { generateStaticParams } = await import("@/app/departements/[slug]/page");
    const { DEPARTMENTS, getDepartmentBySlug } = await import("@/config/departments");
    const params = generateStaticParams();

    expect(params).toHaveLength(Object.keys(DEPARTMENTS).length);
    for (const { slug } of params) expect(getDepartmentBySlug(slug), slug).not.toBeNull();
    expect(params).toContainEqual({ slug: "ille-et-vilaine" });
    expect(params).toContainEqual({ slug: "corse-du-sud" });
  });
});
