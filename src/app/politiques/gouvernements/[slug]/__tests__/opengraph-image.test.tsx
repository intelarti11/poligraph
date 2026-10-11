import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  imageResponses: [] as Array<{ element: ReactNode; options: unknown }>,
  findUnique: vi.fn(),
  loadOgPortrait: vi.fn(),
  getPublishedGovernments: vi.fn(),
  isFeatureEnabled: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(element: ReactNode, options: unknown) {
      mocks.imageResponses.push({ element, options });
    }
  },
}));
vi.mock("@/lib/og-utils", () => ({
  OG_SIZE: { width: 1200, height: 630 },
  OgLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
  loadOgPortrait: (url: string | null | undefined) => mocks.loadOgPortrait(url),
}));
vi.mock("@/lib/db", () => ({ db: { politician: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/data/governments", () => ({
  getPublishedGovernments: () => mocks.getPublishedGovernments(),
}));
vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: (key: string) => mocks.isFeatureEnabled(key),
}));

import Image from "../opengraph-image";

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (!node || typeof node === "boolean") return "";
  if (typeof node === "object" && "props" in node) {
    return textContent((node.props as { children?: ReactNode }).children);
  }
  return "";
}

function imgSources(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(imgSources);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const props = node.props as { children?: ReactNode; src?: string };
  const own = node.type === "img" && props.src ? [props.src] : [];
  return [...own, ...imgSources(props.children)];
}

const government = (overrides: Record<string, unknown> = {}) => ({
  slug: "rivet-2",
  name: "Gouvernement Camille Rivet II",
  primeMinister: { slug: "camille-rivet", fullName: "Camille Rivet", gender: "F" },
  primeMinisterAppointedAt: "2025-10-10",
  formedAt: "2025-10-10",
  resignedAt: null,
  endedAt: null,
  hasDerivedDate: false,
  completeness: "COMPLETE",
  ...overrides,
});

const primeMinister = (overrides: Record<string, unknown> = {}) => ({
  firstName: "Camille",
  lastName: "Rivet",
  photoUrl: "https://source.test/rivet.jpg",
  blobPhotoUrl: "https://blob.test/rivet-portrait.jpg",
  ...overrides,
});

async function render(slug = "rivet-2") {
  await Image({ params: Promise.resolve({ slug }) });
  return mocks.imageResponses[0]?.element;
}

describe("Open Graph d'un gouvernement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.imageResponses.length = 0;
    mocks.isFeatureEnabled.mockResolvedValue(true);
    mocks.getPublishedGovernments.mockResolvedValue([government()]);
    mocks.findUnique.mockResolvedValue(primeMinister());
    mocks.loadOgPortrait.mockResolvedValue("data:image/jpeg;base64,portrait");
  });

  it("rend le portrait du Premier ministre, en préférant la copie Blob", async () => {
    const element = await render();

    expect(mocks.findUnique.mock.calls[0]?.[0]?.where?.slug).toBe("camille-rivet");
    expect(mocks.loadOgPortrait).toHaveBeenCalledWith("https://blob.test/rivet-portrait.jpg");
    expect(imgSources(element)).toContain("data:image/jpeg;base64,portrait");
    expect(textContent(element)).toContain("Gouvernement Camille Rivet II");
  });

  it("ne lit le portrait que sur une fiche publique", async () => {
    mocks.findUnique.mockResolvedValue(null);

    const element = await render();

    expect(JSON.stringify(mocks.findUnique.mock.calls[0]?.[0]?.where)).toContain("PUBLISHED");
    expect(mocks.loadOgPortrait).not.toHaveBeenCalled();
    expect(imgSources(element)).toHaveLength(0);
    expect(textContent(element)).toContain("Gouvernement Camille Rivet II");
  });

  it("retombe sur les initiales quand la photo est illisible", async () => {
    mocks.loadOgPortrait.mockResolvedValue(null);

    const element = await render();

    expect(imgSources(element)).toHaveLength(0);
    expect(textContent(element)).toContain("CR");
  });

  it("affirme le sourçage au Journal officiel pour une composition complète", async () => {
    expect(textContent(await render())).toContain(
      "Sa composition jour par jour, chaque nomination sourcée par le Journal officiel."
    );
  });

  it("n'affirme aucun sourçage pour une composition partielle", async () => {
    mocks.getPublishedGovernments.mockResolvedValue([government({ completeness: "PARTIAL" })]);

    const rendered = textContent(await render());

    expect(rendered).toContain("Sa composition documentée et les actes officiels qui l'appuient.");
    expect(rendered).not.toMatch(/chaque nomination|jour par jour/);
  });

  it("n'affirme aucun sourçage quand une date est estimée", async () => {
    mocks.getPublishedGovernments.mockResolvedValue([government({ hasDerivedDate: true })]);

    expect(textContent(await render())).not.toMatch(/chaque nomination/);
  });

  it("affiche les initiales, sans photo, quand la fiche du Premier ministre n'est pas publiée", async () => {
    // Debré : fiche exclue, la lecture filtrée par PUBLIC_POLITICIAN_WHERE ne renvoie rien.
    mocks.getPublishedGovernments.mockResolvedValue([
      government({
        slug: "debre",
        name: "Gouvernement Michel Debré",
        primeMinister: { slug: "michel-debre", fullName: "Michel Debré", gender: "M" },
      }),
    ]);
    mocks.findUnique.mockResolvedValue(null);

    const element = await render("debre");

    expect(mocks.loadOgPortrait).not.toHaveBeenCalled();
    expect(imgSources(element)).toHaveLength(0);
    expect(textContent(element)).toContain("MD");
  });

  it("saute les particules dans les initiales", async () => {
    mocks.getPublishedGovernments.mockResolvedValue([
      government({
        primeMinister: {
          slug: "maurice-couve-de-murville",
          fullName: "Maurice Couve de Murville",
          gender: "M",
        },
      }),
    ]);
    mocks.findUnique.mockResolvedValue(null);

    expect(textContent(await render())).toContain("MC");
  });

  it("donne la date de nomination d'un gouvernement en cours, sans le dire en fonction", async () => {
    const rendered = textContent(await render());

    expect(rendered).toContain("Équipe nommée le 10 octobre 2025");
    expect(rendered).not.toMatch(/en fonction|en cours|membres/i);
  });

  it("donne la période d'un gouvernement terminé", async () => {
    mocks.getPublishedGovernments.mockResolvedValue([government({ endedAt: "2026-01-01" })]);

    expect(textContent(await render())).toContain("Du 10 octobre 2025 au 1er janvier 2026");
  });

  it("part de la date de l'équipe, comme le répertoire et la page", async () => {
    // Jospin : Premier ministre nommé le 2 juin 1997, équipe le 4 juin.
    mocks.getPublishedGovernments.mockResolvedValue([
      government({
        primeMinisterAppointedAt: "1997-06-02",
        formedAt: "1997-06-04",
        endedAt: "2002-05-07",
      }),
    ]);

    const rendered = textContent(await render());

    expect(rendered).toContain("Du 4 juin 1997 au 7 mai 2002");
    expect(rendered).not.toContain("2 juin 1997");
  });

  it("n'écrit aucune période quand une date est estimée", async () => {
    mocks.getPublishedGovernments.mockResolvedValue([
      government({ endedAt: "2026-01-01", hasDerivedDate: true }),
    ]);

    const rendered = textContent(await render());

    expect(rendered).toContain("Gouvernement Camille Rivet II");
    expect(rendered).not.toMatch(/2025|2026/);
  });

  it("ne décrit pas un gouvernement non publié", async () => {
    const rendered = textContent(await render("brouillon"));

    expect(rendered).toContain("Gouvernement introuvable");
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("ne décrit rien tant que la rubrique est désactivée", async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false);

    const rendered = textContent(await render());

    expect(rendered).toContain("Gouvernement introuvable");
    expect(mocks.getPublishedGovernments).not.toHaveBeenCalled();
  });
});
