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
- Résumé de résultats sticky pendant l’exploration.
- Mode cartes/liste sur desktop ; sur mobile, l’affichage reste en cartes.
- Sélection temporaire persistée localement, avec bouton `+` compact sur les cartes et détails complets consultables dans le panneau de sélection.
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

## Note v8.2

Le tri par défaut utilise désormais la colonne `Position` en ordre décroissant. Les options de tri incluent aussi `Position` croissante et décroissante. Le tri par année utilise `Release Date` quand la colonne est disponible, avec `Year` comme fallback.

- Libellés de tri simplifiés : ajout récent/ancien, durée courte/longue, sortie récente/ancienne.
- La comparaison `Title` / `Original Title` est normalisée pour éviter les doublons liés aux différences de casse, accents ou ponctuation.

## Note v8.3

Corrections de cohérence : tri `Year` homogène entre `Release Date` et `Year`, tri `Original Title` basé sur la valeur réelle plutôt que sur le libellé affiché, détection plus sûre de la colonne `Title`, focus clavier visible sur les options de filtre, style conservé au survol des genres sélectionnés, et versions de cache d’icônes alignées.

## Note v8.4

Roadmap d’exploration : hero compact, retrait des anciennes cartes statistiques, résumé sticky des résultats, mode cartes/liste, et sélection temporaire persistée via `localStorage`.

## Note v8.4.1

Nettoyage de maintenance : versions de cache alignées, retrait des sélecteurs CSS obsolètes, suppression des règles mobiles inutiles pour l’ancien mode liste, factorisation du rendu des cartes/listes, et séparation des utilitaires de test navigateur.


## Note v8.4.2

Nettoyage de robustesse : retrait de la suppression de filtres basée sur un index DOM, identifiants DOM normalisés pour les détails de sélection, test réel d’écriture `localStorage`, avertissement quand la colonne URL/IMDb est absente, documentation de l’identifiant de secours des films et migration des anciens identifiants persistés.

Les sélections sont les plus stables quand le CSV contient une colonne URL/IMDb. Sans cette colonne, l’application utilise un identifiant de secours basé sur le titre, l’année et la position ; une modification de ces valeurs dans la feuille peut rendre une ancienne sélection persistée impossible à retrouver.

## Tests de régression

Le package inclut un fichier CSV de test dans `tests/fixtures/apple-tv-movies-library-mdb.csv`. Ce fichier est destiné uniquement aux tests : l’application continue de charger les données depuis l’URL Google Sheets publiée par défaut.

Lancer tous les scénarios depuis la racine du package :

```bash
npm test
```

Lancer une couche précise :

```bash
npm run test:unit
npm run test:assets
npm run test:e2e
```

Les tests sont organisés en trois couches :

- `tests/regression.test.js` : logique de données, parsing CSV, détection des colonnes, tris, filtres, durées, classes IMDb et URLs IMDb.
- `tests/static-assets.test.js` : cohérence des fichiers référencés par `index.html`, le manifeste, les versions de cache et les hooks CSS de la roadmap.
- `tests/e2e.browser.test.js` : scénarios navigateur avec Chromium, sans dépendance externe. Les helpers CDP sont isolés dans `tests/browser-test-utils.js`. Les scénarios couvrent le rendu, la recherche, les filtres, les chips cliquables, les tris, le résumé sticky, l’affichage liste desktop, le mode cartes forcé sur mobile, la sélection temporaire, l’erreur de chargement et les comportements mobiles critiques.

Pour les tests navigateur, Chromium doit être disponible. Si nécessaire :

```bash
CHROMIUM_PATH=/path/to/chromium npm run test:e2e
```
