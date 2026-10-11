# Territoires : protocole de sélection et de saisie des décisions

Date : 11 octobre 2026. Statut : **projet, à arrêter par la rédaction**. Ce protocole doit être publié
avant la première collecte. Tant qu'il ne l'est pas, aucune décision n'est saisie en production.

Références : cadrage produit et UX du 8 octobre (§6.1 à §6.4), plan d'implémentation (lot 2).

## 1. Ce que le pilote publie

Des notices de décisions collectives adoptées par un conseil municipal ou communautaire, chacune
rattachée à l'institution qui l'a adoptée, datée et prouvée par un document officiel, avec
l'endroit exact où la preuve se trouve dans ce document.

Le pilote publie une sélection documentée. Ce n'est pas un relevé exhaustif : le nombre de
décisions référencées ne mesure ni l'activité ni la performance d'un conseil, et la page le dit.

## 2. Choix des douze communes

**Liste : à arrêter.** Les critères ci-dessous servent à la construire et à la justifier. La liste
retenue est publiée avec, pour chaque commune, le critère qui l'a fait entrer.

1. **Tailles différentes.** Au moins une commune par strate : moins de 1 000 habitants, 1 000 à
   9 999, 10 000 à 99 999, 100 000 et plus. Population légale INSEE, millésime indiqué.
2. **Outre-mer inclus.** Au moins une commune d'un département d'outre-mer (971, 972, 973, 974,
   976), de préférence deux de bassins différents. Les collectivités d'outre-mer se traitent à
   part : Saint-Barthélemy, Saint-Martin et Wallis-et-Futuna n'ont pas de commune, les TAAF et
   Clipperton non plus. Elles sortent du pilote par construction, et la page le signale au lieu
   de les taire. Saint-Pierre-et-Miquelon, la Polynésie française et la Nouvelle-Calédonie ont
   des communes, mais les règles de publicité de leurs actes diffèrent de celles du CGCT
   métropolitain : à vérifier commune par commune avant de les retenir.
3. **Sources accessibles.** Les délibérations ou le recueil des actes sont publiés en ligne
   et consultables sans compte. Depuis le 1er juillet 2022, la publication électronique est la
   règle, mais les communes de moins de 3 500 habitants peuvent en choisir une autre : pour
   elles, vérifier la disponibilité avant de les retenir.
4. **Période institutionnelle établissable.** Le maire en fonction est établi dans Poligraph, et
   les dates de début et de fin des mandats couverts sont connues au jour près. Sans cela, les
   décisions de la commune s'afficheraient sous « période institutionnelle non établie ».
5. **Cas d'épreuve couverts** (cadrage §6.4). L'ensemble des douze communes doit contenir au
   moins : un changement de maire sans nouvelle élection générale ; une réélection de la même
   personne ; une décision adoptée sous un maire et publiée sous son successeur ; un acte
   intercommunal concernant la commune ; un résultat collectif sans votes individuels.
6. **Aucun critère politique.** Ni l'étiquette du maire ni la couleur du conseil n'entrent dans le
   choix. Une fois la liste établie, contrôler qu'elle ne se concentre pas sur une famille
   politique ; si c'est le cas, revoir le choix sur les critères 1 à 5, jamais en visant une
   étiquette.
7. **Pas de commune choisie pour une actualité.** Une commune ne rejoint pas le pilote parce
   qu'une affaire, une polémique ou un fait divers la met en avant.

Le jeu de communes de recette (`territoires-recette.md`) sert aux tests d'affichage. Il ne
constitue pas la liste du pilote.

## 3. Choix des actes dans une commune

**Règle : à arrêter.** Deux options, à trancher avant la collecte :

- **Par séances** : toutes les délibérations de séances tirées selon une règle fixée à l'avance
  (par exemple la première séance de chaque semestre). Neutre, mais donne des actes de portée
  très inégale.
- **Par types d'actes communs** : la même liste de types pour toutes les communes (budget primitif,
  compte financier unique ou compte administratif, plan local d'urbanisme, tarifs des services
  publics locaux). Comparable d'une commune à l'autre, mais le choix de la liste est lui-même
  éditorial et doit être publié.

Dans les deux cas, la règle est la même pour toutes les communes, et la profondeur couverte est
affichée (par exemple « depuis mars 2020 »). Un acte n'est jamais retenu ou écarté pour ce qu'il
dit d'un élu.

## 4. Sources admissibles

| Admis                                            | Jamais admis seul                               |
| ------------------------------------------------ | ----------------------------------------------- |
| Délibération publiée par la collectivité         | Ordre du jour (il ne prouve pas l'adoption)     |
| Procès-verbal de séance approuvé                 | Article de presse, communiqué, réseau social    |
| Liste des délibérations affichée après la séance | Tract, site de groupe d'élus, blog              |
| Recueil des actes administratifs                 | Copie d'un document sans l'original consultable |

Le document doit être en ligne, à une adresse http ou https. Une archive (par exemple Internet
Archive) peut s'ajouter pour le cas où le site de la commune déplace le fichier. Poligraph ne
télécharge jamais le document depuis ses serveurs : il affiche le lien.

## 5. Règles de saisie

- **Objet** : l'intitulé de la source, repris tel quel ou raccourci sans changer le sens. Aucun
  qualificatif ajouté, aucun résumé généré par une IA.
- **Référence** : le numéro de délibération quand la source en donne un.
- **Date d'adoption** : la date de la séance. Si la source ne donne que le mois ou l'année, la
  précision le dit, et la décision ne se rattache à un maire que si la période entière tombe dans
  son mandat.
- **Date de publication et prise d'effet** : saisies seulement si la source les donne. Une date
  de publication ne remplace jamais la date d'adoption.
- **Résultat** : adoptée ou rejetée, seulement si la source l'établit. La formulation de la source
  (« adoptée à l'unanimité ») peut être citée. Aucun vote individuel n'est saisi dans ce lot.
- **Localisation** : la page et le numéro du point dans le document.
- **Autorité** : le conseil qui a adopté l'acte. Une décision du conseil communautaire reste
  attribuée à ce conseil, même si elle ne concerne qu'une commune.
- **Une décision, une notice** : avant de saisir, chercher si la notice existe déjà.

## 6. Revue et publication

1. La personne qui saisit crée la notice en brouillon, puis l'envoie en revue.
2. La relecture ouvre le document source à l'endroit indiqué et vérifie chaque champ. Elle publie
   en indiquant son nom, ou renvoie en brouillon, ou rejette avec un motif.
3. Une notice publiée ne se modifie pas : on la dépublie avec un motif, on la corrige, et elle
   repasse en revue. L'historique garde chaque étape.

La relecture par une autre personne que celle qui a saisi est la règle visée. **Limite
technique** : l'administration n'a qu'un compte partagé, le nom du relecteur est donc déclaratif.
La séparation des rôles repose sur l'organisation de la rédaction tant qu'il n'y a pas de comptes
nominatifs.

Entretien : chaque lien est revérifié à une fréquence à fixer (proposition : tous les six mois).
Un lien mort est remplacé par l'archive ou par la nouvelle adresse ; à défaut, la notice est
dépubliée.

## 7. Ce qui n'est jamais fait

- Attribuer une décision collective au maire ou à un conseiller. Être en fonction à une date n'est
  pas avoir voté.
- Déduire un vote individuel d'un résultat, même unanime, ou d'une appartenance à une liste.
- Classer ou comparer des communes ou des conseils par nombre de décisions.
- Ingérer automatiquement des délibérations, à l'échelle nationale ou locale.
- Saisir une donnée fictive ou de test dans la base de production.
- Publier une notice sans source consultable et sans localisation dans la source.

## 8. Avant la première collecte

- [ ] Liste des douze communes arrêtée, avec le critère de chacune.
- [ ] Règle de choix des actes arrêtée (§3).
- [ ] Fréquence de revérification fixée (§6).
- [ ] Protocole publié sur le site, avec sa date.
