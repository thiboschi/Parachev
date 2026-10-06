# Parachev

Application de bureau pour l'atelier de parachèvement (BFC) : elle lit les dossiers de commandes terminées, en tire les quantités et les heures réellement passées, et s'en sert pour prévoir les heures d'une nouvelle affaire et préparer une offre.

Elle fonctionne entièrement en local : aucune donnée ne quitte le poste.

## Ce que fait l'application

| Page | Rôle |
| --- | --- |
| **Dashboard** | Graphiques et tableau des affaires indexées, avec le suivi de l'indexation en cours. |
| **Search** | Recherche d'affaires par critères (client, profil, postes, quantités…) et en plein texte dans les mails et les documents. |
| **Prévision** (depuis une affaire) | Heures pointées par poste, variables lues dans le dossier (modifiables à la main) et documents de l'affaire. |
| **Coefficients** | Modèle calibré de chaque poste ; chaque coefficient peut être corrigé à la main. |
| **Chiffrage** | Chiffrage manuel d'une nouvelle affaire, poste par poste, avec les temps barème de l'atelier, un calculateur de soudage et l'export de l'offre en PDF. |

## Installation

Les installateurs Windows et macOS (Apple Silicon) sont publiés dans les [releases GitHub](https://github.com/thiboschi/Parachev/releases).

Les binaires ne sont pas signés avec un certificat d'éditeur : Windows et macOS peuvent afficher un avertissement au premier lancement.

Il n'y a pas de mise à jour automatique : une nouvelle version s'installe par-dessus l'ancienne, la base de données est conservée.

## Première utilisation

Les trois boutons sont dans l'en-tête de l'application.

1. **Choisir le dossier à surveiller** : la racine des commandes, par exemple `COMMANDES FINIES`.
2. **Choisir le dossier Vacam** : la racine des programmes CN, par exemple `Z:\A-Vacam programmes`.
3. Attendre la fin de l'indexation (barre de progression dans l'en-tête). La première lecture est longue ; les suivantes ne relisent que les fichiers modifiés.
4. Cliquer sur **Calibrer** pour calculer les coefficients à partir des heures réelles.

Les dossiers restent surveillés tant que l'application est ouverte : un fichier ajouté ou modifié est réindexé tout seul. La calibration, elle, ne se relance pas toute seule : il faut recliquer sur **Calibrer** après l'arrivée de nouvelles affaires ou d'un nouvel export ERP.

## Données attendues

### Dossier des commandes

Un dossier par affaire, nommé `1100xxxxxx NOM DU PROJET`. L'application y lit :

| Fichier | Ce qui en est tiré |
| --- | --- |
| Fiche de prévision `<n° commande>.xlsx` | Feuille `PREVI` (client, profils, barres, poids, postes prévus, code affaire atelier en A11), feuille `SUIVI` (opérations réalisées), feuilles de calcul (goujons, perçages, oxycoupage, contre-flèche). |
| RDE, Excel ou Word (`.docx`) | Opérations demandées, normes et exigences, lignes de laminage. |
| Mails `.msg` | Texte indexé pour la recherche, quantités annoncées (goujons, trous). |
| Programmes `.nc` (DSTV) | Nombre de trous et diamètres. |
| Autres documents (PDF, plans…) | Référencés pour la recherche et l'ouverture depuis l'application. |

Une seule fiche et un seul RDE sont retenus par affaire : celui à la racine du dossier, sinon le plus récent. Les sous-dossiers `Ancien` / `Old` sont considérés comme périmés.

### Heures réelles (ERP)

L'export ERP est un fichier `.txt` déposé dans le dossier surveillé, **en dehors** de tout dossier d'affaire. Un `.txt` rangé dans un dossier d'affaire est ignoré.

### Dossier Vacam

Les programmes y sont rangés par code affaire atelier (`D090`, `PROGRAMME 2025/D006/…`). Le rattachement à la commande se fait par ce code, lu en A11 de la feuille `PREVI`.

## Prévision et calibration

Pour chaque poste, la calibration relie les heures ERP à une grandeur de l'affaire (nombre de barres, poids, mètres de poutre, nombre de trous, de goujons, longueur de coupe…). Elle essaie plusieurs grandeurs et garde celle qui prévoit le mieux en validation croisée, en droite ou en courbe puissance.

Un poste n'est chiffré que s'il est prévu sur l'affaire (fiche, SUIVI ou RDE). Réparation et casse machine ne sont pas modélisées : ce sont des aléas.

Les modèles candidats de chaque poste sont déclarés dans `poste_variables()` ([calibration.rs](src-tauri/src/calibration.rs)) ; le calcul des heures est dans [prevision.rs](src-tauri/src/prevision.rs).

### Temps barème du chiffrage

La page Chiffrage utilise aussi les temps barème de l'atelier. Ils sont recopiés des feuilles de calcul des fiches de prévision et ne se mettent pas à jour tout seuls :

| Fichier | Poste | Origine | Rôle dans le chiffrage |
| --- | --- | --- | --- |
| [sciage.ts](src/lib/sciage.ts) | Mise à longueur | Feuilles `DATA-TEMPS` et `SCIE` | Remplace la calibration dès que des coupes sont saisies. |
| [presse.ts](src/lib/presse.ts) | Contre-flèche | Feuille `PRESSE` | Remplace la calibration dès qu'une contre-flèche est saisie. Le redressage n'a pas de barème. |
| [percage.ts](src/lib/percage.ts) | Forage manuel et numérique, trous oblongs | Feuilles `FMAN`, `FWAG` et `DATA-TEMPS` | Indicatif, affiché à côté des heures calibrées. |
| [soudage.ts](src/lib/soudage.ts) | Soudage | Classeur « 00 Calcul des temps de soudage » | Calculateur ; les cadences sont des paramètres modifiables. |

## Où sont stockées les données

Tout est dans le dossier de données de l'application :

- Windows : `%APPDATA%\com.thibaultboschi.parachev\`
- macOS : `~/Library/Application Support/com.thibaultboschi.parachev/`

| Fichier | Contenu |
| --- | --- |
| `affaires.db` | Base SQLite : affaires, heures, variables, documents, index de recherche, coefficients. |
| `coefficients.json` | Copie lisible de la dernière calibration (la base fait foi). |
| `indexation.log` | Journal de l'indexation, à consulter si un fichier n'est pas lu. |

Supprimer `affaires.db` remet l'application à zéro : il faut alors rechoisir les dossiers et recalibrer. Les corrections saisies à la main sont perdues.

## Développement

Prérequis : [Node.js](https://nodejs.org/) LTS, [Rust](https://rustup.rs/) stable et les [dépendances système de Tauri](https://tauri.app/start/prerequisites/).

```sh
npm install
npm run tauri dev      # application en mode développement
npm run tauri build    # installateur pour la plateforme courante
npx tsc --noEmit       # vérification des types du frontend
```

Tests du backend :

```sh
cd src-tauri
cargo test
```

Trois tests sont ignorés par défaut car ils ont besoin de données réelles :

```sh
# Indexation complète d'un dossier de commandes réel
cargo test --release -- --ignored --nocapture indexation_dossier_reel

# Erreur de chaque modèle sur une copie de la base
PARACHEV_DB=/chemin/affaires.db cargo test --lib banc_essai -- --ignored --nocapture

# Erreur de prévision affaire par affaire, exportée en CSV
PARACHEV_DB=/chemin/affaires.db PARACHEV_CSV=/tmp/eval.csv cargo test --lib evaluation_par_affaire -- --ignored --nocapture
```

### Organisation du code

```
src/                    Interface (React, TypeScript, Tailwind, shadcn/ui)
  pages/                Une page par entrée du menu
  components/           Composants par page (affaires, chiffrage, dashboard) et ui/
  lib/                  Temps barème, types de production, recherche
  hooks/                Accès aux commandes du backend
src-tauri/src/          Backend (Rust)
  lib.rs                Commandes exposées à l'interface, démarrage
  watcher.rs            Scan initial et surveillance des dossiers
  indexeur.rs           Rattachement, classement et extraction de chaque fichier
  parsing/              Un lecteur par source : PREVI, SUIVI, RDE, RDE Word, DSTV, goujons…
  erp.rs                Lecture de l'export ERP
  msg.rs                Lecture des mails .msg
  quantites.rs          Consolidation des quantités entre fiche, programmes CN et mails
  calibration.rs        Calcul des coefficients
  prevision.rs          Calcul des heures prévues
  recherche.rs          Recherche par critères et plein texte
```

Quand l'extraction d'un fichier change, incrémenter `VERSION_INDEXEUR` dans [indexeur.rs](src-tauri/src/indexeur.rs) : tous les fichiers seront relus au prochain lancement. Sans cela, l'indexation incrémentale saute les fichiers déjà lus.

### Publier une version

1. Mettre le même numéro de version dans [package.json](package.json), [tauri.conf.json](src-tauri/tauri.conf.json) et [Cargo.toml](src-tauri/Cargo.toml). Le nom de la release est tiré de `tauri.conf.json`.
2. Pousser un tag `v*` :

   ```sh
   git tag v0.3.4
   git push origin v0.3.4
   ```

3. Le workflow [release.yml](../.github/workflows/release.yml) construit les installateurs Windows et macOS et crée une release en brouillon, à publier à la main sur GitHub. Il a besoin du secret `RELEASE_TOKEN` dans le dépôt.

## Limites connues

- La précision dépend du poste : la presse et la manutention restent difficiles à prévoir à partir des données disponibles.
- Les trous oblongs des programmes `.nc` ne sont pas lus ; ils ne sont pris en compte que dans le chiffrage manuel.
- Les RDE Word contiennent moins d'informations que les RDE Excel (pas de donneur d'ordre ni de détail des normes).
- Les temps barème du chiffrage sont figés dans le code.
