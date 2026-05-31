# Explorateur de films

Application statique GitHub Pages pour explorer une bibliothèque de films publiée depuis Google Sheets.

## Fonctionnalités

- Recherche, tri et filtres par genre, acteur et réalisateur.
- Mode de correspondance par catégorie : `Au moins un` ou `Tous`.
- Options de filtres dynamiques : les valeurs sans résultat sont masquées, sauf si elles sont déjà sélectionnées.
- Mise en évidence des filtres sélectionnés dans les cartes de films.
- Couleurs IMDb : vert pour `8.0+`, jaune pour `7.0–7.9`, rouge sous `7.0`.
- Titre du film cliquable vers IMDb quand une colonne URL est disponible.
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

## Note v7.4

Ajout d’un lien IMDb sur le titre des films quand la colonne URL est disponible dans Google Sheets.

## Note v7.5

Le tri alphabétique des titres ignore les articles initiaux courants, par exemple `Le`, `La`, `Les`, `L’`, `The`, `A` et `An`. Les titres affichés restent inchangés.


## Note v7.6

Le tri alphabétique des titres ignore aussi la ponctuation et les symboles de classement, par exemple les points, parenthèses, guillemets et tirets. Les titres affichés restent inchangés.

## Note v7.7

Les filtres utilisent `Tous` par défaut. Les options de chaque filtre sont triées par nombre de résultats décroissant.

## Note v7.8

Les genres, acteurs et réalisateurs affichés dans les cartes sont cliquables pour ajouter ou retirer directement le filtre correspondant.

## Note v7.9

Nettoyage de maintenance : cache léger pour les compteurs de filtres, clarification du comportement tactile iOS, et séparation plus nette entre synchronisation d’accessibilité et changement de taille d’écran.
