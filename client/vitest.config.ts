import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unlike shared/server's "node" environment, several testable modules here run
    // document.getElementById(...) at module scope on import (e.g. characterPanel.ts,
    // npcAndQuestsPanel.ts), so a real DOM is needed just to import them, not only to test them.
    environment: "jsdom",
    // Loads index.html's real markup into jsdom's document before any test file's imports run -
    // see the setup file's own doc comment for why an empty jsdom document isn't enough.
    setupFiles: ["./test/setup.ts"],
  },
});
