# Explorateur de films

Application statique GitHub Pages pour explorer une bibliothèque de films publiée depuis Google Sheets.

## Fonctionnalités

- Recherche, tri et filtres par genre, acteur et réalisateur.
- Mode de correspondance par catégorie : `Au moins un` ou `Tous`.
- Options de filtres dynamiques : les valeurs sans résultat sont masquées, sauf si elles sont déjà sélectionnées.
- Mise en évidence des filtres sélectionnés dans les cartes de films.
- Couleurs IMDb : vert pour `8.0+`, jaune pour `7.0–7.9`, rouge sous `7.0`.
- Panneau de filtres mobile et barre latérale desktop.
- Icônes favicon, iOS et manifeste incluses.

## Lancer en local

```bash
python3 -m http.server 8000
```

Ouvrir `http://localhost:8000`.

## Déployer

Déposer les fichiers à la racine du dépôt GitHub Pages. Aucun backend ni build step n’est nécessaire.

## Adapter les colonnes

Si une colonne Google Sheets n’est pas détectée, modifier `columnAliases` en haut de `script.js`.

## Note v7.2

Correctif sur la suppression des filtres actifs contenant des caractères spéciaux, et découplage partiel entre rendu des listes et synchronisation accessibilité du panneau mobile.
