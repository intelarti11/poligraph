import Link from "next/link";
import { TERRITOIRES_PATH } from "@/lib/territoires/paths";

export default function CommuneDecisionsNotFound() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-16">
      <h1 className="font-display text-3xl font-extrabold tracking-tight">
        Aucune décision publiée
      </h1>
      <p className="mt-3 text-muted-foreground">
        Poligraph ne documente pas encore de décision du conseil pour cette commune. Une décision n
        {"'"}apparaît ici qu{"'"}une fois sa notice vérifiée contre le document officiel qui la
        prouve.
      </p>
      <Link
        href={TERRITOIRES_PATH}
        prefetch={false}
        className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
      >
        Chercher une commune
      </Link>
    </div>
  );
}
