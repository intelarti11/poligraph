import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getRegionTerritoire } from "@/lib/data/territoires";
import { getElections } from "@/lib/data/elections";
import { REGIONS } from "@/config/regions";
import { territoireRegionPath } from "@/lib/territoires/paths";
import { missingEntityMetadata } from "@/lib/seo/not-found-metadata";
import { RegionHero } from "@/components/territoires/RegionHero";
import {
  RegionCollectivites,
  RegionCouverture,
  RegionDepartements,
  RegionElections,
  RegionParlement,
  RegionReutiliser,
  type RegionElection,
} from "@/components/territoires/RegionSections";
import { formatCompte } from "@/lib/territoires/format";

// The 18 regions are a closed list: every page is prerendered, any other slug is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return REGIONS.map((r) => ({ slug: r.slug }));
}

const loadRegion = cache(getRegionTerritoire);

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadRegion(slug);
  if (!data) return missingEntityMetadata("Région introuvable");

  const { region } = data;
  const description = `${region.name} : ${formatCompte(data.departements.length, "département", "départements")} et ${formatCompte(data.communeCount, "commune", "communes")}. Les élus de chaque commune, les députés et sénateurs par département, avec la source de chaque information.`;
  // A region page is always indexable: no robots override.
  return {
    title: `${region.name} : départements, communes et élus`,
    description,
    alternates: { canonical: territoireRegionPath(region.slug) },
    openGraph: {
      title: region.name,
      description,
      url: territoireRegionPath(region.slug),
    },
  };
}

/**
 * Regional elections recorded in the base. Not shown where a single collectivity replaces the
 * region (Corse, Guyane, Martinique, Mayotte): their assembly is not elected at the regionales.
 */
async function loadRegionElections(hasCollectiviteParticuliere: boolean) {
  if (hasCollectiviteParticuliere) return [];
  const elections = await getElections("REGIONALES");
  return elections.map(
    (e): RegionElection => ({
      slug: e.slug,
      title: e.title,
      round1Date: e.round1Date ? e.round1Date.toISOString() : null,
    })
  );
}

export default async function RegionPage({ params }: PageProps) {
  const { slug } = await params;
  const data = await loadRegion(slug);
  if (!data) notFound();

  const elections = await loadRegionElections(data.collectivitesParticulieres.length > 0);

  return (
    <>
      <RegionHero data={data} />
      <div className="container mx-auto grid gap-6 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <RegionDepartements data={data} />
          <RegionCollectivites data={data} />
          <RegionElections elections={elections} />
        </div>
        <aside className="space-y-6" aria-label="Compléments">
          <RegionParlement data={data} />
          <RegionCouverture data={data} />
          <RegionReutiliser apiPath={`/api/v1/territoires/regions/${data.region.slug}`} />
        </aside>
      </div>
    </>
  );
}
