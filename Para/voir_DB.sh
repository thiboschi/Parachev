#!/bin/bash
# Visualise le contenu de affaires.db dans le terminal.
# Usage : ./voir_db.sh [chemin_vers_affaires.db]
#
# Sans argument, cherche automatiquement affaires.db dans le dossier de
# données standard de l'app (~/Library/Application Support/<identifier>/
# sur macOS) -- c'est là que l'app la crée réellement depuis qu'elle
# utilise app.path().app_data_dir() plutôt qu'un chemin relatif.

if [ -n "$1" ]; then
    DB="$1"
else
    DOSSIER_RECHERCHE="$HOME/Library/Application Support"
    CANDIDATS=$(find "$DOSSIER_RECHERCHE" -iname "affaires.db" 2>/dev/null)
    NB_CANDIDATS=$(echo "$CANDIDATS" | grep -c . )

    if [ "$NB_CANDIDATS" -eq 0 ]; then
        echo "Aucun affaires.db trouvé automatiquement dans :"
        echo "  $DOSSIER_RECHERCHE"
        echo ""
        echo "Lance l'app au moins une fois pour qu'elle soit créée,"
        echo "ou précise le chemin manuellement :"
        echo "  $0 /chemin/vers/affaires.db"
        exit 1
    elif [ "$NB_CANDIDATS" -gt 1 ]; then
        echo "Plusieurs affaires.db trouvés, précise lequel utiliser :"
        echo "$CANDIDATS"
        exit 1
    fi

    DB="$CANDIDATS"
    echo "Base détectée automatiquement : $DB"
fi

if [ ! -f "$DB" ]; then
    echo "Base introuvable : $DB"
    echo "Usage: $0 [chemin_vers_affaires.db]"
    exit 1
fi

separateur() {
    echo ""
    echo "=========================================="
    echo "  $1"
    echo "=========================================="
}

separateur "Tables présentes"
sqlite3 "$DB" ".tables"

separateur "Résumé (nombre de lignes par table)"
sqlite3 -header -column "$DB" "
SELECT 'heures' AS table_, COUNT(*) AS nb_lignes FROM heures
UNION ALL
SELECT 'variables_affaires', COUNT(*) FROM variables_affaires
UNION ALL
SELECT 'previsions', COUNT(*) FROM previsions
UNION ALL
SELECT 'configuration', COUNT(*) FROM configuration;
"

separateur "Dossier surveillé configuré"
sqlite3 -header -column "$DB" "SELECT * FROM configuration;"

separateur "variables_affaires (quantités par affaire)"
sqlite3 -header -column "$DB" "
SELECT affaire, client, nb_barres, nb_goujons, nb_trous_manuel,
       nb_trous_numerique, diametre_moyen_numerique, longueur_coupe
FROM variables_affaires
ORDER BY affaire;
"

separateur "Heures totales par poste (toutes affaires)"
sqlite3 -header -column "$DB" "
SELECT poste, COUNT(*) AS nb_lignes, ROUND(SUM(heures), 1) AS total_heures
FROM heures
GROUP BY poste
ORDER BY total_heures DESC;
"

separateur "Affaires distinctes dans heures vs variables_affaires"
sqlite3 -header -column "$DB" "
SELECT
  (SELECT COUNT(DISTINCT affaire) FROM heures) AS affaires_dans_heures,
  (SELECT COUNT(*) FROM variables_affaires) AS affaires_dans_variables;
"

separateur "Dernières prévisions calculées"
sqlite3 -header -column "$DB" "
SELECT affaire, poste, ROUND(heures_prevues, 2) AS heures_prevues, date_prevision
FROM previsions
ORDER BY date_prevision DESC
LIMIT 20;
"