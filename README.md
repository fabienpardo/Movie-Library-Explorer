# Explorateur de films

Application statique GitHub Pages pour explorer une bibliothèque de films publiée depuis Google Sheets.

## Fonctionnalités

- Rechercher des films.
- Filtrer par genre, acteur et réalisateur.
- Choisir le mode de correspondance ``Au moins un` / `Tous` par catégorie.
- Trier par titre, titre original, durée, note IMDb, année ou pays.
- Afficher le titre, le titre original, la note IMDb, la durée, l’année, le pays principal, la réalisation, les acteurs et les genres.
- Mettre en évidence les filtres sélectionnés dans les cartes de films.
- Colorer les notes IMDb : vert pour `8.0+`, jaune pour `7.0–7.9`, rouge sous `7.0`.
- Utiliser un panneau de filtres sur mobile et une barre latérale sur desktop.
- Inclure les icônes iOS/PWA.

## Lancer en local

```bash
python3 -m http.server 8000
```

Ouvrir `http://localhost:8000`.

## Déployer

Déposer tous les fichiers à la racine du dépôt, puis activer GitHub Pages depuis la branche principale et le dossier racine.

Fichiers requis :

- `index.html`
- `style.css`
- `script.js`
- `favicon.svg`
- `apple-touch-icon.png`
- `icon-192.png`
- `icon-512.png`
- `manifest.webmanifest`

## Adapter les colonnes

Si l’application signale une colonne manquante, modifier `columnAliases` en haut de `script.js` et ajouter le nom exact de la colonne Google Sheets.

## Cache de l’icône iPhone

Si l’icône de l’écran d’accueil ne se met pas à jour, supprimer l’app ajoutée à l’écran d’accueil iOS, puis l’ajouter à nouveau depuis Safari.


## Note v6.6

Libellés de correspondance raccourcis pour éviter la troncature dans les menus.


## v6.7

- Ajoute l’icône flat comme favicon et icône iOS.
- Améliore la recherche mobile dans les filtres acteurs/réalisateurs : le bouton sticky est masqué pendant la saisie pour laisser plus de place aux résultats.
