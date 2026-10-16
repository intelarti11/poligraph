import type { DatasetCoverage, LegislatureCoverage } from "@/lib/parlement/legislature-types";

/**
 * Couverture MESURÉE des données de l'Assemblée nationale dans PoliGraph.
 *
 * Structure séparée des faits institutionnels (an-facts.ts) : ce fichier décrit la base,
 * pas l'Assemblée. Mesures en lecture seule du 2026-10-15 (requêtes `$queryRaw`), à
 * relancer avant chaque usage public. Aucun jeu n'est « complet » : ce niveau exige une
 * justification de périmètre (`completeJustification`) qu'aucune mesure n'apporte encore.
 */

const MEASURED_AT = "2026-10-15" as const;

/** Jusqu'à cet âge (jours), une mesure peut être affichée. Au-delà, ou à la création des pages, relancer. */
const MAX_AGE_DAYS = 30;

const ABSENCE_NOTICE =
  "Certaines données de cette législature ne sont pas encore importées dans PoliGraph. Ce n'est pas une absence d'activité parlementaire : l'Assemblée a siégé et voté, nous n'avons simplement pas encore repris ces données.";

function absent(
  dataset: DatasetCoverage["dataset"],
  perimeter: string,
  note?: string
): DatasetCoverage {
  return {
    dataset,
    level: "absent",
    perimeter,
    measured: { count: 0 },
    measuredAt: MEASURED_AT,
    method: "Comptage en base, lecture seule.",
    note,
  };
}

export const AN_LEGISLATURE_COVERAGE: LegislatureCoverage[] = [
  {
    number: 15,
    navigation: { listed: true, absenceNotice: ABSENCE_NOTICE },
    refresh: { onPageCreation: true, maxAgeDays: MAX_AGE_DAYS },
    datasets: [
      absent(
        "scrutins",
        "Scrutins publics de l'Assemblée nationale rattachés à la 15e législature.",
        "Ils existent à la source (le scrutin n° 1 est du 4 juillet 2017 sur le site de l'Assemblée). Absence d'import, pas absence de scrutins."
      ),
      absent("individual-votes", "Votes individuels des députés sur ces scrutins."),
      absent("official-group-counts", "Décompte officiel par groupe publié avec chaque scrutin."),
      {
        dataset: "deputy-mandates",
        level: "partial",
        perimeter:
          "Mandats de député dont la période recouvre 2017-06-21 à 2022-06-21, toutes origines d'import confondues.",
        measured: { count: 299 },
        measuredAt: MEASURED_AT,
        method:
          "Comptage des mandats DEPUTE dont startDate <= 2022-06-21 et endDate >= 2017-06-21 (282 personnes).",
        note: "Un seul porte l'identifiant -leg15. Aucune référence externe n'a été comptée : non comparable à un total.",
      },
      absent("referenced-groups", "Groupes parlementaires de la 15e législature."),
      absent("dated-group-membership", "Périodes d'appartenance des députés à un groupe."),
      absent("computed-group-positions", "Positions de groupe calculées pour ces scrutins."),
    ],
  },
  {
    number: 16,
    navigation: { listed: true, absenceNotice: ABSENCE_NOTICE },
    refresh: { onPageCreation: true, maxAgeDays: MAX_AGE_DAYS },
    datasets: [
      {
        dataset: "scrutins",
        level: "unverified",
        perimeter: "Scrutins publics de la 16e législature importés.",
        measured: { count: 4105 },
        measuredAt: MEASURED_AT,
        method:
          "Le plus grand numéro importé est 4105 et il y a 4105 scrutins. Sur le site de l'Assemblée, le n° 4105 existe (7 juin 2024) et le n° 4106 répond 404. Aucun total officiel n'est attesté : pas de valeur attendue.",
        note: "Concordance probable, non établie : la sonde du numéro suivant ne prouve pas l'absence de trou ou de scrutin hors numérotation.",
      },
      {
        dataset: "individual-votes",
        level: "partial",
        perimeter: "Scrutins de la 16e législature ayant au moins un vote individuel importé.",
        measured: { count: 3954, outOf: 4105 },
        measuredAt: MEASURED_AT,
        method: "Comptage des scrutins AN de la législature 16 avec au moins une ligne Vote.",
        note: "151 scrutins sans aucun vote individuel. Le nombre de votes par scrutin n'est pas recoupé.",
      },
      absent(
        "official-group-counts",
        "Décompte officiel par groupe publié avec chaque scrutin.",
        "Importé pour la 17e uniquement."
      ),
      {
        dataset: "deputy-mandates",
        level: "partial",
        perimeter:
          "Mandats de député dont la période recouvre 2022-06-22 à 2024-06-09, toutes origines d'import confondues.",
        measured: { count: 467 },
        measuredAt: MEASURED_AT,
        method:
          "Comptage des mandats DEPUTE dont startDate <= 2024-06-09 et endDate >= 2022-06-22 (454 personnes).",
        note: "Un seul porte l'identifiant -leg16. Aucun ne porte de groupe. Aucune référence externe comptée.",
      },
      absent(
        "referenced-groups",
        "Groupes parlementaires de la 16e législature.",
        "Les 12 groupes en base portent tous legislature = 17."
      ),
      absent("dated-group-membership", "Périodes d'appartenance des députés à un groupe."),
      {
        dataset: "computed-group-positions",
        level: "withheld",
        perimeter: "Positions de groupe calculées sur les scrutins de la 16e législature.",
        measured: { count: 37497 },
        measuredAt: MEASURED_AT,
        method: "Comptage des ScrutinGroupPosition dont le scrutin est de la législature 16.",
        note: "Toutes reliées à des groupes de la 17e (jointure sur le mandat courant). Non publiées : voir docs/audits/parlement-historique-lot0.md.",
      },
    ],
  },
  {
    number: 17,
    navigation: { listed: true, absenceNotice: ABSENCE_NOTICE },
    refresh: { onPageCreation: true, maxAgeDays: MAX_AGE_DAYS },
    datasets: [
      {
        dataset: "scrutins",
        level: "partial",
        perimeter: "Scrutins publics de la 17e législature importés.",
        measured: { count: 8730 },
        measuredAt: MEASURED_AT,
        method:
          "8730 scrutins importés pour un plus grand numéro importé de 8772 : au moins 42 numéros manquent. Le plus grand numéro réel n'a pas été relevé à la source, aucun total officiel n'est attesté.",
      },
      {
        dataset: "individual-votes",
        level: "unverified",
        perimeter: "Scrutins de la 17e législature importés ayant au moins un vote individuel.",
        measured: { count: 8730, outOf: 8730 },
        measuredAt: MEASURED_AT,
        method: "Comptage des scrutins AN de la législature 17 avec au moins une ligne Vote.",
        note: "Tous les scrutins importés ont au moins un vote. Le nombre de votes attendu par scrutin n'est pas recoupé.",
      },
      {
        dataset: "official-group-counts",
        level: "partial",
        perimeter: "Scrutins de la 17e législature avec un décompte officiel par groupe importé.",
        measured: { count: 8606, outOf: 8730 },
        measuredAt: MEASURED_AT,
        method: "Scrutins distincts présents dans ScrutinOfficialGroupCount.",
        note: "124 scrutins importés sans décompte officiel.",
      },
      {
        dataset: "deputy-mandates",
        level: "unverified",
        perimeter: "Mandats de député à identifiant -leg17.",
        measured: { count: 613 },
        measuredAt: MEASURED_AT,
        method:
          "Comptage des mandats DEPUTE dont l'externalId se termine par -leg17 (574 mandats courants, tous avec un groupe).",
        note: "Nombre légal de sièges : 577. 613 mandats comprennent les remplaçants : l'adéquation aux sièges pourvus à une date n'est pas vérifiée.",
      },
      {
        dataset: "referenced-groups",
        level: "partial",
        perimeter: "Groupes parlementaires de la 17e législature référencés.",
        measured: { count: 12 },
        measuredAt: MEASURED_AT,
        method: "Comptage des ParliamentaryGroup AN à legislature = 17.",
        note: "Groupes actuels. Les groupes dissous ou créés en cours de législature ne sont pas vérifiés.",
      },
      absent(
        "dated-group-membership",
        "Périodes d'appartenance des députés à un groupe.",
        "MandateParliamentary ne porte qu'un lien vers un groupe, sans dates."
      ),
      {
        dataset: "computed-group-positions",
        level: "unverified",
        perimeter: "Positions de groupe calculées sur les scrutins de la 17e législature.",
        measured: { count: 94819 },
        measuredAt: MEASURED_AT,
        method: "Comptage des ScrutinGroupPosition dont le scrutin est de la législature 17.",
        note: "Calculées sur le groupe actuel du député : un changement de groupe en cours de législature n'est pas pris en compte.",
      },
    ],
  },
];
