import("./src/test-hooks.mjs").then(({ initApp, installTestHooks }) => {
  if (typeof window === "undefined") return;
  installTestHooks(window);
  if (!window.MOVIE_EXPLORER_SKIP_AUTO_INIT) initApp();
}).catch(error => {
  console.error("Movie Explorer failed to start", error);
});
