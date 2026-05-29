# Movie Library Explorer

Static web app for exploring a published Google Sheet movie library.

## Features

- Loads the published Google Sheet CSV endpoint directly in the browser
- Mobile-first UI designed for iPhone Safari, including iPhone 16 Pro Max
- iOS 26-inspired visual treatment using translucent glass surfaces, pill controls, layered depth, and safe-area-aware spacing
- Filter drawer / bottom sheet on mobile
- Large touch targets for filter controls
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
  - actor(s), collapsed when long
  - genres
- Includes an SVG favicon file (`favicon.svg`)
- Shows diagnostics when expected columns are not detected

## Run locally

Use a local static server rather than opening the file directly:

```bash
cd movie-library-explorer-v4
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Deploy on GitHub Pages

1. Push `index.html`, `style.css`, `script.js`, `favicon.svg`, and `README.md` to your repository.
2. In GitHub, open **Settings → Pages**.
3. Set the source to the `main` branch and root folder `/`, or to the branch/folder you use for deployment.
4. Open the GitHub Pages URL from desktop and iPhone Safari.

## Design direction

This version uses an iOS 26-inspired Liquid Glass direction without relying on Apple system assets. The design emphasizes translucent navigation/filter surfaces, rounded cards, pill controls, soft highlights, blur, depth, and readable contrast fallbacks.

## iPhone / mobile testing

The UI is mobile-first. For local browser testing, use responsive viewport widths around:

- `440 × 956` CSS px for iPhone 16 Pro Max-like testing
- `390 × 844` CSS px for smaller iPhones

Checks to perform:

- no horizontal scrolling
- filter button opens the bottom sheet
- filter chips are easy to tap
- actor/director search works
- sorting still works
- movie cards remain readable

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

The script auto-detects common column names. If your sheet uses different names, edit the `columnAliases` object near the top of `script.js`.

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

If a field is not detected, the app displays a diagnostic panel listing detected columns and missing expected fields.

## Note on country handling

When several countries are present in the country column, the app displays only the first value. Supported separators are comma, semicolon, pipe, and slash.

## v5 filter panel refinements

This version adjusts the iPhone filter panel based on mobile use:

- The filter header has more separation from the genre chips to avoid overlap.
- Selected filter chips now use a stronger filled state and a check indicator, so selected vs. unselected values are easier to distinguish.
- The filter panel includes quick navigation buttons for Genres, Actors, and Directors.
- Match mode is now configured per category:
  - Genre match: Any selected genre / All selected genres
  - Actor match: Any selected actor / All selected actors
  - Director match: Any selected director / All selected directors

Categories still combine together: if genre, actor, and director filters are selected, a movie must satisfy each category's rule.

## v5.1 patch notes

This patch addresses the code review items:

- Fixed desktop filter accessibility by keeping the visible desktop filter panel exposed to assistive technology.
- Added basic focus handling for the mobile filter drawer: focus moves to the close button when opened and returns to the previous control when closed.
- Added UTF-8 BOM stripping for CSV headers to avoid first-column detection failures.
- Improved runtime parsing for values such as `2 hr 22 min`, `2 hrs`, and `2 hours 22 minutes`.
- Added a diagnostic warning when the title column is not detected and the app falls back to the first detected column.
