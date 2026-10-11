/**
 * Territoires où la collectivité compétente ne coïncide pas avec le découpage commune /
 * département / région de droit commun.
 *
 * Usage : une note factuelle sur la page du territoire concerné, avec sa source. Jamais de
 * conseil, d'élu ou de rattachement déduit de ces entrées : elles disent comment le territoire
 * est organisé, pas qui y siège.
 *
 * Les URL Légifrance sont des identifiants ELI (texte publié au Journal officiel), stables par
 * construction. Vérifiées le 2026-10-11.
 */
export interface CollectiviteParticuliere {
  /** Clé stable, pour les tests et les ancres. */
  id: string;
  /** Collectivité compétente, telle que le texte la nomme. */
  collectivite: string;
  /** Territoires sur la page desquels la note s'affiche. */
  communes?: readonly string[];
  departements?: readonly string[];
  regions?: readonly string[];
  /** Texte court, factuel, sans tiret cadratin. */
  note: string;
  source: { label: string; url: string };
}

const LEGIFRANCE_ELI = "https://www.legifrance.gouv.fr/eli/loi";

const PLM_SOURCE = {
  label: "Direction générale des collectivités locales, statut de Paris, Marseille et Lyon",
  url: "https://www.collectivites-locales.gouv.fr/connaitre-les-acteurs-et-les-institutions/structures-territoriales/les-collectivites-statut-particulier/statut-de-paris-marseille-lyon",
} as const;

export const COLLECTIVITES_PARTICULIERES: readonly CollectiviteParticuliere[] = [
  {
    id: "ville-de-paris",
    collectivite: "Ville de Paris",
    communes: ["75056"],
    departements: ["75"],
    note: "Depuis le 1er janvier 2019, la Ville de Paris est une collectivité à statut particulier qui exerce à la fois les compétences d'une commune et celles d'un département.",
    source: {
      label: "Loi n° 2017-257 du 28 février 2017 relative au statut de Paris",
      url: `${LEGIFRANCE_ELI}/2017/2/28/2017-257/jo/texte`,
    },
  },
  {
    id: "paris-arrondissements",
    collectivite: "Ville de Paris",
    communes: ["75056"],
    note: "Paris est divisée en arrondissements regroupés en secteurs. Les conseillers d'arrondissement sont élus par secteur et désignent un maire pour chaque secteur.",
    source: PLM_SOURCE,
  },
  {
    id: "metropole-de-lyon-commune",
    collectivite: "Métropole de Lyon",
    communes: ["69123"],
    note: "Lyon fait partie de la Métropole de Lyon, collectivité à statut particulier créée le 1er janvier 2015, qui exerce sur son territoire les compétences du département.",
    source: {
      label:
        "Loi n° 2014-58 du 27 janvier 2014 de modernisation de l'action publique territoriale et d'affirmation des métropoles",
      url: `${LEGIFRANCE_ELI}/2014/1/27/2014-58/jo/texte`,
    },
  },
  {
    id: "metropole-de-lyon-departement",
    collectivite: "Métropole de Lyon",
    departements: ["69"],
    note: "Sur une partie du territoire du Rhône, les compétences départementales sont exercées depuis le 1er janvier 2015 par la Métropole de Lyon, collectivité à statut particulier distincte du département.",
    source: {
      label:
        "Loi n° 2014-58 du 27 janvier 2014 de modernisation de l'action publique territoriale et d'affirmation des métropoles",
      url: `${LEGIFRANCE_ELI}/2014/1/27/2014-58/jo/texte`,
    },
  },
  {
    id: "lyon-arrondissements",
    collectivite: "Commune de Lyon",
    communes: ["69123"],
    note: "Lyon est divisée en arrondissements. Les conseillers d'arrondissement y sont élus et désignent un maire d'arrondissement.",
    source: PLM_SOURCE,
  },
  {
    id: "marseille-secteurs",
    collectivite: "Commune de Marseille",
    communes: ["13055"],
    note: "Marseille est divisée en arrondissements regroupés en secteurs. Les conseillers d'arrondissement sont élus par secteur et désignent un maire pour chaque secteur.",
    source: PLM_SOURCE,
  },
  {
    id: "collectivite-de-corse",
    collectivite: "Collectivité de Corse",
    departements: ["2A", "2B"],
    regions: ["94"],
    note: "Depuis le 1er janvier 2018, la Collectivité de Corse exerce les compétences de la région et des deux départements de Corse-du-Sud et de Haute-Corse, qui ne sont plus des collectivités distinctes.",
    source: {
      label:
        "Loi n° 2015-991 du 7 août 2015 portant nouvelle organisation territoriale (article 30)",
      url: `${LEGIFRANCE_ELI}/2015/8/7/2015-991/jo/texte`,
    },
  },
  {
    id: "collectivite-europeenne-d-alsace",
    collectivite: "Collectivité européenne d'Alsace",
    departements: ["67", "68"],
    note: "Depuis le 1er janvier 2021, les départements du Bas-Rhin et du Haut-Rhin sont regroupés au sein de la Collectivité européenne d'Alsace, qui exerce les compétences départementales.",
    source: {
      label:
        "Loi n° 2019-816 du 2 août 2019 relative aux compétences de la Collectivité européenne d'Alsace",
      url: `${LEGIFRANCE_ELI}/2019/8/2/2019-816/jo/texte`,
    },
  },
  {
    id: "collectivite-territoriale-de-guyane",
    collectivite: "Collectivité territoriale de Guyane",
    departements: ["973"],
    regions: ["03"],
    note: "La Collectivité territoriale de Guyane est une collectivité unique qui exerce les compétences du département et de la région.",
    source: {
      label:
        "Loi n° 2011-884 du 27 juillet 2011 relative aux collectivités territoriales de Guyane et de Martinique",
      url: `${LEGIFRANCE_ELI}/2011/7/27/2011-884/jo/texte`,
    },
  },
  {
    id: "collectivite-territoriale-de-martinique",
    collectivite: "Collectivité territoriale de Martinique",
    departements: ["972"],
    regions: ["02"],
    note: "La Collectivité territoriale de Martinique est une collectivité unique qui exerce les compétences du département et de la région.",
    source: {
      label:
        "Loi n° 2011-884 du 27 juillet 2011 relative aux collectivités territoriales de Guyane et de Martinique",
      url: `${LEGIFRANCE_ELI}/2011/7/27/2011-884/jo/texte`,
    },
  },
  {
    id: "departement-de-mayotte",
    collectivite: "Département de Mayotte",
    departements: ["976"],
    regions: ["06"],
    note: "Le Département de Mayotte est une collectivité unique qui exerce les compétences d'un département et celles d'une région d'outre-mer.",
    source: {
      label: "Loi n° 2010-1487 du 7 décembre 2010 relative au Département de Mayotte",
      url: `${LEGIFRANCE_ELI}/2010/12/7/2010-1487/jo/texte`,
    },
  },
];

export function getCollectivitesForCommune(inseeCode: string): CollectiviteParticuliere[] {
  return COLLECTIVITES_PARTICULIERES.filter((c) => c.communes?.includes(inseeCode));
}

export function getCollectivitesForDepartment(code: string): CollectiviteParticuliere[] {
  const normalized = code.toUpperCase();
  return COLLECTIVITES_PARTICULIERES.filter((c) => c.departements?.includes(normalized));
}

export function getCollectivitesForRegion(code: string): CollectiviteParticuliere[] {
  return COLLECTIVITES_PARTICULIERES.filter((c) => c.regions?.includes(code));
}
