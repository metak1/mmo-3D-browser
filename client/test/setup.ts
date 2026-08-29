import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Every ui/*.ts panel file queries document.getElementById/querySelector for its own DOM refs at
// module scope (and asserts non-null with `!`), matching real index.html's markup - importing any
// of those files for a test (even indirectly, e.g. npcAndQuestsPanel.ts importing
// buildShopSlot from inventoryPanel.ts) needs those elements to actually exist in jsdom's
// document, not just a working DOM API surface. Loading the real index.html's body once here,
// before any test file's imports run, is simpler and less brittle than hand-rolling fake markup
// per test and keeps it in sync with the real page for free.
// process.cwd() is the client/ workspace root when Vitest runs from client/vitest.config.ts,
// regardless of whether it's invoked via `npm run test -w client` or from inside client/ directly.
const indexHtmlPath = resolve(process.cwd(), "index.html");
const html = readFileSync(indexHtmlPath, "utf-8");
const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
if (!bodyMatch) throw new Error("client/test/setup.ts: could not find <body> in index.html");
document.body.innerHTML = bodyMatch[1];
