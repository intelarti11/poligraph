import type { LegislatureFacts } from "@/lib/parlement/legislature-types";

/**
 * Faits institutionnels des 15e, 16e et 17e législatures de l'Assemblée nationale.
 *
 * Aucune donnée de couverture ici (voir an-coverage.ts). Aucun effectif n'est déduit de la
 * composition actuelle : `seats.legalCount` est le nombre légal de sièges, pas un nombre de
 * députés ayant siégé ni de sièges pourvus à une date.
 *
 * `basis` : `sourced` (écrit tel quel par la source), `derived` (calculé par une règle
 * citée), `observed` (relevé dans des données importées, base juridique non vérifiée).
 */

const SEATS_NOTE =
  "Nombre légal de sièges (article LO 119, en vigueur depuis le 15 janvier 2009, donc applicable à toute la période). Ce n'est ni le nombre de députés ayant siégé (remplaçants compris) ni celui des sièges pourvus à une date.";

export const AN_LEGISLATURE_FACTS: LegislatureFacts[] = [
  {
    number: 15,
    officialTitle: "XVe législature de l'Assemblée nationale",
    status: "ended",
    endCause: "powers-expiry",
    dates: [
      {
        kind: "election-first-round",
        date: "2017-06-11",
        basis: "sourced",
        sourceIds: ["decret-2017-616"],
        explanation: "Métropole. Scrutin anticipé dès le 3 juin pour certains postes à l'étranger.",
      },
      {
        kind: "election-second-round",
        date: "2017-06-18",
        basis: "sourced",
        sourceIds: ["decret-2017-616"],
        explanation: "Métropole.",
      },
      {
        kind: "previous-powers-expiry",
        date: "2017-06-20",
        basis: "derived",
        sourceIds: ["lo-121"],
        explanation:
          "Troisième mardi de juin 2017. Suppose que l'Assemblée précédente a été élue en 2012 : cette élection n'est pas sourcée dans ce lot.",
      },
      {
        kind: "mandate-start",
        date: "2017-06-21",
        basis: "observed",
        sourceIds: ["poligraph-mandats-an"],
        explanation:
          "Date de début du seul mandat de la 15e législature importé (identifiant -leg15). Un seul mandat : indicatif, non généralisable.",
      },
      {
        kind: "archive-start",
        date: "2017-06-23",
        basis: "sourced",
        sourceIds: ["an-archives-15"],
      },
      {
        kind: "opening-sitting",
        date: "2017-06-27",
        basis: "sourced",
        sourceIds: ["cr-2017-06-27"],
        explanation: "Ouverture prononcée à 15 heures par le doyen d'âge.",
      },
      {
        kind: "powers-expiry",
        date: "2022-06-21",
        basis: "derived",
        sourceIds: ["lo-121"],
        explanation: "Troisième mardi de juin 2022, cinquième année après l'élection de 2017.",
      },
      {
        kind: "archive-end",
        date: "2022-06-21",
        basis: "sourced",
        sourceIds: ["an-archives-15"],
      },
    ],
    seats: { legalCount: 577, legalBasisSourceIds: ["lo-119"], note: SEATS_NOTE },
    contradictions: [
      {
        topic: "Début de la 15e législature",
        claims: [
          { kind: "mandate-start", date: "2017-06-21", sourceId: "poligraph-mandats-an" },
          { kind: "archive-start", date: "2017-06-23", sourceId: "an-archives-15" },
          { kind: "opening-sitting", date: "2017-06-27", sourceId: "cr-2017-06-27" },
        ],
        proposedReading:
          "Trois natures de dates différentes. Le 23 juin des archives ne correspond ni au lendemain de l'expiration des pouvoirs (21 juin) ni à l'ouverture en séance (27 juin) : sa signification n'est pas établie. Afficher les trois avec leur nature, ne pas en choisir une seule comme « début ».",
        arbitrated: false,
      },
    ],
  },
  {
    number: 16,
    officialTitle: "XVIe législature de l'Assemblée nationale",
    status: "ended",
    endCause: "dissolution",
    dates: [
      {
        kind: "election-first-round",
        date: "2022-06-12",
        basis: "sourced",
        sourceIds: ["decret-2022-648"],
        explanation: "Métropole. Scrutin anticipé dès le 4 juin pour certains postes à l'étranger.",
      },
      {
        kind: "election-second-round",
        date: "2022-06-19",
        basis: "sourced",
        sourceIds: ["decret-2022-648"],
        explanation: "Métropole.",
      },
      {
        kind: "previous-powers-expiry",
        date: "2022-06-21",
        basis: "derived",
        sourceIds: ["lo-121"],
        explanation: "Troisième mardi de juin 2022.",
      },
      {
        kind: "archive-start",
        date: "2022-06-22",
        basis: "sourced",
        sourceIds: ["an-archives-16"],
        explanation: "Titre de la page d'archives. Coïncide avec le lendemain de l'expiration.",
      },
      {
        kind: "mandate-start",
        date: "2022-06-22",
        basis: "observed",
        sourceIds: ["poligraph-mandats-an"],
        explanation:
          "Date de début du seul mandat de la 16e législature importé (identifiant -leg16). Un seul mandat : indicatif.",
      },
      {
        kind: "opening-sitting",
        date: "2022-06-28",
        basis: "sourced",
        sourceIds: ["cr-2022-06-28"],
        explanation: "Ouverture prononcée à 15 heures par le doyen d'âge.",
      },
      {
        kind: "dissolution-decree",
        date: "2024-06-09",
        basis: "sourced",
        sourceIds: ["decret-dissolution-2024", "an-dissolution-2024"],
        explanation: "Décret signé le 9 juin 2024, annoncé le soir même.",
      },
      {
        kind: "dissolution-publication",
        date: "2024-06-10",
        basis: "sourced",
        sourceIds: ["decret-dissolution-2024"],
        explanation: "Journal officiel n° 0134 du 10 juin 2024.",
      },
      {
        kind: "archive-end",
        date: "2024-06-09",
        basis: "sourced",
        sourceIds: ["an-archives-16"],
      },
    ],
    seats: { legalCount: 577, legalBasisSourceIds: ["lo-119"], note: SEATS_NOTE },
    contradictions: [
      {
        topic: "Fin de la 16e législature",
        claims: [
          { kind: "archive-end", date: "2024-06-09", sourceId: "an-archives-16" },
          { kind: "dissolution-decree", date: "2024-06-09", sourceId: "decret-dissolution-2024" },
          {
            kind: "dissolution-publication",
            date: "2024-06-10",
            sourceId: "decret-dissolution-2024",
          },
        ],
        proposedReading:
          "Le décret est daté du 9 juin et publié le 10. La date d'entrée en vigueur de la dissolution n'a pas été vérifiée. Afficher « décret du 9 juin 2024, publié le 10 juin » et reprendre le 9 juin des archives comme fin de législature.",
        arbitrated: false,
      },
    ],
  },
  {
    number: 17,
    officialTitle: "XVIIe législature de l'Assemblée nationale",
    status: "ongoing",
    endCause: null,
    dates: [
      {
        kind: "election-first-round",
        date: "2024-06-30",
        basis: "sourced",
        sourceIds: ["decret-2024-527"],
        explanation: "Métropole. Samedi 29 juin pour l'outre-mer et certains bureaux en Amérique.",
      },
      {
        kind: "election-second-round",
        date: "2024-07-07",
        basis: "sourced",
        sourceIds: ["decret-2024-527"],
        explanation:
          "Métropole. Samedi 6 juillet pour l'outre-mer et certains bureaux en Amérique.",
      },
      {
        kind: "mandate-start",
        date: "2024-07-08",
        basis: "observed",
        sourceIds: ["poligraph-mandats-an"],
        explanation:
          "Date de début de 454 des mandats importés (sièges pourvus au second tour). Base juridique du début des pouvoirs après dissolution non vérifiée.",
      },
      {
        kind: "mandate-start",
        date: "2024-07-01",
        basis: "observed",
        sourceIds: ["poligraph-mandats-an"],
        explanation:
          "Date de début de 76 mandats importés (sièges pourvus au premier tour). Base juridique non vérifiée.",
      },
      {
        kind: "opening-sitting",
        date: "2024-07-18",
        basis: "sourced",
        sourceIds: ["cr-2024-07-18", "constitution-art-12", "an-calendrier-17"],
        explanation:
          "Deuxième jeudi suivant l'élection du 7 juillet (article 12). Ouverture et session de droit prononcées à 15 heures par le doyen d'âge.",
      },
      {
        kind: "powers-expiry",
        date: "2029-06-19",
        basis: "derived",
        sourceIds: ["lo-121"],
        explanation:
          "Échéance théorique (troisième mardi de juin 2029) en l'absence de dissolution. Suppose LO 121 inchangé : version relue en vigueur au 26 mars 2023.",
      },
    ],
    seats: { legalCount: 577, legalBasisSourceIds: ["lo-119"], note: SEATS_NOTE },
    contradictions: [
      {
        topic: "Début des mandats de la 17e législature",
        claims: [
          { kind: "mandate-start", date: "2024-07-01", sourceId: "poligraph-mandats-an" },
          { kind: "mandate-start", date: "2024-07-08", sourceId: "poligraph-mandats-an" },
        ],
        proposedReading:
          "Deux dates observées selon le tour d'élection du député. Ne pas afficher de « début des mandats » unique tant que la règle n'est pas sourcée.",
        arbitrated: false,
      },
    ],
  },
];
