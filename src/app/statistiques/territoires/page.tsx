import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StatisticsPageLayout } from "@/components/stats/StatisticsPageLayout";
import { TerritoiresSection } from "@/components/stats/TerritoiresSection";
import { getTerritoiresStats } from "@/lib/data/territoires-stats";
import { isFeatureEnabled } from "@/lib/feature-flags";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Statistiques des maires et des communes",
  description:
    "Nombre de maires en fonction, part de femmes, âge des maires et taille des communes en France, calculés sur les données de Poligraph.",
  alternates: { canonical: "/statistiques/territoires" },
};

export default async function TerritoiresStatisticsPage() {
  if (!(await isFeatureEnabled("STATISTIQUES_SECTION"))) notFound();
  const stats = await getTerritoiresStats();

  return (
    <StatisticsPageLayout
      active="territoires"
      title="Statistiques des maires et des communes"
      description="Qui sont les maires en fonction et quelle est la taille des communes, à l’échelle nationale."
    >
      <TerritoiresSection stats={stats} />
    </StatisticsPageLayout>
  );
}
