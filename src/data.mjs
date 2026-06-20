import { categories, columnAliases } from "./config.mjs";
import { persistSelection, state } from "./state.mjs";
import { normalize, parseDateValue, parseList, parseNumber } from "./utils.mjs";

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (quoted && next === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      rows.push([...row, field]);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  rows.push([...row, field]);
  return rows.filter(items => items.some(item => String(item || "").trim()));
}

export function csvToTable(text) {
  const records = parseCsv(text);
  if (records.length < 2) throw new Error("Le point d’accès CSV ne contient aucune ligne exploitable.");

  const labels = records[0].map((label, index) => String(label || "").replace(/^\uFEFF/, "").trim() || `Colonne ${index + 1}`);
  const rows = records.slice(1).map(record => Object.fromEntries(labels.map((label, index) => [label, record[index] ?? ""])));
  return { labels, rows };
}

export function detectColumns(labels) {
  const normalized = labels.map(raw => ({ raw, norm: normalize(raw) }));
  const pick = (aliases, exclusions = []) => {
    const aliasNorms = aliases.map(normalize);
    const excluded = exclusions.map(normalize);
    const candidates = normalized.filter(item => !excluded.some(ex => item.norm === ex || item.norm.includes(ex)));
    return candidates.find(item => aliasNorms.includes(item.norm))?.raw
      || candidates.find(item => aliasNorms.some(alias => item.norm.includes(alias)))?.raw
      || null;
  };

  const title = pick(columnAliases.title, columnAliases.originalTitle);
  const url = pick(columnAliases.url);
  const warnings = [];
  if (!title) warnings.push(`La colonne de titre n’a pas été détectée. Utilisation de la première colonne : "${labels[0]}".`);
  if (!url) warnings.push("Aucune colonne URL/IMDb n’a été détectée. La sélection temporaire reste disponible, mais sa persistance utilise un identifiant de secours moins stable basé sur le titre, l’année et la position.");

  return {
    columns: {
      title: title || labels[0],
      originalTitle: pick(columnAliases.originalTitle),
      genres: pick(columnAliases.genres),
      runtime: pick(columnAliases.runtime),
      year: pick(columnAliases.year),
      releaseDate: pick(columnAliases.releaseDate),
      position: pick(columnAliases.position),
      imdbRating: pick(columnAliases.imdbRating),
      url,
      poster: pick(columnAliases.poster),
      country: pick(columnAliases.country),
      actors: pick(columnAliases.actors),
      directors: pick(columnAliases.directors),
      saga: pick(columnAliases.saga),
      sagaOrder: pick(columnAliases.sagaOrder)
    },
    warnings
  };
}

export function cell(row, field, columns = state.columns) {
  const column = columns[field];
  return column ? row[column] ?? "" : "";
}
// Single home for the http(s)-only URL allow-list shared by movie links, poster
// images and the URL-based movie id. Returns the normalized href or "" when the
// value is empty, unparseable, or uses a non-web protocol.
export function httpUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
export function normalizedMovieUrlId(row, columns = state.columns) {
  return httpUrl(cell(row, "url", columns));
}
// Shared title/year/position used to build both the current fallback id and the
// legacy ids it migrates from, so the two formats can never drift apart.
function movieIdParts(row, index = 0, columns = state.columns) {
  const title = normalize([cell(row, "title", columns), cell(row, "originalTitle", columns)].filter(Boolean).join(" "));
  const release = parseDateValue(cell(row, "releaseDate", columns));
  const year = Number.isFinite(release) ? new Date(release).getUTCFullYear() : parseNumber(cell(row, "year", columns));
  const position = parseNumber(cell(row, "position", columns));
  return {
    title: title || "untitled",
    year: Number.isFinite(year) ? year : "unknown",
    position: Number.isFinite(position) ? position : index
  };
}
export function fallbackMovieId(row, index = 0, columns = state.columns) {
  // Fallback IDs are intentionally documented as less stable: spreadsheet title/year/position edits can orphan persisted selections.
  const { title, year, position } = movieIdParts(row, index, columns);
  return `fallback:${title}:${year}:${position}`;
}
export function legacyMovieIds(row, index = 0, columns = state.columns) {
  const url = normalizedMovieUrlId(row, columns);
  const { title, year, position } = movieIdParts(row, index, columns);
  return [url, `movie:${title}:${year}:${position}`].filter(Boolean);
}
export function makeMovieId(row, index = 0, columns = state.columns) {
  const url = normalizedMovieUrlId(row, columns);
  return url ? `url:${url}` : fallbackMovieId(row, index, columns);
}
export function reconcilePersistedSelection(rows = state.rows, columns = state.columns) {
  if (!state.selection.size) return;

  const aliases = new Map();
  rows.forEach((row, index) => {
    const nextId = makeMovieId(row, index, columns);
    legacyMovieIds(row, index, columns).forEach(oldId => aliases.set(oldId, nextId));
  });

  let changed = false;
  const reconciled = new Set();
  for (const id of state.selection) {
    const nextId = aliases.get(id) || id;
    if (nextId !== id) changed = true;
    reconciled.add(nextId);
  }
  if (changed) {
    state.selection = reconciled;
    persistSelection();
  }
}
export function movieId(row) {
  return row.__movieExplorerId || makeMovieId(row, Math.max(0, state.rows.indexOf(row)));
}
export function listFor(row, category) { return parseList(cell(row, categories[category].column)); }
export function displayTitle(row) { return cell(row, "title") || cell(row, "originalTitle") || "Sans titre"; }
export function equivalentTitle(value) { return normalize(value); }
export function displayOriginalTitle(row) {
  const original = cell(row, "originalTitle").trim();
  const title = cell(row, "title").trim();
  return original && equivalentTitle(original) !== equivalentTitle(title) ? original : "";
}
export function safeImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(raw)) return raw;
  return httpUrl(raw);
}
export function movieUrl(row) {
  return httpUrl(cell(row, "url"));
}
export function posterUrl(row) {
  return safeImageUrl(cell(row, "poster"));
}
export function sagaName(row) { return cell(row, "saga").trim(); }
export function sagaOrder(row) {
  const order = parseNumber(cell(row, "sagaOrder"));
  return Number.isFinite(order) ? order : null;
}
export function sagaTotals() {
  // Total per saga is the highest order seen among its movies. Cached because it scans every row and only changes on reload.
  if (state.sagaTotalsCache) return state.sagaTotalsCache;

  const totals = new Map();
  if (state.columns.saga) {
    for (const row of state.rows) {
      const key = normalize(sagaName(row));
      if (!key) continue;
      const order = sagaOrder(row);
      totals.set(key, Math.max(totals.get(key) || 0, Number.isFinite(order) ? order : 0));
    }
  }
  state.sagaTotalsCache = totals;
  return totals;
}
export function sagaTotal(row) {
  const name = sagaName(row);
  return name ? (sagaTotals().get(normalize(name)) || 0) : 0;
}

