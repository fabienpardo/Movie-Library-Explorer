// Production entry point: boot the app directly. The test surface
// (window.__MovieExplorerTestHooks) is intentionally NOT imported here — both the
// unit suite (tests/helpers/app-hooks.js) and the E2E harness
// (tests/browser-test-utils.js) import src/test-hooks.mjs from source themselves,
// so production never has to expose internal state and mutation helpers.
import("./src/app.mjs").then(({ initApp }) => {
  if (typeof window === "undefined") return;
  if (!window.MOVIE_EXPLORER_SKIP_AUTO_INIT) initApp();
}).catch(error => {
  console.error("Movie Explorer failed to start", error);
  showFatalStartupError();
});

// If the module graph fails to load (a bad deploy, offline first visit with no cached
// shell, a blocked request), the app never boots and the initial "Chargement…" text
// would otherwise sit forever. Replace it with an actionable failure + retry.
function showFatalStartupError() {
  if (typeof document === "undefined") return;
  const status = document.getElementById("status");
  if (!status) return;
  status.hidden = false;
  const message = document.createElement("span");
  message.className = "error";
  message.textContent = "Le chargement de l’application a échoué. Vérifiez votre connexion, puis réessayez.";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "secondary-button";
  retry.textContent = "Réessayer";
  retry.addEventListener("click", () => window.location.reload());
  status.replaceChildren(message, document.createElement("br"), retry);
}

// Register the service worker for offline support (PWA app shell + CSV caching).
if ("serviceWorker" in navigator) {
  // The SW precaches the module graph under unversioned URLs and serves it
  // cache-first, so the first load after a deploy boots the OLD src/*.mjs (only
  // the versioned index.html/script.js come back fresh). When the updated SW takes
  // control, reload once so the new code actually runs instead of waiting for a
  // later visit. Guarded to genuine updates: no controller at boot means a first
  // install, where the page already loaded fresh from the network.
  if (navigator.serviceWorker.controller) {
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
