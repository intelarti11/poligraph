import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommuneDossier } from "@/lib/data/territoires";
import { OG_IMAGE_ROBOTS_SOURCE } from "@/lib/seo/og-image-robots";
import { dossier, papeete, reunion, withMaire } from "./fixtures";

const mocks = vi.hoisted(() => ({
  imageResponses: [] as Array<{ element: ReactNode; options: unknown }>,
  getCommuneDossier: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
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
  truncateOg: (text: string) => text,
}));
vi.mock("@/lib/data/territoires", () => ({
  getCommuneDossier: (code: string) => mocks.getCommuneDossier(code),
}));

import Image, { alt, size } from "../opengraph-image";

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

async function render(data: CommuneDossier | null, code = data?.identity.inseeCode ?? "99999") {
  mocks.getCommuneDossier.mockResolvedValue(data);
  await Image({ params: Promise.resolve({ code }) });
  return mocks.imageResponses[0]?.element;
}

describe("Open Graph d'une commune Territoires", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.imageResponses.length = 0;
  });

  it("a la taille standard et un texte alternatif", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(alt).toContain("Commune");
  });

  it("nomme le maire établi et dessine la silhouette du département", async () => {
    const element = await render(dossier());
    const text = textContent(element);

    expect(text).toContain("Commune · Ille-et-Vilaine (35)");
    expect(text).toContain("Rennes");
    expect(text).toContain("Maire : Camille Exemple, depuis mars 2026");
    expect(text).toMatch(/Population : 230\s890 habitants/);
    const shapes = imgSources(element);
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(Buffer.from(shapes[0]!.split(",")[1]!, "base64").toString()).toContain("<circle");
  });

  it("ne nomme personne quand le maire n'est pas établi", async () => {
    const text = textContent(await render(withMaire("NON_ETABLI")));
    expect(text).toContain("Maire : titulaire non établi");
    expect(text).not.toContain("Camille");
  });

  it("rend une commune ultramarine sans contour, jamais celui d'un autre territoire", async () => {
    const element = await render(reunion());
    expect(imgSources(element)).toEqual([]);
    expect(textContent(element)).toContain("Saint-Denis");
  });

  it("rend une COM sans maire, sans contour, avec son statut", async () => {
    const element = await render(papeete());
    const text = textContent(element);
    expect(imgSources(element)).toEqual([]);
    expect(text).toContain("Collectivité d'outre-mer hors région");
    expect(text).not.toContain("Maire");
  });

  it("répond 404 pour une commune inconnue", async () => {
    await expect(render(null)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("est couverte par la règle X-Robots-Tag des images Open Graph", () => {
    const pattern = new RegExp(`^${OG_IMAGE_ROBOTS_SOURCE.replace("/:path*", "(?:/.*)?")}$`);
    expect(pattern.test("/territoires/communes/35238/opengraph-image")).toBe(true);
  });
});
