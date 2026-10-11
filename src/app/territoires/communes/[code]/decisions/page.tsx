import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  CommuneDecisionsBandeau,
  CommuneDecisionsSections,
} from "@/components/territoires/CommuneDecisions";
import { getCommuneDossier } from "@/lib/data/territoires";
import { getCommuneDecisions } from "@/lib/data/territoire-decisions";
import { missingEntityMetadata } from "@/lib/seo/not-found-metadata";
import { territoireCommuneRobotsMetadata } from "@/lib/seo/territoire-robots";
import { territoireCommuneDecisionsPath } from "@/lib/territoires/paths";

// ISR: 24 h backstop; publishing or unpublishing a decision refreshes `territoire:<code>`.
export const revalidate = 86400;

export function generateStaticParams() {
  return [];
}

interface PageProps {
  params: Promise<{ code: string }>;
}

const loadDecisions = cache((code: string) => getCommuneDecisions(code));
const loadDossier = cache((code: string) => getCommuneDossier(code));

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const [decisions, dossier] = await Promise.all([loadDecisions(code), loadDossier(code)]);
  // No published decision: the page does not exist, it is never an empty indexable shell.
  if (!decisions || !dossier) return missingEntityMetadata("Décisions introuvables");

  const title = `${decisions.commune.name} : décisions du conseil`;
  const description = `Décisions du conseil municipal de ${decisions.commune.name}, datées et sourcées, classées par période institutionnelle.`;
  return {
    title,
    description,
    // A sub-page inherits the verdict of its commune page (AGENTS.md §5).
    ...territoireCommuneRobotsMetadata({
      population: dossier.population.value,
      maireEtabli: dossier.maire.state === "ETABLI",
    }),
    openGraph: { title, description },
    alternates: { canonical: territoireCommuneDecisionsPath(decisions.commune.inseeCode) },
  };
}

export default async function CommuneDecisionsPage({ params }: PageProps) {
  const { code } = await params;
  const decisions = await loadDecisions(code);
  if (!decisions) notFound();

  return (
    <>
      <CommuneDecisionsBandeau
        inseeCode={decisions.commune.inseeCode}
        name={decisions.commune.name}
      />
      <div className="container mx-auto max-w-6xl px-4 py-6 md:py-8">
        <CommuneDecisionsSections data={decisions} />
      </div>
    </>
  );
}
