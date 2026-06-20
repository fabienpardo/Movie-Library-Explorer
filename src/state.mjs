import { DEFAULT_MATCH_MODE, STORAGE_KEYS } from "./config.mjs";

let storageAvailabilityCache = null;

// Remember poster outcomes across re-renders so re-created cards paint instantly
// instead of re-showing the loading skeleton (or retrying a known-broken poster).
export const loadedPosters = new Set();
export const failedPosters = new Set();

// Pool of filtered-out card nodes, keyed by movie id. Re-attaching the original
// node (with its already-painted poster) avoids the repaint flash a fresh <img>
// would cause when a movie returns to the result set.
export const cardNodeCache = new Map();

export const els = {};
export const state = {
  rows: [],
  labels: [],
  columns: {},
  warnings: [],
  search: "",
  sort: "position-desc",
  filterSearch: { actor: "", director: "" },
  matchMode: { ...DEFAULT_MATCH_MODE },
  selected: { genre: new Set(), actor: new Set(), director: new Set(), saga: new Set() },
  selection: new Set(),
  selectionPanelOpen: false,
  selectionDetailId: "",
  activePanel: "genre",
  filtersOpen: false,
  lastFocus: null,
  lastSelectionFocus: null,
  backToTopVisible: null,
  // Cached "is the page tall enough to need a back-to-top button" flag. Recomputed
  // only on render/resize so the scroll handler never reads scrollHeight (which
  // forces a synchronous layout on every scroll tick).
  pageIsLong: false,
  optionCountsCache: new Map(),
  sagaTotalsCache: null
};

export function storageAvailable() {
  if (storageAvailabilityCache !== null) return storageAvailabilityCache;
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      storageAvailabilityCache = false;
      return storageAvailabilityCache;
    }

    const probeKey = "movieExplorer.storageProbe";
    window.localStorage.setItem(probeKey, "1");
    window.localStorage.removeItem(probeKey);
    storageAvailabilityCache = true;
    return storageAvailabilityCache;
  } catch {
    storageAvailabilityCache = false;
    return storageAvailabilityCache;
  }
}
export function resetStorageAvailabilityForTests() {
  storageAvailabilityCache = null;
}
export function readStoredValue(key) {
  if (!storageAvailable()) return null;
  try { return window.localStorage.getItem(key); }
  catch { return null; }
}
export function writeStoredValue(key, value) {
  if (!storageAvailable()) return;
  try { window.localStorage.setItem(key, value); }
  catch {}
}
export function removeStoredValue(key) {
  if (!storageAvailable()) return;
  try { window.localStorage.removeItem(key); }
  catch {}
}
export function loadPersistentState() {
  try {
    const selection = JSON.parse(readStoredValue(STORAGE_KEYS.selection) || "[]");
    if (Array.isArray(selection)) state.selection = new Set(selection.filter(Boolean));
  } catch {
    state.selection = new Set();
  }
}
export function persistSelection() {
  if (state.selection.size) writeStoredValue(STORAGE_KEYS.selection, JSON.stringify([...state.selection]));
  else removeStoredValue(STORAGE_KEYS.selection);
}
