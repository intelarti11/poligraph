# Lot 5D, PR B : import, résolution et positions historiques internes

Statut : parcours complet vérifié sur les quatre archives officielles, dans un PostgreSQL 17 local
jetable (`127.0.0.1:55486`, marqueur `hg.disposable`). **Rien n'est appliqué** ailleurs : aucune
écriture distante, aucune migration ni import sur Supabase, aucune surface publique modifiée.

Cette PR est empilée sur la PR A (schéma, rôles, RLS, positions). Elle ajoute le code qui s'en sert.

## Ce que fait la PR

Une seule commande, `npm run historical-groups -- <sous-commande>` (`scripts/historical-groups.ts`),
et des modules dans `scripts/lib/` (tout ce qui touche la base) et `src/lib/parlement/historical-groups/run-assembly.ts`
(pur, sous la garde d'architecture du module).

| Sous-commande                                | Rôle de connexion | Effet                                                                         |
| -------------------------------------------- | ----------------- | ----------------------------------------------------------------------------- |
| `import --stream S`                          | `hg_importer`     | Lecture seule : plan et empreinte du plan.                                    |
| `import --stream S --apply --confirm H`      | `hg_importer`     | Une transaction par flux. Refuse si le plan n'est pas celui confirmé.         |
| `verify --stream S --seq N [--with-archive]` | `hg_reader`       | Recalcule tout, rien n'est écrit.                                             |
| `release --stream S --seq N --confirm H ...` | propriétaire      | Décision RELEASED humaine, après vérification.                                |
| `run --legislature N [--apply]`              | `hg_runner`       | Assemble, exécute, écrit run, épingles, exclusions, positions.                |
| `verify-run --run ID`                        | `hg_reader`       | Rejeu : mêmes entrées reconstruites depuis la base, même empreinte de sortie. |

Garde d'isolation (`historical-groups-db.ts`) : hôte `127.0.0.1`, port `55486`, base `hg_schema_test`,
utilisateur égal au rôle de l'outil, marqueur `hg.disposable = 'yes'`, URL différente de `DATABASE_URL` et
`DIRECT_URL` (jamais lues autrement). Toute autre cible est refusée avant la connexion.

### Import

`sourceMember` est le nom du fichier dans l'archive, `memberHash` le SHA-256 de ses octets. L'archive est
lue en mémoire, jamais extraite. Le plan compte, par genre de ligne, les ajouts, corrections, retraits et
lignes inchangées, et s'arrête au-delà de 1 % de retraits d'un genre. L'écriture ferme d'abord les versions
corrigées ou retirées, ouvre ensuite les nouvelles, puis **relit tout dans la même transaction** : le
`rawHash` de chaque ligne est recalculé depuis ses colonnes et l'empreinte d'état depuis les lignes. Une
différence annule la transaction. Un second import du même octet par le même analyseur n'écrit rien.

### Run

Un run par législature, sur l'évidence AMO30 et le flux de scrutins de la législature, tous deux RELEASED.
Avant de lancer, le run relit les deux snapshots et recalcule chaque `rawHash` et chaque empreinte d'état
(`checkRunnable`). Il y a deux empreintes, volontairement : l'épingle en base d'un snapshot est son
empreinte enregistrée (clé étrangère de la table des épingles) ; l'épingle qui identifie le run pour le flux
d'évidence est l'empreinte de l'évidence que le résolveur lit (`evidenceStateHash`), qui bouge si une seule
ligne de cette évidence bouge. Le contrat de `run-execution.ts` n'est pas modifié, ni `RESOLVER_VERSION`.

L'identité d'un vote est l'identifiant officiel de l'attestation. Aucune fiche, aucun nom, aucun rapprochement
par groupe actuel. Le type d'organe (groupe ou non-inscrit) n'est pas stocké : il est recalculé par la
classification des analyseurs, et un organe qu'elle ne tranche pas reste hors de l'évidence. Un mandat de
siège absent ou d'un autre acteur arrête l'assemblage (le baseline en compte zéro).

Les décisions de continuité et d'identité sont vides dans cette PR (coupures à 0) : un groupe renommé entre
deux références reste donc un conflit, visible et exclu, jusqu'à une décision humaine.

## Résultats sur les archives officielles

Archives copiées hors dépôt, SHA-256 vérifiés contre le baseline 5A-2 avant import.

| Flux         | Fichiers                                | Lignes écrites | Durée d'import                            | Pic mémoire |
| ------------ | --------------------------------------- | -------------- | ----------------------------------------- | ----------- |
| AMO30        | 14 053                                  | 14 970         | 5 s                                       | 0,5 Go      |
| Scrutins 15e | 4 417                                   | 517 463        | 2 min 41                                  | 1,0 Go      |
| Scrutins 16e | 4 106 (dont le Congrès, hors périmètre) | 652 171        | 9 min 53 (en parallèle d'autres lectures) | 1,1 Go      |
| Scrutins 17e | 8 877                                   | 1 439 379      | 15 min 19                                 | 1,9 Go      |

Aucun fichier rejeté. Base finale : 1,9 Go. Les quatre snapshots : 0 problème à la vérification, empreinte
identique en base et dans l'archive, 0 orphelin. Lignes AMO30 : 3 175 acteurs, 63 organes, 7 772 mandats de
groupe, 3 960 mandats de siège. Attestations : 472 631, 602 911 et 1 323 978, soit 2 399 520 votes, tous
retrouvés dans les positions des trois runs.

| Run | Votes     | Attestés BOTH | Conflits (exclus) | Insuffisants (PO0) | Positions | Publiables | Rejeu                |
| --- | --------- | ------------- | ----------------- | ------------------ | --------- | ---------- | -------------------- |
| 15e | 472 631   | 472 554       | 77                | 0                  | 36 959    | 32 934     | même empreinte, 17 s |
| 16e | 602 911   | 598 531       | 4 380             | 0                  | 40 289    | 37 060     | même empreinte       |
| 17e | 1 323 978 | 1 321 691     | 371               | 1 916              | 97 110    | 91 598     | même empreinte, 42 s |

Le run de la 17e a pris 50 s pour assembler, exécuter et écrire, pour un pic de 5,1 Go de mémoire
(`NODE_OPTIONS=--max-old-space-size=8192` est posé par le script npm).

Les positions non publiables et leur motif, sur les trois runs : non-inscrits 11 187 (jamais un groupe),
sans vote attesté 456, exclus présents 780, décomptes officiels discordants 343.

### Critères

- 35 scrutins `COUNT_MISMATCH` (30, 4 et 1) : **aucune position publiable** dans ces scrutins, même quand on
  tente de l'écrire directement (la garde de la PR A refuse).
- 1 916 votes de l'organe de remplissage `PO0` (17e) : tous `INSUFFICIENT`, tous exclus.
- 0 décision RELEASED produite par le rôle d'import ou par un script : les trois sont `HUMAN`.
- Aucune fiche `Politician` lue, aucun nom écrit, aucune surface publique touchée.

### Recoupement avec la mesure indépendante (architecture 8.3)

Le baseline 5A-2 classe chaque vote avec un code qui n'importe pas le résolveur. Chaque ligne ci-dessous
compare ce que le baseline implique à ce que le run a produit, par législature :

- votes du run = votes nominatifs du baseline : égal (15e, 16e, 17e) ;
- attestés au niveau BOTH = accords sur enregistrement unique ou sur enregistrements du même organe : égal ;
- CONFLICT = plusieurs organes, même sigle sous une autre référence, groupe différent : égal (77, 4 380, 371) ;
- INSUFFICIENT pour organe de remplissage = `PO0` du baseline : égal (0, 0, 1 916) ;
- SCRUTIN_ONLY, INTERVAL_ONLY, UNKNOWN, identité non résolue : zéro attendu, zéro observé.

Les 4 159 conflits de la 16e viennent de groupes renommés sous une autre référence (même sigle). Ils sont
exclus, jamais devinés : une décision de continuité validée à la main les réintégrera dans un run futur.

## Tests

- Intégration (conteneur jetable), 18 tests : écriture sous le rôle importateur, snapshot QUARANTINED,
  `rawHash` et empreinte d'état comparés à une **seconde implémentation écrite dans le test**, `memberHash`
  des octets du fichier, second import sans écriture, confirmation périmée refusée, atomicité (plantage au
  milieu : rien n'est écrit, puis l'import réussit), deux imports concurrents (un seul gagne), correction
  rétroactive (nouvelle version, l'ancienne reste lisible au snapshot 1), retrait massif refusé, ligne
  altérée derrière le dos de l'import, libération humaine seulement, run refusé sur snapshot en quarantaine,
  positions jamais publiables sur un scrutin discordant, rejeu qui détecte une empreinte altérée.
- Unitaires : garde de cible (hôte, port, base, rôle, URL de l'application), colonnes des tables égales aux
  clés des lignes des analyseurs, assemblage (type d'organe recalculé, mandat de siège absent, positions).
- Trois mutations du code d'import et de rejeu font chacune échouer les tests concernés.

## Limites et suivis

- Les décisions de continuité et d'identité ne sont pas écrites par cette PR : les 4 159 conflits de
  renommage de la 16e attendent une décision humaine.
- La vérification inter-flux (le mandat de siège couvre la date du vote) est faite à l'assemblage du run, qui
  s'arrête au premier écart, pas dans `verify`.
- Le rapprochement entre fiches `Politician` et acteurs officiels n'existe pas ici : les positions sont
  indexées par scrutin et organe officiel, indépendantes des fiches.
- Optimisations consignées en issues : benchmark comparatif des index `active_key` et d'exclusion, import
  par `COPY`, chiffrement des durées d'import (la 16e a été ralentie par des lectures concurrentes).
- Stockage privé des archives (A9) : toujours à décider, les archives restent hors dépôt.
