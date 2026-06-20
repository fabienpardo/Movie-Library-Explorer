export const PUBLISHED_SHEET_ID = "2PACX-1vR0f-YQic-WwbzgTdFQroIy9T1P14usd5ysqySDfuM0Hi9JtMS8jKJ1DaJBJOQAgXvkWpgTXjiCMTdK";
export const GID = "70337195";
export const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/e/${PUBLISHED_SHEET_ID}/pub?gid=${GID}&single=true&output=csv`;
export const TEST_FIXTURE_CSV_URL = "./tests/fixtures/apple-tv-movies-library-mdb.csv";
export const TEST_MISSING_CSV_URL = "./tests/fixtures/__missing_regression_fixture__.csv";
export const DESKTOP_QUERY = window.matchMedia("(min-width: 760px)");
export const SUPPORTS_INERT = "inert" in HTMLElement.prototype;
export const FOCUSABLE = "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";
// Used by the inert fallback: includes controls even when they have already been forced to tabindex=-1.
export const PANEL_FOCUSABLE = "a[href],button,input,select,textarea,[tabindex]";

// The published Google Sheet always exposes the exact column headers below (they
// mirror the test fixture's header and never change), so columns are mapped by
// their fixed names rather than fuzzy-detected. Fuzzy alias/substring detection
// was removed because generic substrings (url, imdb, saga, order) mis-matched
// sibling columns (e.g. "Poster URL" -> url, "IMDb URL" -> imdbRating).
export const COLUMNS = {
  title: "Title",
  originalTitle: "Original Title",
  genres: "Genres",
  runtime: "Runtime (mins)",
  year: "Year",
  releaseDate: "Release Date",
  position: "Position",
  imdbRating: "IMDb Rating",
  url: "URL",
  poster: "Poster",
  country: "Country",
  actors: "Main actors",
  directors: "Directors",
  saga: "Saga name",
  sagaOrder: "Saga order"
};

export const categories = {
  genre: { label: "Genre", column: "genres", listId: "genreList", countId: "genreSelectedCount", empty: "Aucun genre disponible pour les filtres actuels" },
  actor: { label: "Acteur", column: "actors", listId: "actorList", countId: "actorSelectedCount", searchId: "actorFilterSearch", empty: "Aucun acteur disponible pour les filtres actuels" },
  director: { label: "Réalisateur", column: "directors", listId: "directorList", countId: "directorSelectedCount", searchId: "directorFilterSearch", empty: "Aucun réalisateur disponible pour les filtres actuels" }
};
export const categoryKeys = Object.keys(categories);
export const searchableCategories = categoryKeys.filter(category => categories[category].searchId);
export const DEFAULT_MATCH_MODE = { genre: "all", actor: "all", director: "all" };
export const STORAGE_KEYS = {
  selection: "movieExplorer.selection"
};
export const CARD_CACHE_LIMIT = 800;
export const OPTION_COUNTS_CACHE_LIMIT = 80;
// Above this many results, the single-column (mobile) grid renders only a scrolling
// window of cards instead of the whole list. Multi-column desktop always renders in
// full (it performs fine and content-visibility already skips off-screen work there).
export const VIRTUALIZE_THRESHOLD = 50;
