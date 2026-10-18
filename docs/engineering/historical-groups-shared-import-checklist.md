# Import des archives historiques sur la base partagée : checklist d'exploitation

À suivre dans l'ordre, case par case, par la personne qui lance l'import. **Rien ici ne s'exécute sans
un accord explicite pour cette opération.** Ne copier dans ce fichier, une PR, une issue ou une sortie
de CI ni chaîne de connexion, ni nom d'hôte, ni identifiant de projet, ni clé, ni mot de passe.

Le schéma du lot (16 tables, RLS, gardes, trois rôles) est déjà posé et les tables sont vides. Les
rôles `hg_importer`, `hg_runner` et `hg_reader` sont sans connexion (`NOLOGIN`) et sans mot de passe.

## 0. Avant de commencer

- [ ] L'accord pour l'opération est écrit, avec la liste des flux (AMO30, scrutins 15e, 16e, 17e).
- [ ] Le dépôt local est à jour (`git rev-list --count HEAD..origin/main` vaut 0) et propre.
- [ ] Les archives sont hors dépôt, avec leur `manifest.json`, et leurs SHA-256 sont ceux du baseline
      (`npm run validate:historical-groups` en lecture seule).
- [ ] Aucun sync, backfill ou migration n'est en cours sur la base.

## 1. Capacité disque et marge WAL

À constater dans le dashboard et par requête, jamais à déduire d'une page tarifaire.

- [ ] Disque provisionné et espace utilisé relevés dans le dashboard (le 2026-10-18 : 4,51 Go utilisés
      sur 12 Go).
- [ ] Besoin mesuré en local avec les réglages de la base partagée (`wal_level=logical`,
      `wal_compression=zstd`) : 1,47 Go de données au total, 2,8 Go de WAL au total (11,9 Mo, 587 Mo, 746 Mo
      et 1 682 Mo pour AMO30, 15e, 16e et 17e). Le WAL fait donc environ deux fois le volume de données, et
      la 17e est le flux le plus lourd (880 Mo de données, 1,7 Go de WAL, environ 22 minutes).
- [ ] Le WAL est recyclé par les checkpoints tant que l'archivage suit : avec `max_wal_size` à 4 Go, le
      répertoire WAL reste borné. Si l'archivage prend du retard, il grossit jusqu'au total de 2,8 Go en plus
      du volume actuel. Le pire cas à vérifier est donc : espace utilisé + 1,47 Go + 2,8 Go sous le disque
      provisionné, avec une marge.
- [ ] Réglages relevés par `SHOW` : `max_wal_size`, `min_wal_size`, `wal_level`, `archive_mode`,
      `max_slot_wal_keep_size`, `wal_compression`. Le 2026-10-18 : 4 096 Mo, 1 024 Mo, `logical`,
      `on`, 2 048 Mo, `zstd`.
- [ ] Aucun slot de réplication inactif (`pg_replication_slots`) : un slot qui retient du WAL remplit
      le disque pendant un import.
- [ ] Taille actuelle du répertoire WAL relevée (`pg_ls_waldir()`), et l'archivage fonctionne
      (`pg_stat_archiver` : aucun échec récent).
- [ ] Marge exigée avant de lancer : espace libre supérieur aux données du flux plus son WAL mesuré plus 2 Go. Sinon, augmenter le disque d'abord (geste du dashboard, à confirmer dans le dashboard :
      délai et comportement de l'augmentation ne sont pas connus ici).
- [ ] Un flux à la fois, et l'espace libre relevé entre deux flux.
- [ ] Arrêt immédiat si l'espace libre passe sous 2 Go : la transaction du flux en cours est annulée, rien
      n'est écrit.

## 2. Sauvegarde restaurable

- [ ] Une sauvegarde récente existe (date relevée dans le dashboard) et son mode est connu : sauvegarde
      quotidienne seule, ou restauration à un instant donné.
- [ ] Une restauration a été **essayée** sur un projet jetable, pas seulement affichée comme disponible.
      (À confirmer : je n'ai pas vérifié que la restauration est activée sur ce projet.)
- [ ] La durée de cette restauration est notée, pour savoir ce que coûterait un retour arrière complet.
- [ ] Sans sauvegarde restaurable, l'import ne démarre pas.

## 3. Connectivité directe

- [ ] L'URL du rôle est une connexion directe (jamais le pooleur transactionnel : port 6543, hôte de
      pooleur, utilisateur de la forme `role.projet`), avec TLS (`sslmode=require` au minimum).
- [ ] `npm run historical-groups -- fingerprint --role importer` imprime l'empreinte de l'hôte. Elle est
      comparée à celle attendue, et `HG_EXPECTED_TARGET_FINGERPRINT` est posée.
- [ ] `HG_EXPECTED_SYSTEM_IDENTIFIER` est posé avec l'identifiant du cluster relevé par un administrateur
      (`SELECT system_identifier FROM pg_control_system()`). L'outil le relit à chaque connexion : un
      projet inattendu est refusé même si l'hôte est le bon.
- [ ] `HG_TARGET=shared` est posé explicitement. Sans lui, les outils n'acceptent que la base locale.
- [ ] Un plan (`import --stream S`, lecture seule) réussit avant tout `--apply`. Il vérifie aussi que
      la session est réelle (pas de pooleur), en TLS, sur un primaire.
- [ ] Pour une écriture : `HG_ALLOW_SHARED_WRITE` vaut le début de l'empreinte imprimée par `fingerprint`.
      C'est la reconnaissance écrite de cette cible précise.

## 4. Stockage privé des archives

- [ ] Le stockage Vercel Blob **privé** est dédié (variable `HG_BLOB_READ_WRITE_TOKEN`, distincte du jeton
      des photos). À confirmer dans le dashboard : que la boutique accepte l'accès privé, son quota, et que
      le jeton n'a que cette boutique.
- [ ] Le dossier de copie hors ligne indépendante (`HG_OFFLINE_COPY_DIR`) est un autre dossier que
      `HG_ARCHIVE_DIR`, idéalement un autre support, et contient chaque archive sous `<sha256>.zip`.
- [ ] L'import dépose l'archive avant d'écrire une ligne : adressage par SHA-256, aucun écrasement,
      relecture et nouveau hachage après l'envoi. Un refus ou une panne arrête tout, rien n'est écrit en
      base.
- [ ] Après l'import, relire chaque archive du stockage et vérifier qu'elle porte toujours son SHA-256.

## 5. Contrôle des rôles

Les rôles sont `NOLOGIN` tant que cette étape n'est pas décidée.

- [ ] Les mots de passe sont générés hors dépôt, rangés dans le gestionnaire de secrets, jamais dans un
      fichier d'environnement partagé avec l'application.
- [ ] `LOGIN` et le mot de passe sont posés **juste avant** l'import, par le propriétaire.
- [ ] Chaque rôle est contrôlé : ni superutilisateur, ni BYPASSRLS, ni CREATEROLE, ni CREATEDB, propriétaire
      d'aucune table. Les privilèges de la matrice du rapport de la PR A sont les seuls présents. L'outil
      refuse de se connecter si l'une de ces conditions n'est pas vraie.
- [ ] RLS activée sur les 16 tables (`relrowsecurity`). La migration le vérifie, on le relit.
- [ ] `anon`, `authenticated` et `PUBLIC` n'ont aucun droit sur les tables du lot.

## 6. Import, un flux à la fois

Pour AMO30, puis scrutins 15e, 16e, 17e :

- [ ] Plan en lecture seule, comptes relus (AMO30 : 14 970 lignes ; 15e : 517 463 ; 16e : 652 171 ;
      17e : 1 439 379), empreinte du plan notée.
- [ ] `--apply --confirm <empreinte> --store blob`. Une confirmation absente ou périmée est refusée.
- [ ] Un second plan sur le même flux annonce `ALREADY_IMPORTED`.

## 7. Vérification de chaque snapshot

- [ ] `verify --stream S --seq N --with-archive` : aucun problème, empreinte d'état identique en base et
      dans l'archive, aucun orphelin, comptes égaux à `recordCounts`.
- [ ] La vérification a été relancée depuis l'archive relue **du stockage privé**, pas seulement du disque.

## 8. Libération (geste humain)

- [ ] Relecture du rapport de vérification par une personne.
- [ ] `release` par le propriétaire (`HG_SHARED_OWNER_ROLE`), avec l'empreinte de la vérification. Jamais par
      un rôle du lot.

## 9. Runs

- [ ] `run --legislature N` à blanc d'abord : recoupement avec le baseline sans écart (77, 4 380 et 371
      conflits, 1 916 `PO0`).
- [ ] `run --apply`, puis `verify-run` : même empreinte de sortie.
- [ ] Aucune position publiable dans un scrutin dont les décomptes officiels sont discordants.

## 10. Retour à NOLOGIN

- [ ] `ALTER ROLE ... NOLOGIN` pour les trois rôles, mots de passe supprimés du gestionnaire ou archivés.
- [ ] Contrôle : aucun rôle du lot ne peut ouvrir de session.
- [ ] État consigné dans la mémoire du projet et dans le rapport de l'opération.

## Retour arrière

- Un snapshot ne se supprime pas : un import faux se **révoque** (décision `REVOKED` par un humain), et les
  runs qui l'épinglent deviennent à revoir.
- Les scripts de retour arrière du lot ne s'exécutent que sur des tables vides.
- Une restauration complète de la base est le dernier recours : sa durée est celle notée à l'étape 2.
