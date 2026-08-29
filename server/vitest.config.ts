import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Integration tests hit a real Postgres + boot a real Colyseus room - give them more room
    // than unit tests' default 5s before Vitest calls a hang a failure.
    testTimeout: 20000,
    hookTimeout: 20000,
    // Each *.integration.test.ts file boots its own @colyseus/testing server on the same fixed
    // WS port - running test files in parallel (Vitest's default) makes two files' boot() calls
    // race for that port. Only integration tests actually pay for this (unit tests still run
    // fast); serializing all files is the simplest fix without hand-picking a distinct port per
    // integration test file.
    fileParallelism: false,
  },
});
