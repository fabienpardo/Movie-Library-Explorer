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

export const columnAliases = {
  title: ["title", "movie", "movie title", "name"],
  originalTitle: ["original title", "originaltitle", "original name", "original movie title"],
  genres: ["genre", "genres"],
  runtime: ["runtime", "runtime min", "runtime mins", "runtime minutes", "duration", "duration min", "duration mins", "duration minutes", "running time"],
  year: ["year", "release year", "movie year"],
  releaseDate: ["release date", "released", "date released", "premiere date", "theatrical release", "release"],
  position: ["position", "library position", "library rank", "library order", "rank", "order"],
  imdbRating: ["imdb rating", "imdb", "imdb score", "imdb rate", "imdb user rating"],
  url: ["url", "link", "movie url", "imdb url", "imdb link", "imdb title url", "imdb page", "imdb title page"],
  poster: ["poster", "poster url", "poster link", "cover", "cover url", "cover link", "image", "image url", "image link", "affiche", "affiche url", "affiche link"],
  country: ["country", "countries", "production country", "production countries", "main country", "origin country", "country of origin", "nationality"],
  actors: ["actor", "actors", "cast", "main cast", "stars", "starring", "lead actors"],
  directors: ["director", "directors", "directed by"],
  saga: ["saga", "saga name", "saga title", "franchise", "franchise name", "collection", "series", "serie", "saga collection"],
  sagaOrder: ["saga order", "saga number", "saga index", "saga rank", "saga position", "franchise order", "order in saga", "part number", "chapter number"]
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
