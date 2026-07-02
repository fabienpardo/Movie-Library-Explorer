export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

export function toSafeDomId(value, prefix = "id") {
  const safe = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return `${prefix}-${safe || "item"}`;
}

export function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function parseList(value) { return String(value || "").split(/[,;|]/).map(item => item.trim()).filter(Boolean); }

export function mainCountry(value) { return String(value || "").split(/[,;|/]/).map(item => item.trim()).filter(Boolean)[0] || ""; }

export function parseNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = String(value || "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
}

export function parseDateValue(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
  const raw = String(value || "").trim();
  if (!raw) return Number.NaN;

  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return strictUtcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dayFirst = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dayFirst) return strictUtcDate(Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]));

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function strictUtcDate(year, month, day) {
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? timestamp
    : Number.NaN;
}

export function parseRuntime(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value || "").toLowerCase().trim();
  if (!raw) return Number.NaN;

  // Plain numeric values are treated as minutes because the source data is expected to store runtimes in minutes.
  const hm = raw.match(/^(\d+)\s*(?:hours?|hrs?|h)\s*(\d+)?\s*(?:minutes?|mins?|m)?$/i);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2] || 0);

  const colon = raw.match(/^(\d+)\s*:\s*(\d{1,2})$/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);

  const min = raw.match(/(\d+(?:\.\d+)?)\s*(min|mins|minutes|m)?/i);
  return min ? Number(min[1]) : Number.NaN;
}

export function formatRuntime(minutes) {
  if (!Number.isFinite(minutes)) return "Durée inconnue";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h && m ? `${h} h ${m}` : h ? `${h} h` : `${m} min`;
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count > 1 ? plural : singular}`;
}

// Card/chip filter values live in data attributes, so encode them before insertion and decode on click.
export function encodeFilterValue(value) {
  return encodeURIComponent(String(value || ""));
}

export function decodeFilterValue(value) {
  try {
    return decodeURIComponent(value || "");
  } catch {
    return value || "";
  }
}
