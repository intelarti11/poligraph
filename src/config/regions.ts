import { generateSlug } from "@/lib/utils";

/**
 * Les 18 régions françaises : 13 en métropole, 5 en outre-mer (DROM).
 *
 * Source : Code officiel géographique (COG) de l'INSEE, édition 2026, fichiers « région » et
 * « département » (https://www.insee.fr/fr/information/2560452). Codes, noms officiels,
 * rattachement des départements et chef-lieu (code INSEE de la commune) en sont repris tels
 * quels ; le slug est dérivé du nom.
 *
 * Les collectivités d'outre-mer et territoires à statut particulier (codes 975 à 989) ne
 * relèvent d'aucune région : ils figurent dans `TERRITOIRES_HORS_REGION`, jamais ici.
 *
 * Le code région est celui que porte `Commune.regionCode` en base (vérifié en production le
 * 2026-10-11 : chaque département n'y a qu'un code région, identique à celui listé ici).
 */
export interface Region {
  /** Code INSEE de la région ("11", "84", "04"). */
  code: string;
  /** Nom officiel, tel qu'au COG. */
  name: string;
  slug: string;
  /** Codes des départements de la région, dans l'ordre du COG. */
  departmentCodes: readonly string[];
  /** Chef-lieu de région. */
  chefLieu: { inseeCode: string; name: string };
  outreMer: boolean;
}

type RegionInput = Omit<Region, "slug">;

const REGION_INPUTS: readonly RegionInput[] = [
  {
    code: "01",
    name: "Guadeloupe",
    departmentCodes: ["971"],
    chefLieu: { inseeCode: "97105", name: "Basse-Terre" },
    outreMer: true,
  },
  {
    code: "02",
    name: "Martinique",
    departmentCodes: ["972"],
    chefLieu: { inseeCode: "97209", name: "Fort-de-France" },
    outreMer: true,
  },
  {
    code: "03",
    name: "Guyane",
    departmentCodes: ["973"],
    chefLieu: { inseeCode: "97302", name: "Cayenne" },
    outreMer: true,
  },
  {
    code: "04",
    name: "La Réunion",
    departmentCodes: ["974"],
    chefLieu: { inseeCode: "97411", name: "Saint-Denis" },
    outreMer: true,
  },
  {
    code: "06",
    name: "Mayotte",
    departmentCodes: ["976"],
    chefLieu: { inseeCode: "97611", name: "Mamoudzou" },
    outreMer: true,
  },
  {
    code: "11",
    name: "Île-de-France",
    departmentCodes: ["75", "77", "78", "91", "92", "93", "94", "95"],
    chefLieu: { inseeCode: "75056", name: "Paris" },
    outreMer: false,
  },
  {
    code: "24",
    name: "Centre-Val de Loire",
    departmentCodes: ["18", "28", "36", "37", "41", "45"],
    chefLieu: { inseeCode: "45234", name: "Orléans" },
    outreMer: false,
  },
  {
    code: "27",
    name: "Bourgogne-Franche-Comté",
    departmentCodes: ["21", "25", "39", "58", "70", "71", "89", "90"],
    chefLieu: { inseeCode: "21231", name: "Dijon" },
    outreMer: false,
  },
  {
    code: "28",
    name: "Normandie",
    departmentCodes: ["14", "27", "50", "61", "76"],
    chefLieu: { inseeCode: "76540", name: "Rouen" },
    outreMer: false,
  },
  {
    code: "32",
    name: "Hauts-de-France",
    departmentCodes: ["02", "59", "60", "62", "80"],
    chefLieu: { inseeCode: "59350", name: "Lille" },
    outreMer: false,
  },
  {
    code: "44",
    name: "Grand Est",
    departmentCodes: ["08", "10", "51", "52", "54", "55", "57", "67", "68", "88"],
    chefLieu: { inseeCode: "67482", name: "Strasbourg" },
    outreMer: false,
  },
  {
    code: "52",
    name: "Pays de la Loire",
    departmentCodes: ["44", "49", "53", "72", "85"],
    chefLieu: { inseeCode: "44109", name: "Nantes" },
    outreMer: false,
  },
  {
    code: "53",
    name: "Bretagne",
    departmentCodes: ["22", "29", "35", "56"],
    chefLieu: { inseeCode: "35238", name: "Rennes" },
    outreMer: false,
  },
  {
    code: "75",
    name: "Nouvelle-Aquitaine",
    departmentCodes: ["16", "17", "19", "23", "24", "33", "40", "47", "64", "79", "86", "87"],
    chefLieu: { inseeCode: "33063", name: "Bordeaux" },
    outreMer: false,
  },
  {
    code: "76",
    name: "Occitanie",
    departmentCodes: ["09", "11", "12", "30", "31", "32", "34", "46", "48", "65", "66", "81", "82"],
    chefLieu: { inseeCode: "31555", name: "Toulouse" },
    outreMer: false,
  },
  {
    code: "84",
    name: "Auvergne-Rhône-Alpes",
    departmentCodes: ["01", "03", "07", "15", "26", "38", "42", "43", "63", "69", "73", "74"],
    chefLieu: { inseeCode: "69123", name: "Lyon" },
    outreMer: false,
  },
  {
    code: "93",
    name: "Provence-Alpes-Côte d'Azur",
    departmentCodes: ["04", "05", "06", "13", "83", "84"],
    chefLieu: { inseeCode: "13055", name: "Marseille" },
    outreMer: false,
  },
  {
    code: "94",
    name: "Corse",
    departmentCodes: ["2A", "2B"],
    chefLieu: { inseeCode: "2A004", name: "Ajaccio" },
    outreMer: false,
  },
];

export const REGIONS: readonly Region[] = REGION_INPUTS.map((r) => ({
  ...r,
  slug: generateSlug(r.name),
}));

/**
 * Territoires d'outre-mer rattachés à aucune région. Leur statut est donné en clair parce
 * qu'il diffère d'un territoire à l'autre : la Nouvelle-Calédonie n'est pas une collectivité
 * d'outre-mer de l'article 74, les TAAF et Clipperton n'ont pas de communes au sens usuel.
 * Source : Constitution, articles 74 et 76-77 ; COG INSEE 2026, « collectivités d'outre-mer ».
 */
export const TERRITOIRES_HORS_REGION: Readonly<Record<string, { name: string; statut: string }>> = {
  "975": { name: "Saint-Pierre-et-Miquelon", statut: "Collectivité d'outre-mer" },
  "977": { name: "Saint-Barthélemy", statut: "Collectivité d'outre-mer" },
  "978": { name: "Saint-Martin", statut: "Collectivité d'outre-mer" },
  "984": {
    name: "Terres australes et antarctiques françaises",
    statut: "Territoire d'outre-mer à statut particulier (loi du 6 août 1955)",
  },
  "986": { name: "Wallis-et-Futuna", statut: "Collectivité d'outre-mer" },
  "987": { name: "Polynésie française", statut: "Collectivité d'outre-mer" },
  "988": { name: "Nouvelle-Calédonie", statut: "Collectivité à statut particulier" },
  "989": { name: "Île de Clipperton", statut: "Île du domaine public de l'État" },
};

const BY_SLUG = new Map(REGIONS.map((r) => [r.slug, r]));
const BY_CODE = new Map(REGIONS.map((r) => [r.code, r]));
const BY_DEPARTMENT = new Map(REGIONS.flatMap((r) => r.departmentCodes.map((d) => [d, r])));

export function getRegionBySlug(slug: string): Region | null {
  return BY_SLUG.get(slug) ?? null;
}

export function getRegionByCode(code: string | null | undefined): Region | null {
  if (!code) return null;
  return BY_CODE.get(code) ?? null;
}

/** Null for the territories of `TERRITOIRES_HORS_REGION` and for any unknown code. */
export function getRegionForDepartment(departmentCode: string | null | undefined): Region | null {
  if (!departmentCode) return null;
  return BY_DEPARTMENT.get(departmentCode.toUpperCase()) ?? null;
}

/** Statut of an overseas territory outside any region, or null. */
export function getTerritoireHorsRegion(
  departmentCode: string | null | undefined
): { code: string; name: string; statut: string } | null {
  if (!departmentCode) return null;
  const entry = TERRITOIRES_HORS_REGION[departmentCode];
  return entry ? { code: departmentCode, ...entry } : null;
}
