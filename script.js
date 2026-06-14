import("./src/test-hooks.mjs").then(({ initApp, installTestHooks }) => {
  if (typeof window === "undefined") return;
  installTestHooks(window);
  if (!window.MOVIE_EXPLORER_SKIP_AUTO_INIT) initApp();
}).catch(error => {
  console.error("Movie Explorer failed to start", error);
});

// Register the service worker for offline support (PWA app shell + CSV caching).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
