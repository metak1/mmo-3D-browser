import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Integration tests hit a real Postgres + boot a real Colyseus room - give them more room
    // than unit tests' default 5s before Vitest calls a hang a failure.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
