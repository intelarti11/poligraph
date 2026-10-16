import type { InstitutionalSource } from "@/lib/parlement/legislature-types";

/**
 * Sources des faits institutionnels des législatures de l'Assemblée nationale.
 * Toutes lues le 2026-10-16. Une source relayée sans relecture directe porte
 * `unverifiedDirectly`.
 */
export const AN_SOURCES: InstitutionalSource[] = [
  {
    id: "constitution-art-12",
    kind: "constitution",
    publisher: "Légifrance",
    label: "Constitution du 4 octobre 1958, article 12",
    url: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000571356",
    consultedAt: "2026-10-16",
    quote:
      "L'Assemblée nationale se réunit de plein droit le deuxième jeudi qui suit son élection.",
  },
  {
    id: "lo-119",
    kind: "loi-organique",
    publisher: "Légifrance",
    label: "Code électoral, article LO 119 (loi organique n° 2009-38 du 13 janvier 2009)",
    url: "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000020103138",
    consultedAt: "2026-10-16",
    quote: "Le nombre des députés est de cinq cent soixante-dix-sept.",
  },
  {
    id: "lo-121",
    kind: "loi-organique",
    publisher: "Légifrance",
    label:
      "Code électoral, article LO 121 (loi organique n° 2001-419 du 15 mai 2001), version en vigueur au 26 mars 2023",
    url: "https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006070239/LEGISCTA000006148463/2023-03-26/",
    consultedAt: "2026-10-16",
    quote:
      "Les pouvoirs de l'Assemblée nationale expirent le troisième mardi de juin de la cinquième année qui suit son élection.",
  },
  {
    id: "decret-2017-616",
    kind: "decret",
    publisher: "Légifrance",
    label: "Décret n° 2017-616 du 24 avril 2017 portant convocation des électeurs (députés)",
    url: "https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000034475263",
    consultedAt: "2026-10-16",
  },
  {
    id: "decret-2022-648",
    kind: "decret",
    publisher: "Légifrance",
    label: "Décret n° 2022-648 du 25 avril 2022 portant convocation des électeurs (députés)",
    url: "https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000045653424",
    consultedAt: "2026-10-16",
  },
  {
    id: "decret-2024-527",
    kind: "decret",
    publisher: "Légifrance",
    label: "Décret n° 2024-527 du 9 juin 2024 portant convocation des électeurs (députés)",
    url: "https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000049689654",
    consultedAt: "2026-10-16",
  },
  {
    id: "decret-dissolution-2024",
    kind: "decret",
    publisher: "Légifrance",
    label:
      "Décret du 9 juin 2024 portant dissolution de l'Assemblée nationale (JO du 10 juin 2024)",
    url: "https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000049689651",
    consultedAt: "2026-10-16",
    quote: "L'Assemblée nationale est dissoute.",
  },
  {
    id: "cr-2017-06-27",
    kind: "compte-rendu",
    publisher: "Assemblée nationale",
    label: "Compte rendu de la séance du mardi 27 juin 2017",
    url: "https://www.assemblee-nationale.fr/dyn/15/comptes-rendus/seance/session-ordinaire-de-2016-2017/seance-du-mardi-27-juin-2017",
    consultedAt: "2026-10-16",
    quote: "Je déclare ouverte la XVe législature de l'Assemblée nationale.",
  },
  {
    id: "cr-2022-06-28",
    kind: "compte-rendu",
    publisher: "Assemblée nationale",
    label: "Compte rendu de la séance du mardi 28 juin 2022",
    url: "https://www.assemblee-nationale.fr/dyn/16/comptes-rendus/seance/session-ordinaire-de-2021-2022/seance-du-mardi-28-juin-2022",
    consultedAt: "2026-10-16",
    quote: "Je déclare ouverte la XVIe législature de l'Assemblée nationale.",
  },
  {
    id: "cr-2024-07-18",
    kind: "compte-rendu",
    publisher: "Assemblée nationale",
    label: "Compte rendu de la séance du jeudi 18 juillet 2024",
    url: "https://www.assemblee-nationale.fr/dyn/17/comptes-rendus/seance/session-de-droit-de-2024/seance-du-jeudi-18-juillet-2024",
    consultedAt: "2026-10-16",
    quote:
      "Je déclare ouverte la XVIIe législature de l'Assemblée nationale et la session de droit prévue par l'article 12 de la Constitution.",
  },
  {
    id: "an-archives-15",
    kind: "archive-an",
    publisher: "Assemblée nationale",
    label: "Archives de la 15e législature",
    url: "https://www.assemblee-nationale.fr/dyn/archives-15",
    consultedAt: "2026-10-16",
    quote: "du 23 juin 2017 au 21 juin 2022",
  },
  {
    id: "an-archives-16",
    kind: "archive-an",
    publisher: "Assemblée nationale",
    label: "Archives de la 16e législature (22 juin 2022 - 9 juin 2024)",
    url: "https://www.assemblee-nationale.fr/dyn/actualites-accueil-hub/archives-de-la-16e-legislature-22-juin-2022-9-juin-2024",
    consultedAt: "2026-10-16",
  },
  {
    id: "an-calendrier-17",
    kind: "page-an",
    publisher: "Assemblée nationale",
    label: "Calendrier d'ouverture de la 17e législature",
    url: "https://www.assemblee-nationale.fr/dyn/actualites-accueil-hub/calendrier-d-ouverture-de-la-17e-legislature",
    consultedAt: "2026-10-16",
  },
  {
    id: "an-dissolution-2024",
    kind: "page-an",
    publisher: "Assemblée nationale",
    label:
      "Dissolution de l'Assemblée nationale, en application de l'article 12 de la Constitution",
    url: "https://www.assemblee-nationale.fr/dyn/actualites-accueil-hub/dissolution-de-l-assemblee-nationale-en-application-de-l-article-12-de-la-constitution",
    consultedAt: "2026-10-16",
  },
  {
    id: "poligraph-mandats-an",
    kind: "donnee-poligraph",
    publisher: "PoliGraph",
    label:
      "Dates de début des mandats de député importées dans PoliGraph (open data de l'Assemblée nationale)",
    url: "https://data.assemblee-nationale.fr/",
    consultedAt: "2026-10-16",
    unverifiedDirectly: true,
  },
];
