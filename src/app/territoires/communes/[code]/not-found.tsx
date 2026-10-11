import Link from "next/link";
import { TERRITOIRES_PATH } from "@/lib/territoires/paths";

export default function CommuneNotFound() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-16">
      <h1 className="font-display text-3xl font-extrabold tracking-tight">Commune introuvable</h1>
      <p className="mt-3 text-muted-foreground">
        Aucune commune ne porte ce code INSEE dans le Code officiel géographique importé par
        Poligraph. Le code INSEE compte cinq caractères (35238 pour Rennes, 2A004 pour Ajaccio) et
        diffère du code postal.
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
