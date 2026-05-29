# Movie Library Explorer

Static web app for browsing a published Google Sheets movie library.

## Features

- Loads movies from the published Google Sheet CSV endpoint.
- Search by text.
- Filter by genre, actor, and director.
- Per-category match mode: `Any` or `All`.
- Sort by title, original title, runtime, IMDb rating, year, or country.
- Displays title, original title, IMDb rating, runtime, year, main country, director, actors, and genres.
- Highlights selected filters inside movie cards.
- IMDb rating colors:
  - green: `8.0+`
  - yellow: `7.0–7.9`
  - red: below `7.0`
- Mobile-first layout with an iPhone-friendly filter drawer.
- Desktop layout with a permanent filter sidebar.
- Home-screen icons for iOS / PWA usage.

## Run locally

From this folder:

```bash
python3 -m http.server 8000
```

Open:

```text
http://localhost:8000
```

## Deploy on GitHub Pages

Upload these files to the repository root and enable GitHub Pages from the main branch/root folder:

- `index.html`
- `style.css`
- `script.js`
- `favicon.svg`
- `apple-touch-icon.png`
- `icon-192.png`
- `icon-512.png`
- `manifest.webmanifest`

## Update sheet column mapping

If the app warns that a column is missing, edit `columnAliases` near the top of `script.js`.

Example:

```js
imdbRating: ["imdb rating", "imdb", "imdb score"]
```

Add the exact column name from the sheet if needed.

## iPhone home-screen icon

If the icon does not update after deployment:

1. Delete the existing home-screen app.
2. Open the GitHub Pages URL in Safari.
3. Add it to the home screen again.

Safari/iOS may cache the first installed icon.
