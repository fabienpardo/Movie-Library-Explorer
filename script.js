import("./src/test-hooks.mjs").then(({ initApp, installTestHooks }) => {
  if (typeof window === "undefined") return;
  installTestHooks(window);
  if (!window.MOVIE_EXPLORER_SKIP_AUTO_INIT) initApp();
}).catch(error => {
  console.error("Movie Explorer failed to start", error);
});

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
