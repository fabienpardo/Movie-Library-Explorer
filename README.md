# Movie Library Explorer

Static web app for exploring a published Google Sheet movie library.

## Features

- Loads the published Google Sheet CSV endpoint directly in the browser
- Filters by:
  - genre
  - actor
  - director
- Supports `any` or `all` matching within each filter group
- Combines different filter groups together, for example: `genre = Drama` + `actor = Al Pacino` + `director = Francis Ford Coppola`
- Sorts by:
  - title
  - original title
  - runtime
  - IMDb rating
  - year
  - country
- Displays:
  - title
  - original title
  - year
  - main country only, using the first country when several are listed
  - runtime
  - IMDb rating
  - director(s)
  - actor(s)
  - genres
- Includes an SVG favicon file (`favicon.svg`)

## Run locally

Use a local static server rather than opening the file directly:

```bash
cd movie-library-explorer-v2
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Source sheet

The app is configured for this published Google Sheet:

```text
https://docs.google.com/spreadsheets/d/e/2PACX-1vR0f-YQic-WwbzgTdFQroIy9T1P14usd5ysqySDfuM0Hi9JtMS8jKJ1DaJBJOQAgXvkWpgTXjiCMTdK/pubhtml?gid=70337195&single=true
```

It reads the CSV endpoint:

```text
https://docs.google.com/spreadsheets/d/e/2PACX-1vR0f-YQic-WwbzgTdFQroIy9T1P14usd5ysqySDfuM0Hi9JtMS8jKJ1DaJBJOQAgXvkWpgTXjiCMTdK/pub?gid=70337195&single=true&output=csv
```

## Column detection

The script auto-detects common column names. If your sheet uses different names, edit the alias arrays near the top of `script.js`.

Important mappings:

- title: `Title`, `Movie`, `Movie Title`, `Name`
- original title: `Original Title`, `Original Name`
- genres: `Genre`, `Genres`
- runtime: `Runtime`, `Duration`, `Running Time`
- year: `Year`, `Release Year`
- IMDb rating: `IMDb Rating`, `IMDb`, `IMDb Score`
- country: `Country`, `Countries`, `Production Country`, `Production Countries`, `Country of Origin`
- actors: `Actor`, `Actors`, `Cast`, `Stars`, `Starring`
- directors: `Director`, `Directors`, `Directed By`

## Note on country handling

When several countries are present in the country column, the app displays only the first value. Supported separators are comma, semicolon, pipe, and slash.
# Movie-Library-Explorer
