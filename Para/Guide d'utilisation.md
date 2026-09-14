# Guide d'utilisation — Parachev

Application de suivi des affaires de parachèvement : elle importe automatiquement les heures pointées (ERP) et les fiches de prévision (Excel), et calcule des prévisions d'heures par poste à partir de coefficients calibrés sur l'historique.

---

## 1. Premier lancement : choisir le dossier à surveiller

Au premier démarrage, aucune donnée n'est chargée. En haut à droite de l'écran, cliquez sur **« Choisir le dossier à surveiller »** et sélectionnez le dossier contenant :

- les fichiers ERP (`.txt`) avec les heures pointées,
- les fichiers Excel de prévision par affaire (`.xlsx`, un fichier par affaire).

Une fois le dossier choisi :

- l'application scanne immédiatement tous les fichiers déjà présents (sous-dossiers inclus),
- puis surveille ce dossier en continu : tout fichier ajouté ou modifié est ré-importé automatiquement, sans action de votre part.

Le bouton affiche ensuite simplement **« Dossier »** — le chemin choisi est mémorisé, vous n'avez pas à le resélectionner aux lancements suivants. Pour changer de dossier, recliquez sur le bouton ; le nouveau dossier n'est réellement pris en compte qu'après un redémarrage de l'application.

---

## 2. Tableau de bord — Heures pointées

Page d'accueil. Affiche toutes les lignes d'heures importées depuis les fichiers ERP.

- **Cartes en haut** : total d'heures, nombre d'affaires distinctes, nombre de lignes — recalculées selon les filtres actifs.
- **Recherche** : par numéro d'affaire ou OT.
- **Filtre par poste** : cliquez sur un ou plusieurs postes pour n'afficher que ces lignes ; « Réinitialiser postes » efface la sélection.
- **Filtre par période** : bornes de dates libres, ou raccourcis (Tout, 12 derniers mois, Cette année, Année dernière).
- **Graphique** : heures totales par poste, selon les filtres actifs.
- **Tableau** : trié par défaut par date décroissante ; cliquez sur un en-tête de colonne pour changer le tri. Pagination en bas.

---

## 3. Rechercher une affaire

Accessible via **Search** dans le menu de gauche. Permet de retrouver une ou plusieurs affaires selon plusieurs critères combinés :

- **Champ de recherche libre** : numéro d'affaire, client, profil ou n° de plan.
- **Client** : liste déroulante des clients connus.
- **Profil** : liste déroulante des profils connus (HEB 600, HEM 700...).
- **Type** : liste déroulante des types de projet (Redressage, Presse, Pont PPE, Ponts Complexes, Caisson...). Sélectionner un type filtre les affaires qui ont bien reçu **toutes** les actions de production associées à ce type (déduites de leurs heures pointées par poste) — une affaire sans heure sur un poste requis par ce type n'apparaît pas.
- **Rechercher par valeur de variable** : un champ numérique par variable (nb barres, nb goujons, trous manuel/numérique, Ø moyen numérique, longueur coupe, contre-flèche) — ne renseigner que les champs qui vous intéressent ; une valeur filtre sur une correspondance exacte.

Chaque résultat est une carte cliquable : cliquer dessus ouvre la fiche détaillée de l'affaire (voir section 4).

---

## 4. Fiche affaire (Prévision)

Ouverte en cliquant sur une affaire depuis la recherche, ou via l'URL `/prevision/<numéro d'affaire>`.

### Contenu affiché

- **Total heures pointées** et **Heures par poste** : issus des heures ERP réellement enregistrées pour cette affaire.
- **Variables** : les variables extraites du fichier Excel de l'affaire (profil, n° de plan, nombre de barres, de goujons, de trous, contre-flèche...). Si l'affaire mélange plusieurs profils distincts, le détail par profil est affiché au-dessus.
- **Prévisions enregistrées** : le dernier calcul de prévision par poste pour cette affaire, s'il en existe un.

### Modifier les variables

Chaque variable est un champ modifiable. Dès qu'une valeur diffère de celle en base, un bouton **« Sauvegarder »** apparaît en haut de la carte Variables — cliquez dessus pour enregistrer. Un champ numérique laissé vide est enregistré comme « non renseigné », pas comme zéro.

> ⚠️ Rouvrir le fichier Excel de l'affaire et le ré-enregistrer écrase à nouveau ces variables avec ce qui est extrait du fichier — une correction manuelle ne survit pas à un nouveau passage du fichier source.

### Calculer une prévision

Le bouton **« previ »** en haut de la page lance le calcul de prévision (heures par poste) pour l'affaire affichée, à partir des coefficients actuellement calibrés (voir section 5) et des variables de l'affaire. Le résultat remplace la prévision précédemment enregistrée pour cette affaire et s'affiche dans la carte « Prévisions enregistrées ».

---

## 5. Coefficients et calibration

Accessible via **Coefficients** dans le menu de gauche. Liste, pour chaque poste connu, l'intercept et les coefficients de la formule de prévision (temps = intercept + Σ coefficient × variable). Les postes sans modèle calibré (faute de variable explicative connue, ex. Soudage, P3, Robot) apparaissent avec la mention **« Non calibré »**.

### Relancer une calibration

Le bouton **« Calibrer »**, disponible en haut de n'importe quelle page, recalcule tous les coefficients à partir de l'historique actuel (heures pointées + variables des affaires en base) et remplace intégralement l'ancienne calibration. La page Coefficients se met à jour automatiquement si elle est ouverte pendant l'opération.

Un poste n'est calibré que s'il dispose d'assez d'observations (au moins ~15 affaires par variable explicative) ; en dessous de ce seuil il reste affiché comme non calibré plutôt que de produire un modèle peu fiable.

---

## 6. Comprendre le circuit des données

```
Dossier surveillé
 ├─ fichiers ERP (.txt)  ──────────► heures pointées par affaire/poste
 └─ fichiers Excel (.xlsx, un par affaire)
      └─ feuille PREVI, FC-GOUJ, FC-OXY, FT-MAN/FT-NUM, FC-PRES...
                                    ──► variables de l'affaire
                                        (profil, nb barres, nb goujons,
                                         trous, contre-flèche...)

  heures pointées + variables des affaires  ──[Calibrer]──► coefficients par poste

  coefficients + variables d'une affaire  ──[previ]──► prévision d'heures par poste
```

Tout ce circuit est automatique dès que le dossier surveillé est configuré (section 1) — il n'y a rien à importer manuellement. Seule la calibration (section 5) et le calcul de prévision par affaire (section 4) sont déclenchés à la demande, via leurs boutons respectifs.

---

## 7. Questions fréquentes

**« Affaire introuvable en base » sur la fiche d'une affaire**
Le fichier Excel de cette affaire n'a pas encore été détecté dans le dossier surveillé (ou le dossier n'est pas encore configuré, voir section 1).

**Une variable affiche « — »**
La donnée n'a pas pu être extraite du fichier Excel de l'affaire (feuille absente, ou modèle non rempli côté production). Elle peut être renseignée manuellement depuis la fiche affaire (section 4).

**Le bouton « previ » ne calcule rien pour un poste**
Soit ce poste n'a pas de coefficient calibré (voir page Coefficients), soit aucune des variables attendues par son modèle n'est renseignée pour cette affaire.

**Mes coefficients semblent dépassés**
Relancez une calibration (bouton « Calibrer », section 5) — elle prend en compte toutes les heures et variables actuellement en base.
