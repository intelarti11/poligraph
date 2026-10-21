# Cibles tactiles de Breadcrumb et SourceLine

Mesures faites le 17 octobre 2026 sur les pages `/parlement/assemblee/legislatures` et
`/parlement/assemblee/legislatures/[n]` en production, avec `getBoundingClientRect()` à 390 px
et 1280 px. Le seuil du projet est de 44 px de haut (AGENTS.md). Aucun de ces composants n'est
modifié par la PR de stabilisation des pages historiques : ils sont globaux et relèvent d'une
passe d'accessibilité transversale.

| Composant    | Élément                                                                | Hauteur mesurée | Écart au seuil |
| ------------ | ---------------------------------------------------------------------- | --------------- | -------------- |
| `Breadcrumb` | liens du fil d'Ariane                                                  | 20 px           | 24 px          |
| `SourceLine` | liens de sources, ligne longue (page de législature)                   | 34 px           | 10 px          |
| `SourceLine` | liens de sources et « Signaler une erreur », ligne courte (page liste) | 14 px           | 30 px          |

Axe (WCAG 2.2 AA) ne signale rien sur ces éléments : la règle 2.5.8 exempte les liens placés
dans une phrase, et le fil d'Ariane passe le seuil de 24 px. Le décalage est donc avec la règle
interne de 44 px, pas avec WCAG.

## Cibles pour la passe transversale

- `Breadcrumb` : porter la zone cliquable de chaque lien à 44 px de haut (`min-h-11` et
  `inline-flex items-center`) sans agrandir le texte. Vérifier le retour à la ligne à 320 px.
- `SourceLine` : même traitement pour les liens de sources. Les liens sont dans une phrase
  continue, donc deux options à trancher : les passer en liste verticale à partir de 3 sources,
  ou garder la phrase et accepter l'exemption WCAG en le documentant dans AGENTS.md.
- Mesurer avant et après sur au moins une page par rubrique, puisque ces deux composants sont
  utilisés partout.
