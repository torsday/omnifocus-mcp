// Fixture OmniJS script used to verify the script-inlining loader.
// Accepts no arguments; returns a simple pong payload.
(() => {
  return JSON.stringify({ event: "pong", transport: "omnijs" });
})();
