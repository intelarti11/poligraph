/**
 * Official population series imported by `scripts/sync-populations.ts` into
 * `CommunePopulation`. Every figure carries the vintage (millésime), the date its decree makes
 * it apply, and its source. Nothing here is computed except the PLM communes, whose INSEE
 * figure is the sum of their municipal arrondissements (checked against INSEE's commune-level
 * figure for 2023: equal for Paris, Lyon and Marseille).
 *
 * Coverage, verified on insee.fr and Légifrance on 2026-10-11:
 * - Metropolitan France, 971 to 974, 975, 977, 978: INSEE "populations de référence" (the term
 *   replaced "populations légales" from the 2022 vintage), national file, two vintages.
 * - 976 Mayotte: excluded from the national file. The last authenticated figures are the 2017
 *   census (decree 2017-1688), in force since 2018-01-01. INSEE announces new figures from the
 *   2025-2026 exhaustive census, to be authenticated at the end of 2026.
 * - 987, 988, 986: own general census every five years (article 157 of law 2002-276),
 *   authenticated by decree. Figures transcribed from INSEE's tables of each decree.
 * - 984 TAAF, 989 Clipperton: no resident population, no series.
 */

/**
 * From this population on, a single recorded constituency is never shown as established on a
 * Territoires commune page. Lives here, free of server imports, so the importer can report
 * which communes cross it.
 */
export const DEPUTE_UNIQUE_MAX_POPULATION = 20_000;

/** SyncMetadata key: date of the last import that checked every row against its source. */
export const POPULATION_SYNC_KEY = "communes-populations";

export interface PopulationSource {
  /** Key used in reports. */
  key: string;
  millesime: number;
  /** ISO date from which the decree makes the figures apply. */
  effectiveFrom: string;
  /** Short name shown to readers, in parentheses after the figure. */
  producer: string;
  label: string;
  url: string;
}

export interface InseeNationalSource extends PopulationSource {
  fileUrl: string;
  /** Communal boundaries the file is published in (1 January of millésime + 2). */
  geographyDate: string;
}

export const INSEE_POPULATIONS_2023: InseeNationalSource = {
  key: "insee-2023",
  millesime: 2023,
  effectiveFrom: "2026-01-01",
  geographyDate: "2025-01-01",
  producer: "INSEE",
  label: "INSEE, populations de référence 2023 (décret n° 2025-1362 du 26 décembre 2025)",
  url: "https://www.insee.fr/fr/statistiques/8680726",
  fileUrl: "https://www.insee.fr/fr/statistiques/fichier/8680726/ensemble.zip",
};

export const INSEE_POPULATIONS_2022: InseeNationalSource = {
  key: "insee-2022",
  millesime: 2022,
  effectiveFrom: "2025-01-01",
  geographyDate: "2024-01-01",
  producer: "INSEE",
  label: "INSEE, populations de référence 2022 (décret n° 2024-1276 du 31 décembre 2024)",
  url: "https://www.insee.fr/fr/statistiques/8290591",
  fileUrl: "https://www.insee.fr/fr/statistiques/fichier/8290591/ensemble.zip",
};

/** National files, newest first. The first one sets the geography the base is matched in. */
export const INSEE_NATIONAL_SOURCES = [INSEE_POPULATIONS_2023, INSEE_POPULATIONS_2022] as const;

/**
 * COG commune movements (all events since 1943). An older vintage is published in older
 * boundaries: a code whose territory changed since (merger, restoration, new chef-lieu code)
 * would carry the population of another territory, so its row is dropped, never adjusted.
 * Must be a COG edition at least as recent as the newest file's geography.
 */
export const INSEE_COG_MOUVEMENTS_URL =
  "https://www.insee.fr/fr/statistiques/fichier/8377162/v_mvt_commune_2025.csv";

/** PLM communes: INSEE lists their municipal arrondissements, not the commune itself. */
export const PLM_ARRONDISSEMENT_PREFIXES: Record<string, string> = {
  "75056": "751",
  "69123": "6938",
  "13055": "132",
};

/** [INSEE code, name as published, municipale, comptée à part, totale] */
export type OverseasRow = readonly [string, string, number, number, number];

export interface OverseasPopulationSeries {
  source: PopulationSource;
  departmentCode: string;
  /** Article 1 of the decree: the municipal population of the whole territory. */
  decreeTotalMunicipale: number;
  rows: OverseasRow[];
}

const MAYOTTE_2017: OverseasRow[] = [
  ["97601", "Acoua", 5192, 192, 5384],
  ["97602", "Bandraboua", 13989, 222, 14211],
  ["97603", "Bandrele", 10282, 247, 10529],
  ["97604", "Bouéni", 6189, 314, 6503],
  ["97605", "Chiconi", 8295, 321, 8616],
  ["97606", "Chirongui", 8920, 277, 9197],
  ["97607", "Dembeni", 15848, 268, 16116],
  ["97608", "Dzaoudzi", 17831, 406, 18237],
  ["97609", "Kani-Kéli", 5507, 209, 5716],
  ["97610", "Koungou", 32156, 596, 32752],
  ["97611", "Mamoudzou", 71437, 1537, 72974],
  ["97612", "Mtsamboro", 7705, 320, 8025],
  ["97613", "M'Tsangamouji", 6432, 154, 6586],
  ["97614", "Ouangani", 10203, 190, 10393],
  ["97615", "Pamandzi", 11442, 360, 11802],
  ["97616", "Sada", 11156, 463, 11619],
  ["97617", "Tsingoni", 13934, 301, 14235],
];

const POLYNESIE_2022: OverseasRow[] = [
  ["98711", "Anaa", 970, 1, 971],
  ["98712", "Arue", 10322, 55, 10377],
  ["98713", "Arutua", 1736, 15, 1751],
  ["98714", "Bora-Bora", 10758, 98, 10856],
  ["98715", "Faaa", 29826, 319, 30145],
  ["98716", "Fakarava", 1679, 23, 1702],
  ["98717", "Fangatau", 323, 1, 324],
  ["98718", "Fatu-Hiva", 600, 9, 609],
  ["98719", "Gambier", 1570, 26, 1596],
  ["98720", "Hao", 1227, 147, 1374],
  ["98721", "Hikueru", 199, 0, 199],
  ["98722", "Hitiaa O Te Ra", 10196, 40, 10236],
  ["98723", "Hiva-Oa", 2371, 143, 2514],
  ["98724", "Huahine", 6263, 62, 6325],
  ["98725", "Mahina", 14623, 258, 14881],
  ["98726", "Makemo", 1391, 96, 1487],
  ["98727", "Manihi", 1138, 7, 1145],
  ["98728", "Maupiti", 1302, 13, 1315],
  ["98729", "Moorea-Maiao", 18201, 131, 18332],
  ["98730", "Napuka", 307, 3, 310],
  ["98731", "Nuku-Hiva", 3025, 136, 3161],
  ["98732", "Nukutavake", 287, 5, 292],
  ["98733", "Paea", 12756, 67, 12823],
  ["98734", "Papara", 11743, 151, 11894],
  ["98735", "Papeete", 26654, 338, 26992],
  ["98736", "Pirae", 14068, 402, 14470],
  ["98737", "Pukapuka", 137, 1, 138],
  ["98738", "Punaauia", 28781, 392, 29173],
  ["98739", "Raivavae", 900, 29, 929],
  ["98740", "Rangiroa", 3761, 143, 3904],
  ["98741", "Rapa", 451, 16, 467],
  ["98742", "Reao", 513, 7, 520],
  ["98743", "Rimatara", 893, 26, 919],
  ["98744", "Rurutu", 2163, 87, 2250],
  ["98745", "Tahaa", 5296, 69, 5365],
  ["98746", "Tahuata", 595, 21, 616],
  ["98747", "Taiarapu-Est", 13602, 240, 13842],
  ["98748", "Taiarapu-Ouest", 8371, 100, 8471],
  ["98749", "Takaroa", 1050, 6, 1056],
  ["98750", "Taputapuatea", 5007, 32, 5039],
  ["98751", "Tatakoto", 180, 0, 180],
  ["98752", "Teva I Uta", 10837, 48, 10885],
  ["98753", "Tubuai", 2185, 100, 2285],
  ["98754", "Tumaraa", 3718, 42, 3760],
  ["98755", "Tureia", 261, 3, 264],
  ["98756", "Ua-Huka", 719, 6, 725],
  ["98757", "Ua-Pou", 2168, 46, 2214],
  ["98758", "Uturoa", 3663, 401, 4064],
];

const NOUVELLE_CALEDONIE_2025: OverseasRow[] = [
  ["98801", "Belep", 686, 866, 1552],
  ["98802", "Boulouparis", 3359, 364, 3723],
  ["98803", "Bourail", 5575, 622, 6197],
  ["98804", "Canala", 3911, 2303, 6214],
  ["98805", "Dumbéa", 34926, 369, 35295],
  ["98806", "Farino", 736, 9, 745],
  ["98807", "Hienghène", 2455, 1656, 4111],
  ["98808", "Houaïlou", 3756, 2400, 6156],
  ["98809", "Île-des-Pins (L’)", 2050, 1131, 3181],
  ["98810", "Kaala-Gomen", 2112, 560, 2672],
  ["98811", "Koné", 8048, 1134, 9182],
  ["98812", "Koumac", 4272, 487, 4759],
  ["98813", "La Foa", 3449, 327, 3776],
  ["98814", "Lifou", 9225, 14141, 23366],
  ["98815", "Maré", 6284, 7679, 13963],
  ["98816", "Moindou", 944, 142, 1086],
  ["98817", "Mont-Dore (Le)", 25303, 883, 26186],
  ["98818", "Nouméa", 85976, 1478, 87454],
  ["98819", "Ouégoa", 2409, 825, 3234],
  ["98820", "Ouvéa", 3162, 5471, 8633],
  ["98821", "Païta", 27609, 801, 28410],
  ["98822", "Poindimié", 4613, 1766, 6379],
  ["98823", "Ponérihouen", 2332, 2060, 4392],
  ["98824", "Pouébo", 2292, 1741, 4033],
  ["98825", "Pouembout", 3062, 487, 3549],
  ["98826", "Poum", 1597, 772, 2369],
  ["98827", "Poya", 2962, 562, 3524],
  ["98828", "Sarraméa", 581, 263, 844],
  ["98829", "Thio", 2581, 826, 3407],
  ["98830", "Touho", 2284, 1018, 3302],
  ["98831", "Voh", 3122, 645, 3767],
  ["98832", "Yaté", 1588, 1187, 2775],
  ["98833", "Kouaoua", 1335, 448, 1783],
];

const WALLIS_FUTUNA_2023: OverseasRow[] = [
  ["98611", "Alo", 1875, 61, 1936],
  ["98612", "Sigave", 1188, 73, 1261],
  ["98613", "Uvea", 8088, 335, 8423],
];

export const OVERSEAS_POPULATION_SERIES: OverseasPopulationSeries[] = [
  {
    source: {
      key: "mayotte-2017",
      millesime: 2017,
      effectiveFrom: "2018-01-01",
      producer: "INSEE",
      label: "INSEE, recensement de Mayotte 2017 (décret n° 2017-1688 du 14 décembre 2017)",
      url: "https://www.insee.fr/fr/statistiques/3291775",
    },
    departmentCode: "976",
    decreeTotalMunicipale: 256_518,
    rows: MAYOTTE_2017,
  },
  {
    source: {
      key: "polynesie-2022",
      millesime: 2022,
      effectiveFrom: "2023-01-01",
      producer: "ISPF",
      label:
        "ISPF et INSEE, recensement de la Polynésie française 2022 (décret n° 2022-1592 du 20 décembre 2022)",
      url: "https://www.insee.fr/fr/statistiques/6689891",
    },
    departmentCode: "987",
    decreeTotalMunicipale: 278_786,
    rows: POLYNESIE_2022,
  },
  {
    source: {
      key: "nouvelle-caledonie-2025",
      millesime: 2025,
      effectiveFrom: "2026-01-01",
      producer: "ISEE",
      label:
        "ISEE et INSEE, recensement de la Nouvelle-Calédonie 2025 (décret n° 2025-966 du 18 septembre 2025)",
      url: "https://www.insee.fr/fr/statistiques/8658726",
    },
    departmentCode: "988",
    decreeTotalMunicipale: 264_596,
    rows: NOUVELLE_CALEDONIE_2025,
  },
  {
    source: {
      key: "wallis-futuna-2023",
      millesime: 2023,
      effectiveFrom: "2024-01-01",
      producer: "INSEE-STSEE",
      label:
        "INSEE-STSEE, recensement de Wallis-et-Futuna 2023 (décret n° 2023-1233 du 22 décembre 2023)",
      url: "https://www.insee.fr/fr/statistiques/7756933",
    },
    departmentCode: "986",
    decreeTotalMunicipale: 11_151,
    rows: WALLIS_FUTUNA_2023,
  },
];
