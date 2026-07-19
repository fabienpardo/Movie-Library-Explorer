import { categories } from "./config.mjs";
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
// Assign a unique __movieExplorerId to every row during ingestion. Two rows can
// otherwise resolve to the same id (a shared IMDb URL, or colliding title/year/
// position), which would make the keyed renderer merge them into one card and let
// selection treat them as a single film. Collisions get a deterministic "#n" suffix
// and a diagnostic warning; the returned warnings surface in the diagnostics panel.
export function assignUniqueMovieIds(rows, columns = state.columns) {
  const seen = new Map();
  const warnings = [];
  rows.forEach((row, index) => {
    const baseId = makeMovieId(row, index, columns);
    const count = (seen.get(baseId) || 0) + 1;
    seen.set(baseId, count);
    row.__movieExplorerId = count === 1 ? baseId : `${baseId}#${count}`;
    if (count > 1) warnings.push(`Identifiant de film en double détecté (ligne ${index + 2}) : ${baseId}. Un suffixe a été ajouté pour les distinguer.`);
  });
  return warnings;
}
export function reconcilePersistedSelection(rows = state.rows, columns = state.columns) {
  if (!state.selection.size) return;

  // Only drop "orphan" IDs when the columns that define a movie's identity are
  // actually present in the loaded sheet. If the URL header is temporarily
  // missing/renamed, every row falls back to a title/year/position ID and the
  // previously saved url: selections would look absent — preserving them avoids
  // silently wiping localStorage on a transient sheet glitch. Once the sheet is
  // healthy again, normal pruning resumes.
  const canPrune = (state.labels || []).includes(columns.url);

  const aliases = new Map();
  const validIds = new Set();
  rows.forEach((row, index) => {
    // Use the id actually assigned during ingestion (incl. any duplicate-disambiguation
    // suffix) so reconciliation matches what the renderer and selection use.
    const nextId = movieId(row);
    validIds.add(nextId);
    legacyMovieIds(row, index, columns).forEach(oldId => aliases.set(oldId, nextId));
  });

  let changed = false;
  const reconciled = new Set();
  for (const id of state.selection) {
    const nextId = aliases.get(id) || id;
    // Prune IDs with no matching row in the current dataset (deleted movie,
    // changed fallback key, etc.) so the badge count never claims selected films
    // the selection panel can't show. Gated on canPrune to avoid data loss when a
    // mapped header is missing. Only runs after a successful, non-empty load.
    if (canPrune && !validIds.has(nextId)) { changed = true; continue; }
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
export function appleTvUrl(row) {
  return httpUrl(cell(row, "appleTvUrl"));
}
// The sheet links full-resolution poster art (often 2000x3000, up to 2560x3840).
// Cards only ever show it in a ~440px banner and a 78px thumb, so decoding and
// GPU-compositing 20MB+ textures per poster wrecks scroll on a phone. Both CDNs we
// see (Apple mzstatic, Amazon) resize via the URL — ask them for a card-sized copy.
const POSTER_DISPLAY_WIDTH = 600;
export function resizePosterUrl(url, width = POSTER_DISPLAY_WIDTH) {
  if (!url || /^data:/i.test(url)) return url;
  // Apple mzstatic: dimensions are the leading "{w}x{h}" of the last path segment
  // (e.g. .../2000x3000bb.jpg, .../800x1200CA.TVA23C01.jpg). Swap them, keep aspect + the crop/format suffix.
  if (/mzstatic\.com/i.test(url)) {
    const slash = url.lastIndexOf("/");
    const seg = url.slice(slash + 1);
    const m = seg.match(/^(\d+)x(\d+)/);
    if (m) {
      const h = Math.round(width * (Number(m[2]) / Number(m[1])));
      return url.slice(0, slash + 1) + `${width}x${h}` + seg.slice(m[0].length);
    }
  }
  // Amazon m.media-amazon: "_UX936_" / "_UY..._" / "_SX..._" size token -> request our width.
  if (/media-amazon\.com/i.test(url)) return url.replace(/_(?:U[XY]|S[XY])\d+_/i, `_UX${width}_`);
  return url;
}
export function posterUrl(row) {
  return resizePosterUrl(safeImageUrl(cell(row, "poster")));
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
